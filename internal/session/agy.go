package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/agy"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

func (a *Service) AgyDiagnosticsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if a.Execution.Remote != nil {
		var report agy.Diagnostics
		if err := a.Execution.Remote.Call(ctx, execution.Request{Op: "agy-diagnostics"}, &report); err != nil {
			httpx.WriteError(w, 503, "无法在远端环境执行 Antigravity 检测："+err.Error())
			return
		}
		httpx.WriteJSON(w, 200, report)
		return
	}
	httpx.WriteJSON(w, 200, a.diagnoseAgy(ctx))
}

func (a *Service) agyOptionsCatalog(ctx context.Context, refresh bool) (agy.OptionCatalog, error) {
	fallback := agy.OptionCatalog{Models: []codex.ChatModel{}, Modes: agy.DefaultModes}
	if a.Execution.Remote != nil {
		return fallback, fmt.Errorf("暂不支持在远端 WSL 环境运行 Antigravity 对话")
	}
	a.agyCatalogMu.Lock()
	cached := a.agyCatalog
	a.agyCatalogMu.Unlock()
	if cached != nil && !refresh {
		return *cached, nil
	}
	catalog, err := agy.DiscoverCatalog(ctx, a.openAgy)
	if err == nil && len(catalog.Models) > 0 {
		a.agyCatalogMu.Lock()
		a.agyCatalog = &catalog
		a.agyCatalogMu.Unlock()
		return catalog, nil
	}
	if cached != nil {
		return *cached, err
	}
	if models := agy.ListCLIModels(ctx); len(models) > 0 {
		fallback.Models = models
		return fallback, nil
	}
	return fallback, err
}

func (a *Service) agyChatOptions(ctx context.Context) map[string]any {
	defaults, _ := a.conversationPreferencesForProvider(ctx, model.ProviderAgy)
	catalog, _ := a.agyOptionsCatalog(ctx, false)
	return map[string]any{
		"provider":     model.ProviderAgy,
		"models":       catalog.Models,
		"modes":        catalog.Modes,
		"defaults":     defaults,
		"capabilities": model.CapabilitiesForProvider(model.ProviderAgy),
	}
}

func (a *Service) scanAgyCatalog(ctx context.Context, scope sessionScope, archived bool) (map[string]model.Session, error) {
	found := map[string]model.Session{}
	if archived || a.Execution.Remote != nil {
		return found, nil
	}
	scanCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	c, _, err := a.openAgy(scanCtx)
	if err != nil {
		return found, err
	}
	defer c.Close()

	observed := time.Now().UnixNano()
	params := map[string]any{}
	if len(scope.paths) == 1 {
		params["cwd"] = scope.paths[0]
	}
	seenCursors := map[string]bool{}
	for {
		var page acp.SessionListResult
		if err := c.Call(scanCtx, "session/list", params, &page); err != nil {
			return found, err
		}
		for _, item := range page.Sessions {
			if item.SessionID == "" || !scope.includes(item.SessionID, item.Cwd) {
				continue
			}
			updated := acp.ParseTimestamp(item.UpdatedAt)
			created := acp.ParseTimestamp(item.CreatedAt)
			if created == 0 {
				created = updated
			}
			if updated == 0 {
				updated = created
			}
			title := strings.TrimSpace(item.Title)
			if len([]rune(title)) > 160 {
				title = string([]rune(title)[:160])
			}
			rec := model.Session{
				ID:        item.SessionID,
				Provider:  model.ProviderAgy,
				Name:      title,
				Cwd:       item.Cwd,
				CreatedAt: created,
				UpdatedAt: updated,
				Source:    "agy",
				Available: true,
			}
			found[rec.ID] = rec
			if err := a.Execution.Store.SaveSession(rec, observed); err != nil {
				return found, err
			}
		}
		if page.NextCursor == nil || *page.NextCursor == "" || seenCursors[*page.NextCursor] {
			break
		}
		seenCursors[*page.NextCursor] = true
		params["cursor"] = *page.NextCursor
	}
	return found, nil
}

func (a *Service) readAgySessionHistory(ctx context.Context, record model.Session) (SessionHistory, error) {
	history := SessionHistory{
		Session: codex.Session{
			ID:        record.ID,
			Name:      record.Name,
			Cwd:       record.Cwd,
			CreatedAt: record.CreatedAt,
			UpdatedAt: record.UpdatedAt,
		},
		Entries: []HistoryEntry{},
	}
	if a.Execution.Remote != nil {
		return history, fmt.Errorf("暂不支持在远端 WSL 环境读取 Antigravity 对话历史")
	}
	loadCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	c, _, err := a.openAgy(loadCtx)
	if err != nil {
		return history, err
	}
	defer func() {
		closeCtx, end := context.WithTimeout(context.Background(), 2*time.Second)
		defer end()
		_ = c.Call(closeCtx, "session/close", map[string]any{"sessionId": record.ID}, nil)
		c.Close()
	}()

	reducer := newACPUpdateReducer()
	setup, err := loadAgyReplay(loadCtx, c, record.ID, map[string]any{
		"sessionId":  record.ID,
		"cwd":        record.Cwd,
		"mcpServers": []any{},
	}, reducer)
	if err != nil {
		return history, err
	}
	cat := agy.CatalogFromSetup(setup)
	history.Session.Model = cat.CurrentModel
	history.Session.Effort = cat.CurrentEffort
	if reducer.title != "" && record.TitleSource != "manual" {
		history.Session.Name = reducer.title
	}
	history.Entries = reducer.entries()
	for i := range history.Entries {
		entry := &history.Entries[i]
		if entry.Kind == "user" {
			history.HasUserMessage = true
		}
		if entry.Status == "inProgress" {
			entry.Status = "interrupted"
			if entry.Kind == "assistant" {
				entry.Status = "completed"
			}
		}
	}
	return history, nil
}

// Use the same ACP replay for reading history and locating the next turn.
func loadAgyReplay(ctx context.Context, c acp.Client, sessionID string, params map[string]any, reducer *acpUpdateReducer) (acp.SessionSetupResult, error) {
	callDone := make(chan error, 1)
	var setup acp.SessionSetupResult
	go func() {
		callDone <- c.Call(ctx, "session/load", params, &setup)
	}()

	events := c.Events()
	var drained <-chan time.Time
	for {
		select {
		case msg, ok := <-events:
			if !ok {
				events = nil
				if callDone == nil {
					return setup, nil
				}
				continue
			}
			if msg.Method == "session/update" {
				reducer.applyRaw(msg.Params, sessionID)
			}
		case err := <-callDone:
			if err != nil || events == nil {
				return setup, err
			}
			callDone = nil
			// ACP notifications and replies arrive on separate channels.
			timer := time.NewTimer(30 * time.Millisecond)
			defer timer.Stop()
			drained = timer.C
		case <-drained:
			return setup, nil
		case <-ctx.Done():
			return acp.SessionSetupResult{}, ctx.Err()
		}
	}
}

func (a *Service) DriveAgyChat(ctx context.Context, run *ChatRun, plan model.LaunchPlan, text string, images ...string) {
	defer traceRun(ctx, run)()
	if plan.ManagedBindings {
		plan.AdditionalDirectories = nil
	}
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
	if a.Execution.Remote != nil {
		fail("暂不支持在远端 WSL 环境运行 Antigravity 对话")
		return
	}
	if !platform.AbsoluteWorkspacePath(plan.Cwd) {
		fail("对话工作目录不可用")
		return
	}
	fileCtx := execution.WithClient(ctx, a.Execution.Remote)
	if info, err := execution.Stat(fileCtx, plan.Cwd, true); err != nil || !info.IsDir() {
		fail("对话原工作目录不可用")
		return
	}

	c := run.acpClient
	replay := newACPUpdateReducer()
	var setup acp.SessionSetupResult
	if run.acpSetup != nil {
		setup = *run.acpSetup
	}
	if c == nil {
		flags := agy.ACPFlagsForPermission(run.settings.Permission, plan.AdditionalDirectories)
		var err error
		c, _, err = a.openAgy(ctx, flags...)
		if err != nil {
			fail(err.Error())
			return
		}
		run.mu.Lock()
		run.acpClient = c
		run.mu.Unlock()
		resumeCtx, endResume := context.WithTimeout(ctx, 20*time.Second)
		resumeParams := map[string]any{
			"sessionId":  run.session,
			"cwd":        plan.Cwd,
			"mcpServers": []any{},
		}
		if len(plan.AdditionalDirectories) > 0 {
			resumeParams["additionalDirectories"] = plan.AdditionalDirectories
		}
		setup, err = loadAgyReplay(resumeCtx, c, run.session, resumeParams, replay)
		endResume()
		if err != nil {
			if acp.IsAuthRequired(err) {
				fail("Antigravity 尚未登录，请先在终端运行 agy 或 agy acp --login 完成登录")
			} else {
				fail("无法恢复 Antigravity 对话：" + err.Error())
			}
			c.Close()
			return
		}
	}
	defer func() {
		closeCtx, end := context.WithTimeout(context.Background(), 2*time.Second)
		defer end()
		_ = c.Call(closeCtx, "session/close", map[string]any{"sessionId": run.session}, nil)
		c.Close()
	}()

	cat := agy.CatalogFromSetup(setup)
	if err := applyAgyTurnSettings(ctx, c, run.session, &cat, run.settings); err != nil {
		fail(err.Error())
		return
	}
	chatCtx := buildAgyChatContext(plan, cat, run.settings)
	reducer := newACPUpdateReducer()
	reducer.turnSeq = replay.turnSeq
	reducer.live = true
	reducer.startTurn(text, images, "")
	run.change(func(s *ChatState) {
		s.Context = &chatCtx
		s.TurnID = reducer.currentTurn()
		s.Status = "running"
		s.Entries = reducer.entries()
	})

	promptBlocks := agyPromptBlocks(text, images)
	type promptOutcome struct {
		res acp.PromptResult
		err error
	}
	promptDone := make(chan promptOutcome, 1)
	go func() {
		var res acp.PromptResult
		err := c.Call(ctx, "session/prompt", map[string]any{
			"sessionId": run.session,
			"prompt":    promptBlocks,
		}, &res)
		promptDone <- promptOutcome{res: res, err: err}
	}()

	handleMessage := func(msg acp.Message) {
		if msg.Method == "session/request_permission" && len(msg.ID) > 0 {
			approval, err := makeACPPermissionApproval(msg)
			if err != nil {
				_ = c.Reply(msg.ID, map[string]any{"outcome": map[string]any{"outcome": "cancelled"}})
				return
			}
			run.change(func(s *ChatState) {
				s.Approvals = append(s.Approvals, approval)
				s.Status = "waiting"
			})
			return
		}
		if len(msg.ID) > 0 {
			// Unknown server-to-client RPC: reject explicitly rather than hanging the turn.
			_ = c.ReplyError(msg.ID, -32601, "Method not supported by Yolu client: "+msg.Method)
			return
		}
		if msg.Method == "session/update" {
			changedTitle := reducer.applyRaw(msg.Params, run.session)
			if changedTitle != "" {
				if updated, err := a.Execution.Store.ObserveSessionTitle(run.session, changedTitle); err == nil && updated {
					run.change(func(s *ChatState) { s.SessionName = changedTitle })
				}
			}
			entries := reducer.entries()
			run.change(func(s *ChatState) {
				s.Retrying = ""
				s.Entries = entries
			})
		}
	}

	for {
		select {
		case msg, ok := <-c.Events():
			if !ok {
				fail("Antigravity 实时连接断开，请刷新历史检查已保存的进展")
				return
			}
			handleMessage(msg)
		case outcome := <-promptDone:
			// Drain any trailing session/update notifications emitted right before the RPC reply.
			drain := time.NewTimer(40 * time.Millisecond)
		drainLoop:
			for {
				select {
				case msg, ok := <-c.Events():
					if !ok {
						break drainLoop
					}
					if msg.Method == "session/update" {
						handleMessage(msg)
					}
				case <-drain.C:
					break drainLoop
				}
			}
			drain.Stop()
			now := time.Now().Unix()
			_, _ = a.Execution.Store.DB.Exec(`UPDATE sessions SET updated_at=? WHERE id=?`, now, run.session)
			run.change(func(s *ChatState) {
				s.Busy = false
				s.Approvals = []ChatApproval{}
				s.Retrying = ""
				for i := range s.Entries {
					if s.Entries[i].Status == "inProgress" {
						if outcome.err != nil || outcome.res.StopReason == "cancelled" || s.Status == "stopping" {
							s.Entries[i].Status = "interrupted"
						} else {
							s.Entries[i].Status = "completed"
						}
					}
				}
				switch {
				case s.Status == "stopping" || outcome.res.StopReason == "cancelled":
					s.Status = "interrupted"
					s.Error = ""
				case outcome.err != nil:
					s.Status = "failed"
					s.Error = outcome.err.Error()
				default:
					s.Status = "completed"
					s.Error = ""
				}
			})
			return
		case <-ctx.Done():
			_ = run.interruptAgy()
			fail("页面对话已停止，请刷新历史检查进展")
			return
		}
	}
}

func (run *ChatRun) interruptAgy() error {
	run.mu.Lock()
	client := run.acpClient
	approvals := append([]ChatApproval(nil), run.state.Approvals...)
	run.mu.Unlock()
	if client == nil {
		run.cancel()
		return nil
	}
	for _, pending := range approvals {
		if len(pending.rpcID) > 0 {
			_ = client.Reply(pending.rpcID, map[string]any{"outcome": map[string]any{"outcome": "cancelled"}})
		}
	}
	return client.Notify("session/cancel", map[string]any{"sessionId": run.session})
}

func applyAgyTurnSettings(ctx context.Context, c acp.Client, sessionID string, cat *agy.OptionCatalog, settings TurnSettings) error {
	callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if settings.Model != "" && settings.Model != cat.CurrentModel {
		if cat.ModelConfigID != "" {
			var updated acp.SessionSetupResult
			if err := c.Call(callCtx, "session/set_config_option", map[string]any{
				"sessionId": sessionID,
				"configId":  cat.ModelConfigID,
				"value":     settings.Model,
			}, &updated); err != nil {
				return fmt.Errorf("切换 Antigravity 模型失败：%w", err)
			}
			if len(updated.ConfigOptions) > 0 {
				*cat = agy.CatalogFromSetup(updated)
			}
		} else {
			if err := c.Call(callCtx, "session/set_model", map[string]any{
				"sessionId": sessionID,
				"modelId":   settings.Model,
			}, nil); err != nil {
				return fmt.Errorf("切换 Antigravity 模型失败：%w", err)
			}
		}
	}
	if settings.Effort != "" && cat.EffortConfigID == "" {
		return fmt.Errorf("所选模型不支持该思考强度")
	}
	if settings.Effort != "" && settings.Effort != cat.CurrentEffort {
		if err := c.Call(callCtx, "session/set_config_option", map[string]any{
			"sessionId": sessionID,
			"configId":  cat.EffortConfigID,
			"value":     settings.Effort,
		}, nil); err != nil {
			return fmt.Errorf("设置思考强度失败：%w", err)
		}
	}
	if settings.Mode != "" && settings.Mode != cat.CurrentMode {
		if cat.ModeConfigID != "" {
			if err := c.Call(callCtx, "session/set_config_option", map[string]any{
				"sessionId": sessionID,
				"configId":  cat.ModeConfigID,
				"value":     settings.Mode,
			}, nil); err != nil {
				return fmt.Errorf("切换工作模式失败：%w", err)
			}
		} else {
			if err := c.Call(callCtx, "session/set_mode", map[string]any{
				"sessionId": sessionID,
				"modeId":    settings.Mode,
			}, nil); err != nil {
				return fmt.Errorf("切换工作模式失败：%w", err)
			}
		}
	}
	return nil
}

func buildAgyChatContext(plan model.LaunchPlan, cat agy.OptionCatalog, settings TurnSettings) ChatContext {
	ctx := ChatContext{
		Model:                 cat.CurrentModel,
		Effort:                cat.CurrentEffort,
		Mode:                  cat.CurrentMode,
		Cwd:                   plan.Cwd,
		AdditionalDirectories: plan.AdditionalDirectories,
	}
	if settings.Model != "" {
		ctx.Model = settings.Model
	}
	if settings.Effort != "" && cat.EffortConfigID != "" {
		ctx.Effort = settings.Effort
	}
	if settings.Mode != "" {
		ctx.Mode = settings.Mode
	}
	switch settings.Permission {
	case "full":
		ctx.ApprovalPolicy = "never"
		ctx.Sandbox = map[string]any{"type": "dangerFullAccess"}
	case "ask":
		ctx.ApprovalPolicy = "on-request"
		ctx.ApprovalsReviewer = "user"
		ctx.Sandbox = map[string]any{"type": "workspaceWrite"}
	}
	return ctx
}

func agyPromptBlocks(text string, images []string) []map[string]any {
	blocks := []map[string]any{}
	if text != "" {
		blocks = append(blocks, map[string]any{"type": "text", "text": text})
	}
	for _, image := range images {
		if strings.HasPrefix(image, "data:") {
			parts := strings.SplitN(strings.TrimPrefix(image, "data:"), ";base64,", 2)
			if len(parts) == 2 {
				blocks = append(blocks, map[string]any{
					"type":     "image",
					"mimeType": parts[0],
					"data":     parts[1],
				})
			}
		}
	}
	return blocks
}

func makeACPPermissionApproval(msg acp.Message) (ChatApproval, error) {
	var req acp.PermissionRequest
	if err := json.Unmarshal(msg.Params, &req); err != nil {
		return ChatApproval{}, err
	}
	title := "Antigravity 请求操作权限"
	details := ""
	if req.ToolCall != nil {
		if req.ToolCall.Title != "" {
			title = req.ToolCall.Title
		}
		lines := []string{}
		if req.ToolCall.Kind != "" {
			lines = append(lines, "类型："+req.ToolCall.Kind)
		}
		for _, loc := range req.ToolCall.Locations {
			if loc.Path != "" {
				lines = append(lines, loc.Path)
			}
		}
		if cmd := extractACPCommand(req.ToolCall.RawInput); cmd != "" {
			lines = append(lines, cmd)
		}
		details = strings.Join(lines, "\n")
	}
	choices := make([]ChatApprovalChoice, 0, len(req.Options))
	for _, opt := range req.Options {
		if opt.OptionID == "" {
			continue
		}
		label := strings.TrimSpace(opt.Name)
		if label == "" {
			switch opt.Kind {
			case "allow_once":
				label = "允许一次"
			case "allow_always":
				label = "始终允许"
			case "reject_once":
				label = "拒绝"
			case "reject_always":
				label = "始终拒绝"
			default:
				label = opt.OptionID
			}
		}
		accepts := opt.Kind == "allow_once" || opt.Kind == "allow_always" || strings.HasPrefix(opt.Kind, "allow")
		choices = append(choices, ChatApprovalChoice{
			ID:      opt.OptionID,
			Label:   label,
			Accepts: accepts,
		})
	}
	if len(choices) == 0 {
		choices = []ChatApprovalChoice{{ID: "cancel", Label: "拒绝", Accepts: false}}
	}
	return ChatApproval{
		ID:        model.NewID(),
		Kind:      "acp_permission",
		Title:     title,
		Details:   details,
		CanAccept: false,
		Choices:   choices,
		rpcID:     msg.ID,
		method:    msg.Method,
		params:    msg.Params,
	}, nil
}

type acpUpdateReducer struct {
	turnSeq       int
	assistantSeq  int
	toolSeq       int
	list          []HistoryEntry
	byID          map[string]int
	assistantIDs  map[string]string
	lastKind      string
	lastMsgID     string
	userMessageID string
	title         string
	live          bool
}

func newACPUpdateReducer() *acpUpdateReducer {
	return &acpUpdateReducer{
		byID:         map[string]int{},
		assistantIDs: map[string]string{},
	}
}

func (r *acpUpdateReducer) currentTurn() string {
	return fmt.Sprintf("hist-%d", r.turnSeq)
}

func (r *acpUpdateReducer) startTurn(text string, images []string, messageID string) {
	r.turnSeq++
	r.assistantSeq = 0
	r.toolSeq = 0
	clear(r.byID)
	clear(r.assistantIDs)
	r.userMessageID = messageID
	r.upsert(HistoryEntry{
		ID:     "user",
		TurnID: r.currentTurn(),
		Kind:   "user",
		Text:   boundedChatText(text),
		Images: images,
		Status: "completed",
	})
}

func (r *acpUpdateReducer) entries() []HistoryEntry {
	out := make([]HistoryEntry, len(r.list))
	copy(out, r.list)
	return out
}

func (r *acpUpdateReducer) applyRaw(raw json.RawMessage, sessionID string) string {
	var env acp.SessionUpdateEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return ""
	}
	if env.SessionID != "" && sessionID != "" && env.SessionID != sessionID {
		return ""
	}
	return r.apply(env.Update)
}

func (r *acpUpdateReducer) apply(u acp.SessionUpdate) string {
	switch u.KindName() {
	case "user_message_chunk":
		// The submitted prompt already supplies the user entry during a live turn.
		if r.live {
			return ""
		}
		text, images := decodeACPContentBlock(u.Content)
		if text == "" && len(images) == 0 {
			return ""
		}
		if r.lastKind != "user" || (u.MessageID != "" && r.userMessageID != "" && u.MessageID != r.userMessageID) {
			r.startTurn(text, images, u.MessageID)
			return ""
		}
		if r.userMessageID == "" {
			r.userMessageID = u.MessageID
		}
		idx := r.byID["user"]
		r.list[idx].Text = boundedChatText(r.list[idx].Text + text)
		r.list[idx].Images = append(r.list[idx].Images, images...)

	case "agent_message_chunk":
		text, images := decodeACPContentBlock(u.Content)
		if text == "" && len(images) == 0 {
			return ""
		}
		id := r.assistantIDs[u.MessageID]
		if u.MessageID == "" && r.lastKind == "assistant" {
			id = r.lastMsgID
		}
		if id != "" {
			idx := r.byID[id]
			r.list[idx].Text = boundedChatText(r.list[idx].Text + text)
			r.list[idx].Images = append(r.list[idx].Images, images...)
			r.lastKind = "assistant"
			r.lastMsgID = id
			return ""
		}
		// ACP can omit messageId. Key assistant entries by their position in the turn.
		r.assistantSeq++
		id = fmt.Sprintf("assistant-%d", r.assistantSeq)
		if u.MessageID != "" {
			r.assistantIDs[u.MessageID] = id
		}
		r.upsert(HistoryEntry{
			ID:     id,
			TurnID: r.currentTurn(),
			Kind:   "assistant",
			Text:   boundedChatText(text),
			Images: images,
			Status: "inProgress",
		})

	case "agent_thought_chunk":
		// Private model reasoning is intentionally not surfaced as message content.

	case "plan":
		lines := make([]string, 0, len(u.Entries))
		for _, item := range u.Entries {
			mark := "[ ]"
			switch item.Status {
			case "completed":
				mark = "[x]"
			case "in_progress":
				mark = "[~]"
			}
			lines = append(lines, mark+" "+item.Content)
		}
		if len(lines) == 0 {
			return ""
		}
		id := "plan-" + r.currentTurn()
		entry := HistoryEntry{
			ID:     id,
			TurnID: r.currentTurn(),
			Kind:   "activity",
			Tool:   "计划",
			Text:   boundedChatText(strings.Join(lines, "\n")),
			Status: "completed",
		}
		r.upsert(entry)

	case "tool_call", "tool_call_update":
		r.applyToolCall(u)

	case "session_info_update":
		title := strings.TrimSpace(u.Title)
		if title != "" {
			if len([]rune(title)) > 160 {
				title = string([]rune(title)[:160])
			}
			r.title = title
			return title
		}
	}
	return ""
}

func (r *acpUpdateReducer) upsert(entry HistoryEntry) {
	if idx, ok := r.byID[entry.ID]; ok {
		r.list[idx] = entry
		return
	}
	r.byID[entry.ID] = len(r.list)
	r.list = append(r.list, entry)
	r.lastKind = entry.Kind
	r.lastMsgID = entry.ID
}

func (r *acpUpdateReducer) applyToolCall(u acp.SessionUpdate) {
	id := "tool:" + u.ToolCallID
	if u.ToolCallID == "" {
		r.toolSeq++
		id = fmt.Sprintf("tool-%d", r.toolSeq)
	}
	existingIdx, exists := r.byID[id]
	var entry HistoryEntry
	if exists {
		entry = r.list[existingIdx]
	} else {
		entry = HistoryEntry{
			ID:     id,
			TurnID: r.currentTurn(),
			Kind:   "activity",
			Status: "inProgress",
		}
	}
	if u.Status != "" {
		entry.Status = mapACPStatus(u.Status)
	}
	toolName := strings.TrimSpace(u.Title)
	if toolName == "" {
		toolName = strings.TrimSpace(u.Name)
	}
	if toolName != "" {
		entry.Tool = toolName
	}

	kindLower := strings.ToLower(strings.TrimSpace(u.Kind))
	diffs, texts := decodeACPToolContent(u.Content)
	if len(diffs) > 0 || kindLower == "edit" {
		entry.Kind = "change"
		if len(diffs) > 0 {
			entry.FileChanges = nil
			var preview strings.Builder
			for _, d := range diffs {
				diffText := formatACPDiff(d.oldText, d.newText)
				entry.FileChanges = append(entry.FileChanges, historyFileChange(d.path, diffText))
				preview.WriteString(d.path)
				preview.WriteByte('\n')
				preview.WriteString(diffText)
				preview.WriteByte('\n')
			}
			entry.Text = boundedChatText(preview.String())
		} else if len(u.Locations) > 0 && entry.Text == "" {
			paths := make([]string, 0, len(u.Locations))
			for _, loc := range u.Locations {
				if loc.Path != "" {
					paths = append(paths, loc.Path)
				}
			}
			entry.Text = boundedChatText(strings.Join(paths, "\n"))
		}
	} else if kindLower == "execute" || extractACPCommand(u.RawInput) != "" {
		entry.Kind = "command"
		if cmd := extractACPCommand(u.RawInput); cmd != "" {
			entry.Command = cmd
		} else if entry.Command == "" && toolName != "" {
			entry.Command = toolName
		}
		if len(texts) > 0 {
			out := boundedChatText(strings.Join(texts, "\n"))
			entry.Output = &out
		} else if out := extractACPOutput(u.RawOutput); out != "" {
			out = boundedChatText(out)
			entry.Output = &out
		}
	} else {
		if entry.Tool == "" {
			entry.Tool = u.Kind
		}
		if len(texts) > 0 {
			entry.Text = boundedChatText(strings.Join(texts, "\n"))
		} else if len(u.Locations) > 0 && entry.Text == "" {
			paths := make([]string, 0, len(u.Locations))
			for _, loc := range u.Locations {
				if loc.Path != "" {
					paths = append(paths, loc.Path)
				}
			}
			entry.Text = boundedChatText(strings.Join(paths, "\n"))
		}
	}
	r.upsert(entry)
}

func mapACPStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "pending", "in_progress", "running":
		return "inProgress"
	case "completed", "done":
		return "completed"
	case "failed", "error":
		return "failed"
	case "cancelled", "canceled":
		return "interrupted"
	default:
		return status
	}
}

func decodeACPContentBlock(raw json.RawMessage) (string, []string) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", nil
	}
	var block acp.ContentBlock
	if err := json.Unmarshal(raw, &block); err == nil && block.Type != "" {
		switch block.Type {
		case "text":
			return block.Text, nil
		case "image":
			if block.Data != "" && block.MimeType != "" {
				return "", []string{"data:" + block.MimeType + ";base64," + block.Data}
			}
		}
		return "", nil
	}
	var list []acp.ContentBlock
	if err := json.Unmarshal(raw, &list); err == nil {
		var sb strings.Builder
		var images []string
		for _, item := range list {
			if item.Type == "text" {
				sb.WriteString(item.Text)
			} else if item.Type == "image" && item.Data != "" && item.MimeType != "" {
				images = append(images, "data:"+item.MimeType+";base64,"+item.Data)
			}
		}
		return sb.String(), images
	}
	return "", nil
}

type acpDiffItem struct {
	path    string
	oldText string
	newText string
}

func decodeACPToolContent(raw json.RawMessage) ([]acpDiffItem, []string) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var items []acp.ToolCallContent
	if err := json.Unmarshal(raw, &items); err != nil {
		var single acp.ToolCallContent
		if err := json.Unmarshal(raw, &single); err != nil {
			return nil, nil
		}
		items = []acp.ToolCallContent{single}
	}
	var diffs []acpDiffItem
	var texts []string
	for _, item := range items {
		switch item.Type {
		case "diff":
			oldText := ""
			if item.OldText != nil {
				oldText = *item.OldText
			}
			diffs = append(diffs, acpDiffItem{path: item.Path, oldText: oldText, newText: item.NewText})
		case "content":
			if item.Content != nil && item.Content.Type == "text" && item.Content.Text != "" {
				texts = append(texts, item.Content.Text)
			}
		case "text":
			if item.Text != "" {
				texts = append(texts, item.Text)
			}
		}
	}
	return diffs, texts
}

func formatACPDiff(oldText, newText string) string {
	var sb strings.Builder
	sb.WriteString("@@ -1 +1 @@\n")
	if oldText != "" {
		for _, line := range strings.Split(oldText, "\n") {
			sb.WriteByte('-')
			sb.WriteString(line)
			sb.WriteByte('\n')
		}
	}
	if newText != "" {
		for _, line := range strings.Split(newText, "\n") {
			sb.WriteByte('+')
			sb.WriteString(line)
			sb.WriteByte('\n')
		}
	}
	return sb.String()
}

func extractACPCommand(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var obj map[string]any
	if err := json.Unmarshal(raw, &obj); err != nil {
		return ""
	}
	for _, key := range []string{"command", "CommandLine", "cmd"} {
		if val, ok := obj[key].(string); ok && strings.TrimSpace(val) != "" {
			return strings.TrimSpace(val)
		}
	}
	return ""
}

func extractACPOutput(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var obj map[string]any
	if json.Unmarshal(raw, &obj) == nil {
		for _, key := range []string{"output", "stdout", "text", "result"} {
			if val, ok := obj[key].(string); ok && val != "" {
				return val
			}
		}
	}
	return ""
}
