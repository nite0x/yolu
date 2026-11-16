package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/store"
)

type toolProviderFixture struct {
	providerFixture
	beforeReply []codex.Event
	replies     []toolResponse
}

func (f *toolProviderFixture) Call(ctx context.Context, method string, params, out any) error {
	if method != "turn/start" {
		return f.providerFixture.Call(ctx, method, params, out)
	}
	for _, event := range f.beforeReply {
		f.events <- event
	}
	f.events <- codex.Event{Method: "item/completed", Params: json.RawMessage(`{"threadId":"ephemeral","turnId":"turn","item":{"type":"agentMessage","text":"Ready"}}`)}
	f.events <- codex.Event{Method: "turn/completed", Params: json.RawMessage(`{"threadId":"ephemeral","turn":{"id":"turn","status":"completed"}}`)}
	return json.Unmarshal([]byte(`{"turn":{"id":"turn"}}`), out)
}
func (f *toolProviderFixture) Reply(_ json.RawMessage, result any) error {
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	var response toolResponse
	if err := json.Unmarshal(data, &response); err != nil {
		return err
	}
	f.replies = append(f.replies, response)
	return nil
}
func newToolFixture(events ...codex.Event) *toolProviderFixture {
	return &toolProviderFixture{providerFixture: providerFixture{events: make(chan codex.Event, 64), calls: map[string]map[string]any{}}, beforeReply: events}
}
func toolEvent(callID, tool, arguments string) codex.Event {
	params, _ := json.Marshal(map[string]any{"threadId": "ephemeral", "turnId": "turn", "callId": callID, "tool": tool, "arguments": json.RawMessage(arguments)})
	return codex.Event{ID: json.RawMessage(`1`), Method: "item/tool/call", Params: params}
}
func testToolDefinitions() []ToolDefinition {
	return []ToolDefinition{{Name: "yolu_context", Description: "Read application context", InputSchema: map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}}}
}
func runToolFixture(t *testing.T, fixture *toolProviderFixture, handler ToolHandler) (string, error) {
	t.Helper()
	ctx := WithTools(context.Background(), testToolDefinitions(), handler)
	return codexProvider(t.TempDir(), func(context.Context) (codex.LiveClient, error) { return fixture, nil })(ctx, []store.AssistantMessage{{Role: "user", Text: "Find projects"}})
}
func TestCodexProviderDynamicToolProtocol(t *testing.T) {
	foreign := toolEvent("foreign", "yolu_context", `{}`)
	foreign.Params = json.RawMessage(`{"threadId":"other","turnId":"turn","callId":"foreign","tool":"yolu_context","arguments":{}}`)
	old := toolEvent("old", "yolu_context", `{}`)
	old.Params = json.RawMessage(`{"threadId":"ephemeral","turnId":"previous","callId":"old","tool":"yolu_context","arguments":{}}`)
	started := codex.Event{Method: "item/started", Params: json.RawMessage(`{"threadId":"ephemeral","turnId":"turn","item":{"type":"dynamicToolCall","tool":"yolu_context"}}`)}
	fixture := newToolFixture(foreign, old, started, toolEvent("read", "yolu_context", `{}`))
	calls := 0
	output, err := runToolFixture(t, fixture, func(ctx context.Context, name string, arguments json.RawMessage) (any, error) {
		calls++
		if name != "yolu_context" || string(arguments) != `{}` {
			t.Fatalf("unexpected call %s %s", name, arguments)
		}
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > toolTimeout {
			t.Fatal("tool deadline missing")
		}
		return map[string]any{"projects": []string{"frontend", "backend"}}, nil
	})
	if err != nil || output != "Ready" || calls != 1 {
		t.Fatalf("output=%q calls=%d err=%v", output, calls, err)
	}
	tools := fixture.calls["thread/start"]["dynamicTools"].([]any)
	tool := tools[0].(map[string]any)
	if tool["type"] != "function" || tool["name"] != "yolu_context" || !strings.Contains(fixture.calls["thread/start"]["baseInstructions"].(string), "explicit approval") {
		t.Fatalf("tool definitions %+v", tool)
	}
	if len(fixture.replies) != 1 || !fixture.replies[0].Success || fixture.replies[0].ContentItems[0].Type != "inputText" || !strings.Contains(fixture.replies[0].ContentItems[0].Text, "frontend") {
		t.Fatalf("tool reply %+v", fixture.replies)
	}
}
func TestCodexProviderToolFailuresAreBoundedAndRedacted(t *testing.T) {
	cases := []struct {
		name      string
		tool      string
		arguments string
		handler   ToolHandler
		code      string
	}{
		{name: "unknown", tool: "shell", arguments: `{}`, handler: func(context.Context, string, json.RawMessage) (any, error) {
			t.Fatal("unknown tool executed")
			return nil, nil
		}, code: "tool_unavailable"},
		{name: "handler-error", tool: "yolu_context", arguments: `{}`, handler: func(context.Context, string, json.RawMessage) (any, error) {
			return nil, errors.New("PRIVATE_CREDENTIAL")
		}, code: "tool_failed"},
		{name: "argument-limit", tool: "yolu_context", arguments: `{"text":"` + strings.Repeat("a", maxToolBytes) + `"}`, handler: func(context.Context, string, json.RawMessage) (any, error) {
			t.Fatal("oversize arguments executed")
			return nil, nil
		}, code: "invalid_arguments"},
		{name: "result-limit", tool: "yolu_context", arguments: `{}`, handler: func(context.Context, string, json.RawMessage) (any, error) {
			return strings.Repeat("a", maxToolBytes), nil
		}, code: "tool_result_limit"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fixture := newToolFixture(toolEvent("call", tc.tool, tc.arguments))
			_, err := runToolFixture(t, fixture, tc.handler)
			if err != nil || len(fixture.replies) != 1 {
				t.Fatalf("replies=%+v err=%v", fixture.replies, err)
			}
			response := fixture.replies[0]
			if response.Success || !strings.Contains(response.ContentItems[0].Text, tc.code) || strings.Contains(response.ContentItems[0].Text, "PRIVATE_CREDENTIAL") {
				t.Fatalf("unsafe response %+v", response)
			}
		})
	}
}
func TestCodexProviderToolReceipts(t *testing.T) {
	for _, changed := range []bool{false, true} {
		t.Run(fmt.Sprint("changed=", changed), func(t *testing.T) {
			arguments := `{}`
			if changed {
				arguments = `{"changed":true}`
			}
			fixture := newToolFixture(toolEvent("call", "yolu_context", `{}`), toolEvent("call", "yolu_context", arguments))
			calls := 0
			_, err := runToolFixture(t, fixture, func(context.Context, string, json.RawMessage) (any, error) { calls++; return "result", nil })
			if calls != 1 || (err != nil) != changed {
				t.Fatalf("calls=%d err=%v", calls, err)
			}
			if !changed && (len(fixture.replies) != 2 || fixture.replies[0].ContentItems[0] != fixture.replies[1].ContentItems[0]) {
				t.Fatalf("receipt was not reused %+v", fixture.replies)
			}
		})
	}
}
func TestCodexProviderStopsUnadvertisedAndExcessToolCalls(t *testing.T) {
	for _, event := range []codex.Event{
		{Method: "item/started", Params: json.RawMessage(`{"threadId":"ephemeral","turnId":"turn","item":{"type":"commandExecution"}}`)},
		{Method: "item/started", Params: json.RawMessage(`{"threadId":"ephemeral","turnId":"turn","item":{"type":"dynamicToolCall","tool":"shell"}}`)},
		{ID: json.RawMessage(`2`), Method: "item/commandExecution/requestApproval", Params: json.RawMessage(`{"threadId":"ephemeral","turnId":"turn"}`)},
	} {
		fixture := newToolFixture(event)
		_, err := runToolFixture(t, fixture, func(context.Context, string, json.RawMessage) (any, error) {
			t.Fatal("unsafe tool executed")
			return nil, nil
		})
		if err == nil || fixture.calls["turn/interrupt"] == nil {
			t.Fatalf("event %s retained unsafe turn, err=%v", event.Method, err)
		}
	}
	events := make([]codex.Event, maxToolCalls+1)
	for i := range events {
		events[i] = toolEvent(fmt.Sprint(i), "yolu_context", `{}`)
	}
	fixture := newToolFixture(events...)
	calls := 0
	_, err := runToolFixture(t, fixture, func(context.Context, string, json.RawMessage) (any, error) { calls++; return nil, nil })
	if err == nil || calls != maxToolCalls || fixture.calls["turn/interrupt"] == nil {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}
func TestCodexProviderValidatesDefinitions(t *testing.T) {
	for _, definitions := range [][]ToolDefinition{
		{{Name: "invalid.name", Description: "Read", InputSchema: map[string]any{}}},
		{testToolDefinitions()[0], testToolDefinitions()[0]},
		{{Name: "context", InputSchema: map[string]any{}}},
	} {
		if _, err := addDynamicTools(map[string]any{}, providerTools{definitions: definitions, handler: func(context.Context, string, json.RawMessage) (any, error) { return nil, nil }}); err == nil {
			t.Fatalf("invalid definitions accepted %+v", definitions)
		}
	}
}

func TestCodexProviderDoesNotStartToolsAfterCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	response := invokeProviderTool(ctx, func(context.Context, string, json.RawMessage) (any, error) {
		t.Fatal("tool started after cancellation")
		return nil, nil
	}, "yolu_context", json.RawMessage(`{}`))
	if response.Success || !strings.Contains(response.ContentItems[0].Text, "tool_interrupted") {
		t.Fatalf("unexpected cancelled response %+v", response)
	}
}

func TestCodexProviderToolDeadlineBoundsUncooperativeHandlers(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	started := make(chan struct{}, 1)
	returned := make(chan struct{}, 1)
	before := time.Now()
	response := invokeProviderToolWithin(context.Background(), func(context.Context, string, json.RawMessage) (any, error) {
		started <- struct{}{}
		<-release
		returned <- struct{}{}
		return "late result", nil
	}, "yolu_context", json.RawMessage(`{}`), 20*time.Millisecond)
	select {
	case <-started:
	default:
		t.Fatal("tool did not start")
	}
	if time.Since(before) > time.Second || response.Success || !strings.Contains(response.ContentItems[0].Text, "tool_interrupted") {
		t.Fatalf("tool deadline failed after %s, response=%+v", time.Since(before), response)
	}
	select {
	case <-returned:
		t.Fatal("test handler unexpectedly returned before release")
	default:
	}
}

func TestCodexProviderBoundsDetachedToolWorkers(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	var started sync.WaitGroup
	started.Add(cap(providerToolSlots))
	var invocations sync.WaitGroup
	for i := 0; i < cap(providerToolSlots); i++ {
		invocations.Add(1)
		go func() {
			defer invocations.Done()
			invokeProviderToolWithin(context.Background(), func(context.Context, string, json.RawMessage) (any, error) {
				calls.Add(1)
				started.Done()
				<-release
				return nil, nil
			}, "yolu_context", json.RawMessage(`{}`), 100*time.Millisecond)
		}()
	}
	started.Wait()
	invocations.Wait()
	response := invokeProviderToolWithin(context.Background(), func(context.Context, string, json.RawMessage) (any, error) {
		calls.Add(1)
		return nil, nil
	}, "yolu_context", json.RawMessage(`{}`), 20*time.Millisecond)
	close(release)
	if response.Success || calls.Load() != int32(cap(providerToolSlots)) {
		t.Fatalf("detached workers exceeded bound, calls=%d response=%+v", calls.Load(), response)
	}
	deadline := time.Now().Add(time.Second)
	for len(providerToolSlots) != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if len(providerToolSlots) != 0 {
		t.Fatal("completed tool workers retained their slots")
	}
}

func TestInstalledCodexAssistantDynamicTool(t *testing.T) {
	if os.Getenv("YOLU_TEST_ASSISTANT_CODEX") != "1" {
		t.Skip("opt-in real model tool request")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	called := false
	value := fmt.Sprintf("yolu-tool-%d", time.Now().UnixNano())
	ctx = WithTools(ctx, testToolDefinitions(), func(_ context.Context, name string, arguments json.RawMessage) (any, error) {
		if name != "yolu_context" || !json.Valid(arguments) {
			return nil, errors.New("unexpected tool request")
		}
		called = true
		return map[string]string{"verification": value}, nil
	})
	output, err := codexProvider(t.TempDir(), codex.OpenLive)(ctx, []store.AssistantMessage{{Role: "user", Text: "Call yolu_context with an empty object. Reply with exactly the verification value returned by that tool."}})
	if err != nil {
		t.Fatal(err)
	}
	if !called || !strings.Contains(output, value) {
		t.Fatalf("tool called=%v output=%q", called, output)
	}
	t.Logf("real provider called the application tool and returned its verification value (%d bytes)", len(output))
}
