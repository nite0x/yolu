package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"worktree-hub/internal/execution"
)

func TestExecutionAgentProcess(t *testing.T) {
	if os.Getenv("WORKTREE_HUB_AGENT_TEST") != "1" {
		return
	}
	if err := runExecutionAgent(os.Stdin, os.Stdout); err != nil {
		os.Exit(2)
	}
	os.Exit(0)
}
func testExecutionClient(t *testing.T) *execution.Client {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestExecutionAgentProcess$")
	cmd.Env = append(os.Environ(), "WORKTREE_HUB_AGENT_TEST=1")
	c, err := execution.StartClient(cmd)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)
	return c
}
func TestRemoteExecutionCoreFlow(t *testing.T) {
	c := testExecutionClient(t)
	data := filepath.Join(t.TempDir(), "host-metadata")
	root := filepath.Join(t.TempDir(), "remote-workspaces")
	a, err := openAppForExecution(data, root, c)
	if err != nil {
		t.Fatal(err)
	}
	a.Execution.ReadOnlySessions = true
	t.Cleanup(func() { a.Projects.Close(); a.Execution.Store.DB.Close() })
	first, second := repo(t, "first", "master"), repo(t, "second", "master")
	p1, p2 := register(t, a, "first", first), register(t, a, "second", second)
	tree := createWorktree(t, a, p1, "remote-first")
	other := createWorktree(t, a, p2, "remote-second")
	for _, item := range []string{tree.Path, other.Path} {
		if !strings.HasPrefix(item, a.Execution.Root+string(os.PathSeparator)) {
			t.Fatalf("worktree escaped root: %s", item)
		}
	}
	if _, err := os.Stat(filepath.Join(data, "worktree-hub.db")); err != nil {
		t.Fatal("host metadata missing", err)
	}
	if _, err := os.Stat(filepath.Join(root, "worktree-hub.db")); !os.IsNotExist(err) {
		t.Fatal("helper must not create a business database")
	}
	if err := os.WriteFile(filepath.Join(tree.Path, "changed.txt"), []byte("dirty"), 0644); err != nil {
		t.Fatal(err)
	}
	code, raw := call(t, a, "GET", "/api/projects/"+p1+"/git", nil)
	if code != 200 || !strings.Contains(string(raw), `"dirty":1`) {
		t.Fatalf("remote status: %d %s", code, raw)
	}
	if err := c.Call(context.Background(), execution.Request{Op: "session", Method: "turn/start"}, nil); err == nil {
		t.Fatal("helper accepted a model turn")
	}
}
func TestRemoteExecutionErrorsAndCancellation(t *testing.T) {
	c := testExecutionClient(t)
	ctx := execution.WithClient(context.Background(), c)
	root := t.TempDir()
	missing := filepath.Join(root, "missing")
	if _, err := execution.Stat(ctx, missing, false); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing error lost: %v", err)
	}
	canceled, stop := context.WithCancel(ctx)
	stop()
	if err := execution.Mkdir(canceled, missing, 0755, false); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("canceled operation was executed")
	}
}

func TestRemoteExecutionRejectsRelativeAndWindowsRoots(t *testing.T) {
	// An unconnected client proves invalid roots are rejected before any RPC.
	c := &execution.Client{Identity: execution.Identity{Home: "/home/nite"}}
	for _, root := range []string{"relative", `C:\workspaces`} {
		if a, err := openAppForExecution(t.TempDir(), root, c); err == nil {
			a.Execution.Store.DB.Close()
			t.Fatalf("accepted non-Linux root %q", root)
		}
	}
}
func TestReadOnlySessionModeKeepsHistoryAndRejectsControl(t *testing.T) {
	a := testApp(t)
	a.Execution.ReadOnlySessions = true
	_, body := call(t, a, "GET", "/?app-page=conversations", nil)
	raw := string(body)
	if !strings.Contains(raw, `content="read-only"`) || strings.Contains(raw, `src="/features/sessions/session-chat.js"`) || strings.Contains(raw, `src="/features/sessions/session-create.js"`) {
		t.Fatal("read-only page still loads interactive controls")
	}
	for _, path := range []string{"/api/sessions/new", "/api/sessions/session/chat", "/api/sessions/session/chat/handoff", "/api/sessions/session/bindings"} {
		code, _ := call(t, a, "POST", path, map[string]string{})
		if code != 405 {
			t.Fatalf("control %s returned %d", path, code)
		}
	}
}
