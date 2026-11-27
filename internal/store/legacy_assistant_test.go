package store

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

func TestLegacyAssistantRestartAndMetadataTransfer(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.DB.Exec(`
		INSERT INTO assistant_conversations VALUES('conversation','Previous chat',1,2);
		INSERT INTO assistant_runs VALUES('run','conversation','input','running','');
	`)
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{"pending", "running", "cancelling", "succeeded"} {
		payload := fmt.Sprintf(`{"id":%q,"conversation_id":"conversation","run_id":"run","status":%q,"revision":1,"digest":"historical-digest","arguments":{},"review":{"branch":"reviewed"},"steps":[{"id":"create","status":"running","historical_step_field":42}],"resources":[{"id":"checkout"}],"historical_plan_field":{"id":"evidence"}}`, status, status)
		if _, err := db.DB.Exec(`INSERT INTO assistant_action_plans VALUES(?,'conversation','run',?,?,1,2)`, status, status, payload); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.DB.Exec(`
		INSERT INTO assistant_decisions VALUES('conversation','request','running','fingerprint');
		INSERT INTO assistant_tool_calls VALUES(1,'conversation','run','project_list','completed','{"id":"project"}',2);
		INSERT INTO assistant_run_contexts VALUES('conversation','run','{"environment_id":"remote","project_id":"frontend"}');
	`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 111; i++ {
		if _, err := db.DB.Exec(`INSERT INTO assistant_messages(conversation_id,run_id,role,text) VALUES('conversation','run','assistant',?)`, fmt.Sprint(i)); err != nil {
			t.Fatal(err)
		}
	}
	source := filepath.Join(dir, "worktree-hub.db")
	snapshot, err := ExportMetadata(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	destination := t.TempDir()
	imported, err := Open(destination)
	if err != nil {
		t.Fatal(err)
	}
	defer imported.Close()
	if err := imported.ImportMetadata(snapshot); err != nil {
		t.Fatal(err)
	}
	for name, path := range map[string]string{"restart": source, "import": filepath.Join(destination, "worktree-hub.db")} {
		t.Run(name, func(t *testing.T) {
			got, err := ExportMetadata(context.Background(), path)
			if err != nil {
				t.Fatal(err)
			}
			run := got.Tables["assistant_runs"][0]
			if run[3] != "interrupted" || run[4] != "interrupted" {
				t.Fatal(run)
			}
			messages := got.Tables["assistant_messages"]
			if len(messages) != 111 || messages[0][4] != "0" || messages[110][4] != "110" {
				t.Fatal("historical messages were lost")
			}
			if got.Tables["assistant_decisions"][0][3] != "fingerprint" ||
				got.Tables["assistant_tool_calls"][0][5] != `{"id":"project"}` ||
				got.Tables["assistant_run_contexts"][0][2] != `{"environment_id":"remote","project_id":"frontend"}` {
				t.Fatal("historical receipts, activity or context were lost")
			}
			plans := got.Tables["assistant_action_plans"]
			if len(plans) != 4 {
				t.Fatalf("expected all four plans, got %d", len(plans))
			}
			for _, row := range plans {
				var p struct {
					Steps []struct {
						Status string
						Field  int `json:"historical_step_field"`
					}
					Digest    string
					ErrorCode string `json:"error_code"`
					Review    map[string]string
					Resources []map[string]string
					Evidence  map[string]string `json:"historical_plan_field"`
				}
				if err := json.Unmarshal([]byte(row[4].(string)), &p); err != nil {
					t.Fatal(err)
				}
				expected := row[0]
				if expected == "running" || expected == "cancelling" {
					expected = "unknown"
					if p.Steps[0].Status != "unknown" || p.ErrorCode != "interrupted" {
						t.Fatal("interrupted plan was not repaired", row)
					}
				}
				if row[3] != expected || p.Digest != "historical-digest" || p.Review["branch"] != "reviewed" ||
					p.Resources[0]["id"] != "checkout" || p.Evidence["id"] != "evidence" || p.Steps[0].Field != 42 {
					t.Fatal("lost plan evidence", row)
				}
			}
		})
	}
	if err := imported.ImportMetadata(snapshot); err == nil {
		t.Fatal("import overwrote historical data")
	}
	legacy, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer legacy.Close()
	if err := legacy.ImportMetadata(MetadataSnapshot{Tables: map[string][][]any{}}); err != nil {
		t.Fatal("older snapshot without assistant tables did not import", err)
	}
}

func TestLegacyAssistantMalformedPlanImportRollsBack(t *testing.T) {
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
