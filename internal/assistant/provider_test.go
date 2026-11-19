package assistant

import (
	"context"
	"encoding/json"
	"os"
	"sync"
	"testing"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
	"worktree-hub/internal/store"
)

type providerFixture struct {
	events     chan codex.Event
	calls      map[string]map[string]any
	unexpected bool
	once       sync.Once
}

func (f *providerFixture) Call(_ context.Context, method string, params, out any) error {
	raw, _ := json.Marshal(params)
	var arguments map[string]any
	json.Unmarshal(raw, &arguments)
	f.calls[method] = arguments
	response := `{}`
	switch method {
	case "config/read":
		response = `{"config":{"mcp_servers":{"untrusted":{"command":"anything"}}}}`
	case "model/list":
		response = `{"data":[{"id":"fixture-id","model":"fixture-model"}]}`
	case "thread/start":
		response = `{"thread":{"id":"ephemeral"}}`
	case "turn/start":
		response = `{"turn":{"id":"turn"}}`
		if f.unexpected {
			f.events <- codex.Event{Method: "item/started", Params: json.RawMessage(`{"threadId":"ephemeral","turnId":"turn","item":{"type":"commandExecution"}}`)}
		} else {
			// Unrelated daemon events must never enter assistant history.
			f.events <- codex.Event{Method: "item/completed", Params: json.RawMessage(`{"threadId":"other","item":{"type":"agentMessage","text":"private"}}`)}
			f.events <- codex.Event{Method: "item/completed", Params: json.RawMessage(`{"threadId":"ephemeral","turnId":"turn","item":{"type":"agentMessage","text":"Ready"}}`)}
			f.events <- codex.Event{Method: "turn/completed", Params: json.RawMessage(`{"threadId":"ephemeral","turn":{"id":"turn","status":"completed"}}`)}
		}
	}
	if out != nil {
		return json.Unmarshal([]byte(response), out)
	}
	return nil
}
func TestAssistantProviderUsesSelectedCatalogModel(t *testing.T) {
	for _, name := range []string{"fixture-model", "unlisted-model"} {
		t.Run(name, func(t *testing.T) {
			fixture := &providerFixture{events: make(chan codex.Event, 4), calls: map[string]map[string]any{}}
			provider := codexProvider(t.TempDir(), func(context.Context) (codex.LiveClient, error) { return fixture, nil })
			ctx := context.WithValue(context.Background(), settingsContextKey{}, model.AssistantSettings{Model: name})
			output, err := provider(ctx, []store.AssistantMessage{{Role: "user", Text: "Hello"}})
			start := fixture.calls["thread/start"]
			if name == "unlisted-model" {
				if err != errAssistantModelUnavailable || start != nil {
					t.Fatalf("unlisted model started a thread: %+v, %v", start, err)
				}
			} else if err != nil || output != "Ready" || start["model"] != name || start["sandbox"] != "read-only" {
				t.Fatalf("selected model or isolation lost: %+v, %q, %v", start, output, err)
			}
		})
	}
}
func (f *providerFixture) Close()                           { f.once.Do(func() { close(f.events) }) }
func (f *providerFixture) Events() <-chan codex.Event       { return f.events }
func (f *providerFixture) Reply(json.RawMessage, any) error { return nil }
func TestCodexProviderIsolation(t *testing.T) {
	for _, unexpected := range []bool{false, true} {
		t.Run(map[bool]string{false: "completion", true: "unexpected-tool"}[unexpected], func(t *testing.T) {
			fixture := &providerFixture{events: make(chan codex.Event, 4), calls: map[string]map[string]any{}, unexpected: unexpected}
			provider := codexProvider(t.TempDir(), func(context.Context) (codex.LiveClient, error) { return fixture, nil })
			output, err := provider(context.Background(), []store.AssistantMessage{{Role: "user", Text: "Hello"}})
			if unexpected {
				if err == nil {
					t.Fatal("tool execution accepted")
				}
				if fixture.calls["turn/interrupt"] == nil {
					t.Fatal("unfinished turn not interrupted")
				}
			} else if err != nil || output != "Ready" {
				t.Fatalf("%q %v", output, err)
			}
			start := fixture.calls["thread/start"]
			if start["ephemeral"] != true || start["sandbox"] != "read-only" || start["approvalPolicy"] != "never" {
				t.Fatalf("unsafe thread %+v", start)
			}
			config := start["config"].(map[string]any)
			if config["features.shell_tool"] != false || config["web_search"] != "disabled" || config["mcp_servers"].(map[string]any)["untrusted"].(map[string]any)["enabled"] != false {
				t.Fatalf("tools enabled %+v", config)
			}
			if fixture.calls["thread/unsubscribe"] == nil {
				t.Fatal("thread subscription retained")
			}
		})
	}
}
func TestInstalledCodexAssistantProvider(t *testing.T) {
	if os.Getenv("YOLU_TEST_ASSISTANT_CODEX") != "1" {
		t.Skip("opt-in real model request")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	output, err := codexProvider(t.TempDir(), codex.OpenLive)(ctx, []store.AssistantMessage{{Role: "user", Text: "Reply with exactly Yolu ready."}})
	if err != nil {
		t.Fatal(err)
	}
	if output == "" {
		t.Fatal("empty response")
	}
	t.Logf("real provider returned %d bytes", len(output))
}
