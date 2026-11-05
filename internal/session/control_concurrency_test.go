package session

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"worktree-hub/internal/codex"
)

type blockedCreationClient struct {
	*fakeLiveClient
	entered chan struct{}
	release <-chan struct{}
}

func (c *blockedCreationClient) Call(ctx context.Context, method string, params any, out any) error {
	if method == "thread/start" {
		close(c.entered)
		select {
		case <-c.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return c.fakeLiveClient.Call(ctx, method, params, out)
}

func TestSlowCreationAllowsOtherSessionControlsAndIndependentCreation(t *testing.T) {
	a, q, base, _ := chatFixture(t)
	release := make(chan struct{})
	clients := []*blockedCreationClient{
		{fakeLiveClient: base, entered: make(chan struct{}), release: release},
		{fakeLiveClient: &fakeLiveClient{updates: make(chan codex.Event, 256), cwd: base.cwd, session: "second"}, entered: make(chan struct{}), release: release},
	}
	base.session = "first"
	var opened atomic.Int32
	a.openLive = func(context.Context) (codex.LiveClient, error) { return clients[int(opened.Add(1))-1], nil }
	var workers sync.WaitGroup
	t.Cleanup(func() { close(release); workers.Wait() })
	create := func(key string) <-chan int {
		result := make(chan int, 1)
		workers.Add(1)
		go func() {
			defer workers.Done()
			code, _ := call(t, a, "POST", "/api/requirements/"+q.ID+"/sessions/new", map[string]string{"text": "check", "request_id": key})
			result <- code
		}()
		return result
	}
	create("first")
	select {
	case <-clients[0].entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first creation did not reach the RPC")
	}
	// A creation in progress must keep worktree cleanup excluded.
	if a.controlMu.TryLock() {
		a.controlMu.Unlock()
		t.Fatal("creation lost its worktree reservation")
	}
	pinned := make(chan int, 1)
	workers.Add(1)
	go func() {
		defer workers.Done()
		code, _ := call(t, a, "POST", "/api/sessions/session/manage", map[string]string{"action": "pin"})
		pinned <- code
	}()
	select {
	case code := <-pinned:
		if code != 200 {
			t.Fatalf("pin returned %d", code)
		}
	case <-time.After(time.Second):
		t.Fatal("slow creation blocked an unrelated session control")
	}
	create("second")
	select {
	case <-clients[1].entered:
	case <-time.After(time.Second):
		t.Fatal("independent creation waited for another request's RPC")
	}
}

func TestConcurrentCreationRetriesShareOneDurableRequest(t *testing.T) {
	a, q, base, _ := chatFixture(t)
	base.session = "created"
	release := make(chan struct{})
	c := &blockedCreationClient{fakeLiveClient: base, entered: make(chan struct{}), release: release}
	var opened atomic.Int32
	a.openLive = func(context.Context) (codex.LiveClient, error) { opened.Add(1); return c, nil }
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	var workers sync.WaitGroup
	t.Cleanup(func() { unblock(); workers.Wait() })
	results := make(chan int, 2)
	start := func() {
		workers.Add(1)
		go func() {
			defer workers.Done()
			code, _ := call(t, a, "POST", "/api/requirements/"+q.ID+"/sessions/new", map[string]string{"text": "check", "request_id": "same"})
			results <- code
		}()
	}
	start()
	select {
	case <-c.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("creation did not reach the RPC")
	}
	start()
	unblock()
	codes := map[int]int{}
	for range 2 {
		select {
		case code := <-results:
			codes[code]++
		case <-time.After(3 * time.Second):
			t.Fatal("creation retry did not finish")
		}
	}
	if opened.Load() != 1 || codes[202] != 1 || codes[200] != 1 {
		t.Fatalf("opened=%d responses=%v", opened.Load(), codes)
	}
}
