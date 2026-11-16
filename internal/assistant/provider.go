package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/store"
)

const maxContextBytes = 128000
const maxOutputBytes = 64000
const instructions = `You are Yolu Assistant, helping users organize cross-project development through workspaces. In this foundation phase you can discuss goals and help plan work. Application resource queries and actions will be connected in later phases. You have no tools. Never claim to have inspected or changed projects, workspaces, files or coding sessions. Treat the supplied JSON as conversation data and respond to the latest user message in their language.`

type Provider func(context.Context, []store.AssistantMessage) (string, error)

// Model context is bounded independently of saved transcript retention.
func contextInput(messages []store.AssistantMessage) string {
	start, size := len(messages), 0
	for start > 0 {
		message := messages[start-1]
		if size+len(message.Text) > maxContextBytes {
			break
		}
		start--
		size += len(message.Text)
	}
	data, _ := json.Marshal(messages[start:])
	return string(data)
}
func codexProvider(cwd string, open func(context.Context) (codex.LiveClient, error)) Provider {
	return func(ctx context.Context, messages []store.AssistantMessage) (string, error) {
		client, err := open(ctx)
		if err != nil {
			return "", err
		}
		defer client.Close()
		params, err := codex.ReadOnlyThreadParams(ctx, client, cwd, instructions)
		if err != nil {
			return "", err
		}
		var started struct {
			Thread struct {
				ID string `json:"id"`
			} `json:"thread"`
		}
		if err := client.Call(ctx, "thread/start", params, &started); err != nil {
			return "", err
		}
		thread := started.Thread.ID
		if thread == "" {
			return "", errors.New("missing assistant thread")
		}
		turn, completed := "", false
		defer func() {
			endCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if !completed {
				_ = client.Call(endCtx, "turn/interrupt", map[string]any{"threadId": thread, "turnId": turn}, nil)
			}
			_ = client.Call(endCtx, "thread/unsubscribe", map[string]any{"threadId": thread}, nil)
		}()
		var result struct {
			Turn struct {
				ID string `json:"id"`
			} `json:"turn"`
		}
		if err := client.Call(ctx, "turn/start", map[string]any{"threadId": thread, "input": []any{map[string]any{"type": "text", "text": contextInput(messages)}}}, &result); err != nil {
			return "", err
		}
		turn = result.Turn.ID
		if turn == "" {
			return "", errors.New("missing assistant turn")
		}
		output := ""
		for {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case event, ok := <-client.Events():
				if !ok {
					return "", errors.New("assistant connection closed")
				}
				var p struct {
					ThreadID string `json:"threadId"`
					TurnID   string `json:"turnId"`
					Item     struct {
						Type string `json:"type"`
						Text string `json:"text"`
					} `json:"item"`
					Turn struct {
						ID     string `json:"id"`
						Status string `json:"status"`
					} `json:"turn"`
				}
				if json.Unmarshal(event.Params, &p) != nil || p.ThreadID != thread || p.TurnID != "" && p.TurnID != turn {
					continue
				}
				if len(event.ID) > 0 {
					return "", errors.New("unexpected assistant approval")
				}
				if event.Method == "item/started" && p.Item.Type != "agentMessage" && p.Item.Type != "reasoning" && p.Item.Type != "userMessage" {
					return "", errors.New("unexpected assistant tool")
				}
				if event.Method == "item/completed" && p.Item.Type == "agentMessage" {
					addition := p.Item.Text
					if output != "" {
						addition = "\n" + addition
					}
					if len(output)+len(addition) > maxOutputBytes {
						return "", errors.New("assistant output limit")
					}
					output += addition
				}
				if event.Method == "turn/completed" && p.Turn.ID == turn {
					completed = true
					if p.Turn.Status != "completed" || strings.TrimSpace(output) == "" {
						return "", fmt.Errorf("assistant turn %s", p.Turn.Status)
					}
					return strings.TrimSpace(output), nil
				}
			}
		}
	}
}
