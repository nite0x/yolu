package session

import (
	"context"
	"errors"
	"fmt"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
)

func (a *Service) startCodexSession(startup context.Context, key, fingerprint string, input newSessionInput, execution executionContext) (*ChatRun, int, error) {
	plan := execution.plan
	ctx, cancel := context.WithCancel(context.WithoutCancel(startup))
	stopStartupCancellation := context.AfterFunc(startup, cancel)
	defer stopStartupCancellation()
	c, err := a.openLive(ctx)
	if err != nil {
		cancel()
		return nil, 503, err
	}
	keep := false
	defer func() {
		if !keep {
			c.Close()
			cancel()
		}
	}()
	requestCtx, end := context.WithTimeout(ctx, 15*time.Second)
	defer end()
	if input.Settings.Model != "" {
		models, err := codex.ListModels(func(method string, params any, out any) error { return c.Call(requestCtx, method, params, out) })
		if err != nil {
			return nil, 503, fmt.Errorf("无法核对默认模型：%w", err)
		}
		selected := findConversationModel(models, input.Settings.Model)
		if selected == nil {
			return nil, 400, errors.New("所选模型不可用，请更换模型或在设置中沿用 Codex 默认模型")
		}
		if err := validateSettingsForModel(input.Settings, selected); err != nil {
			return nil, 400, err
		}
	}
	var result struct {
		ChatContext
		Thread codex.Session `json:"thread"`
	}
	params := map[string]any{"cwd": plan.Cwd, "config": chatQuestionConfig()}
	if input.Settings.Model != "" {
		params["model"] = input.Settings.Model
	}
	if input.Settings.Effort != "" {
		params["config"].(map[string]any)["model_reasoning_effort"] = input.Settings.Effort
	}
	if err := a.configureCodexThread(startup, c, params, plan, input.Settings.Permission); err != nil {
		return nil, 409, err
	}
	if execution.instructions != "" && !plan.YoluAssistant {
		params["developerInstructions"] = codexDirectoryInstructions(execution.instructions) + "\n" + chatQuestionInstructions
	}
	if _, err := a.Execution.Store.DB.ExecContext(requestCtx, `INSERT INTO conversation_create_requests(request_id,fingerprint) VALUES(?,?)`, key, fingerprint); err != nil {
		return nil, 500, err
	}
	if err := requestCtx.Err(); err != nil {
		return nil, 503, err
	}
	if err := c.Call(requestCtx, "thread/start", params, &result); err != nil || result.Thread.ID == "" {
		return nil, 503, errors.New("Codex 创建失败或结果未确认，未发送消息：" + fmt.Sprint(err))
	}
	if err := verifyCodexProfile(params, result.ActivePermissionProfile); err != nil {
		return nil, 409, err
	}
	s := result.Thread
	// Publish a complete record before other controls can target this new ID.
	releaseSession := a.lockControlKey("session:" + s.ID)
	defer releaseSession()
	if s.Model == "" {
		s.Model = result.ChatContext.Model
	}
	if s.Effort == "" {
		s.Effort = result.ChatContext.Effort
	}
	s.Cwd = plan.Cwd
	s.Name = sessionName(s)
	initialTitle, titleNotice := false, ""
	// This runs exactly once, before the new thread is exposed to Yolu's
	// rename controls. Never retry an uncertain name write on subsequent turns.
	if s.Name == "" {
		if name := initialSessionTitle(input.Text); name != "" {
			if err := c.Call(requestCtx, "thread/name/set", map[string]any{"threadId": s.ID, "name": name}, &struct{}{}); err == nil {
				s.Name, initialTitle = name, true
			} else {
				titleNotice = "对话已创建，初始标题同步未确认，请刷新核对或手动重命名。"
			}
		}
	}
	if s.CreatedAt == 0 {
		s.CreatedAt = time.Now().Unix()
	}
	s.UpdatedAt = s.CreatedAt
	err = a.Execution.Store.SaveSessionWithBindings(model.Session{
		ID: s.ID, Name: s.Name, Cwd: s.Cwd, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, Source: "workbench", Permission: input.Settings.Permission, YoluAssistant: plan.YoluAssistant,
	}, execution.bindings)
	if err != nil {
		return nil, 500, err
	}
	plan.Bindings, err = a.Execution.Store.SessionBindings(s.ID)
	if err != nil {
		return nil, 500, err
	}
	if initialTitle {
		if err := a.Execution.Store.SetSessionTitle(s.ID, s.Name, "initial"); err != nil {
			return nil, 500, err
		}
	}
	if _, err := a.Execution.Store.DB.Exec(`UPDATE conversation_create_requests SET session_id=? WHERE request_id=?`, s.ID, key); err != nil {
		return nil, 500, err
	}
	run := &ChatRun{session: s.ID, cwd: s.Cwd, created: &s, client: c, cancel: cancel, notify: make(chan struct{}, 1), finished: make(chan struct{}), state: ChatState{ID: input.RequestID, Status: "starting", Busy: true, Entries: []HistoryEntry{}, Approvals: []ChatApproval{}, Notice: titleNotice}}
	run.settings = input.Settings
	run.createdContext = &result.ChatContext
	run.writeRoots = writableRoots(plan)
	run.directoryRoots = uniqueDirectories(append([]string{plan.Cwd}, plan.AdditionalDirectories...))
	run.managedBindings = plan.ManagedBindings
	plan.Permission = input.Settings.Permission
	a.chatMu.Lock()
	a.chats[s.ID] = run
	a.chatMu.Unlock()
	// Keep this exact connection through the first turn: a new thread has no
	// resumable rollout until that turn has begun.
	if !stopStartupCancellation() {
		cancel()
	}
	keep = true
	go a.DriveChat(ctx, run, plan, input.Text, input.Images...)
	return run, 202, nil
}
