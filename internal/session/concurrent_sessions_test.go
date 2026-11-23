package session

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
)

func awaitSessionRun(t *testing.T, a *App, id string, condition func(ChatState) bool) ChatState {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if run := a.ChatFor(id); run != nil {
			state := run.snapshot()
			if condition(state) {
				return state
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("conversation %s did not reach expected state", id)
	return ChatState{}
}

func TestIndependentConversationsRunInSameDirectory(t *testing.T) {
	for _, createNew := range []bool{false, true} {
		name := "continue"
		if createNew {
			name = "create"
		}
		t.Run(name, func(t *testing.T) {
			a, q, _, firstEndpoint := chatFixture(t)
			startFakeChat(t, a, firstEndpoint)
			cwd := q.Path
			// A third conversation owns a managed terminal in this directory.
			a.bridgeMu.Lock()
			a.bridges["other-terminal"] = &terminalBridge{session: "terminal-session", cwd: cwd, connected: true}
			a.bridgeMu.Unlock()
			second := &fakeLiveClient{session: "second", cwd: cwd, updates: make(chan codex.Event, 256)}
			a.openLive = func(context.Context) (codex.LiveClient, error) { return second, nil }
			endpoint := "/api/sessions/second/chat"
			if createNew {
				input := map[string]any{"text": "parallel work", "project_id": q.ProjectID, "cwd": cwd, "request_id": "second-create"}
				if code, raw := call(t, a, "POST", "/api/sessions/new", input); code != 409 || !strings.Contains(string(raw), "directory_conflict") {
					t.Fatalf("shared directory not reported: %d %s", code, raw)
				}
				input["allow_shared"] = true
				code, raw := call(t, a, "POST", "/api/sessions/new", input)
				if code != 202 {
					t.Fatalf("new conversation blocked: %d %s", code, raw)
				}
				var result struct {
					Session codex.Session `json:"session"`
				}
				if err := json.Unmarshal(raw, &result); err != nil || result.Session.ID != "second" {
					t.Fatalf("unexpected conversation: %s (%v)", raw, err)
				}
			} else {
				// Refreshing stale metadata must also allow the actual shared cwd.
				if err := a.SaveSession(codex.Session{ID: "second", Cwd: cwd}, "codex"); err != nil {
					t.Fatal(err)
				}
				input := map[string]any{"text": "parallel work", "request_id": "second-start"}
				if code, raw := call(t, a, "POST", endpoint, input); code != 409 || !strings.Contains(string(raw), "directory_conflict") {
					t.Fatalf("shared directory not reported: %d %s", code, raw)
				}
				input["allow_shared"] = true
				if code, raw := call(t, a, "POST", endpoint, input); code != 202 {
					t.Fatalf("existing conversation blocked: %d %s", code, raw)
				}
			}
			running := awaitSessionRun(t, a, "second", func(s ChatState) bool { return s.Status == "running" })
			if !a.ChatBusy("session") || !running.Busy {
				t.Fatal("both conversations must remain active")
			}
			if code, raw := call(t, a, "POST", endpoint, map[string]string{"text": "duplicate turn", "request_id": "duplicate"}); code != 409 {
				t.Fatalf("same conversation started twice: %d %s", code, raw)
			}
			if code, raw := call(t, a, "POST", "/api/sessions/second/resume", nil); code != 409 {
				t.Fatalf("same conversation resumed in terminal: %d %s", code, raw)
			}
			if code, raw := call(t, a, "POST", endpoint+"/stop", map[string]string{"run_id": running.ID}); code != 200 {
				t.Fatalf("stop: %d %s", code, raw)
			}
			stopped := awaitSessionRun(t, a, "second", func(s ChatState) bool { return !s.Busy })
			if stopped.Status != "interrupted" || !a.ChatBusy("session") {
				t.Fatal("stopping one conversation affected another")
			}
		})
	}
}

func TestTerminalOwnershipIsScopedToConversation(t *testing.T) {
	a, q, _, _ := chatFixture(t)
	cwd := q.Path
	a.bridges["terminal"] = &terminalBridge{session: "session", cwd: cwd, connected: true}
	for _, id := range []string{"", "other"} {
		if err := a.AppTerminalConflict(id, cwd); err != nil {
			t.Fatalf("independent conversation %q blocked: %v", id, err)
		}
	}
	if err := a.AppTerminalConflict("session", t.TempDir()); !execution.IsSessionConflict(err) || !strings.Contains(err.Error(), "保有此对话") {
		t.Fatalf("same conversation lost terminal ownership: %v", err)
	}
}

func TestBridgeOnlyBlocksTheConversationRunningInSidebar(t *testing.T) {
	a, q, _, endpoint := chatFixture(t)
	startFakeChat(t, a, endpoint)
	for _, id := range []string{"other", "session"} {
		t.Run(id, func(t *testing.T) {
			upstream, server := socketPair(t)
			client, terminal := socketPair(t)
			server.SetReadDeadline(time.Now().Add(2 * time.Second))
			terminal.SetReadDeadline(time.Now().Add(2 * time.Second))
			bridge := &terminalBridge{app: a.Service, session: id, cwd: q.Path, upstream: upstream, client: client, pending: map[string]bridgeCall{}}
			raw := []byte(`{"id":1,"method":"turn/start","params":{"threadId":"` + id + `"}}`)
			if err := bridge.forward(raw); err != nil {
				t.Fatal(err)
			}
			if id == "session" {
				_, response, err := terminal.ReadMessage()
				if err != nil || !strings.Contains(string(response), "对话正在侧栏运行") {
					t.Fatalf("same conversation was not blocked: %s %v", response, err)
				}
			} else {
				_, response, err := server.ReadMessage()
				if err != nil || string(response) != string(raw) {
					t.Fatalf("independent terminal was not forwarded: %s %v", response, err)
				}
			}
		})
	}
}
