package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"worktree-hub/internal/store"
)

func actionSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{"environment_id": map[string]any{"type": "string", "enum": []string{"local", "remote"}}, "name": map[string]any{"type": "string", "minLength": 1, "maxLength": 100}}, "required": []string{"environment_id", "name"}, "additionalProperties": false}
}

func actionService(t *testing.T, capability Capability, readOnly func() bool) (*Service, http.Handler) {
	t.Helper()
	s, h := testService(t, func(context.Context, []store.AssistantMessage) (string, error) { return "Ready", nil })
	registry := NewRegistry()
	if err := registry.Register(Capability{Name: "app_get_context", Description: "Read selected resources", InputSchema: map[string]any{"type": "object"}, Read: func(context.Context, json.RawMessage) (any, error) { return map[string]any{}, nil }}); err != nil {
		t.Fatal(err)
	}
	capability.Name, capability.Mutation = "test_write", true
	capability.Description, capability.InputSchema = "Create a reviewed workspace", actionSchema()
	if capability.Review == nil {
		capability.Review = func(_ context.Context, raw json.RawMessage) (any, error) {
			var args map[string]any
			if err := json.Unmarshal(raw, &args); err != nil {
				return nil, err
			}
			return map[string]any{"name": args["name"], "path": "/tmp/workspaces/feature", "commit": "reviewed-head"}, nil
		}
	}
	if capability.Execute == nil {
		capability.Execute = func(context.Context, json.RawMessage) (ExecutionResult, error) {
			return ExecutionResult{}, errors.New("unexpected execution")
		}
	}
	if err := registry.Register(capability); err != nil {
		t.Fatal(err)
	}
	s.Configure(registry, readOnly)
	request(t, h, "POST", "/api/assistant/conversations", `{"id":"yolu-one"}`, 201)
	return s, h
}

func proposeAction(t *testing.T, s *Service, name string) store.AssistantPlan {
	t.Helper()
	raw, _ := json.Marshal(map[string]string{"environment_id": "local", "name": name})
	result, err := s.invoke(context.Background(), store.AssistantRun{ID: "model-run", ConversationID: "yolu-one"}, "test_write", raw)
	if err != nil {
		t.Fatal(err)
	}
	plan, ok := result.(store.AssistantPlan)
	if !ok {
		t.Fatalf("proposal failed %+v", result)
	}
	return plan
}

func decisionBody(t *testing.T, plan store.AssistantPlan, decision, id string) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"decision": decision, "request_id": id, "digest": plan.Digest, "revision": plan.Revision})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func decisionPath(plan store.AssistantPlan) string {
	return "/api/assistant/conversations/" + plan.ConversationID + "/plans/" + plan.ID + "/decision"
}
func waitPlan(t *testing.T, s *Service, id, status string) store.AssistantPlan {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		p, err := s.store.AssistantPlan("yolu-one", id)
		if err != nil {
			t.Fatal(err)
		}
		if p.Status == status {
			return p
		}
		time.Sleep(time.Millisecond)
	}
	p, _ := s.store.AssistantPlan("yolu-one", id)
	t.Fatalf("plan did not reach %s, got %+v", status, p)
	return p
}

func TestAssistantPlanApprovalBindsReviewAndReusesReceipt(t *testing.T) {
	var calls atomic.Int32
	s, h := actionService(t, Capability{Execute: func(_ context.Context, review json.RawMessage) (ExecutionResult, error) {
		calls.Add(1)
		if !strings.Contains(string(review), "reviewed-head") {
			t.Error("execution lost approved review")
		}
		return ExecutionResult{Status: "succeeded", Resources: []Resource{{Kind: "workspace", ID: "actual-id", EnvironmentID: "local", Name: "Feature"}}, Data: map[string]string{"state": "ready"}}, nil
	}}, nil)
	plan := proposeAction(t, s, "Feature")
	if plan.Status != "pending" || plan.Revision != 1 || plan.Digest != planDigest(plan) || calls.Load() != 0 {
		t.Fatalf("proposal executed or invalid %+v", plan)
	}
	wrong := plan
	wrong.Digest = strings.Repeat("b", 64)
	request(t, h, "POST", decisionPath(plan), decisionBody(t, wrong, "approve", "wrong-digest"), 409)
	wrong = plan
	wrong.Revision++
	request(t, h, "POST", decisionPath(plan), decisionBody(t, wrong, "approve", "wrong-revision"), 409)
	request(t, h, "POST", decisionPath(plan), decisionBody(t, plan, "approve", "approve"), 202)
	finished := waitPlan(t, s, plan.ID, "succeeded")
	request(t, h, "POST", decisionPath(plan), decisionBody(t, plan, "approve", "approve"), 202)
	request(t, h, "POST", decisionPath(plan), decisionBody(t, plan, "cancel", "approve"), 409)
	request(t, h, "POST", decisionPath(plan), decisionBody(t, plan, "approve", "approve-again"), 409)
	if calls.Load() != 1 || len(finished.Resources) != 1 || finished.Resources[0].ID != "actual-id" || finished.Steps[0].Status != "succeeded" || !strings.Contains(string(finished.Steps[0].Result), "ready") {
		t.Fatalf("execution/receipt evidence calls=%d plan=%+v", calls.Load(), finished)
	}
	changed := proposeAction(t, s, "Changed")
	changed.Review = json.RawMessage(`{"path":"/unexpected"}`)
	if err := s.store.UpdateAssistantPlan(changed); err != nil {
		t.Fatal(err)
	}
	request(t, h, "POST", decisionPath(changed), decisionBody(t, changed, "approve", "changed-review"), 409)
	if calls.Load() != 1 {
		t.Fatal("tampered review executed")
	}
}

func TestAssistantConcurrentApprovalsExecuteOnce(t *testing.T) {
	var calls atomic.Int32
	s, h := actionService(t, Capability{Execute: func(context.Context, json.RawMessage) (ExecutionResult, error) {
		calls.Add(1)
		return ExecutionResult{Status: "succeeded"}, nil
	}}, nil)
	plan := proposeAction(t, s, "Feature")
	body := decisionBody(t, plan, "approve", "shared-request")
	var workers sync.WaitGroup
	statuses := make(chan int, 12)
	for i := 0; i < 12; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("POST", decisionPath(plan), strings.NewReader(body)))
			statuses <- w.Code
		}()
	}
	workers.Wait()
	close(statuses)
	for status := range statuses {
		if status != 202 {
			t.Errorf("concurrent receipt status %d", status)
		}
	}
	waitPlan(t, s, plan.ID, "succeeded")
	if calls.Load() != 1 {
		t.Fatalf("executed %d times", calls.Load())
	}
}

func TestAssistantDecisionRetryWorksAtExecutionCapacity(t *testing.T) {
	var calls atomic.Int32
	release := make(chan struct{})
	defer close(release)
	s, h := actionService(t, Capability{Execute: func(ctx context.Context, _ json.RawMessage) (ExecutionResult, error) {
		calls.Add(1)
		select {
		case <-release:
			return ExecutionResult{Status: "succeeded"}, nil
		case <-ctx.Done():
			return ExecutionResult{}, ctx.Err()
		}
	}}, nil)
	var first store.AssistantPlan
	for i := 0; i < 4; i++ {
		plan := proposeAction(t, s, fmt.Sprint("Feature ", i))
		if i == 0 {
			first = plan
		}
		request(t, h, "POST", decisionPath(plan), decisionBody(t, plan, "approve", fmt.Sprint("approve-", i)), 202)
	}
	request(t, h, "POST", decisionPath(first), decisionBody(t, first, "approve", "approve-0"), 202)
	fifth := proposeAction(t, s, "Feature 5")
	request(t, h, "POST", decisionPath(fifth), decisionBody(t, fifth, "approve", "approve-5"), 429)
}

func TestAssistantPlanCancellationAndStaleReview(t *testing.T) {
	var calls atomic.Int32
	s, h := actionService(t, Capability{Execute: func(context.Context, json.RawMessage) (ExecutionResult, error) {
		calls.Add(1)
		return ExecutionResult{}, &CapabilityError{Code: "stale_plan", Message: "The reviewed branch moved"}
	}}, nil)
	cancelled := proposeAction(t, s, "Cancel")
	request(t, h, "POST", decisionPath(cancelled), decisionBody(t, cancelled, "cancel", "cancel"), 202)
	waitPlan(t, s, cancelled.ID, "cancelled")
	request(t, h, "POST", decisionPath(cancelled), decisionBody(t, cancelled, "approve", "cancelled-approval"), 409)
	if calls.Load() != 0 {
		t.Fatal("cancelled plan executed")
	}
	stale := proposeAction(t, s, "Stale")
	request(t, h, "POST", decisionPath(stale), decisionBody(t, stale, "approve", "stale-approval"), 202)
	conflict := waitPlan(t, s, stale.ID, "conflict")
	if calls.Load() != 1 || conflict.ErrorCode != "stale_plan" || len(conflict.Resources) != 0 {
		t.Fatalf("stale plan result %+v calls=%d", conflict, calls.Load())
	}
}

func TestAssistantCancelledWorkerDoesNotStartAnOperation(t *testing.T) {
	var calls atomic.Int32
	s, _ := actionService(t, Capability{Execute: func(context.Context, json.RawMessage) (ExecutionResult, error) {
		calls.Add(1)
		return ExecutionResult{Status: "succeeded"}, nil
	}}, nil)
	plan := proposeAction(t, s, "Cancelled worker")
	plan.Status = "running"
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	s.workers.Add(1)
	s.executePlan(ctx, cancel, plan)
	if calls.Load() != 0 {
		t.Fatal("operation started after cancellation")
	}
}

func TestAssistantUnknownExecutionReconcilesWithoutReplay(t *testing.T) {
	var calls atomic.Int32
	var resourceExists atomic.Bool
	s, h := actionService(t, Capability{
		Execute: func(context.Context, json.RawMessage) (ExecutionResult, error) {
			calls.Add(1)
			return ExecutionResult{}, errors.New("PRIVATE_TRANSPORT_ERROR")
		},
		Reconcile: func(context.Context, json.RawMessage) (ExecutionResult, bool, error) {
			if !resourceExists.Load() {
				return ExecutionResult{}, false, nil
			}
			return ExecutionResult{Status: "partial", Resources: []Resource{{Kind: "workspace", ID: "actual-partial", EnvironmentID: "local", Name: "Feature"}}, Data: map[string]any{"members": []string{"ready", "failed"}}, Steps: []store.AssistantStep{{ID: "frontend", Label: "Frontend", Status: "succeeded"}, {ID: "backend", Label: "Backend", Status: "failed"}}}, true, nil
		},
	}, nil)
	plan := proposeAction(t, s, "Feature")
	request(t, h, "POST", decisionPath(plan), decisionBody(t, plan, "approve", "approve"), 202)
	unknown := waitPlan(t, s, plan.ID, "unknown")
	if unknown.ErrorCode != "operation_failed" || strings.Contains(unknown.Error, "PRIVATE_TRANSPORT_ERROR") {
		t.Fatalf("unknown result leaked diagnostics %+v", unknown)
	}
	resourceExists.Store(true)
	path := strings.TrimSuffix(decisionPath(plan), "decision") + "reconcile"
	request(t, h, "POST", path, `{}`, 200)
	partial := waitPlan(t, s, plan.ID, "partial")
	request(t, h, "POST", decisionPath(plan), decisionBody(t, plan, "approve", "approve"), 202)
	if calls.Load() != 1 || len(partial.Resources) != 1 || partial.Resources[0].ID != "actual-partial" || partial.Error != "" || len(partial.Steps) != 3 || partial.Steps[0].Status != "partial" || partial.Steps[1].Status != "succeeded" || partial.Steps[2].Status != "failed" || !strings.Contains(string(partial.Steps[0].Result), "failed") {
		t.Fatalf("reconciliation replayed/lost evidence calls=%d plan=%+v", calls.Load(), partial)
	}
}

func TestAssistantReadOnlyBlocksToolsAndForgedDecisions(t *testing.T) {
	var readOnly atomic.Bool
	var reviews atomic.Int32
	var executions atomic.Int32
	s, h := actionService(t, Capability{
		Review: func(context.Context, json.RawMessage) (any, error) {
			reviews.Add(1)
			return map[string]string{"path": "/tmp/feature"}, nil
		},
		Execute: func(context.Context, json.RawMessage) (ExecutionResult, error) {
			executions.Add(1)
			return ExecutionResult{Status: "succeeded"}, nil
		},
	}, readOnly.Load)
	plan := proposeAction(t, s, "Feature")
	readOnly.Store(true)
	for _, tool := range s.registry.Tools(true) {
		if tool.Name == "test_write" {
			t.Fatal("read-only model advertised write capability")
		}
	}
	result, err := s.invoke(context.Background(), store.AssistantRun{ID: "read-only-run", ConversationID: "yolu-one"}, "test_write", json.RawMessage(`{"environment_id":"local","name":"Blocked"}`))
	raw, _ := json.Marshal(result)
	if err != nil || !strings.Contains(string(raw), "permission_denied") || reviews.Load() != 1 || executions.Load() != 0 {
		t.Fatalf("read-only mutation %+v err=%v reviews=%d executions=%d", result, err, reviews.Load(), executions.Load())
	}
	request(t, h, "POST", decisionPath(plan), decisionBody(t, plan, "approve", "forged-approval"), 403)
	stored, err := s.store.AssistantPlan("yolu-one", plan.ID)
	if err != nil || stored.Status != "pending" || executions.Load() != 0 {
		t.Fatalf("read-only decision changed plan %+v %v", stored, err)
	}
	if _, err := s.invoke(context.Background(), store.AssistantRun{ID: "read-only-run", ConversationID: "yolu-one"}, "app_get_context", json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
}

func TestAssistantCapabilityValidationRejectsInvalidArguments(t *testing.T) {
	var reviews atomic.Int32
	s, _ := actionService(t, Capability{Review: func(context.Context, json.RawMessage) (any, error) { reviews.Add(1); return nil, nil }}, nil)
	for _, raw := range []string{`{"environment_id":"missing","name":"Feature"}`, `{"environment_id":"local","name":"Feature","execute":true}`, `{"environment_id":"local","name":0}`, `{"environment_id":"local","name":""}`, `{} {}`} {
		_, _, err := s.registry.Validate("test_write", json.RawMessage(raw))
		var problem *CapabilityError
		if !errors.As(err, &problem) || problem.Code != "invalid_input" {
			t.Fatalf("invalid input accepted %s %v", raw, err)
		}
	}
	if _, _, err := s.registry.Validate("shell", json.RawMessage(`{}`)); err == nil {
		t.Fatal("unknown capability accepted")
	}
	if reviews.Load() != 0 {
		t.Fatal("invalid arguments reached review")
	}
}

func TestAssistantSendReceiptIncludesSelection(t *testing.T) {
	s, h := actionService(t, Capability{Execute: func(context.Context, json.RawMessage) (ExecutionResult, error) { return ExecutionResult{}, nil }}, nil)
	seen := make(chan Selection, 1)
	s.provider = func(ctx context.Context, _ []store.AssistantMessage) (string, error) {
		seen <- SelectionFromContext(ctx)
		return "Ready", nil
	}
	path := "/api/assistant/conversations/yolu-one/runs"
	body := `{"request_id":"selection","text":"Plan feature","context":{"environment_id":"local","project_id":"frontend"}}`
	request(t, h, "POST", path, body, 202)
	waitRun(t, s, "selection", "completed")
	request(t, h, "POST", path, body, 200)
	request(t, h, "POST", path, `{"request_id":"selection","text":"Plan feature","context":{"environment_id":"remote","project_id":"frontend"}}`, 409)
	if selection := <-seen; selection.EnvironmentID != "local" || selection.ProjectID != "frontend" {
		t.Fatalf("provider received wrong selection %+v", selection)
	}
}

func TestAssistantSendReceiptSurvivesStaleSelection(t *testing.T) {
	s, h := actionService(t, Capability{}, nil)
	var removed atomic.Bool
	capability := s.registry.capabilities["app_get_context"]
	capability.Read = func(context.Context, json.RawMessage) (any, error) {
		if removed.Load() {
			return nil, &CapabilityError{Code: "resource_not_found", Message: "The selected project was removed"}
		}
		return map[string]any{}, nil
	}
	s.registry.capabilities["app_get_context"] = capability
	path := "/api/assistant/conversations/yolu-one/runs"
	body := `{"request_id":"selection","text":"Plan feature","context":{"environment_id":"local","project_id":"frontend"}}`
	request(t, h, "POST", path, body, 202)
	waitRun(t, s, "selection", "completed")
	removed.Store(true)
	request(t, h, "POST", path, body, 200)
}

func TestAssistantPersistsMemberProgressBeforeExecutionCompletes(t *testing.T) {
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	resources := []Resource{{Kind: "workspace", ID: "actual-workspace", EnvironmentID: "local", Name: "Feature"}}
	memberSteps := func(second string) []store.AssistantStep {
		return []store.AssistantStep{{ID: "frontend", Label: "Frontend", Status: "succeeded", Result: json.RawMessage(`{"path":"/tmp/workspaces/feature/frontend"}`)}, {ID: "backend", Label: "Backend", Status: second}}
	}
	s, h := actionService(t, Capability{
		Execute: func(ctx context.Context, _ json.RawMessage) (ExecutionResult, error) {
			select {
			case <-release:
				return ExecutionResult{Status: "partial", Resources: resources, Steps: memberSteps("failed")}, nil
			case <-ctx.Done():
				return ExecutionResult{}, ctx.Err()
			}
		},
		Progress: func(context.Context, json.RawMessage) (ExecutionResult, bool, error) {
			return ExecutionResult{Resources: resources, Steps: memberSteps("running")}, true, nil
		},
	}, nil)
	plan := proposeAction(t, s, "Feature")
	request(t, h, "POST", decisionPath(plan), decisionBody(t, plan, "approve", "approve"), 202)
	deadline := time.Now().Add(3 * time.Second)
	observed := false
	for time.Now().Before(deadline) {
		current, err := s.store.AssistantPlan("yolu-one", plan.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(current.Steps) == 3 && current.Steps[1].Status == "succeeded" && current.Steps[2].Status == "running" {
			observed = true
			if current.Status != "running" || current.Steps[0].Status != "running" || len(current.Resources) != 1 || current.Resources[0].ID != "actual-workspace" || !strings.Contains(string(current.Steps[1].Result), "frontend") {
				t.Fatalf("progress lost execution evidence %+v", current)
			}
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !observed {
		t.Fatal("member progress was not saved while execution was active")
	}
	releaseOnce.Do(func() { close(release) })
	finished := waitPlan(t, s, plan.ID, "partial")
	if len(finished.Steps) != 3 || finished.Steps[1].Status != "succeeded" || finished.Steps[2].Status != "failed" || len(finished.Resources) != 1 {
		t.Fatalf("final partial result lost member states %+v", finished)
	}
}

func TestAssistantTimedOutReviewCannotPersistALatePlan(t *testing.T) {
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	returned := make(chan struct{})
	s, _ := actionService(t, Capability{Review: func(context.Context, json.RawMessage) (any, error) {
		<-release
		return map[string]string{"path": "/tmp/late-plan"}, nil
	}}, nil)
	response := invokeProviderToolWithin(context.Background(), func(ctx context.Context, name string, raw json.RawMessage) (any, error) {
		defer close(returned)
		return s.invoke(ctx, store.AssistantRun{ID: "timed-out-review", ConversationID: "yolu-one"}, name, raw)
	}, "test_write", json.RawMessage(`{"environment_id":"local","name":"Late review"}`), 20*time.Millisecond)
	if response.Success || !strings.Contains(response.ContentItems[0].Text, "tool_interrupted") {
		t.Fatalf("review did not time out %+v", response)
	}
	releaseOnce.Do(func() { close(release) })
	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("late review handler did not return")
	}
	plans, err := s.store.AssistantPlans("yolu-one")
	if err != nil || len(plans) != 0 {
		t.Fatalf("late review saved an unwanted plan %+v %v", plans, err)
	}
	activities, err := s.store.AssistantActivities("yolu-one")
	if err != nil || len(activities) != 0 {
		t.Fatalf("late review saved an unwanted activity %+v %v", activities, err)
	}
}
