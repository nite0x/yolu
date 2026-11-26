package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/project"
	"worktree-hub/internal/testutil"
)

type App struct {
	*Service
	Projects *project.Service
	token    string
}

func openApp(dataDir, root string) (*App, error) {
	env, err := execution.Open(dataDir, root, nil)
	if err != nil {
		return nil, err
	}
	return &App{Service: New(env), Projects: project.New(env), token: model.NewID()}, nil
}

func testApp(t *testing.T) *App {
	t.Helper()
	root := t.TempDir()
	a, err := openApp(filepath.Join(root, "data"), filepath.Join(root, "workspaces"))
	if err != nil {
		t.Fatal(err)
	}
	a.Projects.CredentialHelper = ""
	a.openCloudSessions = nil
	a.openAgy = func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
		return nil, acp.InitializeResult{}, fmt.Errorf("Antigravity is mocked in tests")
	}
	a.openCursor = func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
		return nil, acp.InitializeResult{}, fmt.Errorf("Cursor is mocked in tests")
	}
	a.openTitleLive = func(context.Context) (codex.LiveClient, error) {
		return nil, fmt.Errorf("title generation is mocked in tests")
	}
	t.Cleanup(func() { a.CloseChats(); a.CloseBridges(); a.Projects.Close(); a.Execution.Close() })
	return a
}

func (a *App) handler() http.Handler {
	return testutil.Handler(a.Execution, a.token, a.Projects, a.Projects.RegisterRoutes, a.RegisterRoutes)
}
func gitView(t *testing.T, a *App, id string) project.GitOverview {
	t.Helper()
	code, raw := call(t, a, "GET", "/api/projects/"+id+"/git", nil)
	if code != 200 {
		t.Fatalf("overview %d %s", code, raw)
	}
	var v project.GitOverview
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func gitAction(t *testing.T, a *App, id string, input project.GitAction) (int, []byte) {
	t.Helper()
	return call(t, a, "POST", "/api/projects/"+id+"/git", input)
}

func TestWorkspaceAgentProcess(t *testing.T) {
	if os.Getenv("WORKTREE_HUB_AGENT_TEST") != "1" {
		return
	}
	err := execution.RunAgent(os.Stdin, os.Stdout, execution.AgentHooks{WatchHistory: WatchCodexHistoryRaw})
	if err != nil {
		os.Exit(2)
	}
	os.Exit(0)
}
func testWorkspaceClient(t *testing.T) *execution.Client {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestWorkspaceAgentProcess$")
	cmd.Env = append(os.Environ(), "WORKTREE_HUB_AGENT_TEST=1")
	c, err := execution.StartClient(cmd)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)
	return c
}

var (
	testGit       = testutil.Git
	repo          = testutil.Repo
	call          = testutil.Call
	register      = testutil.Register
	remoteClone   = testutil.RemoteClone
	advanceRemote = testutil.AdvanceRemote
)
var settledState = testutil.SettledState

func (a *App) TestHandler() http.Handler { return a.handler() }
func (a *App) TestToken() string         { return a.token }

type testDirectory struct {
	ProjectID string
	Path      string
	Parent    string
}

func newTestDirectory(t *testing.T, a *App, projectID, name string) testDirectory {
	t.Helper()
	tree := testutil.CreateWorktree(t, a, projectID, name)
	return testDirectory{ProjectID: projectID, Path: tree.Path, Parent: filepath.Dir(tree.Path)}
}
