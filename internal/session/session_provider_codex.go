package session

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/platform"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
)

func (a *Service) startCodexSession(startup context.Context, key, fingerprint string, input CreateSessionInput, execution executionContext) (*ChatRun, int, error) {
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
	if err := a.Execution.Store.ReserveCreation(requestCtx, key, fingerprint); err != nil {
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
	record := model.Session{
		ID: s.ID, Name: s.Name, Cwd: s.Cwd, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, Source: "workbench", Permission: input.Settings.Permission, YoluAssistant: plan.YoluAssistant,
	}
	if initialTitle {
		record.TitleSource = "initial"
	}
	if err := a.Execution.Store.SaveCreatedSession(ctx, key, record, execution.bindings); err != nil {
		return nil, 500, err
	}
	plan.Bindings, err = a.Execution.Store.SessionBindings(s.ID)
	if err != nil {
		return nil, 500, err
	}
	run := &ChatRun{session: s.ID, cwd: s.Cwd, connection: c, cancel: cancel, finished: make(chan struct{}), state: ChatState{ID: input.RequestID, Status: "starting", Busy: true, Entries: []HistoryEntry{}, Approvals: []ChatApproval{}, Notice: titleNotice}}
	run.settings = input.Settings
	run.writeRoots = writableRoots(plan)
	run.directoryRoots = uniqueDirectories(append([]string{plan.Cwd}, plan.AdditionalDirectories...))
	run.managedBindings = plan.ManagedBindings
	plan.Permission = input.Settings.Permission
	if err := a.publishRun(run); err != nil {
		return nil, 503, err
	}
	// Keep this exact connection through the first turn: a new thread has no
	// resumable rollout until that turn has begun.
	if !stopStartupCancellation() {
		cancel()
	}
	keep = true
	go a.driveCodexTurn(ctx, run, plan, &codexCreation{thread: s, context: &result.ChatContext}, input.Text, input.Images...)
	return run, 202, nil
}

type codexCreation struct {
	thread  codex.Session
	context *ChatContext
}

func (a *Service) driveCodexTurn(ctx context.Context, run *ChatRun, plan model.LaunchPlan, initial *codexCreation, text string, images ...string) {
	defer traceRun(ctx, run)()
	defer a.finishRun(run)
	defer run.finishLocalTurn()

	c, _ := run.connection.(codex.LiveClient)
	var err error
	if c == nil {
		c, err = a.openLive(ctx)
	}
	if err != nil {
		run.fail(err.Error())
		return
	}
	run.mu.Lock()
	run.connection = c
	run.mu.Unlock()
	defer c.Close()
	call := func(method string, params any, result any) error {
		requestCtx, end := context.WithTimeout(ctx, 15*time.Second)
		defer end()
		return c.Call(requestCtx, method, params, result)
	}
	var metadata struct {
		Thread struct {
			codex.Session
			Status struct {
				Type string `json:"type"`
			} `json:"status"`
		} `json:"thread"`
	}
	titleObservedAt := time.Now().UnixNano()
	if initial != nil {
		metadata.Thread.Session = initial.thread
	} else if err := call("thread/read", map[string]any{"threadId": run.session, "includeTurns": false}, &metadata); err != nil {
		run.fail(err.Error())
		return
	}
	s := metadata.Thread.Session
	if s.ID != run.session || !platform.AbsoluteWorkspacePath(s.Cwd) {
		run.fail("对话原工作目录信息不可用")
		return
	}
	fileCtx := execution.WithClient(ctx, a.Execution.Remote)
	if !plan.ManagedBindings {
		var err error
		plan.Cwd, err = canonicalDirectory(fileCtx, s.Cwd)
		if err != nil {
			run.fail("对话原工作目录不可用")
			return
		}
	}
	if initial == nil {
		if err := a.SaveSession(s, "codex", titleObservedAt); err != nil {
			run.fail(err.Error())
			return
		}
	}
	run.mu.Lock()
	run.cwd = plan.Cwd
	run.mu.Unlock()
	checkOwner := func() error {
		if err := a.chatTerminalConflict(run.session); err != nil {
			return err
		}
		if metadata.Thread.Status.Type == "active" {
			return &execution.SessionConflictError{Message: "此对话正在其他 Codex 客户端运行，请等待完成后重试"}
		}
		return nil
	}
	ownerFailure := func(err error) {
		if execution.IsSessionConflict(err) {
			run.change(func(s *ChatState) { s.Status = "conflict"; s.Error = err.Error() })
		} else {
			run.fail("无法完成对话占用检查，请稍后重试：" + err.Error())
		}
	}
	if err := checkOwner(); err != nil {
		ownerFailure(err)
		return
	}
	var resumed struct {
		ChatContext
		Thread struct {
			Status struct {
				Type string `json:"type"`
			} `json:"status"`
		} `json:"thread"`
		Sandbox map[string]any `json:"sandbox"`
	}
	effectivePermission := run.settings.Permission
	if effectivePermission == "" && plan.ManagedBindings {
		effectivePermission = plan.Permission
	}
	run.mu.Lock()
	run.permission = effectivePermission
	run.mu.Unlock()
	var profile string
	configurationFailure := func(err error) {
		// A separate app-server may retain an idle thread's writer lock. This
		// is ownership contention, not a failed turn or directory permission.
		if strings.Contains(err.Error(), "already has an active writer") {
			run.change(func(s *ChatState) {
				s.Status = "conflict"
				s.Error = "另一个 Codex 后台仍持有此对话的写入锁，CLI 后台暂时无法继续。"
				s.Notice = "消息已保留，可在原 Codex 窗口继续此对话；待原后台释放写入锁后，再在 Yolu 重试发送。"
			})
			return
		}
		run.mu.Lock()
		run.directoryError = err.Error()
		run.mu.Unlock()
		run.fail(err.Error())
	}
	if initial != nil {
		if initial.context != nil {
			resumed.ChatContext = *initial.context
			resumed.Sandbox, _ = initial.context.Sandbox.(map[string]any)
			if initial.context.ActivePermissionProfile != nil {
				profile = initial.context.ActivePermissionProfile.ID
			}
		}
	} else {
		resumeParams := map[string]any{"threadId": run.session, "excludeTurns": true, "config": chatQuestionConfig()}
		if err := a.configureCodexThread(ctx, c, resumeParams, plan, effectivePermission); err != nil {
			configurationFailure(err)
			return
		}
		if err := call("thread/resume", resumeParams, &resumed); err != nil {
			configurationFailure(err)
			return
		}
		if err := verifyCodexProfile(resumeParams, resumed.ActivePermissionProfile); err != nil {
			configurationFailure(err)
			return
		}
		profile, _ = resumeParams["permissions"].(string)
	}
	if plan.ManagedBindings && effectivePermission != "full" && profile == "" {
		configurationFailure(fmt.Errorf("Codex 没有核实对话目录权限"))
		return
	}
	defer func() {
		endCtx, end := context.WithTimeout(context.Background(), 2*time.Second)
		defer end()
		_ = c.Call(endCtx, "thread/unsubscribe", map[string]any{"threadId": run.session}, nil)
	}()
	metadata.Thread.Status.Type = resumed.Thread.Status.Type
	if err := checkOwner(); err != nil {
		ownerFailure(err)
		return
	}
	params := map[string]any{"threadId": run.session, "cwd": plan.Cwd, "input": chatTurnInput(text, images)}
	if run.asyncRequest != "" {
		params["clientUserMessageId"] = run.asyncRequest
	}
	currentModel := s.Model
	if initial != nil && run.settings.Model != "" {
		// The first turn must resolve an explicitly selected model's default
		// effort even when thread/start already returned that same model.
		currentModel = ""
	}
	if err := a.applyTurnSettings(ctx, c, params, run.settings, currentModel, resumed.ChatContext.Effort); err != nil {
		run.fail(err.Error())
		return
	}
	resumed.ChatContext.Sandbox = resumed.Sandbox
	if mode, ok := params["collaborationMode"].(map[string]any); ok {
		if settings, ok := mode["settings"].(map[string]any); ok {
			resumed.ChatContext.Model, _ = settings["model"].(string)
			resumed.ChatContext.Effort, _ = settings["reasoning_effort"].(string)
		}
	}
	resumed.ChatContext.Cwd = plan.Cwd
	resumed.ChatContext.AdditionalDirectories = plan.AdditionalDirectories
	if resumed.ChatContext.Model == "" {
		resumed.ChatContext.Model = s.Model
	}
	if run.settings.Model != "" {
		resumed.ChatContext.Model = run.settings.Model
	}
	if run.settings.Effort != "" {
		resumed.ChatContext.Effort = run.settings.Effort
	}
	if effort, ok := params["effort"].(string); ok {
		resumed.ChatContext.Effort = effort
	}
	resumed.ChatContext.Mode = run.settings.Mode
	if run.settings.ServiceTier != "" {
		resumed.ChatContext.ServiceTier = run.settings.ServiceTier
	}
	if plan.ManagedBindings {
		addCodexDirectoryContext(params, plan.Bindings)
		params["runtimeWorkspaceRoots"] = uniqueDirectories(append([]string{plan.Cwd}, plan.AdditionalDirectories...))
		if effectivePermission == "full" {
			setTurnPermissions(params, "full", writableRoots(plan))
			resumed.ChatContext.ApprovalPolicy = params["approvalPolicy"]
			resumed.ChatContext.ApprovalsReviewer = params["approvalsReviewer"].(string)
			resumed.ChatContext.Sandbox = params["sandboxPolicy"]
		} else {
			reviewer := "user"
			if effectivePermission == "auto" {
				reviewer = "auto_review"
			}
			params["permissions"] = profile
			params["approvalPolicy"] = "on-request"
			params["approvalsReviewer"] = reviewer
			resumed.ChatContext.ApprovalPolicy = "on-request"
			resumed.ChatContext.ApprovalsReviewer = reviewer
		}
	} else {
		if resumed.Sandbox["type"] == "workspaceWrite" && len(plan.AdditionalDirectories) > 0 {
			resumed.Sandbox["writableRoots"] = writableRoots(plan)
			params["sandboxPolicy"] = resumed.Sandbox
		}
		if run.settings.Permission != "" {
			setTurnPermissions(params, run.settings.Permission, writableRoots(plan))
			resumed.ChatContext.ApprovalPolicy = params["approvalPolicy"]
			resumed.ChatContext.ApprovalsReviewer = params["approvalsReviewer"].(string)
			resumed.ChatContext.Sandbox = params["sandboxPolicy"]
		}
	}
	if resumed.ChatContext.Effort == "" {
		resumed.ChatContext.Effort = s.Effort
	}
	run.change(func(state *ChatState) { state.Context = &resumed.ChatContext })
	var started struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := ctx.Err(); err != nil {
		run.fail(err.Error())
		return
	}
	if len(plan.Bindings) > 0 {
		inspect, cancel := context.WithTimeout(ctx, 5*time.Second)
		a.captureRunDirectories(inspect, run, plan.Bindings)
		cancel()
	}
	if initial == nil {
		// Settings discovery and directory snapshots may take time. Recheck the
		// shared runtime just before sending to catch CLI turns that started
		// meanwhile. The protocol has no atomic idle-only start precondition.
		var latest struct {
			Thread codex.Session `json:"thread"`
		}
		if err := call("thread/read", map[string]any{"threadId": run.session, "includeTurns": false}, &latest); err != nil {
			ownerFailure(err)
			return
		}
		if latest.Thread.ID != run.session {
			run.fail("无法核实当前对话状态，请稍后重试")
			return
		}
		metadata.Thread.Status.Type = latest.Thread.Status.Type
	}
	if err := checkOwner(); err != nil {
		ownerFailure(err)
		return
	}
	run.mu.Lock()
	if run.stopRequested {
		run.mu.Unlock()
		run.fail("")
		return
	}
	run.turnSubmitting = true
	run.mu.Unlock()
	if err := call("turn/start", params, &started); err != nil {
		configurationFailure(err)
		return
	}
	if started.Turn.ID == "" {
		run.fail("Codex 未返回运行标识，请刷新历史检查进展")
		return
	}
	// Freeze the completed turn's directory state before waiting for an
	// optional prediction; suggestions must never keep the turn busy.
	defer run.predictNextPrompt(ctx, c)
	defer a.freezeRunDirectories(run)
	run.mu.Lock()
	run.configured = map[string]configuredDirectory{}
	for _, b := range plan.Bindings {
		run.configured[b.Directory] = configuredDirectory{id: b.ID, access: b.Access, updatedAt: b.UpdatedAt}
	}
	run.mu.Unlock()
	var stopQueued bool
	run.change(func(state *ChatState) {
		run.turnSubmitting = false
		state.TurnID = started.Turn.ID
		stopQueued = run.stopRequested
		if !stopQueued {
			state.Status = "running"
		}
	})
	if stopQueued {
		if err := run.interrupt(); err != nil {
			run.restoreAfterStopFailure()
			run.change(func(s *ChatState) { s.Notice = "停止请求未确认，请重试" })
		}
	}
	if plan.ManagedBindings && !platform.SameWorkspacePath(s.Cwd, plan.Cwd) {
		s.Cwd = plan.Cwd
		_ = a.SaveSession(s, "codex", titleObservedAt)
	}
	if run.settings.Permission != "" && run.settings.Permission != plan.Permission {
		_ = a.Execution.Store.SetSessionPermission(run.session, run.settings.Permission)
	}
	if initial != nil {
		a.startSessionTitle(run, text)
	}
	if run.asyncRequest != "" {
		if err := a.Execution.Store.AcceptAsyncAnswer(context.WithoutCancel(ctx), run.session, run.asyncRequest); err != nil {
			run.fail(err.Error())
			return
		}
		a.asyncAnswersChanged(run.session)
		close(run.started)
	}
	for {
		select {
		case event, ok := <-c.Events():
			if !ok {
				run.fail("Codex 实时连接断开，请刷新历史检查已保存的进展")
				return
			}
			if event.Method == "thread/name/updated" {
				a.syncSessionName(run, event)
				continue
			}
			if a.handleDirectoryPermission(ctx, run, event) {
				continue
			}
			if run.handle(event) {
				return
			}
		case <-ctx.Done():
			run.fail("页面对话已停止，请刷新历史检查进展")
			return
		}
	}
}

func steerCodex(ctx context.Context, client codex.LiveClient, session, turn, request, text string, images []string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	var result struct {
		TurnID string `json:"turnId"`
	}
	if err := client.Call(ctx, "turn/steer", map[string]any{
		"threadId": session, "expectedTurnId": turn, "clientUserMessageId": request, "input": chatTurnInput(text, images),
	}, &result); err != nil {
		return err
	}
	if result.TurnID != turn {
		return errors.New("Codex 未确认当前轮次")
	}
	return nil
}
