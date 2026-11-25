package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"
)

// No model requests: reproduce native-client ownership with two independent
// app-servers and a new thread, leaving existing conversations untouched.
func TestInstalledCodexIdleWriterLock(t *testing.T) {
	if os.Getenv("WORKTREE_HUB_TEST_INSTALLED_CODEX") != "1" {
		t.Skip("opt-in installed writer lock check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	owner, err := StartWire(ctx, Command(ctx, "app-server"))
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	other, err := StartWire(ctx, Command(ctx, "app-server"))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	var started struct {
		Thread Session `json:"thread"`
	}
	if err := owner.Call(ctx, "thread/start", map[string]any{"cwd": t.TempDir(), "sandbox": "read-only", "approvalPolicy": "never"}, &started); err != nil {
		t.Fatal(err)
	}
	id := started.Thread.ID
	if id == "" {
		t.Fatal("missing new thread ID")
	}
	defer func() {
		owner.Close()
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		if err := other.Call(cleanup, "thread/delete", map[string]any{"threadId": id}, nil); err != nil {
			t.Errorf("delete isolated test thread: %v", err)
		}
	}()
	// Codex does not persist a fresh thread until its first item. A local
	// shell item creates the rollout without submitting a model request.
	command := "printf YOLU_WRITER_LOCK_PROBE"
	if runtime.GOOS == "windows" {
		command = "Write-Output YOLU_WRITER_LOCK_PROBE"
	}
	if err := owner.Call(ctx, "thread/shellCommand", map[string]any{"threadId": id, "command": command, "timeoutMs": 5000}, nil); err != nil {
		t.Fatal(err)
	}
	for {
		select {
		case event := <-owner.Events():
			if event.Method == "item/completed" {
				goto persisted
			}
		case <-ctx.Done():
			t.Fatal("seed item did not complete")
		}
	}
persisted:
	var metadata struct {
		Thread Session `json:"thread"`
	}
	params := map[string]any{"threadId": id, "includeTurns": false}
	for {
		if err := owner.Call(ctx, "thread/read", params, &metadata); err != nil {
			t.Fatal(err)
		}
		if metadata.Thread.Status.Type == "idle" {
			break
		}
		select {
		case <-time.After(20 * time.Millisecond):
		case <-ctx.Done():
			t.Fatalf("owner did not become idle: %s", metadata.Thread.Status.Type)
		}
	}
	if err := other.Call(ctx, "thread/read", params, &metadata); err != nil || metadata.Thread.Status.Type != "notLoaded" {
		t.Fatalf("other server should see notLoaded: %s, %v", metadata.Thread.Status.Type, err)
	}
	resume := map[string]any{"threadId": id, "excludeTurns": true}
	if err := other.Call(ctx, "thread/resume", resume, nil); err == nil || !strings.Contains(err.Error(), "already has an active writer") {
		t.Fatalf("idle thread must retain its exclusive writer: %v", err)
	}
	owner.Close()
	if err := other.Call(ctx, "thread/resume", resume, nil); err != nil {
		t.Fatalf("resume after original owner exits: %v", err)
	}
}

// Two shared-daemon clients can alternate turns while both remain connected.
// Shell-only items avoid model requests and touch only the new test thread.
func TestInstalledCodexSharedDaemonIdleClients(t *testing.T) {
	if os.Getenv("WORKTREE_HUB_TEST_INSTALLED_CODEX") != "1" {
		t.Skip("opt-in installed shared daemon check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	terminal, err := OpenLive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	yolu, err := OpenLive(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer yolu.Close()
	var started struct {
		Thread Session `json:"thread"`
	}
	if err := terminal.Call(ctx, "thread/start", map[string]any{"cwd": t.TempDir(), "sandbox": "read-only", "approvalPolicy": "never"}, &started); err != nil {
		t.Fatal(err)
	}
	id := started.Thread.ID
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		if err := terminal.Call(cleanup, "thread/delete", map[string]any{"threadId": id}, nil); err != nil {
			t.Errorf("delete shared-daemon test thread: %v", err)
		}
	}()
	sequence := 0
	run := func(client LiveClient) {
		t.Helper()
		sequence++
		marker := fmt.Sprintf("YOLU_SHARED_DAEMON_PROBE_%d", sequence)
		command := "printf " + marker
		if runtime.GOOS == "windows" {
			command = "Write-Output " + marker
		}
		if err := client.Call(ctx, "thread/shellCommand", map[string]any{"threadId": id, "command": command, "timeoutMs": 5000}, nil); err != nil {
			t.Fatal(err)
		}
		turnID := ""
		for {
			select {
			case event := <-client.Events():
				var p struct {
					ThreadID string                   `json:"threadId"`
					TurnID   string                   `json:"turnId"`
					Item     struct{ Command string } `json:"item"`
					Turn     struct{ ID string }      `json:"turn"`
				}
				if json.Unmarshal(event.Params, &p) != nil || p.ThreadID != id {
					continue
				}
				if event.Method == "item/completed" && strings.Contains(p.Item.Command, marker) {
					turnID = p.TurnID
				}
				if event.Method == "turn/completed" && turnID != "" && p.Turn.ID == turnID {
					return
				}
			case <-ctx.Done():
				t.Fatal("shared-daemon item did not complete")
			}
		}
	}
	run(terminal)
	var resumed struct {
		Thread Session `json:"thread"`
	}
	if err := yolu.Call(ctx, "thread/resume", map[string]any{"threadId": id, "excludeTurns": true}, &resumed); err != nil {
		t.Fatal("idle terminal prevented shared resume:", err)
	}
	if resumed.Thread.ID != id || resumed.Thread.Status.Type != "idle" {
		t.Fatalf("shared thread not idle: %+v", resumed.Thread)
	}
	run(yolu)
	// The original terminal connection is still usable after the Yolu turn.
	run(terminal)
}
