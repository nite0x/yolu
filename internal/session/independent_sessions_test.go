package session

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
)

func TestStandaloneWorktreeCreationNeedsNoWorkspaceAndRetriesOnce(t *testing.T) {
	a := testApp(t)
	id := register(t, a, "Standalone", repo(t, "standalone", "master"))
	ps, _ := a.Execution.Store.ProjectMap()
	cwd := filepath.Join(filepath.Dir(ps[id].Path), "detached")
	testGit(t, ps[id].Path, "worktree", "add", "--detach", cwd, "HEAD")
	c := &fakeLiveClient{updates: make(chan codex.Event, 256), cwd: cwd}

	a.openLive = func(context.Context) (codex.LiveClient, error) { return c, nil }
	a.terminalConflict = func(string, string) error { return nil }
	input := map[string]string{"text": "检查项目", "project_id": id, "cwd": cwd, "request_id": "standalone"}
	if code, raw := call(t, a, "POST", "/api/sessions/new", input); code != 202 {
		t.Fatalf("%d %s", code, raw)
	}
	awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
	if code, raw := call(t, a, "POST", "/api/sessions/new", input); code != 200 {
		t.Fatalf("retry: %d %s", code, raw)
	}
	input["text"] = "a different request"
	if code, _ := call(t, a, "POST", "/api/sessions/new", input); code != 409 {
		t.Fatal("changed payload reused creation key", code)
	}
	bindings, err := a.Execution.Store.SessionBindings("session")
	if err != nil || len(bindings) != 1 || bindings[0].ProjectID != id {
		t.Fatalf("expected one persisted project binding: %+v, %v", bindings, err)
	}
	c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
	awaitChat(t, a, func(s ChatState) bool { return !s.Busy })
	fakeSessions(a, map[string]codex.Session{"session": {ID: "session", Cwd: cwd}})
	code, raw := call(t, a, "GET", "/api/sessions?project_id="+id, nil)
	if code != 200 || !strings.Contains(string(raw), `"id":"session"`) {
		t.Fatalf("project sessions: %d %s", code, raw)
	}
	c.mu.Lock()
	methods := strings.Join(c.methods, ",")
	c.mu.Unlock()
	if strings.Count(methods, "thread/start") != 1 {
		t.Fatal(methods)
	}
}

func TestStandaloneCreationRejectsForeignDirectoriesBeforeStartingCodex(t *testing.T) {
	a, q, c, _ := chatFixture(t)

	for i, cwd := range []string{t.TempDir(), q.Path + "-other"} {
		if code, raw := call(t, a, "POST", "/api/sessions/new", map[string]string{"text": "hello", "project_id": q.ProjectID, "cwd": cwd, "request_id": fmt.Sprintf("foreign-%d", i)}); code != 400 && code != 409 {
			t.Fatalf("%d %s", code, raw)
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.methods) != 0 {
		t.Fatal("invalid target reached Codex", c.methods)
	}
}

func TestGlobalResumeUsesSavedDirectoriesWithoutWorkspaceLookup(t *testing.T) {
	a, q, _, _ := chatFixture(t)

	a.Execution.ReadOnlySessions = true // Use the platform terminal launcher on all OSes.
	if err := a.Execution.Store.SaveSessionDirectories("session", []string{q.Parent}); err != nil {
		t.Fatal(err)
	}
	fakeSessions(a, map[string]codex.Session{"session": {ID: "session", Cwd: q.Path}})
	var plan model.LaunchPlan
	a.Execution.Launch = func(p model.LaunchPlan, _ func()) error { plan = p; return nil }
	if code, raw := call(t, a, "POST", "/api/sessions/session/resume", nil); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if plan.Cwd != q.Path || len(plan.AdditionalDirectories) != 1 || plan.AdditionalDirectories[0] != q.Parent {
		t.Fatalf("saved context: %+v", plan)
	}
}

func TestGlobalResumeUsesCodexDirectoryWithoutAddingTheCachedOldRoot(t *testing.T) {
	a, q, _, _ := chatFixture(t)

	a.Execution.ReadOnlySessions = true
	fakeSessions(a, map[string]codex.Session{"session": {ID: "session", Cwd: q.Parent}})
	var plan model.LaunchPlan
	a.Execution.Launch = func(p model.LaunchPlan, _ func()) error { plan = p; return nil }
	if code, raw := call(t, a, "POST", "/api/sessions/session/resume", nil); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if plan.Cwd != q.Parent || len(plan.AdditionalDirectories) != 0 {
		t.Fatalf("old cached cwd added to execution context: %+v", plan)
	}
	saved, _ := a.Execution.Store.Session("session")
	if saved.Cwd != q.Parent {
		t.Fatalf("index was not refreshed: %+v", saved)
	}
}
