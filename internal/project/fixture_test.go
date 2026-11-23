package project

import (
	"net/http"
	"path/filepath"
	"testing"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/overview"
	"worktree-hub/internal/testutil"
)

type App struct {
	*Service
	token string
}

func openApp(dataDir, root string) (*App, error) {
	env, err := execution.Open(dataDir, root, nil)
	if err != nil {
		return nil, err
	}
	return &App{Service: New(env), token: model.NewID()}, nil
}

func testApp(t *testing.T) *App {
	t.Helper()
	root := t.TempDir()
	a, err := openApp(filepath.Join(root, "data"), filepath.Join(root, "workspaces"))
	if err != nil {
		t.Fatal(err)
	}
	a.CredentialHelper = ""
	t.Cleanup(func() { a.cache.Close(); a.Execution.Close() })
	return a
}

func (a *App) handler() http.Handler {
	return testutil.Handler(a.Execution, a.token, a.Service, a.RegisterRoutes)
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

func (a *App) TestHandler() http.Handler { return a.handler() }
func (a *App) TestToken() string         { return a.token }

func (a *App) StateHandler(w http.ResponseWriter, r *http.Request) {
	overview.New(a.Execution, a.Service).ServeHTTP(w, r)
}
