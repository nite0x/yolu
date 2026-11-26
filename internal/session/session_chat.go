package session

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"strings"
	"sync"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

type ChatApproval struct {
	ID               string                 `json:"id"`
	Kind             string                 `json:"kind"`
	Title            string                 `json:"title"`
	Details          string                 `json:"details"`
	Questions        []ChatQuestion         `json:"questions,omitempty"`
	CanAccept        bool                   `json:"can_accept"`
	Choices          []ChatApprovalChoice   `json:"choices,omitempty"`
	Elicitation      *ChatElicitation       `json:"elicitation,omitempty"`
	ProjectAccess    *projectAccessApproval `json:"project_access,omitempty"`
	directoryBinding *model.SessionProjectBinding
	rpcID            json.RawMessage
	method           string
	params           json.RawMessage
}
type ChatQuestion struct {
	ID       string `json:"id"`
	Header   string `json:"header"`
	Question string `json:"question"`
	IsSecret bool   `json:"isSecret"`
	IsOther  bool   `json:"isOther"`
	Options  []struct {
		Label       string `json:"label"`
		Description string `json:"description"`
	} `json:"options"`
}
type ChatState struct {
	Prediction        *ChatPrediction `json:"prediction,omitempty"`
	PredictionPending bool            `json:"prediction_pending,omitempty"`
	SessionName       string          `json:"session_name,omitempty"`
	External          bool            `json:"external,omitempty"`
	Revision          uint64          `json:"revision"`
	ID                string          `json:"id,omitempty"`
	Status            string          `json:"status"`
	Busy              bool            `json:"busy"`
	TurnID            string          `json:"turn_id,omitempty"`
	Entries           []HistoryEntry  `json:"entries"`
	Approvals         []ChatApproval  `json:"approvals"`
	Error             string          `json:"error,omitempty"`
	Retrying          string          `json:"retrying,omitempty"`
	Blocked           string          `json:"blocked,omitempty"`
	CanHandoff        bool            `json:"can_handoff"`
	Notice            string          `json:"notice,omitempty"`
	AcceptedInputs    []string        `json:"accepted_inputs,omitempty"`
	Context           *ChatContext    `json:"context,omitempty"`
}
type ChatRun struct {
	mu                     sync.Mutex
	provider               string
	cloudInterrupt         func(context.Context, string) error
	state                  ChatState
	session, cwd           string
	client                 codex.LiveClient
	acpClient              acp.Client
	acpSetup               *acp.SessionSetupResult
	cancel                 context.CancelFunc
	notify                 chan struct{}
	finished               chan struct{}
	ended                  time.Time
	created                *codex.Session
	createdContext         *ChatContext
	handoff                bool
	settings               TurnSettings
	asyncRequest           string
	started                chan struct{}
	writeRoots             []string
	directoryRoots         []string
	baseline               map[string]fileSnapshot
	finalSnapshots         map[string]fileSnapshot
	configured             map[string]configuredDirectory
	directoryError         string
	managedBindings        bool
	permission             string
	pendingDirectoryGrants map[string]model.SessionProjectBinding
}

func (run *ChatRun) snapshot() ChatState {
	run.mu.Lock()
	defer run.mu.Unlock()
	s := run.state
	s.Entries = append([]HistoryEntry{}, s.Entries...)
	s.Approvals = append([]ChatApproval{}, s.Approvals...)
	s.AcceptedInputs = append([]string{}, s.AcceptedInputs...)
	return s
}
func (run *ChatRun) change(fn func(*ChatState)) {
	run.mu.Lock()
	fn(&run.state)
	run.state.Revision++
	run.mu.Unlock()
	select {
	case run.notify <- struct{}{}:
	default:
	}
}

func (a *Service) ChatStateHandler(w http.ResponseWriter, r *http.Request) {
	record, ok := a.requestSession(w, r)
	cwd := record.Cwd
	if !ok {
		return
	}
	state := ChatState{Status: "idle", Entries: []HistoryEntry{}, Approvals: []ChatApproval{}}
	if run := a.ChatFor(r.PathValue("session")); run != nil {
		state = run.snapshot()
	}
	if !state.Busy && model.NormalizeProvider(record.Provider) == model.ProviderCodex {
		// An unaccepted send has no turn ID. Its error must survive polling an
		// older completed rollout, so the composer can restore the failed draft.
		// A running/waiting native turn still owns its live controls.
		if external, ok := a.externalActivity(r.Context(), record.ID); ok && (state.ID == "" || external.Status == "running" || external.Status == "waiting" || external.TurnID != "" && external.TurnID != state.TurnID && (state.TurnID != "" || state.Error == "")) {
			state.Status = external.Status
			state.ID = ""
			state.Revision = 0
			state.Entries = []HistoryEntry{}
			state.Approvals = []ChatApproval{}
			state.Context = nil
			state.Error = ""
			state.AcceptedInputs = nil
			state.Prediction = nil
			state.PredictionPending = false
			state.External = true
			state.TurnID = external.TurnID
			state.Busy = external.Status == "running" || external.Status == "waiting"
			if state.Busy {
				state.Notice = "对话正在原生 Codex 中运行，进展会自动同步；请在原窗口处理停止或确认。"
			} else if external.Status == "unknown" {
				state.Notice = "暂时无法核实原生运行状态，请在 Codex 窗口确认。"
			}
		}
	}
	if !state.Busy && model.NormalizeProvider(record.Provider) == model.ProviderCodex {
		state.Blocked = ""
		state.CanHandoff = false
		if err := a.chatTerminalConflict(record.ID); err != nil {
			state.Blocked = err.Error()
			a.DecorateHandoff(&state, record.ID, cwd)
		}
	}
	a.prepareHistoryMedia(record.ID, state.Entries)
	if err := a.decorateAsyncQuestions(record.ID, state.Entries); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, state)
}
func (a *Service) ChatStartHandler(w http.ResponseWriter, r *http.Request) {
	releaseControl := a.lockSessionControl(r.PathValue("session"))
	defer releaseControl()
	var input struct {
		Text        string       `json:"text"`
		RequestID   string       `json:"request_id"`
		Images      []string     `json:"images"`
		Settings    TurnSettings `json:"settings"`
		AllowShared bool         `json:"allow_shared"`
	}
	if !httpx.DecodeLimit(w, r, &input, chatRequestLimit) {
		return
	}
	if err := validateChatImages(input.Images); err != nil {
		httpx.WriteError(w, 400, err.Error())
		return
	}
	input.Text = strings.TrimSpace(input.Text)
	if (input.Text == "" && len(input.Images) == 0) || len(input.Text) > 64000 || len(input.RequestID) > 100 || input.RequestID == "" {
		httpx.WriteError(w, 400, "请输入消息或添加图片（文字最多 64000 字节）并提供发送标识")
		return
	}
	record, ok := a.requestSession(w, r)
	if !ok {
		return
	}
	if previous := a.ChatFor(record.ID); previous != nil {
		snapshot := previous.snapshot()
		if snapshot.ID == input.RequestID {
			a.prepareHistoryMedia(record.ID, snapshot.Entries)
			httpx.WriteJSON(w, 200, snapshot)
			return
		}
	}
	if model.NormalizeProvider(record.Provider) == model.ProviderCodex {
		if external, ok := a.externalActivity(r.Context(), record.ID); ok && (external.Status == "running" || external.Status == "waiting") && !a.ChatBusy(record.ID) {
			httpx.WriteError(w, 409, "此对话仍在原生 Codex 中运行，请在原窗口继续或等待完成")
			return
		}
	}
	if record.Archived {
		httpx.WriteError(w, 409, "请先恢复已归档对话")
		return
	}
	if err := input.Settings.Validate(); err != nil {
		httpx.WriteError(w, 400, err.Error())
		return
	}
	if model.IsACPProvider(model.NormalizeProvider(record.Provider)) && input.Settings.ServiceTier != "" {
		httpx.WriteError(w, 400, "所选对话引擎不支持设置响应速度")
		return
	}
	if record.Provider == model.ProviderCodexCloud {
		a.cloudChatStart(w, r, record, input.RequestID, input.Text, input.Images)
		return
	}
	planCtx := execution.WithClient(r.Context(), a.Execution.Remote)
	plan, err := a.savedSessionPlan(planCtx, record, input.AllowShared)
	if err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	if err := validateProviderBindings(record.Provider, plan); err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	releaseDirectories, conflicts := a.reserveDirectories("session:"+record.ID, record.ID, plan)
	if releaseDirectories == nil {
		writeBindingConflict(w, conflicts)
		return
	}
	defer releaseDirectories()
	a.chatMu.Lock()
	if previous := a.chats[r.PathValue("session")]; previous != nil {
		s := previous.snapshot()
		if s.ID == input.RequestID {
			a.chatMu.Unlock()
			httpx.WriteJSON(w, 200, s)
			return
		}
		if s.Busy {
			a.chatMu.Unlock()
			httpx.WriteError(w, 409, "该对话正在运行，请等待完成或停止后再发送")
			return
		}
		if s.PredictionPending {
			previous.cancel()
		}
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(r.Context()))
	run := &ChatRun{provider: model.NormalizeProvider(record.Provider), session: r.PathValue("session"), cwd: plan.Cwd, cancel: cancel, notify: make(chan struct{}, 1), finished: make(chan struct{}), state: ChatState{ID: input.RequestID, Status: "starting", Busy: true, Entries: []HistoryEntry{}, Approvals: []ChatApproval{}}}
	run.settings = input.Settings
	run.writeRoots = writableRoots(plan)
	run.directoryRoots = uniqueDirectories(append([]string{plan.Cwd}, plan.AdditionalDirectories...))
	run.managedBindings = plan.ManagedBindings
	a.chats[run.session] = run
	a.chatMu.Unlock()
	a.pruneFinishedChats()
	if model.IsACPProvider(run.provider) {
		go a.DriveACPChat(ctx, run, plan, input.Text, input.Images...)
	} else {
		go a.DriveChat(ctx, run, plan, input.Text, input.Images...)
	}
	httpx.WriteJSON(w, 202, run.snapshot())
}
func (a *Service) DriveChat(ctx context.Context, run *ChatRun, plan model.LaunchPlan, text string, images ...string) {
	defer traceRun(ctx, run)()
	defer close(run.finished)
	defer run.cancel()
	defer func() { run.mu.Lock(); run.ended = time.Now(); run.mu.Unlock() }()
	defer run.change(func(s *ChatState) {
		s.Busy = false
		s.Retrying = ""
		s.Approvals = []ChatApproval{}
		if s.Status == "starting" || s.Status == "running" || s.Status == "waiting" || s.Status == "stopping" {
			s.Status = "failed"
			if s.Error == "" {
				s.Error = "对话连接已结束，请检查已保存的进展后重试"
			}
		}
	})
	fail := func(message string) {
		run.change(func(s *ChatState) {
			if s.Status == "stopping" {
				s.Status = "interrupted"
				s.Error = ""
			} else {
				s.Status = "failed"
				s.Error = message
			}
		})
	}
	c := run.client
	var err error
	if c == nil {
		c, err = a.openLive(ctx)
	}
	if err != nil {
		fail(err.Error())
		return
	}
	run.mu.Lock()
	run.client = c
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
	if run.created != nil {
		metadata.Thread.Session = *run.created
	} else if err := call("thread/read", map[string]any{"threadId": run.session, "includeTurns": false}, &metadata); err != nil {
		fail(err.Error())
		return
	}
	s := metadata.Thread.Session
	if s.ID != run.session || !platform.AbsoluteWorkspacePath(s.Cwd) {
		fail("对话原工作目录信息不可用")
		return
	}
	fileCtx := execution.WithClient(ctx, a.Execution.Remote)
	if !plan.ManagedBindings {
		var err error
		plan.Cwd, err = canonicalDirectory(fileCtx, s.Cwd)
		if err != nil {
			fail("对话原工作目录不可用")
			return
		}
	}
	if run.created == nil {
		if err := a.SaveSession(s, "codex", titleObservedAt); err != nil {
			fail(err.Error())
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
			fail("无法完成对话占用检查，请稍后重试：" + err.Error())
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
		fail(err.Error())
	}
	if run.created != nil {
		if run.createdContext != nil {
			resumed.ChatContext = *run.createdContext
			resumed.Sandbox, _ = run.createdContext.Sandbox.(map[string]any)
			if run.createdContext.ActivePermissionProfile != nil {
				profile = run.createdContext.ActivePermissionProfile.ID
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
	if run.created != nil && run.settings.Model != "" {
		// The first turn must resolve an explicitly selected model's default
		// effort even when thread/start already returned that same model.
		currentModel = ""
	}
	if err := a.applyTurnSettings(ctx, c, params, run.settings, currentModel, resumed.ChatContext.Effort); err != nil {
		fail(err.Error())
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
		fail(err.Error())
		return
	}
	if len(plan.Bindings) > 0 {
		inspect, cancel := context.WithTimeout(ctx, 5*time.Second)
		a.captureRunDirectories(inspect, run, plan.Bindings)
		cancel()
	}
	if run.created == nil {
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
			fail("无法核实当前对话状态，请稍后重试")
			return
		}
		metadata.Thread.Status.Type = latest.Thread.Status.Type
	}
	if err := checkOwner(); err != nil {
		ownerFailure(err)
		return
	}
	if err := call("turn/start", params, &started); err != nil {
		configurationFailure(err)
		return
	}
	if started.Turn.ID == "" {
		fail("Codex 未返回运行标识，请刷新历史检查进展")
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
	run.change(func(state *ChatState) { state.TurnID = started.Turn.ID; state.Status = "running" })
	if plan.ManagedBindings && !platform.SameWorkspacePath(s.Cwd, plan.Cwd) {
		s.Cwd = plan.Cwd
		_ = a.SaveSession(s, "codex", titleObservedAt)
	}
	if run.settings.Permission != "" && run.settings.Permission != plan.Permission {
		_ = a.Execution.Store.SetSessionPermission(run.session, run.settings.Permission)
	}
	a.startSessionTitle(run, text)
	if run.asyncRequest != "" {
		if err := a.Execution.Store.AcceptAsyncAnswer(context.WithoutCancel(ctx), run.session, run.asyncRequest); err != nil {
			fail(err.Error())
			return
		}
		close(run.started)
	}
	for {
		select {
		case event, ok := <-c.Events():
			if !ok {
				fail("Codex 实时连接断开，请刷新历史检查已保存的进展")
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
			_ = run.interrupt()
			fail("页面对话已停止，请刷新历史检查进展")
			return
		}
	}
}
func (run *ChatRun) interrupt() error {
	run.mu.Lock()
	provider := run.provider
	client, id := run.client, run.state.TurnID
	if run.handoff {
		run.mu.Unlock()
		run.cancel()
		return nil
	}
	run.mu.Unlock()
	if model.IsACPProvider(provider) {
		return run.interruptACP()
	}
	if provider == model.ProviderCodexCloud {
		if id == "" {
			return fmt.Errorf("云端尚未确认本轮消息")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
		defer cancel()
		return run.cloudInterrupt(ctx, id)
	}
	if client == nil || id == "" {
		run.cancel()
		return nil
	}
	ctx, end := context.WithTimeout(context.Background(), 5*time.Second)
	defer end()
	return client.Call(ctx, "turn/interrupt", map[string]any{"threadId": run.session, "turnId": id}, nil)
}
func (a *Service) ControlledRun(w http.ResponseWriter, r *http.Request, id string) *ChatRun {
	if _, ok := a.requestSession(w, r); !ok {
		return nil
	}
	run := a.ChatFor(r.PathValue("session"))
	if run == nil || run.snapshot().ID != id {
		httpx.WriteError(w, 409, "页面运行已变化，请重新打开对话后重试")
		return nil
	}
	return run
}
func (a *Service) ChatStopHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RunID string `json:"run_id"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	run := a.ControlledRun(w, r, input.RunID)
	if run == nil {
		return
	}
	if !run.snapshot().Busy {
		httpx.WriteJSON(w, 200, run.snapshot())
		return
	}
	run.change(func(s *ChatState) { s.Status = "stopping" })
	if err := run.interrupt(); err != nil {
		run.change(func(s *ChatState) {
			if s.Busy {
				s.Status = "running"
				if len(s.Approvals) > 0 {
					s.Status = "waiting"
				}
			}
		})
		httpx.WriteError(w, 503, "停止请求未确认："+err.Error())
		return
	}
	run.change(func(s *ChatState) {
		if s.Busy {
			s.Status = "stopping"
		}
	})
	httpx.WriteJSON(w, 200, run.snapshot())
}
func (a *Service) ChatEventsHandler(w http.ResponseWriter, r *http.Request) {
	run := a.ControlledRun(w, r, r.URL.Query().Get("run"))
	if run == nil {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.WriteError(w, 500, "浏览器连接不支持实时输出")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	last := ^uint64(0)
	for {
		s := run.snapshot()
		a.prepareHistoryMedia(r.PathValue("session"), s.Entries)
		if err := a.decorateAsyncQuestions(r.PathValue("session"), s.Entries); err != nil {
			return
		}
		if s.Revision != last {
			raw, _ := json.Marshal(s)
			_, err := fmt.Fprintf(w, "data: %s\n\n", raw)
			if err != nil {
				return
			}
			flusher.Flush()
			last = s.Revision
		}
		if !s.Busy && !s.PredictionPending {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
		}
	}
}

// Inspect snapshots outside the registry lock. Approval replies may need to
// look up other running writes while holding one run's lock.
func (a *Service) pruneFinishedChats() {
	a.chatMu.Lock()
	all := maps.Clone(a.chats)
	a.chatMu.Unlock()
	for id, run := range all {
		run.mu.Lock()
		expired := !run.ended.IsZero() && time.Since(run.ended) > 10*time.Minute
		run.mu.Unlock()
		if expired {
			a.chatMu.Lock()
			if a.chats[id] == run {
				delete(a.chats, id)
			}
			a.chatMu.Unlock()
		}
	}
}
