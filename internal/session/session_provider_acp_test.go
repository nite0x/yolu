package session

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/model"
)

type slowACPCreateClient struct {
	*fakeACPClient
	delay    time.Duration
	attempts atomic.Int32
	closed   atomic.Bool
	started  chan struct{}
}

func (c *slowACPCreateClient) Call(ctx context.Context, method string, params, out any) error {
	if method == "session/new" {
		c.attempts.Add(1)
		if c.started != nil {
			select {
			case c.started <- struct{}{}:
			default:
			}
		}
		timer := time.NewTimer(c.delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return c.fakeACPClient.Call(ctx, method, params, out)
}

func (c *slowACPCreateClient) Close() { c.closed.Store(true) }

func TestACPColdCreationSurvivesTwentySeconds(t *testing.T) {
	for _, provider := range []string{model.ProviderAgy, model.ProviderCursor} {
		t.Run(provider, func(t *testing.T) {
			t.Parallel()
			a, q, _, _ := chatFixture(t)
			client := &slowACPCreateClient{fakeACPClient: newFakeACPClient(q.Path), delay: 21 * time.Second}
			open := func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
				return client, acp.InitializeResult{}, nil
			}
			a.openAgy, a.openCursor = open, open
			input := CreateSessionInput{Provider: provider, Cwd: q.Path, Project: q.ProjectID, Text: "hello", RequestID: "cold-create"}
			result, err := a.CreateSession(context.Background(), input)
			if err != nil || result.Status != 202 || result.SessionID != client.sessionID {
				t.Fatalf("cold creation failed: %+v %v", result, err)
			}
			awaitSessionRun(t, a, result.SessionID, func(s ChatState) bool { return s.Status == "running" })
			if client.closed.Load() {
				t.Fatal("creating connection was closed before the first turn finished")
			}
			retry, err := a.CreateSession(context.Background(), input)
			if err != nil || retry.Status != 200 || retry.SessionID != result.SessionID || client.attempts.Load() != 1 {
				t.Fatalf("creation retry was not idempotent: %+v %v; attempts=%d", retry, err, client.attempts.Load())
			}
			client.promptGate <- acp.PromptResult{StopReason: "end_turn"}
			awaitSessionRun(t, a, result.SessionID, func(s ChatState) bool { return !s.Busy })
			client.mu.Lock()
			defer client.mu.Unlock()
			if strings.Count(strings.Join(client.calls, ","), "session/prompt") != 1 {
				t.Fatalf("first prompt was not sent exactly once: %v", client.calls)
			}
		})
	}
}

func TestACPCreationDeadlineKeepsUncertainReceipt(t *testing.T) {
	a, q, _, _ := chatFixture(t)
	client := &slowACPCreateClient{fakeACPClient: newFakeACPClient(q.Path), delay: time.Hour}
	a.openAgy = func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
		return client, acp.InitializeResult{}, nil
	}
	input := CreateSessionInput{Provider: model.ProviderAgy, Cwd: q.Path, Text: "hello", RequestID: "timed-out-create"}
	startup, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	run, status, err := a.startACPSession(startup, input.Provider, input.RequestID, creationFingerprint(input), input, executionContext{plan: model.LaunchPlan{Cwd: q.Path}})
	if run != nil || status != 503 || err == nil || !strings.Contains(err.Error(), "创建会话超时") {
		t.Fatalf("unexpected startup timeout: run=%v status=%d error=%v", run, status, err)
	}
	if !client.closed.Load() {
		t.Fatal("timed-out creating connection was not closed")
	}
	if _, err := a.CreateSession(context.Background(), input); err == nil || !strings.Contains(err.Error(), errCreationUncertain.Error()) {
		t.Fatalf("uncertain creation was retried: %v", err)
	}
	if client.attempts.Load() != 1 {
		t.Fatalf("duplicate creation: %d attempts", client.attempts.Load())
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if len(client.calls) != 0 {
		t.Fatalf("timed-out creation sent more requests: %v", client.calls)
	}
}

func TestACPColdCreationCanceledOnShutdown(t *testing.T) {
	a, q, _, _ := chatFixture(t)
	client := &slowACPCreateClient{
		fakeACPClient: newFakeACPClient(q.Path), delay: time.Hour, started: make(chan struct{}, 1),
	}
	a.openAgy = func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
		return client, acp.InitializeResult{}, nil
	}
	input := CreateSessionInput{Provider: model.ProviderAgy, Cwd: q.Path, Project: q.ProjectID, Text: "hello", RequestID: "shutdown-create"}
	done := make(chan error, 1)
	go func() {
		_, err := a.CreateSession(context.Background(), input)
		done <- err
	}()
	select {
	case <-client.started:
	case <-time.After(5 * time.Second):
		t.Fatal("creation did not reach the provider")
	}
	a.CloseChats()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("shutdown did not cancel pending creation")
		}
	case <-time.After(time.Second):
		t.Fatal("creation did not stop after shutdown")
	}
	if !client.closed.Load() || client.attempts.Load() != 1 {
		t.Fatalf("shutdown did not close the single creating connection: closed=%v attempts=%d", client.closed.Load(), client.attempts.Load())
	}
	if _, err := a.CreateSession(context.Background(), input); err == nil || !strings.Contains(err.Error(), errCreationUncertain.Error()) {
		t.Fatalf("shutdown lost the uncertain creation receipt: %v", err)
	}
}
