package session

import (
	"context"
	"os"
	"testing"
	"time"

	"worktree-hub/internal/codex"
)

// Opt in to model usage in a new in-memory, tool-free thread. This never
// resumes a user conversation or executes tools in a project directory.
func TestInstalledCodexPromptPrediction(t *testing.T) {
	if os.Getenv("WORKTREE_HUB_TEST_CODEX_PREDICTION") != "1" {
		t.Skip("opt-in prediction model check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	c, err := codex.StartWire(ctx, codex.Command(ctx, "app-server"))
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	cwd := t.TempDir()
	params, err := codex.ReadOnlyThreadParams(ctx, c, cwd, "Help plan a tiny calculator. Respond briefly in plain text. Do not use tools or inspect files.")
	if err != nil {
		t.Fatal(err)
	}
	var started struct {
		Model  string `json:"model"`
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := c.Call(ctx, "thread/start", params, &started); err != nil {
		t.Fatal(err)
	}
	var turn struct {
		Turn struct {
			ID string `json:"id"`
		} `json:"turn"`
	}
	if err := c.Call(ctx, "turn/start", map[string]any{"threadId": started.Thread.ID, "input": chatTurnInput("I want a small command-line calculator. Suggest its first feature, then wait for my next instruction.", nil), "effort": "low"}, &turn); err != nil {
		t.Fatal(err)
	}
	run := &ChatRun{session: started.Thread.ID, cwd: cwd, notify: make(chan struct{}, 1), state: ChatState{Status: "running", Busy: true, TurnID: turn.Turn.ID, Context: &ChatContext{Model: started.Model}}}
	for {
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case event, ok := <-c.Events():
			if !ok {
				t.Fatal("connection closed")
			}
			if len(event.ID) > 0 {
				t.Fatal("unexpected tool request")
			}
			if run.handle(event) {
				if run.snapshot().Status != "completed" {
					t.Fatal(run.snapshot())
				}
				run.predictNextPrompt(ctx, c)
				state := run.snapshot()
				if state.Prediction == nil || state.Prediction.Text == "" {
					t.Fatalf("no live prediction (status=%s, pending=%t, visible entries=%d)", state.Status, state.PredictionPending, len(state.Entries))
				}
				t.Logf("Live next-prompt generation succeeded (%d characters)", len([]rune(state.Prediction.Text)))
				return
			}
		}
	}
}
