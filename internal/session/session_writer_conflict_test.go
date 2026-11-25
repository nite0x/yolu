package session

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"worktree-hub/internal/codex"
)

func TestWriterConflictSurvivesPollingOlderCompletedNativeTurn(t *testing.T) {
	a, q, base, endpoint := chatFixture(t)
	path := filepath.Join(t.TempDir(), "rollout.jsonl")
	if err := os.WriteFile(path, []byte("{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"older-native-turn\"}}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	thread := codex.Session{ID: "session", Cwd: q.Path, Path: path}
	thread.Status.Type = "idle"
	metadata := map[string]codex.Session{thread.ID: thread}
	fakeSessions(a, metadata)
	a.openLive = func(context.Context) (codex.LiveClient, error) {
		return &writerConflictClient{fakeLiveClient: base, failMethod: "thread/resume"}, nil
	}
	if code, raw := call(t, a, "POST", endpoint, map[string]string{"text": "continue", "request_id": "locked"}); code != 202 {
		t.Fatalf("%d %s", code, raw)
	}
	<-a.ChatFor("session").finished
	code, raw := call(t, a, "GET", endpoint, nil)
	var state ChatState
	if code != 200 || json.Unmarshal(raw, &state) != nil || state.ID != "locked" || state.External || state.Status != "conflict" || !strings.Contains(state.Error, "写入锁") {
		t.Fatalf("older native completion hid the failed send: %d %s", code, raw)
	}
	// A genuinely active native turn still takes precedence for stop/approval
	// ownership, even while the previous Yolu attempt has an error.
	thread.Status.Type = "active"
	metadata[thread.ID] = thread
	code, raw = call(t, a, "GET", endpoint, nil)
	if code != 200 || json.Unmarshal(raw, &state) != nil || !state.External || !state.Busy {
		t.Fatalf("active native turn was hidden: %d %s", code, raw)
	}
}

type writerConflictClient struct {
	*fakeLiveClient
	failMethod string
}

func (c *writerConflictClient) Call(ctx context.Context, method string, params any, result any) error {
	if method == c.failMethod {
		return fmt.Errorf("Codex：thread %s already has an active writer", c.sessionID())
	}
	return c.fakeLiveClient.Call(ctx, method, params, result)
}

func TestIdleWriterConflictCanRetryAfterOwnerReleases(t *testing.T) {
	for _, method := range []string{"thread/resume", "turn/start"} {
		t.Run(method, func(t *testing.T) {
			a, _, base, endpoint := chatFixture(t)
			client := &writerConflictClient{fakeLiveClient: base, failMethod: method}
			a.openLive = func(context.Context) (codex.LiveClient, error) { return client, nil }
			if code, raw := call(t, a, "POST", endpoint, map[string]string{"text": "hello", "request_id": "locked"}); code != 202 {
				t.Fatalf("%d %s", code, raw)
			}
			run := a.ChatFor("session")
			<-run.finished
			state := run.snapshot()
			if state.Busy || state.Status != "conflict" || !strings.Contains(state.Error, "写入锁") || !strings.Contains(state.Notice, "重试发送") {
				t.Fatalf("idle writer not explained as recoverable contention: %+v", state)
			}
			if state.Blocked != "" || state.CanHandoff || run.directoryError != "" {
				t.Fatalf("writer conflict misclassified as a terminal or directory failure: %+v, %s", state, run.directoryError)
			}
			base.mu.Lock()
			methods := append([]string{}, base.methods...)
			base.mu.Unlock()
			for _, called := range methods {
				if called == "turn/start" || called == "turn/interrupt" || called == "thread/fork" || called == "thread/delete" {
					t.Fatalf("conflict triggered %s", called)
				}
			}

			// The next explicit send rechecks ownership; no persistent blocked
			// flag, forced takeover or conversation fork is needed to recover.
			client.failMethod = ""
			if code, raw := call(t, a, "POST", endpoint, map[string]string{"text": "hello", "request_id": "retry"}); code != 202 {
				t.Fatalf("%d %s", code, raw)
			}
			awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
			base.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
			<-a.ChatFor("session").finished
			state = a.ChatFor("session").snapshot()
			if state.Status != "completed" || state.Error != "" || state.Notice != "" {
				t.Fatalf("retry did not recover cleanly: %+v", state)
			}
		})
	}
}
