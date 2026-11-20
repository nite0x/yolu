package session

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"worktree-hub/internal/codex"
)

func TestWorkspaceCodexLaunchUsesReviewedDirectoriesPreferencesAndFirstInstruction(t *testing.T) {
	a, _, c, _ := chatFixture(t)
	main := register(t, a, "Frontend", repo(t, "frontend", "main"))
	other := register(t, a, "Backend", repo(t, "backend", "main"))
	_, q, raw := create(t, a, main, []string{other}, "assistant-launch")
	if q.State != "ready" || len(q.Members) != 2 {
		t.Fatal(string(raw))
	}
	c.session = "assistant-session"
	if _, err := a.Execution.Store.DB.Exec(`INSERT INTO settings(key,value) VALUES('conversation_defaults:v1','{"model":"gpt-6.1-sol","permission":"ask"}')`); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	instruction := "Update the frontend and backend together.\nRun the relevant tests."
	review, err := a.ReviewWorkspaceCodexLaunch(ctx, q, instruction)
	if err != nil {
		t.Fatal(err)
	}
	cwd, additional := q.Members[0].Path, q.Members[1].Path
	if q.Members[0].ProjectID != main {
		cwd, additional = additional, cwd
	}
	if review.Cwd != cwd || !slices.Equal(review.AdditionalDirectories, []string{additional}) {
		t.Fatalf("unexpected review: %+v", review)
	}
	if _, err := a.Execution.Store.DB.Exec(`UPDATE settings SET value='{"permission":"full"}' WHERE key='conversation_defaults:v1'`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := a.StartWorkspaceCodex(ctx, q.ID, review); err != nil {
			t.Fatal(err)
		}
	}
	// A separate service instance has no in-memory run. Recovery uses the receipt.
	outcome, err := New(a.Execution, a.Workspaces).ObserveWorkspaceCodexLaunch(ctx, q.ID, review)
	if err != nil || !outcome.Accepted || outcome.Uncertain || outcome.Session.ID != c.session {
		t.Fatalf("unexpected outcome: %+v %v", outcome, err)
	}
	if outcome.Session.Cwd != cwd || !slices.Equal(outcome.Session.AdditionalDirectories, []string{additional}) {
		t.Fatalf("unexpected stored directories: %+v", outcome.Session)
	}
	var pins int
	if err := a.Execution.Store.DB.QueryRow(`SELECT count(*) FROM workspace_session_pins WHERE workspace_id=? AND session_id=?`, q.ID, c.session).Scan(&pins); err != nil || pins != 1 {
		t.Fatalf("workspace reference missing: %d %v", pins, err)
	}
	c.mu.Lock()
	methods, turn, thread := slices.Clone(c.methods), c.startParams, c.threadParams["thread/start"]
	c.mu.Unlock()
	for _, method := range []string{"thread/start", "turn/start"} {
		if strings.Count(strings.Join(methods, ","), method) != 1 {
			t.Fatalf("expected one %s, got %v", method, methods)
		}
	}
	if thread["model"] != "gpt-6.1-sol" || turn["approvalPolicy"] != "on-request" {
		t.Fatalf("reviewed settings changed: %v %v", thread, turn)
	}
	if got := turn["input"].([]any)[0].(map[string]any)["text"]; got != instruction {
		t.Fatalf("sent %q, wanted %q", got, instruction)
	}
	policy := turn["sandboxPolicy"].(map[string]any)
	if !slices.Equal(policy["writableRoots"].([]string), []string{cwd, additional}) {
		t.Fatalf("missing approved writable roots: %v", policy)
	}
}

type uncertainWorkspaceTurn struct{ *fakeLiveClient }

func (c uncertainWorkspaceTurn) Call(ctx context.Context, method string, params, out any) error {
	if err := c.fakeLiveClient.Call(ctx, method, params, out); err != nil {
		return err
	}
	if method == "turn/start" {
		return errors.New("transport disconnected before acknowledgment")
	}
	return nil
}

func TestWorkspaceCodexLaunchRequiresReadyDirectoriesAndNeverReplaysAnUncertainTurn(t *testing.T) {
	a, q, c, _ := chatFixture(t)
	a.openLive = func(context.Context) (codex.LiveClient, error) { return uncertainWorkspaceTurn{c}, nil }
	ctx := context.Background()
	review, err := a.ReviewWorkspaceCodexLaunch(ctx, q, "Run the checks")
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"partial", "ready"} {
		if _, err := a.Execution.Store.DB.Exec(`UPDATE workspaces SET state=? WHERE id=?`, state, q.ID); err != nil {
			t.Fatal(err)
		}
		err := a.StartWorkspaceCodex(ctx, q.ID, review)
		if state == "partial" && err == nil {
			t.Fatal("started a partial workspace")
		}
	}
	if err := a.StartWorkspaceCodex(ctx, q.ID, review); err != nil {
		t.Fatal(err)
	}
	outcome, err := a.ObserveWorkspaceCodexLaunch(ctx, q.ID, review)
	if err != nil || !outcome.Uncertain || outcome.Accepted || outcome.Session.ID == "" {
		t.Fatalf("uncertain turn lost its conversation: %+v %v", outcome, err)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if strings.Count(strings.Join(c.methods, ","), "turn/start") != 1 {
		t.Fatalf("uncertain turn was replayed: %v", c.methods)
	}
}
