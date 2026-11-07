package session

import (
	"encoding/json"
	"strings"
	"testing"

	"worktree-hub/internal/codex"
)

func handleRetryEvent(t *testing.T, run *ChatRun, method string, params map[string]any) bool {
	t.Helper()
	if params["threadId"] == nil {
		params["threadId"] = "session"
	}
	if params["turnId"] == nil {
		params["turnId"] = "turn"
	}
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	return run.handle(codex.Event{Method: method, Params: raw})
}

func TestChatRetryErrorsAreTemporaryStatus(t *testing.T) {
	yes, no := true, false
	for _, tc := range []struct {
		name, message, notice string
		retry                 *bool
	}{
		{"retry", "Reconnecting... 5/5", "与模型服务的连接暂时中断，正在重连（5/5）…", &yes},
		{"legacy retry", "Reconnecting... 1/5", "与模型服务的连接暂时中断，正在重连（1/5）…", nil},
		{"unicode retry", "Reconnecting…", "与模型服务的连接暂时中断，正在自动重连…", nil},
		{"other retry", "Server overloaded", "正在自动重试：Server overloaded", &yes},
		{"final error", "stream disconnected before completion", "", &no},
		{"explicit final reconnect", "Reconnecting... 5/5", "", &no},
		{"legacy final error", "stream disconnected before completion", "", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			run := &ChatRun{session: "session", state: ChatState{Status: "running", Busy: true, TurnID: "turn", Notice: "已有交接说明"}}
			params := map[string]any{"error": map[string]any{"message": tc.message}}
			if tc.retry != nil {
				params["willRetry"] = tc.retry
			}
			if handleRetryEvent(t, run, "error", params) {
				t.Fatal("error notification ended the turn")
			}
			state := run.snapshot()
			if state.Retrying != tc.notice || !state.Busy || state.Status != "running" || state.Notice != "已有交接说明" {
				t.Fatalf("incorrect retry state: %+v", state)
			}
			if tc.notice != "" && state.Error != "" || tc.notice == "" && state.Error != tc.message {
				t.Fatalf("retry and terminal error were mixed: %+v", state)
			}
		})
	}
}

func TestChatRetryClearsOnlyOnMatchingModelProgress(t *testing.T) {
	for _, tc := range []struct {
		name, method string
		params       map[string]any
		clears       bool
	}{
		{"answer", "item/agentMessage/delta", map[string]any{"itemId": "answer", "delta": "已恢复"}, true},
		{"plan", "item/plan/delta", map[string]any{"itemId": "plan", "delta": "下一步"}, true},
		{"reasoning summary", "item/reasoning/summaryTextDelta", map[string]any{"delta": "private"}, true},
		{"reasoning", "item/reasoning/textDelta", map[string]any{"delta": "private"}, true},
		{"completed answer", "item/completed", map[string]any{"item": map[string]any{"id": "answer", "type": "agentMessage", "text": "完成"}}, true},
		{"other session", "item/agentMessage/delta", map[string]any{"threadId": "other", "itemId": "answer", "delta": "其他对话"}, false},
		{"other turn", "item/agentMessage/delta", map[string]any{"turnId": "other", "itemId": "answer", "delta": "旧轮次"}, false},
		{"empty delta", "item/agentMessage/delta", map[string]any{"itemId": "answer", "delta": ""}, false},
		{"local tool output", "item/commandExecution/outputDelta", map[string]any{"itemId": "command", "delta": "still running"}, false},
		{"unrelated notification", "thread/tokenUsage/updated", map[string]any{}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			run := &ChatRun{session: "session", state: ChatState{Status: "running", Busy: true, TurnID: "turn", Retrying: "正在重连", Error: "独立的真实错误", Notice: "已有说明"}}
			handleRetryEvent(t, run, tc.method, tc.params)
			state := run.snapshot()
			if (state.Retrying == "") != tc.clears || state.Error != "独立的真实错误" || state.Notice != "已有说明" || !state.Busy {
				t.Fatalf("incorrect recovery: %+v", state)
			}
			for _, entry := range state.Entries {
				if strings.Contains(entry.Text, "private") {
					t.Fatal("raw reasoning entered the preview")
				}
			}
		})
	}
}

func TestChatRetryEndsWithAuthoritativeTurnResult(t *testing.T) {
	for _, tc := range []struct {
		status, priorError, finalError, wantError string
	}{
		{"completed", "", "", ""},
		{"completed", "old error", "", ""},
		{"interrupted", "", "", ""},
		{"failed", "", "stream exhausted", "stream exhausted"},
		{"failed", "unauthorized", "", "unauthorized"},
		{"failed", "", "", "本轮未完成，请检查已保存的进展后重试。"},
	} {
		t.Run(tc.status+"/"+tc.priorError+"/"+tc.finalError, func(t *testing.T) {
			run := &ChatRun{session: "session", state: ChatState{Status: "running", Busy: true, TurnID: "turn", Retrying: "正在重连", Error: tc.priorError}}
			turn := map[string]any{"id": "turn", "status": tc.status}
			if tc.finalError != "" {
				turn["error"] = map[string]any{"message": tc.finalError}
			}
			if !handleRetryEvent(t, run, "turn/completed", map[string]any{"turn": turn}) {
				t.Fatal("final event did not finish the turn")
			}
			state := run.snapshot()
			if state.Retrying != "" || state.Error != tc.wantError || state.Busy || state.Status != tc.status {
				t.Fatalf("incorrect final state: %+v", state)
			}
		})
	}
}

func TestChatRetryRecoveryDoesNotRestartTurn(t *testing.T) {
	a, _, c, endpoint := chatFixture(t)
	startFakeChat(t, a, endpoint)
	c.event("error", map[string]any{"turnId": "turn", "willRetry": true, "error": map[string]any{"message": "Reconnecting... 1/5"}})
	awaitChat(t, a, func(s ChatState) bool { return strings.Contains(s.Retrying, "1/5") })
	c.event("error", map[string]any{"turnId": "turn", "willRetry": true, "error": map[string]any{"message": "Reconnecting... 5/5"}})
	awaitChat(t, a, func(s ChatState) bool { return strings.Contains(s.Retrying, "5/5") })
	c.event("item/agentMessage/delta", map[string]any{"turnId": "turn", "itemId": "answer", "delta": "已恢复输出"})
	awaitChat(t, a, func(s ChatState) bool { return s.Retrying == "" && len(s.Entries) > 0 })
	c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
	state := awaitChat(t, a, func(s ChatState) bool { return !s.Busy })
	if state.Error != "" || state.Retrying != "" || state.Status != "completed" {
		t.Fatalf("retry survived successful completion: %+v", state)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	starts := 0
	for _, method := range c.methods {
		if method == "turn/start" {
			starts++
		}
		if method == "turn/interrupt" {
			t.Fatal("temporary retry interrupted the turn")
		}
	}
	if starts != 1 {
		t.Fatalf("retry started %d turns", starts)
	}
}
