package session

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/model"
)

func TestCursorBlockingInteractionsUseOriginalOptionIDs(t *testing.T) {
	a, q, _, _ := chatFixture(t)
	client := newFakeACPClient(q.Path)
	client.sessionID = "cursor-questions"
	a.openCursor = func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
		return client, acp.InitializeResult{}, nil
	}
	code, raw := call(t, a, "POST", "/api/sessions/new", map[string]any{"provider": "cursor", "cwd": q.Path, "project_id": q.ProjectID, "request_id": "cursor-questions-create", "text": "test"})
	if code != 202 {
		t.Fatalf("create: %d %s", code, raw)
	}
	run := a.ChatFor(client.sessionID)
	wait := func() ChatState {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			s := run.snapshot()
			if len(s.Approvals) > 0 {
				return s
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Fatal("Cursor interaction was not surfaced")
		return ChatState{}
	}
	base := "/api/sessions/" + client.sessionID + "/chat/approval"
	for _, tc := range []struct {
		method, params, decision, content, want string
		status                                  int
	}{
		{"cursor/ask_question", `{"questions":[{"id":"stack","prompt":"Stack?","options":[{"id":"go","label":"Go"},{"id":"ts","label":"TypeScript"}]},{"id":"checks","prompt":"Checks?","allowMultiple":true,"options":[{"id":"unit","label":"Unit tests"},{"id":"browser","label":"Browser tests"}]}]}`, "accept", `{"stack":"go","checks":["unit","browser"]}`, `"selectedOptionIds":["unit","browser"]`, 200},
		{"cursor/ask_question", `{"questions":[{"id":"stack","prompt":"Stack?","options":[{"id":"go","label":"Go"}]}]}`, "accept", `{"stack":"invented"}`, "", 400},
		{"cursor/create_plan", `{"name":"Implement","plan":"Read, edit, test"}`, "accept", `{}`, `"outcome":"accepted"`, 200},
		{"cursor/create_plan", `{"plan":"Read, edit, test"}`, "decline", `{}`, `"outcome":"rejected"`, 200},
	} {
		client.events <- acp.Message{ID: json.RawMessage(`"extension-id"`), Method: tc.method, Params: json.RawMessage(tc.params)}
		state := wait()
		if state.Status != "waiting" || state.Approvals[0].Elicitation != nil && state.Approvals[0].Elicitation.Error != "" {
			t.Fatalf("bad approval: %+v", state.Approvals)
		}
		if tc.method == "cursor/ask_question" {
			e := state.Approvals[0].Elicitation
			if e.JSONFallback || len(e.Fields) == 0 {
				t.Fatalf("questions did not use shared form: %+v", e)
			}
		}
		input := map[string]any{"run_id": state.ID, "approval_id": state.Approvals[0].ID, "decision": tc.decision, "content": json.RawMessage(tc.content)}
		code, raw = call(t, a, "POST", base, input)
		if code != tc.status {
			t.Fatalf("%s: %d %s", tc.method, code, raw)
		}
		if code == 400 {
			input["decision"] = "decline"
			code, raw = call(t, a, "POST", base, input)
			if code != 200 {
				t.Fatalf("skip: %d %s", code, raw)
			}
			continue
		}
		client.mu.Lock()
		reply, _ := json.Marshal(client.replies[len(client.replies)-1])
		client.mu.Unlock()
		if !strings.Contains(string(reply), tc.want) {
			t.Fatalf("%s reply: %s", tc.method, reply)
		}
	}
	client.promptGate <- acp.PromptResult{StopReason: "end_turn"}
	select {
	case <-run.finished:
	case <-time.After(3 * time.Second):
		t.Fatal("turn did not finish")
	}
	if run.provider != model.ProviderCursor || run.snapshot().Status != "completed" {
		t.Fatal(run.snapshot())
	}
}

func TestACPCancelWithoutNativeAcknowledgementDoesNotLeaveBusyRun(t *testing.T) {
	for _, provider := range []string{model.ProviderAgy, model.ProviderCursor} {
		t.Run(provider, func(t *testing.T) {
			a, q, _, _ := chatFixture(t)
			client := newFakeACPClient(q.Path)
			client.ignoreCancel = true
			open := func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
				return client, acp.InitializeResult{}, nil
			}
			a.openAgy = open
			a.openCursor = open
			code, raw := call(t, a, "POST", "/api/sessions/new", map[string]any{"provider": provider, "cwd": q.Path, "request_id": "cancel-race", "text": "test"})
			if code != 202 {
				t.Fatalf("create: %d %s", code, raw)
			}
			run := a.ChatFor(client.sessionID)
			deadline := time.Now().Add(3 * time.Second)
			for run.snapshot().Status == "starting" && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			code, raw = call(t, a, "POST", "/api/sessions/"+client.sessionID+"/chat/stop", map[string]string{"run_id": "cancel-race"})
			if code != 200 {
				t.Fatalf("stop: %d %s", code, raw)
			}
			select {
			case <-run.finished:
			case <-time.After(4 * time.Second):
				t.Fatal("cancel left ACP turn busy")
			}
			if state := run.snapshot(); state.Busy || state.Status != "interrupted" {
				t.Fatalf("cancel result: %+v", state)
			}
		})
	}
}
