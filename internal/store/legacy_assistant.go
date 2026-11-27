package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// Historical names and payloads remain readable through metadata import and
// export. Live Yolu Assistant conversations use the native session index.
var legacyAssistantTables = []metadataTable{
	{"assistant_conversations", "id,title,created_at,updated_at"},
	{"assistant_runs", "id,conversation_id,input,status,error_code"},
	{"assistant_messages", "id,conversation_id,run_id,role,text"},
	{"assistant_action_plans", "id,conversation_id,run_id,status,payload,created_at,updated_at"},
	{"assistant_decisions", "conversation_id,request_id,plan_id,fingerprint"},
	{"assistant_tool_calls", "id,conversation_id,run_id,capability,status,result,created_at"},
	{"assistant_run_contexts", "conversation_id,run_id,context"},
}

func migrateLegacyAssistant(tx *sql.Tx) error {
	_, err := tx.Exec(`
CREATE TABLE IF NOT EXISTS assistant_conversations (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assistant_runs (
 id TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id),
 input TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(conversation_id,id));
CREATE UNIQUE INDEX IF NOT EXISTS assistant_active_run ON assistant_runs(conversation_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS assistant_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id),
 run_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS assistant_message_page ON assistant_messages(conversation_id,id);
CREATE TABLE IF NOT EXISTS assistant_action_plans (
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id),
 run_id TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS assistant_plan_conversation ON assistant_action_plans(conversation_id,created_at);
CREATE TABLE IF NOT EXISTS assistant_decisions (
 conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id), request_id TEXT NOT NULL,
 plan_id TEXT NOT NULL REFERENCES assistant_action_plans(id), fingerprint TEXT NOT NULL,
 PRIMARY KEY(conversation_id,request_id));
CREATE TABLE IF NOT EXISTS assistant_tool_calls (
 id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id),
 run_id TEXT NOT NULL, capability TEXT NOT NULL, status TEXT NOT NULL,
 result TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS assistant_tool_conversation ON assistant_tool_calls(conversation_id,id);
CREATE TABLE IF NOT EXISTS assistant_run_contexts (
 conversation_id TEXT NOT NULL, run_id TEXT NOT NULL, context TEXT NOT NULL,
 PRIMARY KEY(conversation_id,run_id),
 FOREIGN KEY(conversation_id,run_id) REFERENCES assistant_runs(conversation_id,id));`)
	if err != nil {
		return err
	}
	return recoverLegacyAssistant(tx)
}

type recoveredAssistantPlan struct {
	id      string
	payload map[string]json.RawMessage
	steps   []map[string]json.RawMessage
}

// Validate the journal before writing repairs. Rewriting only the fields
// affected by interruption preserves evidence from historical payload versions.
func recoverLegacyAssistant(tx *sql.Tx) error {
	if _, err := tx.Exec(`UPDATE assistant_runs SET status='interrupted',error_code='interrupted' WHERE status='running'`); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT id,conversation_id,run_id,status,payload FROM assistant_action_plans`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var repairs []recoveredAssistantPlan
	for rows.Next() {
		var id, conversation, run, status, raw string
		if err := rows.Scan(&id, &conversation, &run, &status, &raw); err != nil {
			return err
		}
		var plan struct {
			ID           string                       `json:"id"`
			Conversation string                       `json:"conversation_id"`
			Run          string                       `json:"run_id"`
			Status       string                       `json:"status"`
			Revision     int                          `json:"revision"`
			Arguments    json.RawMessage              `json:"arguments"`
			Review       json.RawMessage              `json:"review"`
			Steps        []map[string]json.RawMessage `json:"steps"`
		}
		if err := json.Unmarshal([]byte(raw), &plan); err != nil {
			return err
		}
		if plan.ID != id || plan.Conversation != conversation || plan.Run != run || plan.Status != status || plan.Revision < 1 || !json.Valid(plan.Arguments) || !json.Valid(plan.Review) {
			return errors.New("invalid assistant plan journal")
		}
		if status != "running" && status != "cancelling" {
			continue
		}
		var payload map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			return err
		}
		repairs = append(repairs, recoveredAssistantPlan{id: id, payload: payload, steps: plan.Steps})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, repair := range repairs {
		for _, step := range repair.steps {
			var status string
			if json.Unmarshal(step["status"], &status) == nil && status == "running" {
				step["status"] = json.RawMessage(`"unknown"`)
			}
		}
		updated := time.Now().UnixMilli()
		putJSON := func(key string, value any) error {
			raw, err := json.Marshal(value)
			if err == nil {
				repair.payload[key] = raw
			}
			return err
		}
		if _, present := repair.payload["steps"]; present {
			if err := putJSON("steps", repair.steps); err != nil {
				return err
			}
		}
		repair.payload["status"] = json.RawMessage(`"unknown"`)
		repair.payload["error_code"] = json.RawMessage(`"interrupted"`)
		repair.payload["error"] = json.RawMessage(`"执行已中断，请核对已创建的资源后继续。"`)
		if err := putJSON("updated_at", updated); err != nil {
			return err
		}
		payload, err := json.Marshal(repair.payload)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE assistant_action_plans SET status='unknown',payload=?,updated_at=? WHERE id=?`, string(payload), updated, repair.id); err != nil {
			return err
		}
	}
	return nil
}
