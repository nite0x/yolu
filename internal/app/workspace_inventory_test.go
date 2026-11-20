package app

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"worktree-hub/internal/store"
	"worktree-hub/internal/workspace"
)

func TestWorkspaceInventoryPreservesOfflineWorkspacesAndEnvironmentIdentity(t *testing.T) {
	a := testApp(t)
	p := register(t, a, "Local", repo(t, "local", "master"))
	_, q, raw := create(t, a, p, nil, "original")
	if q.State != "ready" {
		t.Fatal(string(raw))
	}
	marker := filepath.Join(q.Members[0].Path, "keep.txt")
	if err := os.WriteFile(marker, []byte("uncommitted work"), 0600); err != nil {
		t.Fatal(err)
	}
	h, err := newEnvironmentHub(a)
	if err != nil {
		t.Fatal(err)
	}
	e := Environment{ID: environmentID("Ubuntu", "user"), Name: "WSL · Ubuntu / user", Distro: "Ubuntu", User: "user", Root: "/new/root"}
	dataDir := filepath.Join(a.Execution.DataDir, "environments", e.ID)
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		t.Fatal(err)
	}
	s, err := store.Open(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	// Imported environments can contain the same IDs and slugs as local workspaces.
	// The saved directory also intentionally differs from the current root.
	_, err = s.DB.Exec(`INSERT INTO projects VALUES(?, 'Remote', '/repo/remote', '/repo/remote/.git', 'remote', 'now')`, p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`INSERT INTO workspaces(id,name,slug,description,branch,path,primary_project_id,state,created_at) VALUES(?, 'Remote workspace', 'original', 'notes', 'codex/original', '/original/workspace/workspace', ?, 'creating', '9999')`, q.ID, p); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`INSERT INTO members(workspace_id,project_id,path,base_commit,state,error) VALUES(?, ?, '/original/workspace/workspace/remote', 'baseline', 'creating', '')`, q.ID, p); err != nil {
		t.Fatal(err)
	}
	h.entries = []Environment{e, {ID: "missing", Name: "Unavailable metadata"}}
	r := httptest.NewRequest("GET", "http://localhost:4317/api/workspace-inventory?refresh=1", nil)
	r.Header.Set("X-CSRF-Token", a.token)
	// The inventory always spans all environments, regardless of caller scope.
	r.Header.Set("X-Environment-ID", e.ID)
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("inventory %d %s", w.Code, w.Body.String())
	}
	var inventory struct {
		Workspaces   []workspaceInventoryEntry       `json:"workspaces"`
		Environments []workspaceInventoryEnvironment `json:"environments"`
		ProjectCount int                             `json:"project_count"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &inventory); err != nil {
		t.Fatal(err)
	}
	if len(inventory.Workspaces) != 2 || inventory.ProjectCount != 2 || len(inventory.Environments) != 3 {
		t.Fatalf("incomplete inventory: %s", w.Body.String())
	}
	remote, local := inventory.Workspaces[0], inventory.Workspaces[1]
	if remote.EnvironmentID != e.ID || remote.ID != q.ID || remote.Path != "/original/workspace/workspace" || remote.State != "creating" || remote.Connected || remote.Members[0].Path != "/original/workspace/workspace/remote" {
		t.Fatalf("offline workspace changed: %+v", remote)
	}
	if local.EnvironmentID != "local" || local.Path != q.Path || !local.Connected || local.Members[0].Path != q.Members[0].Path {
		t.Fatalf("local workspace changed: %+v", local)
	}
	if len(h.apps) != 0 || inventory.Environments[2].Error == "" {
		t.Fatal("listing started an environment or hid a metadata error")
	}
	saved, err := s.Workspace(q.ID)
	if err != nil || saved.State != "creating" || saved.Members[0].State != "creating" {
		t.Fatalf("listing rewrote interrupted state: %+v %v", saved, err)
	}
	if data, err := os.ReadFile(marker); err != nil || string(data) != "uncommitted work" {
		t.Fatalf("listing modified workspace files: %s %v", data, err)
	}
	if branch := testGit(t, q.Members[0].Path, "branch", "--show-current"); branch != q.Branch {
		t.Fatalf("listing switched branch: %s", branch)
	}
	if _, err := os.Stat(filepath.Join(a.Execution.DataDir, "environments", "missing")); !os.IsNotExist(err) {
		t.Fatal("listing created missing metadata directories")
	}
}

func TestWorkspacesRejectProjectsFromAnotherEnvironment(t *testing.T) {
	a, other := testApp(t), testApp(t)
	p := register(t, a, "Here", repo(t, "here", "master"))
	foreign := register(t, other, "Elsewhere", repo(t, "elsewhere", "master"))
	code, raw := call(t, a, "POST", "/api/workspaces", workspace.CreateWorkspaceInput{Name: "Mixed", Slug: "mixed", PrimaryProjectID: p, ProjectIDs: []string{foreign}})
	if code != 400 {
		t.Fatalf("cross-environment creation accepted: %d %s", code, raw)
	}
	if _, err := os.Stat(filepath.Join(a.Execution.Root, "mixed")); !os.IsNotExist(err) {
		t.Fatal("rejected workspace created a directory")
	}
	_, q, raw := create(t, a, p, nil, "same-environment")
	if q.State != "ready" {
		t.Fatal(string(raw))
	}
	code, raw = call(t, a, "POST", "/api/workspaces/"+q.ID+"/projects", map[string]any{"project_ids": []string{foreign}})
	if code != 400 {
		t.Fatalf("cross-environment addition accepted: %d %s", code, raw)
	}
	saved, err := a.Execution.Store.Workspace(q.ID)
	if err != nil || len(saved.Members) != 1 || saved.Path != q.Path {
		t.Fatalf("rejected addition changed workspace: %+v %v", saved, err)
	}
}

func TestWorkspaceInventoryNativeAndSecurity(t *testing.T) {
	a := testApp(t)
	code, raw := call(t, a, "GET", "/api/workspace-inventory", nil)
	if code != 200 {
		t.Fatalf("native inventory %d %s", code, raw)
	}
	r := httptest.NewRequest("GET", "http://localhost:4317/api/workspace-inventory", nil)
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("workspace inventory bypassed authentication")
	}
}
