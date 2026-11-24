package session

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

type newSessionInput struct {
	Text        string         `json:"text"`
	Project     string         `json:"project_id"`
	Cwd         string         `json:"cwd"`
	RequestID   string         `json:"request_id"`
	Purpose     string         `json:"purpose"`
	MergeHead   string         `json:"merge_head"`
	Provider    string         `json:"provider"`
	Images      []string       `json:"images"`
	Settings    TurnSettings   `json:"settings"`
	Bindings    []bindingInput `json:"bindings,omitempty"`
	Access      string         `json:"access,omitempty"`
	AllowShared bool           `json:"allow_shared,omitempty"`
}

var (
	errCreationUncertain = errors.New("上次创建结果未确认，为避免重复创建请先刷新对话列表检查")
	errCreationMismatch  = errors.New("创建标识已用于其他消息或工作目录")
)

func (in newSessionInput) fingerprint() string {
	raw, _ := json.Marshal(in)
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}

func (a *Service) createdSessionID(ctx context.Context, key, fingerprint string) (string, error) {
	var id, previous string
	err := a.Execution.Store.DB.QueryRowContext(ctx, `SELECT session_id,fingerprint FROM conversation_create_requests WHERE request_id=?`, key).Scan(&id, &previous)
	if err != nil {
		return "", err
	}
	if previous != "" && previous != fingerprint {
		return "", errCreationMismatch
	}
	if id == "" {
		return "", errCreationUncertain
	}
	return id, nil
}

func (a *Service) NewSessionHandler(w http.ResponseWriter, r *http.Request) {
	defer a.invalidateSessionCatalog()
	var input newSessionInput
	if !httpx.DecodeLimit(w, r, &input, chatRequestLimit) {
		return
	}
	if !model.SupportedProvider(input.Provider) {
		httpx.WriteError(w, 400, "不支持的对话引擎")
		return
	}
	provider := model.NormalizeProvider(input.Provider)
	if err := validateChatImages(input.Images); err != nil {
		httpx.WriteError(w, 400, err.Error())
		return
	}
	input.Text = strings.TrimSpace(input.Text)
	if err := input.Settings.validate(); err != nil {
		httpx.WriteError(w, 400, err.Error())
		return
	}
	if provider == model.ProviderAgy && input.Settings.ServiceTier != "" {
		httpx.WriteError(w, 400, "所选对话引擎不支持设置响应速度")
		return
	}
	if (input.Text == "" && len(input.Images) == 0 && input.Purpose != "merge_conflict") || len(input.Text) > 64000 || input.RequestID == "" || len(input.RequestID) > 100 || (input.Purpose != "" && input.Purpose != "merge_conflict") {
		httpx.WriteError(w, 400, "请输入第一条消息或添加图片（文字最多 64000 字节）并提供创建标识")
		return
	}
	// Persist the idempotency key before making any remote mutation. An uncertain
	// creation is never retried implicitly, including after a service restart.
	key := input.RequestID
	releaseControl := a.lockControl("create:" + key)
	defer releaseControl()
	fingerprint := input.fingerprint()
	existing, err := a.createdSessionID(r.Context(), key, fingerprint)
	if err == nil {
		a.WriteCreatedSession(w, existing, 200)
		return
	}
	if errors.Is(err, errCreationUncertain) || errors.Is(err, errCreationMismatch) {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		httpx.DbError(w, err)
		return
	}
	defaults, err := a.conversationPreferencesForProvider(r.Context(), provider)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	input.Settings = newConversationSettings(input.Settings, defaults)
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	target, err := a.resolveCreation(ctx, SessionTarget{
		ProjectID: input.Project, Cwd: input.Cwd, Bindings: input.Bindings, Access: input.Access,
		AllowShared: input.AllowShared, Provider: provider,
	}, key)
	if err == nil && input.Purpose == "merge_conflict" {
		if input.Project == "" {
			err = invalidSessionTarget("合并处理需要明确的项目和 Worktree")
		} else {
			input.Text, err = mergeConflictPrompt(ctx, target.plan.Cwd, input.MergeHead)
		}
	}
	if err != nil {
		status := 409
		if errors.Is(err, sql.ErrNoRows) {
			status = 404
		}
		var invalidTarget invalidSessionTarget
		if errors.As(err, &invalidTarget) {
			status = 400
		}
		httpx.WriteError(w, status, err.Error())
		return
	}
	if err := validateProviderBindings(provider, target.plan); err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	releaseDirectories, conflicts := a.reserveDirectories("create:"+key, "", target.plan)
	if releaseDirectories == nil {
		writeBindingConflict(w, conflicts)
		return
	}
	defer releaseDirectories()
	if provider == model.ProviderAgy {
		a.createAgySession(w, r, key, fingerprint, input, target)
		return
	}
	run, status, err := a.startCodexSession(context.WithoutCancel(ctx), key, fingerprint, input, target)

	if err != nil {
		if status == 500 {
			httpx.DbError(w, err)
		} else {
			httpx.WriteError(w, status, err.Error())
		}
		return
	}
	a.WriteCreatedSession(w, run.session, status)
}

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
		if err := input.Settings.validateForModel(selected); err != nil {
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
	if execution.instructions != "" {
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
		ID: s.ID, Name: s.Name, Cwd: s.Cwd, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, Source: "workbench", Permission: input.Settings.Permission,
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

func (a *Service) WriteCreatedSession(w http.ResponseWriter, session string, status int) {
	s, err := a.Execution.Store.Session(session)
	if err != nil {
		httpx.WriteError(w, 409, "已创建的对话记录不可用，请刷新后检查")
		return
	}
	s.Available = true
	chat := ChatState{Status: "idle", Entries: []HistoryEntry{}, Approvals: []ChatApproval{}}
	if run := a.ChatFor(session); run != nil {
		chat = run.snapshot()
	}
	httpx.WriteJSON(w, status, map[string]any{"session": s, "chat": chat})
}
