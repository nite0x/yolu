package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"worktree-hub/internal/model"
	"worktree-hub/internal/testutil"
)

func testApp(t *testing.T) *App {
	t.Helper()
	root := t.TempDir()
	a, err := openApp(filepath.Join(root, "data"), filepath.Join(root, "workspaces"))
	if err != nil {
		t.Fatal(err)
	}
	a.Projects.CredentialHelper = ""
	t.Cleanup(func() { a.Close() })
	return a
}
func TestLocalAPIRejectsCrossSiteAndStaleToken(t *testing.T) {
	a := testApp(t)
	for _, scenario := range []string{"missing-token", "foreign-origin", "foreign-host"} {
		r := httptest.NewRequest("GET", "http://localhost:4317/api/state", nil)
		r.Header.Set("X-CSRF-Token", a.token)
		switch scenario {
		case "missing-token":
			r.Header.Del("X-CSRF-Token")
		case "foreign-origin":
			r.Header.Set("Origin", "https://example.invalid")
		case "foreign-host":
			r.Host = "example.invalid:4317"
		}
		w := httptest.NewRecorder()
		a.handler().ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("accepted %s", scenario)
		}
	}
}

func TestProjectRemovalPreservesSavedConversationDirectory(t *testing.T) {
	a := testApp(t)
	repository := repo(t, "repo", "main")
	projectID := register(t, a, "App", repository)
	tree := createWorktree(t, a, projectID, "keep")
	if _, err := a.Execution.Store.DB.Exec(`INSERT INTO sessions(id,name,cwd,created_at,updated_at,source) VALUES('saved','Saved',?,1,1,'test')`, tree.Path); err != nil {
		t.Fatal(err)
	}
	binding, err := a.Execution.Store.BindSessionDirectory(model.SessionProjectBinding{SessionID: "saved", ProjectID: projectID, Directory: tree.Path, Role: "primary", Access: "write"})
	if err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/projects/" + projectID
	code, raw := call(t, a, http.MethodGet, endpoint+"/removal", nil)
	var preview struct {
		Sessions []struct{ ID string } `json:"sessions"`
	}
	if code != 200 || json.Unmarshal(raw, &preview) != nil || len(preview.Sessions) != 1 || preview.Sessions[0].ID != "saved" {
		t.Fatalf("removal preview: %d %s", code, raw)
	}
	if code, raw := call(t, a, http.MethodDelete, endpoint, nil); code != 200 {
		t.Fatalf("remove registration: %d %s", code, raw)
	}
	if path, err := a.Sessions.BindingDirectory(t.Context(), "saved", binding.ID); err != nil || path != tree.Path {
		t.Fatalf("saved directory after removal: %s %v", path, err)
	}
	if content, err := os.ReadFile(filepath.Join(tree.Path, "README.md")); err != nil || string(content) != "baseline\n" {
		t.Fatal("removing registration changed Worktree files")
	}
}

var (
	testGit        = testutil.Git
	repo           = testutil.Repo
	call           = testutil.Call
	register       = testutil.Register
	createWorktree = testutil.CreateWorktree
	remoteClone    = testutil.RemoteClone
	advanceRemote  = testutil.AdvanceRemote
)
var settledState = testutil.SettledState

func (a *App) TestHandler() http.Handler { return a.handler() }
func (a *App) TestToken() string         { return a.token }
