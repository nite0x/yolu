package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/codex"
)

type predictionLive struct {
	*fakeLiveClient
	requested chan map[string]any
	err       error
}

func (c *predictionLive) Call(ctx context.Context, method string, params, out any) error {
	if method == "thread/prediction/request" {
		c.requested <- params.(map[string]any)
		return c.err
	}
	return c.fakeLiveClient.Call(ctx, method, params, out)
}

func predictionRun() (*ChatRun, *predictionLive) {
	run := &ChatRun{session: "session", notify: make(chan struct{}, 1), state: ChatState{
		ID: "request", Status: "completed", TurnID: "turn", PredictionPending: true,
		Entries: []HistoryEntry{}, Approvals: []ChatApproval{},
	}}
	client := &predictionLive{fakeLiveClient: &fakeLiveClient{updates: make(chan codex.Event, 16)}, requested: make(chan map[string]any, 1)}
	return run, client
}

func TestPredictionUsesCompletedTurnAndKeepsSSEOpenWithoutBusy(t *testing.T) {
	a, _, base, endpoint := chatFixture(t)
	c := &predictionLive{fakeLiveClient: base, requested: make(chan map[string]any, 1)}
	a.openLive = func(context.Context) (codex.LiveClient, error) { return c, nil }
	startFakeChat(t, a, endpoint)
	c.event("turn/completed", map[string]any{"turn": map[string]any{"id": "turn", "status": "completed"}})
	select {
	case params := <-c.requested:
		if params["threadId"] != "session" || params["sourceTurnId"] != "turn" {
			t.Fatal(params)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no prediction request")
	}
	state := a.ChatFor("session").snapshot()
	if state.Busy || state.Status != "completed" || !state.PredictionPending {
		t.Fatal(state)
	}
	r := httptest.NewRequest("GET", endpoint+"/events?run=request1", nil)
	r.SetPathValue("session", "session")
	w := httptest.NewRecorder()
	streamDone := make(chan struct{})
	go func() { defer close(streamDone); a.ChatEventsHandler(w, r) }()
	select {
	case <-streamDone:
		t.Fatal("stream closed before prediction")
	case <-time.After(30 * time.Millisecond):
	}
	c.event("thread/prediction/updated", map[string]any{"sourceTurnId": "turn", "result": map[string]any{"type": "completed", "text": "  检查边界情况。  "}})
	select {
	case <-streamDone:
	case <-time.After(3 * time.Second):
		t.Fatal("stream did not finish")
	}
	state = a.ChatFor("session").snapshot()
	if state.PredictionPending || state.Prediction == nil || state.Prediction.Text != "检查边界情况。" || state.Prediction.SourceTurnID != "turn" || state.Error != "" {
		t.Fatal(state)
	}
	if !strings.Contains(w.Body.String(), `"prediction_pending":true`) || !strings.Contains(w.Body.String(), `"text":"检查边界情况。"`) {
		t.Fatal(w.Body.String())
	}
}

func TestPredictionIgnoresOtherThreadsAndTurns(t *testing.T) {
	run, c := predictionRun()
	c.event("thread/prediction/updated", map[string]any{"threadId": "other", "sourceTurnId": "turn", "result": map[string]any{"type": "completed", "text": "wrong thread"}})
	c.event("thread/prediction/updated", map[string]any{"sourceTurnId": "old", "result": map[string]any{"type": "completed", "text": "wrong turn"}})
	c.event("thread/prediction/updated", map[string]any{"sourceTurnId": "turn", "result": map[string]any{"type": "completed", "text": "correct"}})
	run.predictNextPrompt(context.Background(), c)
	if got := run.snapshot().Prediction; got == nil || got.Text != "correct" {
		t.Fatal(got)
	}
}

func TestPredictionOptionalFailuresPreserveCompletedTurn(t *testing.T) {
	for _, mode := range []string{"unsupported", "failed", "null", "empty", "control", "oversize", "cancelled", "new-turn", "closed"} {
		t.Run(mode, func(t *testing.T) {
			run, c := predictionRun()
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
			defer cancel()
			result := map[string]any{"type": "completed", "text": ""}
			switch mode {
			case "unsupported":
				c.err = fmt.Errorf("method not found")
			case "failed":
				result["type"] = "failed"
			case "null":
				result["text"] = nil
			case "control":
				result["text"] = "bad\x1b[31m"
			case "oversize":
				result["text"] = strings.Repeat("x", 8001)
			case "cancelled":
			case "new-turn":
				c.event("turn/started", map[string]any{"turn": map[string]any{"id": "next"}})
			case "closed":
				close(c.updates)
			}
			if mode != "cancelled" && mode != "closed" {
				c.event("thread/prediction/updated", map[string]any{"sourceTurnId": "turn", "result": result})
			}
			run.predictNextPrompt(ctx, c)
			state := run.snapshot()
			if state.Busy || state.PredictionPending || state.Prediction != nil || state.Status != "completed" || state.Error != "" {
				t.Fatal(state)
			}
		})
	}
}

func TestNextSendCancelsPendingPrediction(t *testing.T) {
	a, _, _, endpoint := chatFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	previous, _ := predictionRun()
	previous.cancel = cancel
	a.chats["session"] = previous
	if code, raw := call(t, a, "POST", endpoint, map[string]string{"text": "next instruction", "request_id": "next-request"}); code != 202 {
		t.Fatalf("%d %s", code, raw)
	}
	if ctx.Err() == nil || a.ChatFor("session") == previous {
		t.Fatal("previous prediction was not cancelled")
	}
}

func TestPredictionIsNotRequestedForFailedTurns(t *testing.T) {
	run, c := predictionRun()
	run.state.Busy, run.state.Status = true, "running"
	raw, _ := json.Marshal(map[string]any{"threadId": "session", "turn": map[string]any{"id": "turn", "status": "failed"}})
	run.handle(codex.Event{Method: "turn/completed", Params: raw})
	run.predictNextPrompt(context.Background(), c)
	if len(c.requested) != 0 || run.snapshot().PredictionPending {
		t.Fatal("prediction requested for failed turn")
	}
}
