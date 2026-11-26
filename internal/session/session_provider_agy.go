package session

import (
	"context"
	"errors"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/agy"
	"worktree-hub/internal/model"
)

func (a *Service) startAgySession(startup context.Context, key, fingerprint string, input newSessionInput, execution executionContext) (*ChatRun, int, error) {
	if a.Execution.Remote != nil {
		return nil, 501, errors.New("暂不支持在远端 WSL 环境启动 Antigravity 对话")
	}
	plan := execution.plan
	ctx, cancel := context.WithCancel(context.WithoutCancel(startup))
	// ACP has no isolated directory grant. Preserve approved associations as
	// reference metadata and start only in the selected execution directory.
	plan.AdditionalDirectories = nil
	flags := agy.ACPFlagsForPermission(input.Settings.Permission, plan.AdditionalDirectories)
	c, _, err := a.openAgy(ctx, flags...)
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
	if _, err := a.Execution.Store.DB.Exec(`INSERT INTO conversation_create_requests(request_id,fingerprint) VALUES(?,?)`, key, fingerprint); err != nil {
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
	if execution.instructions != "" {
		params["_meta"] = map[string]any{
			"antigravity": map[string]any{
				"systemPrompt": map[string]any{"append": execution.instructions},
			},
		}
	}
	var setup acp.SessionSetupResult
	if err := c.Call(requestCtx, "session/new", params, &setup); err != nil || setup.SessionID == "" {
		msg := "Antigravity 创建结果未确认，请刷新对话列表检查后再操作"
		if acp.IsAuthRequired(err) {
			msg = "Antigravity 尚未登录，请先在终端运行 agy 或 agy acp --login 完成登录"
		} else if err != nil {
			msg = "Antigravity 创建对话失败：" + err.Error()
		}
		return nil, 503, errors.New(msg)
	}
	releaseSession := a.lockControlKey("session:" + setup.SessionID)
	defer releaseSession()

	now := time.Now().Unix()
	name := initialSessionTitle(input.Text)
	rec := model.Session{
		ID:          setup.SessionID,
		Provider:    model.ProviderAgy,
		Name:        name,
		TitleSource: "initial",
		Cwd:         plan.Cwd,
		CreatedAt:   now,
		UpdatedAt:   now,
		Source:      "workbench",
	}
	err = a.Execution.Store.SaveSessionWithBindings(rec, execution.bindings)
	if err != nil {
		return nil, 500, err
	}
	if name != "" {
		if err := a.Execution.Store.SetSessionTitle(rec.ID, name, "initial"); err != nil {
			return nil, 500, err
		}
	}
	if _, err := a.Execution.Store.DB.Exec(`UPDATE conversation_create_requests SET session_id=? WHERE request_id=?`, rec.ID, key); err != nil {
		return nil, 500, err
	}
	run := &ChatRun{
		provider:  model.ProviderAgy,
		session:   rec.ID,
		cwd:       rec.Cwd,
		acpClient: c,
		acpSetup:  &setup,
		cancel:    cancel,
		notify:    make(chan struct{}, 1),
		finished:  make(chan struct{}),
		settings:  input.Settings,
		state:     ChatState{ID: input.RequestID, Status: "starting", Busy: true, Entries: []HistoryEntry{}, Approvals: []ChatApproval{}},
	}
	run.writeRoots = writableRoots(plan)
	a.chatMu.Lock()
	a.chats[rec.ID] = run
	a.chatMu.Unlock()
	keep = true
	go a.DriveAgyChat(ctx, run, plan, input.Text, input.Images...)
	return run, 202, nil
}
