package codex_test

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/platform"
)

// Spawn the test binary itself as a deterministic app-server stand-in. This
// exercises the real newline protocol, notifications, errors and cancellation.
func TestCodexProtocolHelper(t *testing.T) {
	if os.Getenv("WORKTREE_HUB_CODEX_HELPER") != "1" {
		return
	}
	if path := os.Getenv("WORKTREE_HUB_CODEX_STARTS"); path != "" {
		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
		if err != nil {
			os.Exit(2)
		}
		_, _ = f.WriteString("start\n")
		_ = f.Close()
	}
	if os.Getenv("WORKTREE_HUB_CODEX_FAIL") == "1" {
		os.Exit(1)
	}
	scanner := bufio.NewScanner(os.Stdin)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var request struct {
			ID     int
			Method string
		}
		_ = json.Unmarshal(scanner.Bytes(), &request)
		if request.Method == "initialized" {
			continue
		}
		if request.Method == "wait" {
			time.Sleep(30 * time.Second)
			continue
		}
		if request.Method == "exit" {
			os.Exit(0)
		}
		_ = encoder.Encode(map[string]any{"method": "notification", "params": map[string]any{}})
		if request.Method == "bad" {
			_ = encoder.Encode(map[string]any{"id": request.ID, "error": map[string]any{"message": "missing session"}})
			continue
		}
		if request.Method == "large" {
			_ = encoder.Encode(map[string]any{"id": request.ID, "result": map[string]any{"text": strings.Repeat("a", 5<<20)}})
			continue
		}
		_ = encoder.Encode(map[string]any{"id": request.ID, "result": map[string]any{"data": []any{}, "pid": os.Getpid()}})
	}
	os.Exit(0)
}

func TestCodexClientProtocolAndCancellation(t *testing.T) {
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
	c, err := codex.OpenSessionClient(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var page codex.SessionPage
	if err := c.Call("thread/list", map[string]any{}, &page); err != nil || len(page.Data) != 0 {
		t.Fatalf("protocol %v %+v", err, page)
	}
	if err := c.Call("bad", map[string]any{}, nil); err == nil || !strings.Contains(err.Error(), "missing session") {
		t.Fatal(err)
	}
	var large struct{ Text string }
	if err := c.Call("large", map[string]any{}, &large); err != nil || len(large.Text) != 5<<20 {
		t.Fatalf("large history response: bytes=%d err=%v", len(large.Text), err)
	}
	c.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	c, err = codex.OpenSessionClient(ctx)
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if err := c.Call("wait", map[string]any{}, nil); err == nil {
		t.Fatal("expected timeout")
	}
	c.Close()
	if time.Since(started) > 3*time.Second {
		t.Fatal("child process was not cancelled")
	}
}
