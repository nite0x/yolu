package session

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/cursor"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

func (a *Service) acpChatOptions(ctx context.Context, provider string) map[string]any {
	defaults, _ := a.conversationPreferencesForProvider(ctx, provider)
	catalog, _ := a.acpOptionsCatalog(ctx, provider, false)
	return map[string]any{
		"provider":     provider,
		"models":       catalog.Models,
		"modes":        catalog.Modes,
		"defaults":     defaults,
		"capabilities": model.CapabilitiesForProvider(provider),
	}
}

func (a *Service) scanACPCatalog(ctx context.Context, provider string, scope sessionScope, archived bool) (map[string]model.Session, error) {
	found := map[string]model.Session{}
	if archived || a.Execution.Remote != nil {
		return found, nil
	}
	scanCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	c, _, err := a.openACP(scanCtx, provider)
	if err != nil {
		return found, err
	}
	defer c.Close()

	observed := time.Now().UnixNano()
	cwd := ""
	if len(scope.paths) == 1 {
		cwd = scope.paths[0]
	}
	err = acp.WalkSessions(scanCtx, c, cwd, func(item acp.SessionSummary) error {
		if item.SessionID == "" || !scope.includes(item.SessionID, item.Cwd) || provider == model.ProviderCursor && cursor.IsOptionsDirectory(item.Cwd) {
			return nil
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
			Provider:  provider,
			Name:      title,
			Cwd:       item.Cwd,
			CreatedAt: created,
			UpdatedAt: updated,
			Source:    provider,
			Available: true,
		}
		found[rec.ID] = rec
		return a.Execution.Store.SaveSession(rec, observed)
	})
	return found, err
}

func (a *Service) readACPSessionHistory(ctx context.Context, record model.Session) (SessionHistory, error) {
	history := SessionHistory{
		Session: codex.Session{
			Provider:  record.Provider,
			ID:        record.ID,
			Name:      record.Name,
			Cwd:       record.Cwd,
			CreatedAt: record.CreatedAt,
			UpdatedAt: record.UpdatedAt,
		},
		Entries: []HistoryEntry{},
	}
	if a.Execution.Remote != nil {
		return history, fmt.Errorf("暂不支持在远端 WSL 环境读取 %s 对话历史", model.ProviderName(record.Provider))
	}
	loadCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	c, _, err := a.openACP(loadCtx, record.Provider)
	if err != nil {
		return history, err
	}
	defer acp.CloseSession(c, record.ID, record.Provider != model.ProviderCursor)

	reducer := newACPUpdateReducer()
	setup, err := acp.ReplaySession(loadCtx, c, record.ID, map[string]any{
		"sessionId":  record.ID,
		"cwd":        record.Cwd,
		"mcpServers": []any{},
	}, func(event acp.SessionUpdate) { reducer.apply(event) })
	if err != nil {
		return history, err
	}
	cat := a.acpCatalogFromSetup(record.Provider, setup)
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

func (a *Service) driveACPTurn(ctx context.Context, run *ChatRun, plan model.LaunchPlan, initial *acp.SessionSetupResult, text string, images ...string) {
	defer traceRun(ctx, run)()
	if plan.ManagedBindings {
		plan.AdditionalDirectories = nil
	}
	defer a.finishRun(run)
	defer run.finishLocalTurn()

	c, _ := run.connection.(acp.Client)
	loaded := initial != nil
	defer func() {
		if c != nil {
			acp.CloseSession(c, run.session, loaded && run.provider != model.ProviderCursor && ctx.Err() == nil)
		}
	}()
	if a.Execution.Remote != nil {
		run.fail("暂不支持在远端 WSL 环境运行 " + model.ProviderName(run.provider) + " 对话")
		return
	}
	if !platform.AbsoluteWorkspacePath(plan.Cwd) {
		run.fail("对话工作目录不可用")
		return
	}
	fileCtx := execution.WithClient(ctx, a.Execution.Remote)
	if info, err := execution.Stat(fileCtx, plan.Cwd, true); err != nil || !info.IsDir() {
		run.fail("对话原工作目录不可用")
		return
	}

	replay := newACPUpdateReducer()
	var setup acp.SessionSetupResult
	if initial != nil {
		setup = *initial
	}
	if c == nil {
		flags := a.acpFlags(run.provider, run.settings.Permission, plan.AdditionalDirectories)
		var err error
		c, _, err = a.openACP(ctx, run.provider, flags...)
		if err != nil {
			run.fail(err.Error())
			return
		}
		run.mu.Lock()
		run.connection = c
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
		setup, err = acp.ReplaySession(resumeCtx, c, run.session, resumeParams, func(event acp.SessionUpdate) { replay.apply(event) })
		endResume()
		if err != nil {
			if acp.IsAuthRequired(err) {
				run.fail(acpLoginAdvice(run.provider))
			} else {
				run.fail("无法恢复 " + model.ProviderName(run.provider) + " 对话：" + err.Error())
			}
			return
		}
		loaded = true
	}

	cat := a.acpCatalogFromSetup(run.provider, setup)
	if err := applyACPTurnSettings(ctx, c, run.session, &cat, run.settings); err != nil {
		run.fail(err.Error())
		return
	}
	chatCtx := buildACPChatContext(run.provider, plan, cat, run.settings)
	reducer := newACPUpdateReducer()
	reducer.turnSeq = replay.turnSeq
	reducer.live = true
	reducer.startTurn(text, images, "")
	stopping := false
	run.change(func(s *ChatState) {
		if s.Status == "stopping" {
			stopping = true
			return
		}
		s.Context = &chatCtx
		s.TurnID = reducer.currentTurn()
		s.Status = "running"
		s.Entries = reducer.entries()
	})

	if stopping || ctx.Err() != nil {
		run.fail("页面对话已停止，请刷新历史检查进展")
		return
	}
	handleMessage := func(msg acp.Message) {
		if msg.Method == "session/request_permission" && len(msg.ID) > 0 {
			approval, err := makeACPPermissionApproval(msg)
			if run.provider == model.ProviderCursor && approval.Title == "Agent 请求操作权限" {
				approval.Title = "Cursor 请求操作权限"
			}
			if err != nil {
				_ = c.Reply(msg.ID, map[string]any{"outcome": map[string]any{"outcome": "cancelled"}})
				return
			}
			run.change(func(s *ChatState) {
				s.Approvals = append(s.Approvals, approval)
				if !run.stopRequested {
					s.Status = "waiting"
				}
			})
			return
		}
		if run.provider == model.ProviderCursor && a.handleCursorMessage(run, c, msg) {
			return
		}
		if len(msg.ID) > 0 {
			// Unknown server-to-client RPC: reject explicitly rather than hanging the turn.
			_ = c.ReplyError(msg.ID, -32601, "Method not supported by Yolu client: "+msg.Method)
			return
		}
		if update, ok := acp.DecodeSessionUpdate(msg, run.session); ok {
			changedTitle := reducer.apply(update)
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

	result, promptErr := acp.PromptSession(ctx, c, run.session, acpPromptBlocks(text, images), handleMessage)

	now := time.Now().Unix()
	_ = a.Execution.Store.TouchSession(ctx, run.session, now)
	run.change(func(s *ChatState) {
		s.Busy = false
		s.Approvals = []ChatApproval{}
		s.Retrying = ""
		for i := range s.Entries {
			if s.Entries[i].Status == "inProgress" {
				if promptErr != nil || result.StopReason == "cancelled" || run.stopRequested {
					s.Entries[i].Status = "interrupted"
				} else {
					s.Entries[i].Status = "completed"
				}
			}
		}
		switch {
		case run.stopRequested || result.StopReason == "cancelled":
			s.Status = "interrupted"
			s.Error = ""
		case promptErr != nil:
			s.Status = "failed"
			s.Error = promptErr.Error()
		default:
			s.Status = "completed"
			s.Error = ""
		}
	})
}

func (run *ChatRun) interruptACP() error {
	run.mu.Lock()
	client, _ := run.connection.(acp.Client)
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
	err := acp.CancelSession(client, run.session)
	// Cancellation may race prompt startup or an agent may never acknowledge it.
	// Each ACP run owns its subprocess, so end that connection after a short grace
	// period instead of leaving the conversation permanently busy.
	go func() {
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		select {
		case <-run.finished:
		case <-timer.C:
			run.cancel()
		}
	}()
	return err
}

func applyACPTurnSettings(ctx context.Context, c acp.Client, sessionID string, cat *acp.OptionCatalog, settings TurnSettings) error {
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
				return fmt.Errorf("切换模型失败：%w", err)
			}
			if len(updated.ConfigOptions) > 0 {
				*cat = acp.CatalogFromSetup(updated)
			}
		} else {
			if err := c.Call(callCtx, "session/set_model", map[string]any{
				"sessionId": sessionID,
				"modelId":   settings.Model,
			}, nil); err != nil {
				return fmt.Errorf("切换模型失败：%w", err)
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

func buildACPChatContext(provider string, plan model.LaunchPlan, cat acp.OptionCatalog, settings TurnSettings) ChatContext {
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
	if provider == model.ProviderCursor {
		return ctx
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

func acpPromptBlocks(text string, images []string) []map[string]any {
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
	title := "Agent 请求操作权限"
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
