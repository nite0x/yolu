package session

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/cursor"
	"worktree-hub/internal/model"
)

// Opt-in: uses the installed/authenticated Cursor Agent and makes small model
// requests in a temporary Git worktree. Never runs against a user repository.
func TestInstalledCursorConversationLifecycle(t *testing.T) {
	if os.Getenv("YOLU_TEST_CURSOR_TURN") != "1" {
		t.Skip("opt-in installed Cursor lifecycle test")
	}
	a, q, _, _ := chatFixture(t)
	a.openCursor = cursor.OpenACP
	catalog, err := a.acpOptionsCatalog(context.Background(), model.ProviderCursor, true)
	if err != nil || len(catalog.Models) == 0 {
		t.Fatalf("native Cursor options: %+v %v", catalog, err)
	}
	selectedModel := catalog.CurrentModel
	for _, option := range catalog.Models {
		if strings.HasPrefix(option.Model, "composer-2.5[") {
			selectedModel = option.Model
			break
		}
	}
	t.Logf("Cursor ACP model: %s", selectedModel)
	if err := os.WriteFile(filepath.Join(q.Path, "cursor-input.txt"), []byte("YOLU_CURSOR_INPUT_731\n"), 0600); err != nil {
		t.Fatal(err)
	}
	code, raw := call(t, a, "POST", "/api/sessions/new", map[string]any{"provider": "cursor", "project_id": q.ProjectID, "cwd": q.Path, "request_id": "cursor-live-create", "text": "Integration test. Read cursor-input.txt and create cursor-output.txt containing the same marker. Do not modify other files. Reply YOLU_CURSOR_READY_731 when done.", "settings": map[string]string{"model": selectedModel, "permission": "ask"}})
	if code != 202 {
		t.Fatalf("create: %d %s", code, raw)
	}
	var created struct {
		Session model.Session `json:"session"`
	}
	if err := json.Unmarshal(raw, &created); err != nil {
		t.Fatal(err)
	}
	id := created.Session.ID
	t.Logf("Cursor test session: %s", id)
	wait := func(run *ChatRun) ChatState {
		t.Helper()
		deadline := time.Now().Add(120 * time.Second)
		for time.Now().Before(deadline) {
			state := run.snapshot()
			if !state.Busy {
				<-run.finished
				return state
			}
			for _, approval := range state.Approvals {
				decision := ""
				for _, choice := range approval.Choices {
					if choice.Accepts {
						decision = choice.ID
						break
					}
				}
				if approval.Kind != "acp_permission" || decision == "" {
					t.Fatalf("unexpected live interaction: %+v", approval)
				}
				status, response := call(t, a, "POST", "/api/sessions/"+id+"/chat/approval", map[string]any{"run_id": state.ID, "approval_id": approval.ID, "decision": decision})
				if status != 200 {
					t.Fatalf("approve: %d %s", status, response)
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("Cursor turn timed out")
		return ChatState{}
	}
	first := wait(a.ChatFor(id))
	if first.Status != "completed" || first.Context == nil || first.Context.Model != selectedModel {
		t.Fatalf("first turn: %s %s", first.Status, first.Error)
	}
	content, err := os.ReadFile(filepath.Join(q.Path, "cursor-output.txt"))
	if err != nil || strings.TrimSpace(string(content)) != "YOLU_CURSOR_INPUT_731" {
		t.Fatalf("file result: %q %v", content, err)
	}
	code, raw = call(t, a, "GET", "/api/sessions/"+id+"/history", nil)
	if code != 200 || !strings.Contains(string(raw), "YOLU_CURSOR_READY_731") {
		t.Fatalf("saved history: %d %s", code, raw)
	}
	// New service instance and fresh ACP subprocess prove native persistence.
	restored := New(a.Execution)
	restored.openCursor = cursor.OpenACP
	t.Cleanup(restored.Close)
	history, err := restored.readACPSessionHistory(context.Background(), created.Session)
	if err != nil || len(history.Entries) == 0 {
		t.Fatalf("history after restart: %v %+v", err, history)
	}
	code, raw = call(t, a, "POST", "/api/sessions/"+id+"/chat", map[string]any{"text": "Without using tools, reply with the exact marker you read from cursor-input.txt in the previous turn.", "request_id": "cursor-live-resume", "settings": map[string]string{"mode": "ask"}})
	if code != 202 {
		t.Fatalf("resume: %d %s", code, raw)
	}
	second := wait(a.ChatFor(id))
	if second.Status != "completed" || second.Context == nil || second.Context.Mode != "ask" {
		t.Fatalf("resume turn: %s %s", second.Status, second.Error)
	}
	text := ""
	for _, entry := range second.Entries {
		if entry.Kind == "assistant" {
			text += entry.Text
		}
	}
	if !strings.Contains(text, "YOLU_CURSOR_INPUT_731") {
		t.Fatalf("resumed context missing: %s", text)
	}
	code, raw = call(t, a, "POST", "/api/sessions/"+id+"/chat", map[string]any{"text": "Write a long explanation of every integer from 1 to 10000. Do not use tools.", "request_id": "cursor-live-cancel"})
	if code != 202 {
		t.Fatalf("cancel setup: %d %s", code, raw)
	}
	run := a.ChatFor(id)
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) && run.snapshot().Status == "starting" {
		time.Sleep(20 * time.Millisecond)
	}
	code, raw = call(t, a, "POST", "/api/sessions/"+id+"/chat/stop", map[string]string{"run_id": "cursor-live-cancel"})
	if code != 200 {
		t.Fatalf("stop: %d %s", code, raw)
	}
	stopped := wait(run)
	if stopped.Status != "interrupted" {
		t.Fatalf("stop result: %+v", stopped)
	}
}
