package session

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/codexcloud"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/store"
)

func (a *Service) cloudClient(ctx context.Context) (*codexcloud.Client, error) {
	if a.openCloudSessions == nil {
		return nil, errors.New("请在本机执行环境中启动 Codex Cloud 对话")
	}
	return codexcloud.Open(ctx, a.openCloudSessions)
}

func (a *Service) CloudEnvironmentsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	client, err := a.cloudClient(ctx)
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	environments, err := client.Environments(ctx)
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	httpx.WriteJSON(w, 200, environments)
}

func (a *Service) openCloudSession(ctx context.Context, id string) (*codexcloud.Client, store.CodexCloudSession, error) {
	thread, err := a.Execution.Store.CodexCloudSession(id)
	if err != nil {
		return nil, thread, err
	}
	client, err := a.cloudClient(ctx)
	if err == nil && client.Identity() != thread.Identity {
		err = errors.New("请切回创建此云端对话的 Codex 账号和工作区")
	}
	return client, thread, err
}

func (a *Service) createCloudSession(ctx context.Context, key, fingerprint string, input CreateSessionInput, provider string) (CreationResult, error) {
	if provider != model.ProviderCodex || input.Text == "" || len(input.Images) != 0 || input.Purpose != "" || input.Cwd != "" || input.Project != "" || input.Access != "" || len(input.Bindings) != 0 || input.AllowShared {
		return CreationResult{}, conversationFailure(400, "", "Codex Cloud 对话使用云端环境和文字消息")
	}
	client, err := a.cloudClient(ctx)
	if err != nil {
		return CreationResult{}, conversationFailure(503, "", err.Error())
	}
	environments, err := client.Environments(ctx)
	if err != nil {
		return CreationResult{}, conversationFailure(503, "", err.Error())
	}
	var environment codexcloud.Environment
	for _, item := range environments {
		if item.ID == input.CloudEnvironment {
			environment = item
			break
		}
	}
	if environment.ID == "" {
		return CreationResult{}, conversationFailure(409, "", "所选 Codex Cloud 环境已不可用，请刷新列表")
	}
	if err := a.Execution.Store.ReserveCreation(ctx, key, fingerprint); err != nil {
		return CreationResult{}, conversationStorageFailure(err)
	}
	thread, err := client.Start(ctx, environment.ID)
	if err != nil {
		return CreationResult{}, conversationFailure(503, "", "云端对话创建结果未确认："+err.Error())
	}
	now := time.Now().Unix()
	record := model.Session{ID: "cloud-" + thread.ID, Name: initialSessionTitle(input.Text), Cwd: thread.Cwd, Provider: model.ProviderCodexCloud, Source: "workbench", CreatedAt: now, UpdatedAt: now}
	cloud := store.CodexCloudSession{ThreadID: thread.ID, Identity: client.Identity(), Environment: environment.Name, Model: thread.Model}
	if err := a.Execution.Store.SaveCodexCloudSession(record, cloud, key); err != nil {
		return CreationResult{}, conversationStorageFailure(err)
	}
	release := a.lockSessionControl(record.ID)
	defer release()
	if err := a.launchCloudTurn(record, cloud, client, key, input.Text); err != nil {
		return CreationResult{}, conversationStorageFailure(err)
	}
	return CreationResult{SessionID: record.ID, Status: http.StatusAccepted}, nil
}

func (a *Service) startCloudTurn(ctx context.Context, record model.Session, key, text string, images []string) (ChatState, error) {
	if text == "" || len(images) != 0 {
		return ChatState{}, conversationFailure(400, "", "Codex Cloud 对话目前支持文字消息")
	}
	if a.ChatBusy(record.ID) {
		return ChatState{}, conversationFailure(409, "", "该对话正在运行，请等待完成或停止后再发送")
	}
	// Never replay a request after its in-memory run was evicted or after a
	// restart. Admission may already have happened even without a receipt.
	fingerprint, _, err := a.Execution.Store.InputReceipt(ctx, record.ID, key)
	if err == nil {
		if fingerprint != cloudMessageFingerprint(text) {
			return ChatState{}, conversationFailure(409, "", "发送标识已用于其他消息")
		}
		return ChatState{}, conversationFailure(409, "", "此消息已经发送或状态未确认，请刷新对话查看")
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ChatState{}, conversationStorageFailure(err)
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client, thread, err := a.openCloudSession(ctx, record.ID)
	if err != nil {
		return ChatState{}, conversationFailure(503, "", err.Error())
	}
	if err := a.launchCloudTurn(record, thread, client, key, text); err != nil {
		if errors.Is(err, errChatClosing) || errors.Is(err, errChatBusy) {
			return ChatState{}, runAdmissionFailure(err)
		}
		return ChatState{}, conversationStorageFailure(err)
	}
	return a.ChatFor(record.ID).snapshot(), nil
}

func cloudMessageFingerprint(text string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
}

func (a *Service) launchCloudTurn(record model.Session, thread store.CodexCloudSession, client *codexcloud.Client, requestID, text string) error {
	if err := a.Execution.Store.ReserveInput(context.Background(), record.ID, requestID, cloudMessageFingerprint(text)); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	run := &ChatRun{session: record.ID, provider: model.ProviderCodexCloud, cancel: cancel, finished: make(chan struct{})}
	run.state = ChatState{ID: requestID, Status: "starting", Busy: true, Entries: []HistoryEntry{}, Approvals: []ChatApproval{}, Context: &ChatContext{Cwd: record.Cwd, Model: thread.Model}}
	run.cloudInterrupt = func(ctx context.Context, turn string) error {
		current, _, err := a.openCloudSession(ctx, record.ID)
		if err != nil {
			return err
		}
		return current.Interrupt(ctx, thread.ThreadID, turn)
	}
	if err := a.publishRun(run); err != nil {
		cancel()
		return err
	}
	go a.driveCloudTurn(ctx, run, client, thread, text, requestID)
	return nil
}

func (a *Service) driveCloudTurn(ctx context.Context, run *ChatRun, client *codexcloud.Client, thread store.CodexCloudSession, text, requestID string) {
	defer a.finishRun(run)
	turn, err := client.Send(ctx, thread.ThreadID, requestID, text)
	if err != nil {
		run.change(func(s *ChatState) {
			s.Status, s.Busy, s.Error = "failed", false, "云端消息提交结果未确认，请刷新历史后检查："+err.Error()
		})
		return
	}
	persistErr := a.Execution.Store.ConfirmCloudInput(context.WithoutCancel(ctx), run.session, requestID, time.Now().Unix())
	run.change(func(s *ChatState) {
		s.TurnID, s.Status = turn, "running"
		if persistErr != nil {
			s.Notice = "消息已被云端接收，本机回执保存失败，请刷新核对历史。"
		}
	})
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	var completed string
	for {
		turns, err := client.Turns(ctx, thread.ThreadID)
		if err == nil {
			for _, current := range turns {
				if current.ID == turn && current.Status != "running" {
					completed = current.Status
					break
				}
			}
			items, _, itemErr := client.Items(ctx, thread.ThreadID, turn, "")
			if itemErr == nil {
				run.change(func(s *ChatState) {
					s.Entries = cloudEntries(items)
					s.Retrying = ""
					if completed != "" {
						s.Status, s.Busy = completed, false
						if completed == "failed" {
							s.Error = "Codex Cloud 运行失败，请查看已收到的消息"
						}
					}
				})
				if completed != "" {
					return
				}
			} else {
				err = itemErr
			}
		}
		if err != nil {
			run.change(func(s *ChatState) { s.Retrying = "云端连接暂时中断，正在重新读取运行状态" })
		}
		select {
		case <-ctx.Done():
			run.change(func(s *ChatState) {
				s.Busy, s.Status, s.Retrying, s.Error = false, "failed", "", "云端状态暂未确认，请刷新历史查看进展"
			})
			return
		case <-ticker.C:
		}
	}
}

func cloudEntries(items []codexcloud.Item) []HistoryEntry {
	entries := make([]HistoryEntry, 0, len(items))
	for _, item := range items {
		entry := HistoryEntry{ID: item.ID, TurnID: item.TurnID, Kind: item.Kind, Text: item.Text, Command: item.Command, Status: item.Status, StartedAtMs: item.StartedAtMs, CompletedAtMs: item.CompletedAtMs, ExitCode: item.ExitCode}
		if item.Kind == "command" {
			entry.Output = &item.Output
		}
		entries = append(entries, entry)
	}
	return entries
}

func (a *Service) cloudHistory(w http.ResponseWriter, r *http.Request, record model.Session) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	client, cloud, err := a.openCloudSession(ctx, record.ID)
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	items, cursor, err := client.Items(ctx, cloud.ThreadID, "", r.URL.Query().Get("cursor"))
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	history := SessionHistory{
		Session: codex.Session{ID: record.ID, Name: record.Name, Provider: record.Provider, CloudEnvironment: cloud.Environment, Model: cloud.Model, Cwd: record.Cwd, CreatedAt: record.CreatedAt, UpdatedAt: record.UpdatedAt},
		Entries: cloudEntries(items),
	}
	for _, item := range items {
		if item.Kind == "user" {
			history.HasUserMessage = true
			break
		}
	}
	if cursor != "" {
		history.NextCursor = &cursor
	}
	httpx.WriteJSON(w, 200, history)
}
