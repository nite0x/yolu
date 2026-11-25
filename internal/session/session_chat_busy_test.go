package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
)

func TestChatStateAndSendIgnoreIdleTerminalProcessPresence(t *testing.T) {
	for _, probeErr := range []error{nil, execution.ErrBusy, errors.New("invalid process arguments"), &execution.SessionConflictError{Message: "terminal is open"}} {
		t.Run(fmt.Sprint(probeErr), func(t *testing.T) {
			a, _, c, endpoint := chatFixture(t)
			probes := 0
			a.terminalConflict = func(string, string) error { probes++; return probeErr }
			code, raw := call(t, a, "GET", endpoint, nil)
			var state ChatState
			if code != 200 || json.Unmarshal(raw, &state) != nil || state.Busy || state.Blocked != "" || state.CanHandoff || state.Notice != "" {
				t.Fatalf("idle terminal blocked chat: %d %s", code, raw)
			}
			startFakeChat(t, a, endpoint)
			c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
			<-a.ChatFor("session").finished
			if probes != 0 {
				t.Fatalf("chat still treats terminal process presence as ownership: %d probes", probes)
			}
		})
	}
}

func TestIdleManagedTerminalCanContinueAfterYoluTurn(t *testing.T) {
	a, q, c, endpoint := chatFixture(t)
	up, server := socketPair(t)
	client, terminal := socketPair(t)
	_ = server.SetReadDeadline(time.Now().Add(5 * time.Second))
	_ = terminal.SetReadDeadline(time.Now().Add(5 * time.Second))
	b := &terminalBridge{app: a.Service, session: "session", cwd: q.Path, connected: true, bound: true, client: client, upstream: up, pending: map[string]bridgeCall{}}
	a.bridges["standby"] = b
	startFakeChat(t, a, endpoint)
	// The managed CLI cannot race a Yolu turn, but its connection stays alive.
	request := []byte(`{"id":1,"method":"turn/start","params":{"threadId":"session"}}`)
	if err := b.forward(request); err != nil {
		t.Fatal(err)
	}
	_, rejected, err := terminal.ReadMessage()
	if err != nil || !strings.Contains(string(rejected), "对话正在侧栏运行") {
		t.Fatalf("CLI was allowed to start during Yolu turn: %s %v", rejected, err)
	}
	c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
	<-a.ChatFor("session").finished
	if b.revoked || b.draining || !b.connected {
		t.Fatal("Yolu turn closed or revoked the standby terminal")
	}
	code, raw := call(t, a, "GET", endpoint, nil)
	var state ChatState
	if code != 200 || json.Unmarshal(raw, &state) != nil || state.Blocked != "" || state.CanHandoff {
		t.Fatalf("idle terminal still requires handoff: %d %s", code, raw)
	}
	if err := b.forward(request); err != nil {
		t.Fatal(err)
	}
	_, forwarded, err := server.ReadMessage()
	if err != nil || string(forwarded) != string(request) {
		t.Fatalf("CLI cannot continue after Yolu completes: %s %v", forwarded, err)
	}
}

type lateRuntimeClient struct {
	*fakeLiveClient
	reads int
	phase string
}

func (c *lateRuntimeClient) Call(ctx context.Context, method string, params, out any) error {
	if err := c.fakeLiveClient.Call(ctx, method, params, out); err != nil {
		return err
	}
	if method == "thread/read" {
		c.reads++
	}
	if method == "thread/resume" && c.phase == "resume" || method == "thread/read" && c.reads == 2 {
		if c.phase == "read failure" {
			return errors.New("runtime unavailable")
		}
		id := c.sessionID()
		if c.phase == "wrong thread" {
			id = "other"
		}
		raw, _ := json.Marshal(map[string]any{"thread": map[string]any{"id": id, "cwd": c.cwd, "status": map[string]string{"type": "active"}}})
		return json.Unmarshal(raw, out)
	}
	return nil
}

func TestChatRechecksSharedRuntimeBeforeSending(t *testing.T) {
	for _, phase := range []string{"resume", "before send", "read failure", "wrong thread"} {
		t.Run(phase, func(t *testing.T) {
			a, _, base, endpoint := chatFixture(t)
			c := &lateRuntimeClient{fakeLiveClient: base, phase: phase}
			a.openLive = func(context.Context) (codex.LiveClient, error) { return c, nil }
			if code, raw := call(t, a, "POST", endpoint, map[string]string{"text": "hello", "request_id": "late-check"}); code != 202 {
				t.Fatalf("%d %s", code, raw)
			}
			<-a.ChatFor("session").finished
			state := a.ChatFor("session").snapshot()
			want := "conflict"
			if phase == "read failure" || phase == "wrong thread" {
				want = "failed"
			}
			if state.Busy || state.Status != want || state.Error == "" {
				t.Fatalf("late runtime check was ignored: %+v", state)
			}
			base.mu.Lock()
			methods := append([]string{}, base.methods...)
			base.mu.Unlock()
			for _, method := range methods {
				if method == "turn/start" || method == "turn/interrupt" {
					t.Fatalf("late runtime conflict triggered %s", method)
				}
			}
		})
	}
}
