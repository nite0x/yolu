package session

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/memory"
)

type memoryLiveFixture struct {
	*fakeLiveClient
	check func(string, any) error
}

func (f memoryLiveFixture) Call(ctx context.Context, method string, params, out any) error {
	if err := f.check(method, params); err != nil {
		return err
	}
	return f.fakeLiveClient.Call(ctx, method, params, out)
}

func TestCodexMemoryActivatesBeforeFirstTurnAndRevokesAfterIt(t *testing.T) {
	a, q, c, _ := chatFixture(t)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	a.Memory = memory.New(binary, a.Execution.DataDir, a.Execution.Store.SessionBindings)
	a.AssistantMCP = []string{binary, "--mcp", "--data", a.Execution.DataDir}
	var token string
	checks := make(chan error, 2)
	input := memory.Call{Search: &memory.SearchInput{}}
	a.openLive = func(context.Context) (codex.LiveClient, error) {
		return memoryLiveFixture{c, func(method string, params any) error {
			switch method {
			case "thread/start":
				config := params.(map[string]any)["config"].(map[string]any)
				servers, _ := config["mcp_servers"].(map[string]any)
				server, ok := servers[memoryMCPName].(map[string]any)
				if !ok {
					checks <- fmt.Errorf("missing the memory MCP registration")
					return nil
				}
				token = server["env"].(map[string]string)[memory.GrantEnv]
				tools := server["enabled_tools"].([]string)
				_, problem := a.Memory.Call(t.Context(), token, input)
				if token == "" || len(tools) != 2 || tools[1] != memory.SaveTool || problem == nil || problem.Code != "forbidden" {
					checks <- fmt.Errorf("memory MCP registration or inactive grant is incorrect")
				} else {
					checks <- nil
				}
			case "turn/start":
				context, _ := params.(map[string]any)["additionalContext"].(map[string]any)
				_, problem := a.Memory.Call(t.Context(), token, input)
				if context["yolu-memory"] == nil || context["yolu-directories"] == nil || problem == nil || problem.Code != "invalid_request" {
					checks <- fmt.Errorf("memory is not authorized and explained on the first turn")
				} else {
					checks <- nil
				}
			}
			return nil
		}}, nil
	}
	// Use a new native identity to avoid overwriting the fixture's existing session.
	c.session = "new-memory-session"
	if code, raw := call(t, a, "POST", "/api/sessions/new", map[string]string{
		"project_id": q.ProjectID, "cwd": q.Path, "request_id": "memory-first-turn", "text": "记住：发布代号是北极星",
	}); code != 202 {
		t.Fatalf("%d %s", code, raw)
	}
	for i := 0; i < 2; i++ {
		select {
		case err := <-checks:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("missing Codex fixture call")
		}
	}
	run := a.ChatFor(c.sessionID())
	c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
	<-run.finished
	if _, problem := a.Memory.Call(t.Context(), token, input); problem == nil || problem.Code != "forbidden" {
		t.Fatal("completed turn's memory grant remained usable")
	}
}
