package project

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

type worktreeResponse struct {
	code int
	body string
}

func checkoutHook(t *testing.T, repository, script string) {
	t.Helper()
	hooks := t.TempDir()
	if err := os.WriteFile(filepath.Join(hooks, "post-checkout"), []byte("#!/bin/sh\n"+script+"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	testGit(t, repository, "config", "core.hooksPath", hooks)
}

func createWorktreeAsync(t *testing.T, a *App, id, slug, branch string) <-chan worktreeResponse {
	t.Helper()
	out := make(chan worktreeResponse, 1)
	go func() {
		code, raw := manualWorktree(t, a, id, CreateWorktree{Slug: slug, Mode: "new", Branch: branch, Source: "HEAD"})
		out <- worktreeResponse{code: code, body: string(raw)}
	}()
	return out
}

func waitForCheckoutHook(t *testing.T, path string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		if _, err := os.Stat(path); err == nil {
			return
		} else if !errors.Is(err, os.ErrNotExist) {
			t.Fatal(err)
		}
		select {
		case <-ctx.Done():
			t.Fatal("checkout hook did not start")
		case <-tick.C:
		}
	}
}

func TestWorktreeCreationSerializesOnlyItsRepository(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses a POSIX checkout hook")
	}
	a := testApp(t)
	front, back := repo(t, "front", "main"), repo(t, "back", "main")
	first, second := register(t, a, "Front", front), register(t, a, "Back", back)
	marker, release := filepath.Join(t.TempDir(), "running"), filepath.Join(t.TempDir(), "release")
	releaseHook := func() { _ = os.WriteFile(release, nil, 0600) }
	defer releaseHook()
	// The deadline ensures a failed test never leaves a child process behind.
	checkoutHook(t, front,
		"touch "+shellQuote(marker)+"\n"+
			"i=0; while [ ! -f "+shellQuote(release)+" ] && [ \"$i\" -lt 100 ]; do i=$((i+1)); sleep .05; done")
	running := createWorktreeAsync(t, a, first, "checkout-one", "same-branch")
	waitForCheckoutHook(t, marker)
	same := createWorktreeAsync(t, a, first, "checkout-two", "same-branch")
	other := createWorktreeAsync(t, a, second, "checkout-one", "same-branch")
	select {
	case result := <-same:
		t.Fatalf("same repository bypassed the lock: %+v", result)
	case result := <-other:
		if result.code != 201 {
			t.Fatal(result)
		}
	case <-time.After(3 * time.Second):
		releaseHook()
		<-running
		<-same
		<-other
		t.Fatal("unrelated repository waited for the first checkout hook")
	}
	releaseHook()
	if result := <-running; result.code != 201 {
		t.Fatal(result)
	}
	if result := <-same; result.code != 409 || !strings.Contains(result.body, "本地分支已存在") {
		t.Fatalf("did not recheck branch after acquiring the lock: %+v", result)
	}
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

// Both repositories run a fixed 250 ms hook. Copy this test file unchanged
// to the baseline for a comparable measurement through the actual HTTP route.
func TestMeasureWorktreeCreationOverlap(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses a POSIX checkout hook")
	}
	a := testApp(t)
	front, back := repo(t, "front", "main"), repo(t, "back", "main")
	first, second := register(t, a, "Front", front), register(t, a, "Back", back)
	checkoutHook(t, front, "sleep .25")
	checkoutHook(t, back, "sleep .25")
	start := time.Now()
	one := createWorktreeAsync(t, a, first, "benchmark", "benchmark")
	two := createWorktreeAsync(t, a, second, "benchmark", "benchmark")
	for _, response := range []worktreeResponse{<-one, <-two} {
		if response.code != 201 {
			t.Fatal(response)
		}
	}
	t.Logf("two isolated checkout requests: %v", time.Since(start))
}
