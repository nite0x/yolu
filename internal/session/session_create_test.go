package session

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
)

func TestNewSessionStartsFirstTurnOnCreatingConnectionAndIsIdempotent(t *testing.T) {
	a, q, c, _ := chatFixture(t)
	endpoint := "/api/sessions/new"
	input := map[string]string{"text": "检查工作区说明并继续实现", "project_id": q.ProjectID, "cwd": q.Path, "request_id": "create-once"}
	code, raw := call(t, a, "POST", endpoint, input)
	if code != 202 {
		t.Fatalf("%d %s", code, raw)
	}
	var result struct {
		Session model.Session `json:"session"`
	}
	_ = json.Unmarshal(raw, &result)
	if result.Session.ID != "session" || result.Session.Source != "workbench" {
		t.Fatal(string(raw))
	}
	awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
	if code, _ := call(t, a, "POST", endpoint, input); code != 200 {
		t.Fatal("retry was not recovered")
	}
	c.mu.Lock()
	methods := strings.Join(c.methods, ",")
	params := c.startParams
	c.mu.Unlock()
	if strings.Count(methods, "thread/start") != 1 || strings.Contains(methods, "thread/read") || strings.Contains(methods, "thread/resume") {
		t.Fatal(methods)
	}
	if params["cwd"] != q.Path {
		t.Fatal(params)
	}
	c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
	awaitChat(t, a, func(s ChatState) bool { return !s.Busy })
}

type failingCreateClient struct{ *fakeLiveClient }

func (c *failingCreateClient) Call(ctx context.Context, method string, params, out any) error {
	if method == "thread/start" {
		c.mu.Lock()
		c.methods = append(c.methods, method)
		c.mu.Unlock()
		return fmt.Errorf("uncertain transport")
	}
	return c.fakeLiveClient.Call(ctx, method, params, out)
}
func TestUncertainNewSessionNeverCreatesAgainOnRetry(t *testing.T) {
	a, _, c, _ := chatFixture(t)
	a.openLive = func(context.Context) (codex.LiveClient, error) { return &failingCreateClient{c}, nil }
	endpoint := "/api/sessions/new"
	input := map[string]string{"text": "hello", "request_id": "uncertain"}
	if code, _ := call(t, a, "POST", endpoint, input); code != 503 {
		t.Fatal(code)
	}
	if code, _ := call(t, a, "POST", endpoint, input); code != 409 {
		t.Fatal(code)
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if strings.Count(strings.Join(c.methods, ","), "thread/start") != 1 {
		t.Fatal(c.methods)
	}
}
