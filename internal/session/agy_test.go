package session

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/agy"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
)

type fakeACPClient struct {
	mu            sync.Mutex
	cwd           string
	sessionID     string
	calls         []string
	newParams     map[string]any
	promptParams  map[string]any
	replies       []map[string]any
	notifications []string
	events        chan acp.Message
	promptGate    chan acp.PromptResult
	replySignal   chan struct{}
	listSessions  []acp.SessionSummary
	replayOnLoad  []acp.SessionUpdate
	closeOnce     sync.Once
}

func newFakeACPClient(cwd string) *fakeACPClient {
	return &fakeACPClient{
		cwd:         cwd,
		sessionID:   "agy-session-1",
		events:      make(chan acp.Message, 64),
		promptGate:  make(chan acp.PromptResult, 1),
		replySignal: make(chan struct{}, 4),
	}
}

func (f *fakeACPClient) Call(ctx context.Context, method string, params any, out any) error {
	f.mu.Lock()
	f.calls = append(f.calls, method)
	var m map[string]any
	if params != nil {
		raw, _ := json.Marshal(params)
		_ = json.Unmarshal(raw, &m)
	}
	f.mu.Unlock()

	var result any
	switch method {
	case "session/list":
		f.mu.Lock()
		items := append([]acp.SessionSummary(nil), f.listSessions...)
		f.mu.Unlock()
		result = acp.SessionListResult{Sessions: items}
	case "session/new":
		f.mu.Lock()
		f.newParams = m
		sid := f.sessionID
		f.mu.Unlock()
		result = acp.SessionSetupResult{
			SessionID: sid,
			ConfigOptions: []acp.ConfigOption{
				{
					ID:           "model",
					Category:     "model",
					CurrentValue: "gemini-3-pro",
					Options:      json.RawMessage(`[{"value":"gemini-3-pro","name":"Gemini 3 Pro"}]`),
				},
				{
					ID:           "mode",
					Category:     "mode",
					CurrentValue: "default",
					Options:      json.RawMessage(`[{"value":"default","name":"Default"},{"value":"plan","name":"Plan"}]`),
				},
			},
		}
	case "session/load":
		f.mu.Lock()
		sid := f.sessionID
		replay := append([]acp.SessionUpdate(nil), f.replayOnLoad...)
		f.mu.Unlock()
		for _, upd := range replay {
			raw, _ := json.Marshal(acp.SessionUpdateEnvelope{SessionID: sid, Update: upd})
			f.events <- acp.Message{Method: "session/update", Params: raw}
		}
		result = acp.SessionSetupResult{SessionID: sid}
	case "session/resume":
		f.mu.Lock()
		sid := f.sessionID
		f.mu.Unlock()
		result = acp.SessionSetupResult{SessionID: sid}
	case "session/prompt":
		f.mu.Lock()
		f.promptParams = m
		f.mu.Unlock()
		select {
		case res := <-f.promptGate:
			result = res
		case <-ctx.Done():
			return ctx.Err()
		}
	case "session/set_config_option", "session/set_model", "session/set_mode", "session/close":
		result = map[string]any{}
	default:
		return fmt.Errorf("unexpected method %s", method)
	}
	if out != nil && result != nil {
		raw, _ := json.Marshal(result)
		return json.Unmarshal(raw, out)
	}
	return nil
}

func (f *fakeACPClient) Notify(method string, params any) error {
	f.mu.Lock()
	f.notifications = append(f.notifications, method)
	f.mu.Unlock()
	if method == "session/cancel" {
		select {
		case f.promptGate <- acp.PromptResult{StopReason: "cancelled"}:
		default:
		}
	}
	return nil
}

func (f *fakeACPClient) Reply(id json.RawMessage, result any) error {
	raw, _ := json.Marshal(result)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	f.mu.Lock()
	f.replies = append(f.replies, m)
	f.mu.Unlock()
	select {
	case f.replySignal <- struct{}{}:
	default:
	}
	return nil
}

func (f *fakeACPClient) ReplyError(json.RawMessage, int, string) error { return nil }
func (f *fakeACPClient) Events() <-chan acp.Message                    { return f.events }
func (f *fakeACPClient) Close()                                        {}

func (f *fakeACPClient) emitUpdate(upd acp.SessionUpdate) {
	raw, _ := json.Marshal(acp.SessionUpdateEnvelope{SessionID: f.sessionID, Update: upd})
	f.events <- acp.Message{Method: "session/update", Params: raw}
}

func TestAgyFullLifecycleCreateStreamApproveHistoryManageAndResume(t *testing.T) {
	a, q, _, _ := chatFixture(t)
	fakeACP := newFakeACPClient(q.Path)
	a.openAgy = func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
		return fakeACP, acp.InitializeResult{AgentInfo: acp.AgentInfo{Name: "Antigravity ACP Server", Version: "1.5.12"}}, nil
	}
	a.diagnoseAgy = func(context.Context) agy.Diagnostics {
		return agy.Diagnostics{Status: "ok", Version: "1.5.12", CLIPath: "/usr/local/bin/agy", Checks: []agy.DiagnosticCheck{{ID: "cli", Name: "CLI", Status: "ok", Message: "/usr/local/bin/agy"}}}
	}

	// 1. Diagnostics & Options
	code, raw := call(t, a, "GET", "/api/settings/agy", nil)
	if code != 200 || !strings.Contains(string(raw), `"version":"1.5.12"`) {
		t.Fatalf("agy diagnostics failed: %d %s", code, raw)
	}
	code, raw = call(t, a, "GET", "/api/agents/chat-options?provider=agy", nil)
	if code != 200 || !strings.Contains(string(raw), `"provider":"agy"`) || !strings.Contains(string(raw), `"steer":false`) {
		t.Fatalf("agy chat options failed: %d %s", code, raw)
	}

	// 2. Create AGY session
	createInput := map[string]any{
		"provider":   "agy",
		"project_id": q.ProjectID,
		"cwd":        q.Path,
		"text":       "帮我检查测试并修复问题",
		"request_id": "agy-create-1",
	}
	code, raw = call(t, a, "POST", "/api/sessions/new", createInput)
	if code != 202 {
		t.Fatalf("create agy session failed: %d %s", code, raw)
	}
	var created struct {
		Session model.Session `json:"session"`
		Chat    ChatState     `json:"chat"`
	}
	_ = json.Unmarshal(raw, &created)
	if created.Session.ID != "agy-session-1" || created.Session.Provider != model.ProviderAgy {
		t.Fatalf("unexpected created session: %+v", created.Session)
	}

	// Wait until running
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if run := a.ChatFor("agy-session-1"); run != nil && run.snapshot().Status == "running" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	run := a.ChatFor("agy-session-1")
	if run == nil || run.snapshot().Status != "running" {
		t.Fatalf("agy chat did not enter running state: %+v", run)
	}

	// Verify systemPrompt append metadata was passed
	fakeACP.mu.Lock()
	meta, _ := fakeACP.newParams["_meta"].(map[string]any)
	fakeACP.mu.Unlock()
	if meta == nil || meta["antigravity"] == nil {
		t.Fatalf("expected antigravity systemPrompt metadata in session/new: %+v", fakeACP.newParams)
	}

	// 3. Stream thought (must be hidden), assistant text, command tool call, diff tool call
	fakeACP.emitUpdate(acp.SessionUpdate{
		SessionUpdate: "agent_thought_chunk",
		Content:       json.RawMessage(`{"type":"text","text":"SECRET_INTERNAL_THOUGHT"}`),
	})
	fakeACP.emitUpdate(acp.SessionUpdate{
		SessionUpdate: "agent_message_chunk",
		Content:       json.RawMessage(`{"type":"text","text":"正在检查代码"}`),
	})
	oldText := "old line"
	fakeACP.emitUpdate(acp.SessionUpdate{
		SessionUpdate: "tool_call",
		ToolCallID:    "edit-1",
		Title:         "Edit main.go",
		Kind:          "edit",
		Status:        "completed",
		Content:       mustJSON(t, []acp.ToolCallContent{{Type: "diff", Path: "main.go", OldText: &oldText, NewText: "new line"}}),
	})

	// 4. Permission approval round-trip
	permRaw, _ := json.Marshal(acp.PermissionRequest{
		SessionID: "agy-session-1",
		ToolCall:  &acp.PermissionToolCall{ToolCallID: "cmd-1", Title: "Run go test", Kind: "execute", RawInput: json.RawMessage(`{"command":"go test ./..."}`)},
		Options:   []acp.PermissionOption{{OptionID: "allow_once", Name: "Allow once", Kind: "allow_once"}, {OptionID: "reject_once", Name: "Reject", Kind: "reject_once"}},
	})
	fakeACP.events <- acp.Message{ID: json.RawMessage(`42`), Method: "session/request_permission", Params: permRaw}

	var waitingState ChatState
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		waitingState = run.snapshot()
		if waitingState.Status == "waiting" && len(waitingState.Approvals) == 1 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if waitingState.Status != "waiting" || len(waitingState.Approvals) != 1 || waitingState.Approvals[0].Kind != "acp_permission" {
		t.Fatalf("expected waiting approval, got %+v", waitingState)
	}

	// Steer must be rejected for AGY
	code, _ = call(t, a, "POST", "/api/sessions/agy-session-1/chat/steer", map[string]any{"text": "extra", "request_id": "s1", "turn_id": waitingState.TurnID})
	if code != 400 {
		t.Fatalf("expected steer to be rejected for agy, got %d", code)
	}

	// Approve permission
	code, raw = call(t, a, "POST", "/api/sessions/agy-session-1/chat/approval", map[string]any{
		"run_id":      waitingState.ID,
		"approval_id": waitingState.Approvals[0].ID,
		"decision":    "allow_once",
	})
	if code != 200 {
		t.Fatalf("approval failed: %d %s", code, raw)
	}
	select {
	case <-fakeACP.replySignal:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for ACP permission reply")
	}
	fakeACP.mu.Lock()
	reply := fakeACP.replies[0]
	fakeACP.mu.Unlock()
	outcome, _ := reply["outcome"].(map[string]any)
	if outcome["outcome"] != "selected" || outcome["optionId"] != "allow_once" {
		t.Fatalf("unexpected ACP approval reply: %+v", reply)
	}

	// Complete prompt
	fakeACP.promptGate <- acp.PromptResult{StopReason: "end_turn"}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !run.snapshot().Busy {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	doneState := run.snapshot()
	if doneState.Status != "completed" {
		t.Fatalf("expected completed, got %+v", doneState)
	}
	for _, entry := range doneState.Entries {
		if strings.Contains(entry.Text, "SECRET_INTERNAL_THOUGHT") {
			t.Fatal("private thought leaked into visible entries")
		}
	}

	// 5. History replay via session/load
	fakeACP.replayOnLoad = []acp.SessionUpdate{
		{SessionUpdate: "user_message_chunk", Content: json.RawMessage(`{"type":"text","text":"你好 AGY"}`)},
		{SessionUpdate: "agent_message_chunk", Content: json.RawMessage(`{"type":"text","text":"你好，已完成检查。"}`)},
	}
	code, raw = call(t, a, "GET", "/api/sessions/agy-session-1/history", nil)
	if code != 200 || !strings.Contains(string(raw), "你好，已完成检查。") {
		t.Fatalf("agy history failed: %d %s", code, raw)
	}

	// 6. Sessions listing works even when Codex is offline
	a.openSessions = func(context.Context) (codex.SessionClient, error) {
		return nil, fmt.Errorf("codex offline")
	}
	fakeACP.listSessions = []acp.SessionSummary{{SessionID: "agy-session-1", Cwd: q.Path, Title: "AGY 对话", UpdatedAt: json.RawMessage(`1700000000`)}}
	code, raw = call(t, a, "GET", "/api/sessions", nil)
	if code != 200 || !strings.Contains(string(raw), `"provider":"agy"`) {
		t.Fatalf("sessions list failed when codex offline: %d %s", code, raw)
	}

	// 7. Manage: rename & archive locally; fork rejected
	code, raw = call(t, a, "POST", "/api/sessions/agy-session-1/manage", map[string]any{"action": "rename", "name": "AGY 重命名"})
	if code != 200 || !strings.Contains(string(raw), "AGY 重命名") {
		t.Fatalf("agy rename failed: %d %s", code, raw)
	}
	code, _ = call(t, a, "POST", "/api/sessions/agy-session-1/manage", map[string]any{"action": "fork", "request_id": "f1"})
	if code != 400 {
		t.Fatalf("expected fork rejected for agy, got %d", code)
	}
	code, _ = call(t, a, "POST", "/api/sessions/agy-session-1/manage", map[string]any{"action": "archive"})
	if code != 200 {
		t.Fatalf("agy archive failed: %d", code)
	}
	code, _ = call(t, a, "POST", "/api/sessions/agy-session-1/manage", map[string]any{"action": "restore"})
	if code != 200 {
		t.Fatalf("agy restore failed: %d", code)
	}

	// 8. Resume in terminal launches agy --conversation
	var launched model.LaunchPlan
	a.Execution.Launch = func(p model.LaunchPlan, _ func()) error {
		launched = p
		return nil
	}
	code, raw = call(t, a, "POST", "/api/sessions/agy-session-1/resume", map[string]bool{"native_permissions": true})
	if code != 200 || launched.Tool != "agy" || !strings.Contains(launched.Command, "--conversation") {
		t.Fatalf("agy resume failed: %d %s launched=%+v", code, raw, launched)
	}

	// 9. Continue existing AGY session and stop via session/cancel
	code, raw = call(t, a, "POST", "/api/sessions/agy-session-1/chat", map[string]any{
		"text":       "继续执行第二步",
		"request_id": "agy-turn-2",
	})
	if code != 202 {
		t.Fatalf("continue agy chat failed: %d %s", code, raw)
	}
	deadline = time.Now().Add(3 * time.Second)
	var secondRun *ChatRun
	for time.Now().Before(deadline) {
		if r := a.ChatFor("agy-session-1"); r != nil && r.snapshot().ID == "agy-turn-2" && r.snapshot().Status == "running" {
			secondRun = r
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if secondRun == nil {
		t.Fatal("second AGY turn did not reach running state")
	}
	code, raw = call(t, a, "POST", "/api/sessions/agy-session-1/chat/stop", map[string]any{"run_id": "agy-turn-2"})
	if code != 200 {
		t.Fatalf("stop agy chat failed: %d %s", code, raw)
	}
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if !secondRun.snapshot().Busy {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if secondRun.snapshot().Status != "interrupted" {
		t.Fatalf("expected interrupted after stop, got %+v", secondRun.snapshot())
	}
}

func mustJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
