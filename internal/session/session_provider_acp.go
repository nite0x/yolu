package session

import (
	"context"
	"errors"
	"fmt"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/model"
)

func (a *Service) startACPSession(startup context.Context, provider, key, fingerprint string, input CreateSessionInput, execution executionContext) (*ChatRun, int, error) {
	if a.Execution.Remote != nil {
		return nil, 501, fmt.Errorf("暂不支持在远端 WSL 环境启动 %s 对话", model.ProviderName(provider))
	}
	plan := execution.plan
	ctx, cancel := context.WithCancel(context.WithoutCancel(startup))
	stopStartupCancellation := context.AfterFunc(startup, cancel)
	defer stopStartupCancellation()
	// ACP has no isolated directory grant. Preserve approved associations as
	// reference metadata and start only in the selected execution directory.
	plan.AdditionalDirectories = nil
	flags := a.acpFlags(provider, input.Settings.Permission, plan.AdditionalDirectories)
	c, _, err := a.openACP(ctx, provider, flags...)
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
	if err := a.Execution.Store.ReserveCreation(ctx, key, fingerprint); err != nil {
		return nil, 500, err
	}
	requestCtx, end := context.WithTimeout(ctx, 20*time.Second)
	defer end()

	params := map[string]any{
		"cwd":        plan.Cwd,
		"mcpServers": []any{},
	}
	if len(plan.AdditionalDirectories) > 0 {
		params["additionalDirectories"] = plan.AdditionalDirectories
	}
	if execution.instructions != "" && provider == model.ProviderAgy {
		params["_meta"] = map[string]any{
			"antigravity": map[string]any{
				"systemPrompt": map[string]any{"append": execution.instructions},
			},
		}
	}
	var setup acp.SessionSetupResult
	if err := c.Call(requestCtx, "session/new", params, &setup); err != nil || setup.SessionID == "" {
		msg := model.ProviderName(provider) + " 创建结果未确认，请刷新对话列表检查后再操作"
		if acp.IsAuthRequired(err) {
			msg = acpLoginAdvice(provider)
		} else if err != nil {
			msg = model.ProviderName(provider) + " 创建对话失败：" + err.Error()
		}
		return nil, 503, errors.New(msg)
	}
	releaseSession := a.lockControlKey("session:" + setup.SessionID)
	defer releaseSession()

	now := time.Now().Unix()
	name := initialSessionTitle(input.Text)
	rec := model.Session{
		ID:          setup.SessionID,
		Provider:    provider,
		Name:        name,
		TitleSource: "initial",
		Cwd:         plan.Cwd,
		CreatedAt:   now,
		UpdatedAt:   now,
		Source:      "workbench",
	}
	if err := a.Execution.Store.SaveCreatedSession(ctx, key, rec, execution.bindings); err != nil {
		return nil, 500, err
	}
	run := &ChatRun{
		provider:   provider,
		session:    rec.ID,
		cwd:        rec.Cwd,
		connection: c,
		cancel:     cancel,
		finished:   make(chan struct{}),
		settings:   input.Settings,
		state:      ChatState{ID: input.RequestID, Status: "starting", Busy: true, Entries: []HistoryEntry{}, Approvals: []ChatApproval{}},
	}
	run.writeRoots = writableRoots(plan)
	if err := a.publishRun(run); err != nil {
		return nil, 503, err
	}
	if !stopStartupCancellation() {
		cancel()
	}
	keep = true
	go a.driveACPTurn(ctx, run, plan, &setup, turnPrompt{text: input.Text, images: input.Images})
	return run, 202, nil
}
