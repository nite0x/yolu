package acp

import (
	"context"
	"encoding/json"
	"time"
)

// WalkSessions follows ACP pagination, retaining the provider's cwd hint.
func WalkSessions(ctx context.Context, client Client, cwd string, visit func(SessionSummary) error) error {
	params := map[string]any{}
	if cwd != "" {
		params["cwd"] = cwd
	}
	seen := map[string]bool{}
	for {
		var page SessionListResult
		if err := client.Call(ctx, "session/list", params, &page); err != nil {
			return err
		}
		for _, item := range page.Sessions {
			if err := visit(item); err != nil {
				return err
			}
		}
		if page.NextCursor == nil || *page.NextCursor == "" || seen[*page.NextCursor] {
			return nil
		}
		seen[*page.NextCursor] = true
		params["cursor"] = *page.NextCursor
	}
}

func DecodeSessionUpdate(msg Message, session string) (SessionUpdate, bool) {
	var envelope SessionUpdateEnvelope
	if msg.Method != "session/update" || len(msg.ID) != 0 || json.Unmarshal(msg.Params, &envelope) != nil {
		return SessionUpdate{}, false
	}
	if envelope.SessionID != "" && envelope.SessionID != session {
		return SessionUpdate{}, false
	}
	return envelope.Update, true
}

func ReplaySession(ctx context.Context, client Client, session string, params map[string]any, update func(SessionUpdate)) (SessionSetupResult, error) {
	return callWithUpdates[SessionSetupResult](ctx, client, "session/load", params, 30*time.Millisecond, func(msg Message) {
		if event, ok := DecodeSessionUpdate(msg, session); ok {
			update(event)
		}
	})
}

func PromptSession(ctx context.Context, client Client, session string, blocks []map[string]any, handle func(Message)) (PromptResult, error) {
	return callWithUpdates[PromptResult](ctx, client, "session/prompt", map[string]any{
		"sessionId": session, "prompt": blocks,
	}, 40*time.Millisecond, handle)
}

type callOutcome[T any] struct {
	result T
	err    error
}

// The transport publishes notifications and replies on separate channels.
// Drain updates accompanying an acknowledgement before returning the result.
func callWithUpdates[T any](ctx context.Context, client Client, method string, params any, grace time.Duration, handle func(Message)) (T, error) {
	callCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan callOutcome[T], 1)
	go func() {
		var result T
		err := client.Call(callCtx, method, params, &result)
		done <- callOutcome[T]{result: result, err: err}
	}()
	events := client.Events()
	var outcome callOutcome[T]
	var drained <-chan time.Time
	for {
		select {
		case msg, open := <-events:
			if !open {
				events = nil
				if done == nil {
					return outcome.result, outcome.err
				}
				continue
			}
			if done != nil || msg.Method == "session/update" {
				handle(msg)
			}
		case outcome = <-done:
			if outcome.err != nil || events == nil {
				return outcome.result, outcome.err
			}
			done = nil
			timer := time.NewTimer(grace)
			defer timer.Stop()
			drained = timer.C
		case <-drained:
			return outcome.result, outcome.err
		case <-ctx.Done():
			return outcome.result, ctx.Err()
		}
	}
}

func CloseSession(client Client, session string, supportsClose bool) {
	if supportsClose {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = client.Call(ctx, "session/close", map[string]any{"sessionId": session}, nil)
	}
	client.Close()
}

func CancelSession(client Client, session string) error {
	return client.Notify("session/cancel", map[string]any{"sessionId": session})
}
