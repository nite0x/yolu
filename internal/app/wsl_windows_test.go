package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/platform"
)

// Opt in: only temporary repositories are created. No Codex turn is started.
func TestInstalledWSLProjectWorktrees(t *testing.T) {
	distro := os.Getenv("WORKTREE_HUB_TEST_WSL")
	if distro == "" {
		t.Skip("set WORKTREE_HUB_TEST_WSL to an installed distro")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c, err := execution.StartWSL(ctx, distro, "")
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("wsl.exe", execution.WSLArgs(distro, c.Identity.User, "mktemp", "-d", "/tmp/worktree-hub-native-smoke.XXXXXX")...)
	platform.HideCommand(cmd)
	raw, err := cmd.Output()
	if err != nil {
		c.Close()
		t.Fatal(err)
	}
	root := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(root, "/tmp/worktree-hub-native-smoke.") || strings.ContainsAny(root, "\r\n") {
		c.Close()
		t.Fatal("invalid fixture root")
	}
	remoteCtx := execution.WithClient(context.Background(), c)
	a, err := openAppForExecution(filepath.Join(t.TempDir(), "host-metadata"), root+"/workspaces", c)
	if err != nil {
		c.Close()
		t.Fatal(err)
	}
	a.Execution.ReadOnlySessions = true
	t.Cleanup(func() {
		a.Projects.Close()
		a.Execution.Store.DB.Close()
		c.Close()
		cleanup := exec.Command("wsl.exe", execution.WSLArgs(distro, c.Identity.User, "rm", "-rf", "--", root)...)
		platform.HideCommand(cleanup)
		_ = cleanup.Run()
	})
	ids := []string{}
	for _, name := range []string{"frontend", "backend"} {
		dir := root + "/" + name
		if err := execution.Mkdir(remoteCtx, dir, 0755, false); err != nil {
			t.Fatal(err)
		}
		for _, args := range [][]string{{"init", "-b", "master"}, {"config", "user.name", "Smoke Test"}, {"config", "user.email", "smoke@example.invalid"}} {
			if _, err := execution.Git(remoteCtx, dir, args...); err != nil {
				t.Fatal(err)
			}
		}
		if err := execution.Write(remoteCtx, dir+"/README.md", []byte(name), os.O_CREATE|os.O_WRONLY, 0644); err != nil {
			t.Fatal(err)
		}
		for _, args := range [][]string{{"add", "README.md"}, {"commit", "-m", "baseline"}} {
			if _, err := execution.Git(remoteCtx, dir, args...); err != nil {
				t.Fatal(err)
			}
		}
		ids = append(ids, register(t, a, name, dir))
	}
	tree := createWorktree(t, a, ids[0], "wsl-first")
	second := createWorktree(t, a, ids[1], "wsl-second")
	for _, p := range []string{tree.Path, second.Path} {
		if !strings.HasPrefix(p, root+"/workspaces/") || strings.Contains(p, `\`) {
			t.Fatal("Linux path was interpreted by Windows", p)
		}
	}
	if err := execution.Write(remoteCtx, tree.Path+"/changed.txt", []byte("dirty"), os.O_CREATE|os.O_WRONLY, 0644); err != nil {
		t.Fatal(err)
	}
	code, body := call(t, a, "GET", "/api/projects/"+ids[0]+"/git", nil)
	if code != 200 || !strings.Contains(string(body), `"dirty":1`) {
		t.Fatalf("status: %d %s", code, body)
	}
	if _, err := os.Stat(filepath.Join(a.Execution.DataDir, "worktree-hub.db")); err != nil {
		t.Fatal("metadata was not stored on Windows", err)
	}
}
