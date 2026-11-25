package session

import (
	"context"
	"encoding/json"
	"strings"
	"time"
	"unicode"

	"worktree-hub/internal/codex"
)

// Predictions belong to one completed turn, never to the saved draft/history.
type ChatPrediction struct {
	SourceTurnID string `json:"source_turn_id"`
	Text         string `json:"text"`
}

func (run *ChatRun) predictNextPrompt(parent context.Context, client codex.LiveClient) {
	state := run.snapshot()
	if !state.PredictionPending {
		return
	}
	defer run.change(func(s *ChatState) { s.PredictionPending = false })
	if state.Status != "completed" || state.TurnID == "" || parent.Err() != nil {
		return
	}
	// Keep the existing subscription only for a bounded, optional request. An
	// older server, unavailable prediction model or empty result is silent.
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	requestCtx, end := context.WithTimeout(ctx, 3*time.Second)
	err := client.Call(requestCtx, "thread/prediction/request", map[string]any{
		"threadId": run.session, "sourceTurnId": state.TurnID,
	}, nil)
	end()
	if err != nil {
		message := strings.ToLower(err.Error())
		if strings.Contains(message, "not implemented") || strings.Contains(message, "method not found") || strings.Contains(message, "unknown method") || strings.Contains(message, "unsupported method") {
			if text := generatePromptPrediction(ctx, client, run.cwd, run.session, state); text != "" {
				run.setPrediction(ctx, state.TurnID, text)
			}
		}
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-client.Events():
			if !ok {
				return
			}
			var p struct {
				ThreadID     string `json:"threadId"`
				SourceTurnID string `json:"sourceTurnId"`
				Result       struct {
					Type string  `json:"type"`
					Text *string `json:"text"`
				} `json:"result"`
			}
			if json.Unmarshal(event.Params, &p) != nil || p.ThreadID != run.session {
				continue
			}
			// A native client can start the next turn while this connection is
			// waiting. Never offer a suggestion based on the earlier reply.
			if event.Method == "turn/started" {
				return
			}
			if event.Method != "thread/prediction/updated" || p.SourceTurnID != state.TurnID {
				continue
			}
			if p.Result.Type != "completed" || p.Result.Text == nil {
				return
			}
			run.setPrediction(ctx, p.SourceTurnID, *p.Result.Text)
			return
		}
	}
}

func (run *ChatRun) setPrediction(ctx context.Context, turn, text string) {
	text = strings.TrimSpace(text)
	if text == "" || len(text) > 8000 || strings.ContainsFunc(text, func(r rune) bool {
		return unicode.IsControl(r) && r != '\n' && r != '\t'
	}) {
		return
	}
	run.change(func(s *ChatState) {
		if !s.Busy && s.Status == "completed" && s.TurnID == turn && ctx.Err() == nil {
			s.Prediction = &ChatPrediction{SourceTurnID: turn, Text: text}
		}
	})
}
