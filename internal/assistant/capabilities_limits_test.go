package assistant

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"worktree-hub/internal/store"
)

func TestAssistantBoundsActivityPayloadBeforePersistence(t *testing.T) {
	s, _ := actionService(t, Capability{}, nil)
	err := s.registry.Register(Capability{Name: "large_read", Description: "Read bounded data", InputSchema: map[string]any{"type": "object"}, Read: func(context.Context, json.RawMessage) (any, error) { return strings.Repeat("x", maxToolBytes+1), nil }})
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.invoke(context.Background(), store.AssistantRun{ID: "model-run", ConversationID: "yolu-one"}, "large_read", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if len(raw) > maxToolBytes || !strings.Contains(string(raw), "result_too_large") {
		t.Fatalf("oversized result escaped registry: %s", raw)
	}
	activities, err := s.store.AssistantActivities("yolu-one")
	if err != nil || len(activities) != 1 || len(activities[0].Result) > maxToolBytes || activities[0].Status != "failed" {
		t.Fatalf("oversized activity persisted: %+v %v", activities, err)
	}
}

func TestAssistantFullPlanReviewRemainsStoredWithBoundedModelReceipt(t *testing.T) {
	s, _ := actionService(t, Capability{Review: func(context.Context, json.RawMessage) (any, error) {
		return map[string]any{"operation": map[string]any{"requirement": map[string]any{"name": "Large workspace", "path": "/workspaces/large", "members": []any{}}, "evidence": strings.Repeat("x", maxToolBytes+1)}}, nil
	}}, nil)
	p := proposeAction(t, s, "Large workspace")
	if len(p.Review) <= maxToolBytes {
		t.Fatal("full review evidence was lost")
	}
	receipt, _ := json.Marshal(compactToolResult(p))
	if len(receipt) > maxToolBytes || !strings.Contains(string(receipt), "Large workspace") {
		t.Fatal("model receipt is unbounded or lost its reviewed target")
	}
	saved, err := s.store.AssistantPlan(p.ConversationID, p.ID)
	if err != nil || string(saved.Review) != string(p.Review) {
		t.Fatal("immutable review did not survive persistence", err)
	}
}
