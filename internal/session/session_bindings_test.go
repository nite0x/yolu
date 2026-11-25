package session

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
	"worktree-hub/internal/project"
)

func getBindings(t *testing.T, a *App, id string) []bindingView {
	t.Helper()
	code, raw := call(t, a, "GET", "/api/sessions/"+id+"/bindings", nil)
	var response struct {
		Bindings []bindingView `json:"bindings"`
	}
	if code != 200 || json.Unmarshal(raw, &response) != nil {
		t.Fatalf("bindings: %d %s", code, raw)
	}
	return response.Bindings
}

func finishFakeTurn(t *testing.T, a *App, c *fakeLiveClient) {
	t.Helper()
	run := a.ChatFor(c.sessionID())
	c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
	select {
	case <-run.finished:
	case <-time.After(5 * time.Second):
		t.Fatal("turn did not complete")
	}
	if state := run.snapshot(); state.Status != "completed" {
		t.Fatal(state)
	}
}

func TestProjectReferencesAreAtomicAndIdempotent(t *testing.T) {
	a, q, c, endpoint := chatFixture(t)
	first := register(t, a, "API", repo(t, "api", "master"))
	second := register(t, a, "UI", repo(t, "ui", "master"))
	if code, raw := call(t, a, "POST", "/api/sessions/new", map[string]any{
		"text": "start", "request_id": "references", "project_id": q.ProjectID, "cwd": q.Path,
	}); code != 202 {
		t.Fatalf("create: %d %s", code, raw)
	}
	awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
	base := "/api/sessions/session/bindings"
	if code, _ := call(t, a, "POST", base, map[string]any{"project_ids": []string{first}}); code != 409 {
		t.Fatalf("references changed the grants of a running turn: %d", code)
	}
	finishFakeTurn(t, a, c)
	if code, _ := call(t, a, "POST", base, map[string]any{"project_ids": []string{first, "missing"}}); code < 400 {
		t.Fatalf("unknown project accepted: %d", code)
	}
	if got := getBindings(t, a, "session"); len(got) != 1 {
		t.Fatalf("invalid batch partially attached: %+v", got)
	}
	for range 2 {
		if code, raw := call(t, a, "POST", base, map[string]any{
			"project_ids": []string{q.ProjectID, first, second, first}, "access": "write",
		}); code != 200 {
			t.Fatalf("bind references: %d %s", code, raw)
		}
	}
	got := getBindings(t, a, "session")
	if len(got) != 3 || got[0].Access != "write" || got[0].Directory != q.Path {
		t.Fatalf("expected primary and two references: %+v", got)
	}
	if code, raw := call(t, a, "POST", endpoint, map[string]any{"text": "continue", "request_id": "use-references"}); code != 202 {
		t.Fatalf("continue: %d %s", code, raw)
	}
	awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
	c.mu.Lock()
	resume := c.threadParams["thread/resume"]
	c.mu.Unlock()
	profileID := resume["permissions"].(string)
	profile := resume["config"].(map[string]any)["permissions"].(map[string]any)[profileID].(map[string]any)
	fs := profile["filesystem"].(map[string]string)
	for _, binding := range got[1:] {
		if binding.Role != "additional" || binding.Access != "read" || fs[binding.Directory] != "read" {
			t.Fatalf("reference grant: %+v, filesystem: %+v", binding, fs)
		}
	}
	finishFakeTurn(t, a, c)
}

func TestSessionBindingProfileManageRestoreAndDiff(t *testing.T) {
	a, q, c, endpoint := chatFixture(t)
	otherID := register(t, a, "References", repo(t, "references", "master"))
	other := newTestDirectory(t, a, otherID, "references")
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(q.Path, alias); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if code, raw := call(t, a, "POST", "/api/sessions/new", map[string]any{
		"text": "inspect changes", "request_id": "bindings", "project_id": q.ProjectID, "cwd": alias,
	}); code != 202 {
		t.Fatalf("create: %d %s", code, raw)
	}
	awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
	bindings := getBindings(t, a, "session")
	if len(bindings) != 1 || bindings[0].Directory != q.Path || bindings[0].Role != "primary" || bindings[0].Status != "ready" {
		t.Fatalf("initial binding: %+v", bindings)
	}
	base := "/api/sessions/session/bindings"
	add := map[string]any{"project_id": other.ProjectID, "directory": other.Path, "access": "read"}
	if code, _ := call(t, a, "POST", base, add); code != 409 {
		t.Fatalf("manual binding changes allowed during active turn: %d", code)
	}
	file := filepath.Join(q.Path, "new.txt")
	if err := os.WriteFile(file, []byte("during turn\n"), 0600); err != nil {
		t.Fatal(err)
	}
	c.event("item/completed", map[string]any{"turnId": "turn", "item": map[string]any{"type": "fileChange", "id": "patch", "status": "completed", "changes": []any{
		map[string]any{"path": file, "diff": "+during turn"},
	}}})
	finishFakeTurn(t, a, c)
	bindingID := bindings[0].ID
	if err := os.WriteFile(filepath.Join(q.Path, "after.txt"), []byte("outside turn\n"), 0600); err != nil {
		t.Fatal(err)
	}
	binding := getBindings(t, a, "session")[0]
	if len(binding.Git.Files) != 2 || binding.Git.Additions != 2 || binding.Git.Deletions != 0 || len(binding.Observed) != 1 || binding.Observed[0] != "new.txt" || len(binding.Attributed) != 1 {
		t.Fatalf("changes were not distinguished: %+v", binding)
	}
	if code, raw := call(t, a, "GET", base+"/"+bindingID+"/diff?path=new.txt", nil); code != 200 || !strings.Contains(string(raw), "during turn") {
		t.Fatalf("untracked diff: %d %s", code, raw)
	}
	if code, raw := call(t, a, "POST", base, add); code != 200 {
		t.Fatalf("bind reference: %d %s", code, raw)
	}
	if code, _ := call(t, a, "POST", base, map[string]any{"directory": alias, "access": "write"}); code != 400 {
		t.Fatalf("duplicate path alias accepted: %d", code)
	}
	if related := getProjectSessions(t, a, other.ProjectID); len(related) != 1 || related[0].ID != "session" || len(related[0].ProjectDirectories) != 1 || related[0].ProjectDirectories[0] != other.Path {
		t.Fatalf("session missing from secondary project's history: %+v", related)
	}
	if related := getProjectSessions(t, a, q.ProjectID); len(related) != 1 || len(related[0].ProjectDirectories) != 1 || related[0].ProjectDirectories[0] != q.Path {
		t.Fatalf("primary project returned the wrong directories: %+v", related)
	}
	bindings = getBindings(t, a, "session")
	if len(bindings) != 2 {
		t.Fatalf("new reference is missing: %+v", bindings)
	}
	second := bindings[1]
	if second.Access != "read" || second.Status != "pending" {
		t.Fatalf("new reference: %+v", bindings)
	}
	if code, raw := call(t, a, "PUT", base+"/"+second.ID, map[string]any{"role": "primary"}); code != 200 {
		t.Fatalf("promote: %d %s", code, raw)
	}
	if code, raw := call(t, a, "POST", endpoint, map[string]any{"text": "continue", "request_id": "second"}); code != 202 {
		t.Fatalf("continue: %d %s", code, raw)
	}
	state := awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
	if state.Context.Cwd != other.Path {
		t.Fatalf("did not switch effective cwd: %+v", state.Context)
	}
	c.mu.Lock()
	created := c.threadParams["thread/start"]
	start := c.threadParams["thread/resume"]
	turn := c.startParams
	c.mu.Unlock()
	for method, params := range map[string]map[string]any{"thread/start": created, "thread/resume": start} {
		profileID, _ := params["permissions"].(string)
		config, _ := params["config"].(map[string]any)
		if profileID == "" || config["default_permissions"] != profileID {
			t.Errorf("%s: default_permissions = %v, want selected profile %q", method, config["default_permissions"], profileID)
		}
	}
	profileID := start["permissions"].(string)
	profile := start["config"].(map[string]any)["permissions"].(map[string]any)[profileID].(map[string]any)
	fs := profile["filesystem"].(map[string]string)
	if fs[q.Path] != "write" || fs[other.Path] != "read" || turn["permissions"] != profileID || turn["sandboxPolicy"] != nil {
		t.Fatalf("declared policy differs from requested access: %+v %+v", fs, turn)
	}
	if release, err := a.ReserveWorktree(context.Background(), q.Path); err == nil {
		release()
		t.Fatal("secondary directory was available for a Git branch operation during a run")
	}
	finishFakeTurn(t, a, c)
	if code, raw := call(t, a, "DELETE", base+"/"+bindingID, nil); code != 200 {
		t.Fatalf("unlink: %d %s", code, raw)
	}
	reopened := New(a.Execution)
	defer reopened.Close()
	record, err := reopened.Execution.Store.Session("session")
	if err != nil {
		t.Fatal(err)
	}
	plan, err := reopened.savedSessionPlan(context.Background(), record, false)
	if err != nil || len(plan.Bindings) != 1 || plan.Cwd != other.Path || !plan.ManagedBindings {
		t.Fatalf("restart context: %+v %v", plan, err)
	}
	if code, _ := call(t, a, "POST", "/api/sessions/session/resume", nil); code != 409 {
		t.Fatalf("managed Agent terminal bypass allowed: %d", code)
	}
}

func TestNativeProjectAccessRequestWaitsForApprovalAndReceipt(t *testing.T) {
	a, q, c, endpoint := chatFixture(t)
	if code, raw := call(t, a, "POST", "/api/sessions/new", map[string]any{
		"text": "request access", "request_id": "grant", "project_id": q.ProjectID, "cwd": q.Path,
	}); code != 202 {
		t.Fatalf("create: %d %s", code, raw)
	}
	awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	c.request("item/permissions/requestApproval", "request-directory", map[string]any{
		"reason":      "Look up the original documentation",
		"permissions": map[string]any{"fileSystem": map[string]any{"read": []string{dir}}},
	})
	state := awaitChat(t, a, func(s ChatState) bool { return len(s.Approvals) == 1 })
	approval := state.Approvals[0]
	if approval.Kind != "project_access" || approval.ProjectAccess.Directory != dir || len(getBindings(t, a, "session")) != 1 {
		t.Fatalf("authorization was not confirmed: %+v", approval)
	}
	if code, raw := call(t, a, "POST", endpoint+"/approval", map[string]any{"run_id": state.ID, "approval_id": approval.ID, "decision": "accept"}); code != 200 {
		t.Fatalf("allow: %d %s", code, raw)
	}
	bindings := getBindings(t, a, "session")
	if len(bindings) != 2 || bindings[1].Status != "configuring" {
		t.Fatalf("application claimed configured permission before receipt: %+v", bindings)
	}
	c.mu.Lock()
	replies := strings.Join(c.replies, "\n")
	c.mu.Unlock()
	if !strings.Contains(replies, `"read":["`+dir+`"]`) || !strings.Contains(replies, `"scope":"turn"`) {
		t.Fatal(replies)
	}
	c.event("serverRequest/resolved", map[string]any{"requestId": "request-directory"})
	awaitChat(t, a, func(s ChatState) bool {
		run := a.ChatFor("session")
		run.mu.Lock()
		defer run.mu.Unlock()
		return run.configured[dir].access == model.SessionBindingRead
	})
	if got := getBindings(t, a, "session"); got[1].Status != "ready" {
		t.Fatalf("confirmed grant is not ready: %+v", got)
	}
	finishFakeTurn(t, a, c)
}

type unconfirmedBindingLive struct{ *fakeLiveClient }

func (c unconfirmedBindingLive) Call(ctx context.Context, method string, params, out any) error {
	if err := c.fakeLiveClient.Call(ctx, method, params, out); err != nil {
		return err
	}
	if method == "thread/start" {
		return json.Unmarshal([]byte(`{"thread":{"id":"session"},"activePermissionProfile":null}`), out)
	}
	return nil
}

func TestUnconfirmedProfileCannotSendFirstTurn(t *testing.T) {
	a, q, c, _ := chatFixture(t)
	a.openLive = func(context.Context) (codex.LiveClient, error) { return unconfirmedBindingLive{c}, nil }
	if code, raw := call(t, a, "POST", "/api/sessions/new", map[string]any{
		"text": "no broad access", "request_id": "bad-profile", "project_id": q.ProjectID, "cwd": q.Path,
	}); code != 409 || !strings.Contains(string(raw), "Codex") {
		t.Fatalf("%d %s", code, raw)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if strings.Contains(strings.Join(c.methods, ","), "turn/start") || a.ChatFor("session") != nil {
		t.Fatalf("unverified permissions allowed execution: %v", c.methods)
	}
}

func TestInspectBindingIdentifiesMainDirectoryForLinkedWorktree(t *testing.T) {
	a, q, _, _ := chatFixture(t)
	p, err := project.LookupProject(context.Background(), a.Execution, q.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	code, raw := call(t, a, "POST", "/api/session-bindings/inspect", map[string]any{"directory": q.Path, "access": "read"})
	var binding bindingView
	if code != 200 || json.Unmarshal(raw, &binding) != nil {
		t.Fatalf("inspect: %d %s", code, raw)
	}
	if binding.MainDirectory != p.Path || binding.Directory != q.Path {
		t.Fatalf("wrong checkout identity: %+v", binding)
	}
}
