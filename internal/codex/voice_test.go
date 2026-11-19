package codex

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"
)

type voiceTestClient struct {
	mu       sync.Mutex
	calls    []string
	params   map[string]map[string]any
	events   chan Event
	closed   chan struct{}
	once     sync.Once
	startErr string
}

func newVoiceTestClient() *voiceTestClient {
	return &voiceTestClient{params: map[string]map[string]any{}, events: make(chan Event, 8), closed: make(chan struct{})}
}
func (c *voiceTestClient) Call(ctx context.Context, method string, params, result any) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	raw, _ := json.Marshal(params)
	var value map[string]any
	_ = json.Unmarshal(raw, &value)
	c.mu.Lock()
	c.calls = append(c.calls, method)
	c.params[method] = value
	c.mu.Unlock()
	switch method {
	case "config/read":
		return json.Unmarshal([]byte(`{"config":{"mcp_servers":{"installed":{"command":"should-not-run"}}}}`), result)
	case "thread/start":
		return json.Unmarshal([]byte(`{"thread":{"id":"voice-thread"}}`), result)
	case "thread/realtime/start":
		if c.startErr != "" {
			raw, _ := json.Marshal(map[string]string{"threadId": "voice-thread", "message": c.startErr})
			c.events <- Event{Method: "thread/realtime/error", Params: raw}
		} else {
			c.events <- Event{Method: "thread/realtime/sdp", Params: json.RawMessage(`{"threadId":"unrelated","sdp":"ignore"}`)}
			c.events <- Event{Method: "thread/realtime/sdp", Params: json.RawMessage(`{"threadId":"voice-thread","sdp":"answer"}`)}
		}
	}
	return nil
}
func (c *voiceTestClient) Reply(json.RawMessage, any) error { return nil }
func (c *voiceTestClient) Events() <-chan Event             { return c.events }
func (c *voiceTestClient) Close()                           { c.once.Do(func() { close(c.closed) }) }

func TestVoiceUsesCodexWebRTCWithoutStartingCodingWork(t *testing.T) {
	client := newVoiceTestClient()
	service := NewVoiceService(t.TempDir(), func(context.Context) (LiveClient, error) { return client, nil })
	defer service.Close()
	ctx, cancel := context.WithCancel(context.Background())
	answer, err := service.Start(ctx, "offer")
	if err != nil || answer.ID == "" || answer.SDP != "answer" {
		t.Fatalf("start: %+v %v", answer, err)
	}
	cancel() // The completed HTTP request does not own the retained session.
	select {
	case <-client.closed:
		t.Fatal("request cancellation closed an established session")
	default:
	}
	client.mu.Lock()
	start := client.params["thread/realtime/start"]
	thread := client.params["thread/start"]
	client.mu.Unlock()
	if start["version"] != "v3" || start["clientManagedHandoffs"] != true || start["flushTranscriptTailOnSessionEnd"] != false || start["includeStartupContext"] != false {
		t.Fatalf("unexpected voice configuration: %+v", start)
	}
	transport := start["transport"].(map[string]any)
	if transport["type"] != "webrtc" || transport["sdp"] != "offer" || thread["ephemeral"] != true || thread["sandbox"] != "read-only" {
		t.Fatal("voice did not use an isolated WebRTC thread")
	}
	config := thread["config"].(map[string]any)
	if config["features.shell_tool"] != false || config["mcp_servers"].(map[string]any)["installed"].(map[string]any)["enabled"] != false {
		t.Fatal("voice enabled coding tools")
	}
	service.Stop(answer.ID)
	service.Stop(answer.ID)
	select {
	case <-client.closed:
	case <-time.After(time.Second):
		t.Fatal("voice connection was not released")
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	if _, ok := client.params["thread/realtime/stop"]; !ok {
		t.Fatal("Codex voice session was not stopped")
	}
	for _, method := range client.calls {
		if method == "turn/start" {
			t.Fatal("dictation started coding work")
		}
	}
}

func TestVoiceAsynchronousErrorsAndServiceClosureReleaseConnections(t *testing.T) {
	for _, failed := range []bool{false, true} {
		client := newVoiceTestClient()
		if failed {
			client.startErr = "login required"
		}
		service := NewVoiceService(t.TempDir(), func(context.Context) (LiveClient, error) { return client, nil })
		_, err := service.Start(context.Background(), "offer")
		if failed && err == nil {
			t.Fatal("asynchronous startup failure was accepted")
		}
		service.Close()
		select {
		case <-client.closed:
		case <-time.After(time.Second):
			t.Fatal("service closure leaked the voice connection")
		}
		if _, err := service.Start(context.Background(), "offer"); err == nil {
			t.Fatal("closed service accepted another recording")
		}
	}
}

func TestVoiceCancelledStartupDoesNotLeakAnOpeningConnection(t *testing.T) {
	started := make(chan struct{})
	service := NewVoiceService(t.TempDir(), func(ctx context.Context) (LiveClient, error) {
		close(started)
		<-ctx.Done()
		return nil, errors.New("cancelled startup")
	})
	defer service.Close()
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { _, err := service.Start(ctx, "offer"); result <- err }()
	<-started
	cancel()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("cancelled startup succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled startup did not finish")
	}
	service.mu.Lock()
	defer service.mu.Unlock()
	if len(service.sessions) != 0 {
		t.Fatal("cancelled startup retained a session")
	}
}
