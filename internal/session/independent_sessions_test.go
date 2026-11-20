package session

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
)

func TestDirectoryScopesShareSessionsWithoutPersistingWorkspaceOwnership(t *testing.T) {
	a, q, _, _ := chatFixture(t)
	_, other, _ := create(t, a, q.PrimaryProjectID, nil, "other")
	if _, err := a.Execution.Store.DB.Exec(`UPDATE members SET path=?,mode='worktree',branch=? WHERE workspace_id=?`, q.Members[0].Path, q.Branch, other.ID); err != nil {
		t.Fatal(err)
	}
	fakeSessions(a, map[string]codex.Session{
		"shared":         {ID: "shared", Cwd: q.Members[0].Path},
		"workspace-root": {ID: "workspace-root", Cwd: q.Path},
		"other-root":     {ID: "other-root", Cwd: other.Path},
		"prefix":         {ID: "prefix", Cwd: q.Members[0].Path + "-unrelated"},
	})
	first := getWorkspaceSessions(t, a, q.ID)
	second := getWorkspaceSessions(t, a, other.ID)
	ids := func(sessions []WorkspaceSession) string {
		var out []string
		for _, s := range sessions {
			if s.Available {
				out = append(out, s.ID)
			}
		}
		return strings.Join(out, ",")
	}
	if !strings.Contains(ids(first), "shared") || !strings.Contains(ids(first), "workspace-root") || strings.Contains(ids(first), "other-root") || strings.Contains(ids(first), "prefix") {
		t.Fatalf("first: %+v", first)
	}
	if !strings.Contains(ids(second), "shared") || !strings.Contains(ids(second), "other-root") || strings.Contains(ids(second), "workspace-root") {
		t.Fatalf("second: %+v", second)
	}
	var count int
	if err := a.Execution.Store.DB.QueryRow(`SELECT count(*) FROM workspace_sessions`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("directory discovery wrote workspace ownership: %d %v", count, err)
	}
	if _, err := a.Execution.Store.DB.Exec(`UPDATE members SET path='/another-directory' WHERE workspace_id=?`, q.ID); err != nil {
		t.Fatal(err)
	}
	first = getWorkspaceSessions(t, a, q.ID)
	if strings.Contains(ids(first), "shared") {
		t.Fatal("old directory match became a permanent workspace link")
	}
	if _, err := a.Execution.Store.Session("shared"); err != nil {
		t.Fatal("changing workspace scope deleted the session", err)
	}
}

func TestStandaloneWorktreeCreationNeedsNoWorkspaceAndRetriesOnce(t *testing.T) {
	a := testApp(t)
	id := register(t, a, "Standalone", repo(t, "standalone", "master"))
	ps, _ := a.Execution.Store.ProjectMap()
	cwd := filepath.Join(filepath.Dir(ps[id].Path), "detached")
	testGit(t, ps[id].Path, "worktree", "add", "--detach", cwd, "HEAD")
	c := &fakeLiveClient{updates: make(chan codex.Event, 256), cwd: cwd}
	a.plans = nil // No workspace service is needed for this entire lifecycle.
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
	var workspaces, pins int
	_ = a.Execution.Store.DB.QueryRow(`SELECT count(*) FROM workspaces`).Scan(&workspaces)
	_ = a.Execution.Store.DB.QueryRow(`SELECT count(*) FROM workspace_session_pins`).Scan(&pins)
	if workspaces != 0 || pins != 0 {
		t.Fatalf("created workspace ownership: %d %d", workspaces, pins)
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

func TestWorkspaceDirectoryCanBeTheCreationDirectory(t *testing.T) {
	a, q, c, _ := chatFixture(t)
	c.cwd = q.Path
	code, raw := call(t, a, "POST", "/api/sessions/new", map[string]string{"text": "研究跨项目方案", "workspace_id": q.ID, "cwd": q.Path, "request_id": "workspace-root"})
	if code != 202 {
		t.Fatalf("%d %s", code, raw)
	}
	var result struct {
		Session model.Session `json:"session"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.Session.Cwd != q.Path || len(result.Session.AdditionalDirectories) != len(q.Members) {
		t.Fatalf("context: %+v", result.Session)
	}
	awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
	c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
	awaitChat(t, a, func(s ChatState) bool { return !s.Busy })
}

func TestSharedSessionHasOneRunAcrossWorkspacesAndGlobalControls(t *testing.T) {
	a, q, c, _ := chatFixture(t)
	_, other, _ := create(t, a, q.PrimaryProjectID, nil, "shared")
	_, err := a.Execution.Store.DB.Exec(`UPDATE members SET path=?,mode='worktree',branch=? WHERE workspace_id=?`, q.Members[0].Path, q.Branch, other.ID)
	if err != nil {
		t.Fatal(err)
	}
	// Archiving the original workspace must not block this independent conversation.
	_, _ = a.Execution.Store.DB.Exec(`UPDATE workspaces SET state='archived' WHERE id=?`, q.ID)
	a.plans = nil
	startFakeChat(t, a, "/api/sessions/session/chat")
	for _, path := range []string{"/api/sessions/session/chat", "/api/workspaces/" + q.ID + "/sessions/session/chat", "/api/workspaces/" + other.ID + "/sessions/session/chat"} {
		code, raw := call(t, a, "GET", path, nil)
		var state ChatState
		_ = json.Unmarshal(raw, &state)
		if code != 200 || state.ID != "request1" || !state.Busy {
			t.Fatalf("shared state: %d %s", code, raw)
		}
	}
	c.request("item/commandExecution/requestApproval", "approval", map[string]any{"command": "pwd", "availableDecisions": []string{"accept", "decline"}})
	waiting := awaitChat(t, a, func(s ChatState) bool { return len(s.Approvals) == 1 })
	second := "/api/workspaces/" + other.ID + "/sessions/session/chat"
	if code, raw := call(t, a, "POST", second+"/approval", map[string]any{"run_id": "request1", "approval_id": waiting.Approvals[0].ID, "decision": "accept"}); code != 200 {
		t.Fatalf("cross-entry approval: %d %s", code, raw)
	}
	if code, raw := call(t, a, "POST", second+"/stop", map[string]string{"run_id": "request1"}); code != 200 {
		t.Fatalf("cross-entry stop: %d %s", code, raw)
	}
	awaitChat(t, a, func(s ChatState) bool { return !s.Busy })
}

func TestStandaloneCreationRejectsForeignDirectoriesBeforeStartingCodex(t *testing.T) {
	a, q, c, _ := chatFixture(t)
	a.plans = nil
	for i, cwd := range []string{"", t.TempDir(), q.Members[0].Path + "-other"} {
		if code, raw := call(t, a, "POST", "/api/sessions/new", map[string]string{"text": "hello", "project_id": q.PrimaryProjectID, "cwd": cwd, "request_id": fmt.Sprintf("foreign-%d", i)}); code != 400 {
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
	a.plans = nil
	a.Execution.ReadOnlySessions = true // Use the platform terminal launcher on all OSes.
	if err := a.Execution.Store.SaveSessionDirectories("session", []string{q.Path}); err != nil {
		t.Fatal(err)
	}
	fakeSessions(a, map[string]codex.Session{"session": {ID: "session", Cwd: q.Members[0].Path}})
	var plan model.LaunchPlan
	a.Execution.Launch = func(p model.LaunchPlan, _ func()) error { plan = p; return nil }
	if code, raw := call(t, a, "POST", "/api/sessions/session/resume", nil); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if plan.Cwd != q.Members[0].Path || len(plan.AdditionalDirectories) != 1 || plan.AdditionalDirectories[0] != q.Path {
		t.Fatalf("saved context: %+v", plan)
	}
}

func TestGlobalResumeUsesCodexDirectoryWithoutAddingTheCachedOldRoot(t *testing.T) {
	a, q, _, _ := chatFixture(t)
	a.plans = nil
	a.Execution.ReadOnlySessions = true
	fakeSessions(a, map[string]codex.Session{"session": {ID: "session", Cwd: q.Path}})
	var plan model.LaunchPlan
	a.Execution.Launch = func(p model.LaunchPlan, _ func()) error { plan = p; return nil }
	if code, raw := call(t, a, "POST", "/api/sessions/session/resume", nil); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	if plan.Cwd != q.Path || len(plan.AdditionalDirectories) != 0 {
		t.Fatalf("old cached cwd added to execution context: %+v", plan)
	}
	saved, _ := a.Execution.Store.Session("session")
	if saved.Cwd != q.Path {
		t.Fatalf("index was not refreshed: %+v", saved)
	}
}
