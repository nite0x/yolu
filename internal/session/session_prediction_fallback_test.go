package session

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

type predictionFallbackLive struct {
	*predictionLive
	mode                     string
	threadParams, turnParams map[string]any
	cleanup                  []string
}

func (c *predictionFallbackLive) Call(ctx context.Context, method string, params, out any) error {
	p, _ := params.(map[string]any)
	if method == "thread/start" && p["ephemeral"] == true {
		c.threadParams = p
		return json.Unmarshal([]byte(`{"thread":{"id":"prediction-thread"}}`), out)
	}
	if p["threadId"] == "prediction-thread" {
		if method == "turn/start" {
			c.turnParams = p
			if c.mode != "timeout" {
				text := `{"prompt":"检查边界情况。"}`
				if c.mode == "invalid" {
					text = `{"prompt":`
				}
				if c.mode == "oversize" {
					raw, _ := json.Marshal(map[string]string{"prompt": strings.Repeat("x", 241)})
					text = string(raw)
				}
				if c.mode == "tool" {
					c.event("item/started", map[string]any{"threadId": "prediction-thread", "turnId": "prediction-turn", "item": map[string]any{"type": "commandExecution"}})
				}
				if c.mode == "new-turn" {
					c.event("turn/started", map[string]any{"threadId": "session", "turn": map[string]any{"id": "next"}})
				}
				c.event("item/completed", map[string]any{"threadId": "prediction-thread", "turnId": "prediction-turn", "item": map[string]any{"type": "agentMessage", "text": text}})
				c.event("turn/completed", map[string]any{"threadId": "prediction-thread", "turn": map[string]any{"id": "prediction-turn", "status": "completed"}})
			}
			return json.Unmarshal([]byte(`{"turn":{"id":"prediction-turn"}}`), out)
		}
		c.cleanup = append(c.cleanup, method)
		return nil
	}
	return c.predictionLive.Call(ctx, method, params, out)
}

func TestPredictionFallbackIsEphemeralToolFreeAndBounded(t *testing.T) {
	for _, mode := range []string{"success", "invalid", "oversize", "tool", "timeout", "new-turn"} {
		t.Run(mode, func(t *testing.T) {
			run, base := predictionRun()
			base.err = contextUnsupportedPrediction{}
			run.cwd = t.TempDir()
			run.state.Context = &ChatContext{Model: "selected-model"}
			run.state.Entries = []HistoryEntry{
				{Kind: "user", Text: "只检查边界"},
				{Kind: "command", Text: "private tool output must not become prediction context"},
				{Kind: "assistant", Text: "已完成第一步。"},
			}
			c := &predictionFallbackLive{predictionLive: base, mode: mode}
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			run.predictNextPrompt(ctx, c)
			state := run.snapshot()
			if state.PredictionPending || state.Busy || state.Status != "completed" || state.Error != "" {
				t.Fatal(state)
			}
			if mode == "success" {
				if state.Prediction == nil || state.Prediction.Text != "检查边界情况。" {
					t.Fatal(state)
				}
			} else if state.Prediction != nil {
				t.Fatal(state.Prediction)
			}
			if c.threadParams["ephemeral"] != true || c.threadParams["sandbox"] != "read-only" || c.threadParams["model"] != "selected-model" {
				t.Fatal(c.threadParams)
			}
			config := c.threadParams["config"].(map[string]any)
			for _, feature := range []string{"features.shell_tool", "features.hooks", "features.plugins", "features.multi_agent", "features.apps"} {
				if config[feature] != false {
					t.Fatal(config)
				}
			}
			input, _ := json.Marshal(c.turnParams["input"])
			if strings.Contains(string(input), "private tool output") || !strings.Contains(string(input), "只检查边界") {
				t.Fatal(string(input))
			}
			if c.turnParams["threadId"] != "prediction-thread" || c.turnParams["outputSchema"] == nil {
				t.Fatal(c.turnParams)
			}
			if len(c.cleanup) == 0 || c.cleanup[len(c.cleanup)-1] != "thread/unsubscribe" {
				t.Fatal(c.cleanup)
			}
			if mode == "timeout" || mode == "tool" || mode == "new-turn" {
				if c.cleanup[0] != "turn/interrupt" {
					t.Fatal(c.cleanup)
				}
			}
		})
	}
}

type contextUnsupportedPrediction struct{}

func (contextUnsupportedPrediction) Error() string {
	return "thread/prediction/request is not implemented yet"
}

func TestPredictionConversationExcludesToolsAndLimitsInput(t *testing.T) {
	entries := []HistoryEntry{{Kind: "user", Text: "first"}}
	for i := 0; i < 20; i++ {
		entries = append(entries, HistoryEntry{Kind: "assistant", Text: strings.Repeat("界", 7000)})
	}
	entries = append(entries, HistoryEntry{Kind: "command", Text: "command secret"})
	data := predictionConversation(entries)
	total := 0
	for _, message := range data {
		total += len([]rune(message["text"]))
	}
	if len(data) > 8 || total > 12000 || len(data) == 0 {
		t.Fatal(len(data), total)
	}
}
