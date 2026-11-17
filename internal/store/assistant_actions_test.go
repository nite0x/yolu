package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func actionTestPlan(id, status string) AssistantPlan {
	return AssistantPlan{ID: id, ConversationID: "conversation", RunID: "run", Revision: 1, Digest: strings.Repeat("a", 64), EnvironmentID: "local", Capability: "workspace_create", Arguments: json.RawMessage(`{"name":"Feature"}`), Review: json.RawMessage(`{"path":"/tmp/workspaces/feature","commit":"resolved"}`), Status: status, Steps: []AssistantStep{{ID: "create", Label: "Create workspace", Status: status}}, Resources: []AssistantResource{{Kind: "workspace", ID: "actual-workspace", EnvironmentID: "local", Name: "Feature", Path: "/tmp/workspaces/feature"}}, CreatedAt: 10, UpdatedAt: 10}
}

func newActionStore(t *testing.T) *Store {
	t.Helper()
	db, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.DB.Close() })
	if err := db.CreateAssistant("conversation"); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestAssistantDecisionReceiptsBindPlanRevisionAndPayload(t *testing.T) {
	db := newActionStore(t)
	plan := actionTestPlan("plan", "pending")
	if err := db.CreateAssistantPlan(plan); err != nil {
		t.Fatal(err)
	}
	for _, input := range []struct {
		digest   string
		revision int
	}{{strings.Repeat("b", 64), 1}, {plan.Digest, 2}} {
		_, changed, err := db.DecideAssistantPlan("conversation", plan.ID, "invalid", "fingerprint", "approve", input.digest, input.revision)
		if !errors.Is(err, ErrAssistantConflict) || changed {
			t.Fatalf("mismatched approval changed=%v err=%v", changed, err)
		}
	}
	approved, changed, err := db.DecideAssistantPlan("conversation", plan.ID, "approve", "approved-payload", "approve", plan.Digest, plan.Revision)
	if err != nil || !changed || approved.Status != "running" || approved.Steps[0].Status != "running" {
		t.Fatalf("approval %+v changed=%v err=%v", approved, changed, err)
	}
	if _, changed, err := db.DecideAssistantPlan("conversation", plan.ID, "approve", "approved-payload", "approve", plan.Digest, plan.Revision); err != nil || changed {
		t.Fatalf("same receipt changed=%v err=%v", changed, err)
	}
	if _, _, err := db.DecideAssistantPlan("conversation", plan.ID, "approve", "changed-payload", "cancel", plan.Digest, plan.Revision); !errors.Is(err, ErrAssistantConflict) {
		t.Fatalf("changed receipt accepted %v", err)
	}
	if _, _, err := db.DecideAssistantPlan("conversation", plan.ID, "new-approval", "new-payload", "approve", plan.Digest, plan.Revision); !errors.Is(err, ErrAssistantConflict) {
		t.Fatalf("running plan approved twice %v", err)
	}
	cancelled, changed, err := db.DecideAssistantPlan("conversation", plan.ID, "cancel", "cancel-payload", "cancel", plan.Digest, plan.Revision)
	if err != nil || !changed || cancelled.Status != "cancelling" {
		t.Fatalf("cancel %+v changed=%v err=%v", cancelled, changed, err)
	}
	if _, err := db.AssistantPlan("other-conversation", plan.ID); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("cross-conversation plan exposed %v", err)
	}
}

func TestAssistantConcurrentDecisionSchedulesOnce(t *testing.T) {
	db := newActionStore(t)
	plan := actionTestPlan("plan", "pending")
	if err := db.CreateAssistantPlan(plan); err != nil {
		t.Fatal(err)
	}
	var changed atomic.Int32
	var workers sync.WaitGroup
	failures := make(chan error, 12)
	for i := 0; i < 12; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			_, first, err := db.DecideAssistantPlan("conversation", plan.ID, "same-request", "same-fingerprint", "approve", plan.Digest, plan.Revision)
			if err != nil {
				failures <- err
			}
			if first {
				changed.Add(1)
			}
		}()
	}
	workers.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	if changed.Load() != 1 {
		t.Fatalf("scheduled %d executions", changed.Load())
	}
}

func TestAssistantActionRestartAndImportPreserveEvidence(t *testing.T) {
	directory := t.TempDir()
	db, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { db.DB.Close() }()
	if err := db.CreateAssistant("conversation"); err != nil {
		t.Fatal(err)
	}
	selection := json.RawMessage(`{"environment_id":"remote","project_id":"frontend"}`)
	if _, _, err := db.BeginAssistantRun("conversation", "run", "Create workspace", selection); err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"pending", "running", "cancelling", "succeeded"} {
		plan := actionTestPlan(status, status)
		if status == "cancelling" {
			plan.Steps[0].Status = "running"
		}
		if err := db.CreateAssistantPlan(plan); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.AddAssistantActivity("conversation", "run", "project_list", "completed", map[string]any{"resources": []AssistantResource{{Kind: "project", ID: "frontend", EnvironmentID: "remote", Name: "Frontend"}}}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := ExportMetadata(context.Background(), filepath.Join(directory, "worktree-hub.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.DB.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer imported.DB.Close()
	if err := imported.ImportMetadata(snapshot); err != nil {
		t.Fatal(err)
	}
	for name, current := range map[string]*Store{"restart": db, "import": imported} {
		t.Run(name, func(t *testing.T) {
			for _, before := range []string{"pending", "running", "cancelling", "succeeded"} {
				p, err := current.AssistantPlan("conversation", before)
				if err != nil {
					t.Fatal(err)
				}
				expected := before
				if before == "running" || before == "cancelling" {
					expected = "unknown"
					if p.ErrorCode != "interrupted" || p.Steps[0].Status != "unknown" {
						t.Fatalf("interrupted evidence %+v", p)
					}
				}
				if p.Status != expected || len(p.Resources) != 1 || p.Resources[0].ID != "actual-workspace" || p.Digest != strings.Repeat("a", 64) || string(p.Review) != `{"path":"/tmp/workspaces/feature","commit":"resolved"}` {
					t.Fatalf("lost plan evidence %+v", p)
				}
			}
			activities, err := current.AssistantActivities("conversation")
			if err != nil || len(activities) != 1 || !strings.Contains(string(activities[0].Result), "frontend") {
				t.Fatalf("lost activities %+v %v", activities, err)
			}
			raw, err := current.AssistantRunContext("conversation", "run")
			if err != nil || string(raw) != string(selection) {
				t.Fatalf("lost selection %s %v", raw, err)
			}
			run, err := current.AssistantRun("conversation", "run")
			if err != nil || run.Status != "interrupted" {
				t.Fatalf("run not interrupted %+v %v", run, err)
			}
		})
	}
}

func TestAssistantMalformedPlanImportRollsBack(t *testing.T) {
	db, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer db.DB.Close()
	snapshot := MetadataSnapshot{Tables: map[string][][]any{
		"assistant_conversations": {{"conversation", "Feature", int64(10), int64(10)}},
		"assistant_action_plans":  {{"bad-plan", "conversation", "run", "running", "{invalid-json", int64(10), int64(10)}},
	}}
	if err := db.ImportMetadata(snapshot); err == nil {
		t.Fatal("malformed plan import succeeded")
	}
	for _, table := range []string{"assistant_conversations", "assistant_action_plans"} {
		var count int
		if err := db.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("failed import committed %s rows=%d err=%v", table, count, err)
		}
	}
}

func TestAssistantPlanPollingTracksOldOutcomes(t *testing.T) {
	db := newActionStore(t)
	old := actionTestPlan("old", "pending")
	if err := db.CreateAssistantPlan(old); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 105; i++ {
		p := actionTestPlan(fmt.Sprintf("recent-%03d", i), "succeeded")
		p.CreatedAt, p.UpdatedAt = int64(100+i), int64(100+i)
		if err := db.CreateAssistantPlan(p); err != nil {
			t.Fatal(err)
		}
	}
	approved, _, err := db.DecideAssistantPlan("conversation", old.ID, "approve-old", "fingerprint", "approve", old.Digest, old.Revision)
	if err != nil {
		t.Fatal(err)
	}
	plans, err := db.AssistantPlans("conversation")
	if err != nil || len(plans) != 100 || plans[0].ID != old.ID || plans[0].Status != "running" {
		t.Fatalf("old approval absent from recent updates %+v %v", plans, err)
	}
	approved.Status = "succeeded"
	if err := db.UpdateAssistantPlan(approved); err != nil {
		t.Fatal(err)
	}
	// Simulate enough later updates to move the completed plan out of the window.
	for i := 0; i < 105; i++ {
		p := actionTestPlan(fmt.Sprintf("recent-%03d", i), "succeeded")
		p.UpdatedAt = time.Now().Add(time.Hour).UnixMilli() + int64(i)
		if _, err := db.DB.Exec(`UPDATE assistant_action_plans SET updated_at=? WHERE id=?`, p.UpdatedAt, p.ID); err != nil {
			t.Fatal(err)
		}
	}
	plans, err = db.AssistantPlansForSnapshot("conversation", []string{"latest-run"}, []string{old.ID})
	if err != nil || len(plans) != 101 || plans[100].ID != old.ID || plans[100].Status != "succeeded" {
		t.Fatalf("tracked completion missing %+v %v", plans, err)
	}
	if err := db.CreateAssistant("other"); err != nil {
		t.Fatal(err)
	}
	plans, err = db.AssistantPlansForSnapshot("other", nil, []string{old.ID})
	if err != nil || len(plans) != 0 {
		t.Fatalf("tracked ID leaked another conversation's plan %+v %v", plans, err)
	}
}
