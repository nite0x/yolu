package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestACPHelperProcess(t *testing.T) {
	if os.Getenv("ACP_HELPER_PROCESS") != "1" {
		return
	}
	enc := json.NewEncoder(os.Stdout)
	scan := bufio.NewScanner(os.Stdin)
	scan.Buffer(make([]byte, 4096), 1<<20)
	for scan.Scan() {
		var req struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.Unmarshal(scan.Bytes(), &req); err != nil {
			continue
		}
		switch req.Method {
		case "initialize":
			_ = enc.Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      req.ID,
				"result": map[string]any{
					"protocolVersion": 1,
					"agentInfo":       map[string]any{"name": "Mock ACP", "version": "1.0.0"},
					"agentCapabilities": map[string]any{
						"loadSession":        true,
						"promptCapabilities": map[string]any{"image": true},
					},
				},
			})
		case "session/load":
			// Burst 1000 replayed updates before responding to verify no deadlock.
			for i := 0; i < 1000; i++ {
				_ = enc.Encode(map[string]any{
					"jsonrpc": "2.0",
					"method":  "session/update",
					"params": map[string]any{
						"sessionId": "s1",
						"update": map[string]any{
							"sessionUpdate": "agent_message_chunk",
							"content":       map[string]any{"type": "text", "text": fmt.Sprintf("chunk-%d", i)},
						},
					},
				})
			}
			_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"sessionId": "s1"}})
		case "session/prompt":
			_ = enc.Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      99,
				"method":  "session/request_permission",
				"params": map[string]any{
					"sessionId": "s1",
					"toolCall":  map[string]any{"toolCallId": "tc1", "title": "Run tests"},
					"options":   []any{map[string]any{"optionId": "allow_once", "name": "Allow", "kind": "allow_once"}},
				},
			})
			if !scan.Scan() {
				return
			}
			var reply struct {
				Result struct {
					Outcome struct {
						Outcome  string `json:"outcome"`
						OptionID string `json:"optionId"`
					} `json:"outcome"`
				} `json:"result"`
			}
			_ = json.Unmarshal(scan.Bytes(), &reply)
			stopReason := "cancelled"
			if reply.Result.Outcome.Outcome == "selected" && reply.Result.Outcome.OptionID == "allow_once" {
				stopReason = "end_turn"
			}
			_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": map[string]any{"stopReason": stopReason}})
		case "auth_error":
			_ = enc.Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": -32000, "message": "Authentication required"}})
		}
	}
	os.Exit(0)
}

func helperCommand(ctx context.Context) *exec.Cmd {
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=TestACPHelperProcess")
	cmd.Env = append(os.Environ(), "ACP_HELPER_PROCESS=1")
	return cmd
}

func TestStdioClientInitializeBurstAndPermissionRoundTrip(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c, err := StartStdio(ctx, helperCommand(ctx))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	initRes, err := Initialize(ctx, c, ClientInfo{Name: "yolu-test", Version: "0.1.0"})
	if err != nil || initRes.AgentInfo.Name != "Mock ACP" || !initRes.AgentCapabilities.LoadSession {
		t.Fatalf("initialize failed: %+v %v", initRes, err)
	}

	var loadRes SessionSetupResult
	if err := c.Call(ctx, "session/load", map[string]any{"sessionId": "s1", "cwd": "/tmp"}, &loadRes); err != nil {
		t.Fatalf("session/load failed: %v", err)
	}
	count := 0
	for count < 1000 {
		select {
		case msg := <-c.Events():
			if msg.Method == "session/update" {
				count++
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("timed out draining events, got %d", count)
		}
	}

	promptErr := make(chan error, 1)
	var promptRes PromptResult
	go func() {
		promptErr <- c.Call(ctx, "session/prompt", map[string]any{"sessionId": "s1", "prompt": []any{}}, &promptRes)
	}()

	select {
	case msg := <-c.Events():
		if msg.Method != "session/request_permission" || len(msg.ID) == 0 {
			t.Fatalf("unexpected event: %+v", msg)
		}
		if err := c.Reply(msg.ID, map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "allow_once"}}); err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for permission request")
	}
	if err := <-promptErr; err != nil || promptRes.StopReason != "end_turn" {
		t.Fatalf("prompt failed: %+v %v", promptRes, err)
	}

	err = c.Call(ctx, "auth_error", nil, nil)
	if !IsAuthRequired(err) {
		t.Fatalf("expected auth error, got %v", err)
	}
}
