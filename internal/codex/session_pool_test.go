package codex_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/platform"
)

func poolHelper(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	bin, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "codex"), []byte("#!/bin/sh\nexec "+platform.ShellQuote(bin)+" -test.run=TestCodexProtocolHelper\n"), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("WORKTREE_HUB_CODEX_HELPER", "1")
	starts := filepath.Join(dir, "starts")
	t.Setenv("WORKTREE_HUB_CODEX_STARTS", starts)
	return starts
}

func TestSessionPoolSharesOneProcessAcrossConcurrentRequests(t *testing.T) {
	starts := poolHelper(t)
	p := codex.NewSessionPool()
	defer p.Close()
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, err := p.Open(context.Background())
			if err != nil {
				t.Error(err)
				return
			}
			defer c.Close()
			var result struct{ PID int }
			if err := c.Call("thread/list", nil, &result); err != nil || result.PID == 0 {
				t.Errorf("request: %v %+v", err, result)
			}
		}()
	}
	wg.Wait()
	raw, err := os.ReadFile(starts)
	if err != nil || string(raw) != "start\n" {
		t.Fatalf("expected one process, got %q: %v", raw, err)
	}
	// Releasing every HTTP request leaves the process ready for later polls.
	c, err := p.Open(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := c.Call("thread/read", nil, nil); err != nil {
		t.Fatal(err)
	}
	p.Close()
	if err := c.Call("thread/read", nil, nil); err == nil {
		t.Fatal("shutdown left the child available")
	}
	if _, err := p.Open(context.Background()); err == nil {
		t.Fatal("closed pool reopened")
	}
}

func TestSessionPoolBoundsCancelledRequestsAndKeepsOtherLeases(t *testing.T) {
	poolHelper(t)
	p := codex.NewSessionPool()
	defer p.Close()
	ctx, cancel := context.WithCancel(context.Background())
	c, err := p.Open(ctx)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	if err := c.Call("thread/list", nil, nil); err == nil {
		t.Fatal("cancelled lease made a request")
	}
	c.Close()
	other, err := p.Open(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if err := other.Call("thread/list", nil, nil); err != nil {
		t.Fatal("one lease cancelled the shared process:", err)
	}
	short, end := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer end()
	waiting, err := p.Open(short)
	if err != nil {
		t.Fatal(err)
	}
	defer waiting.Close()
	started := time.Now()
	if err := waiting.Call("wait", nil, nil); err == nil || time.Since(started) > time.Second {
		t.Fatal("request did not respect its deadline:", err)
	}
}

func TestSessionPoolBacksOffFailedStarts(t *testing.T) {
	starts := poolHelper(t)
	t.Setenv("WORKTREE_HUB_CODEX_FAIL", "1")
	p := codex.NewSessionPool()
	defer p.Close()
	for i := 0; i < 10; i++ {
		if _, err := p.Open(context.Background()); err == nil {
			t.Fatal("expected initialization error")
		}
	}
	raw, err := os.ReadFile(starts)
	if err != nil || strings.Count(string(raw), "start\n") != 1 {
		t.Fatalf("failed starts were not backed off: %q %v", raw, err)
	}
}

func TestSessionPoolReconnectsAfterProcessExitWithoutHotRetry(t *testing.T) {
	starts := poolHelper(t)
	p := codex.NewSessionPool()
	defer p.Close()
	c, err := p.Open(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if err := c.Call("exit", nil, nil); err == nil {
		t.Fatal("dead child returned success")
	}
	if _, err := p.Open(context.Background()); err == nil {
		t.Fatal("dead child was immediately restarted")
	}
	raw, err := os.ReadFile(starts)
	if err != nil || string(raw) != "start\n" {
		t.Fatalf("hot restart: %q %v", raw, err)
	}
	deadline := time.Now().Add(7 * time.Second)
	for {
		c, err := p.Open(context.Background())
		if err == nil {
			defer c.Close()
			if err := c.Call("thread/list", nil, nil); err != nil {
				t.Fatal("reconnected process failed:", err)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("pool did not reconnect:", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	raw, err = os.ReadFile(starts)
	if err != nil || strings.Count(string(raw), "start\n") != 2 {
		t.Fatalf("expected one replacement process: %q %v", raw, err)
	}
}
