package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type AssistantResource struct {
	Kind          string `json:"kind"`
	ID            string `json:"id"`
	EnvironmentID string `json:"environment_id"`
	Name          string `json:"name"`
	Path          string `json:"path,omitempty"`
}

type AssistantStep struct {
	ID     string          `json:"id"`
	Label  string          `json:"label"`
	Status string          `json:"status"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type AssistantPlan struct {
	ID             string              `json:"id"`
	ConversationID string              `json:"conversation_id"`
	RunID          string              `json:"run_id"`
	Revision       int                 `json:"revision"`
	Digest         string              `json:"digest"`
	EnvironmentID  string              `json:"environment_id"`
	Capability     string              `json:"capability"`
	Arguments      json.RawMessage     `json:"arguments"`
	Review         json.RawMessage     `json:"review"`
	Status         string              `json:"status"`
	Steps          []AssistantStep     `json:"steps"`
	Resources      []AssistantResource `json:"resources"`
	ErrorCode      string              `json:"error_code,omitempty"`
	Error          string              `json:"error,omitempty"`
	CreatedAt      int64               `json:"created_at"`
	UpdatedAt      int64               `json:"updated_at"`
}

type AssistantActivity struct {
	ID         int64           `json:"id"`
	RunID      string          `json:"run_id"`
	Capability string          `json:"capability"`
	Status     string          `json:"status"`
	Result     json.RawMessage `json:"result"`
	CreatedAt  int64           `json:"created_at"`
}

func (s *Store) migrateAssistantActions() error {
	_, err := s.DB.Exec(`
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
	return s.InterruptAssistantPlans()
}

func (s *Store) InterruptAssistantPlans() error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := interruptAssistantPlans(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// Import and restart repair share a transaction so malformed imported journals
// cannot leave a committed database that fails to open on the next launch.
func interruptAssistantPlans(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT id,conversation_id,run_id,status,payload FROM assistant_action_plans`)
	if err != nil {
		return err
	}
	plans := []AssistantPlan{}
	for rows.Next() {
		var id, conversation, run, status, raw string
		var p AssistantPlan
		if err := rows.Scan(&id, &conversation, &run, &status, &raw); err != nil {
			rows.Close()
			return err
		}
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			rows.Close()
			return err
		}
		if p.ID != id || p.ConversationID != conversation || p.RunID != run || p.Status != status || p.Revision < 1 || !json.Valid(p.Arguments) || !json.Valid(p.Review) {
			rows.Close()
			return errors.New("invalid assistant plan journal")
		}
		plans = append(plans, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, p := range plans {
		if p.Status != "running" && p.Status != "cancelling" {
			continue
		}
		p.Status, p.ErrorCode, p.Error = "unknown", "interrupted", "执行已中断，请核对已创建的资源后继续。"
		for i := range p.Steps {
			if p.Steps[i].Status == "running" {
				p.Steps[i].Status = "unknown"
			}
		}
		p.UpdatedAt = time.Now().UnixMilli()
		payload, err := json.Marshal(p)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE assistant_action_plans SET status=?,payload=?,updated_at=? WHERE id=?`, p.Status, string(payload), p.UpdatedAt, p.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) CreateAssistantPlan(p AssistantPlan) error {
	payload, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO assistant_action_plans(id,conversation_id,run_id,status,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, p.ID, p.ConversationID, p.RunID, p.Status, string(payload), p.CreatedAt, p.UpdatedAt)
	return err
}

func (s *Store) AssistantPlan(conversation, id string) (AssistantPlan, error) {
	var p AssistantPlan
	var payload string
	err := s.DB.QueryRow(`SELECT payload FROM assistant_action_plans WHERE conversation_id=? AND id=?`, conversation, id).Scan(&payload)
	if err == nil {
		err = json.Unmarshal([]byte(payload), &p)
	}
	return p, err
}

// Include the recent window, the requested transcript page and explicitly
// tracked plans so completion remains observable after an old plan is approved.
func assistantActionHistory(table, conversation, order string, runs, ids []string) (string, []any) {
	args := []any{conversation}
	if len(runs) == 0 && len(ids) == 0 {
		return `conversation_id=? ORDER BY ` + order + ` LIMIT 100`, args
	}
	args = append(args, conversation)
	clauses := []string{`id IN (SELECT id FROM ` + table + ` WHERE conversation_id=? ORDER BY ` + order + ` LIMIT 100)`}
	if len(runs) > 0 {
		clauses = append(clauses, `run_id IN (?`+strings.Repeat(",?", len(runs)-1)+`)`)
		for _, run := range runs {
			args = append(args, run)
		}
	}
	if len(ids) > 0 {
		clauses = append(clauses, `id IN (?`+strings.Repeat(",?", len(ids)-1)+`)`)
		for _, id := range ids {
			args = append(args, id)
		}
	}
	return `conversation_id=? AND (` + strings.Join(clauses, " OR ") + `) ORDER BY ` + order, args
}

func (s *Store) AssistantPlans(conversation string, runs ...string) ([]AssistantPlan, error) {
	return s.AssistantPlansForSnapshot(conversation, runs, nil)
}

func (s *Store) AssistantPlansForSnapshot(conversation string, runs, ids []string) ([]AssistantPlan, error) {
	where, args := assistantActionHistory("assistant_action_plans", conversation, "updated_at DESC,created_at DESC,id DESC", runs, ids)
	query := `SELECT payload FROM assistant_action_plans WHERE ` + where
	if conversation == "" {
		query = `SELECT payload FROM assistant_action_plans WHERE status IN ('running','cancelling','unknown')`
		args = nil
	}
	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	plans := []AssistantPlan{}
	for rows.Next() {
		var payload string
		var p AssistantPlan
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(payload), &p); err != nil {
			return nil, err
		}
		plans = append(plans, p)
	}
	return plans, rows.Err()
}

func (s *Store) UpdateAssistantPlan(p AssistantPlan) error {
	p.UpdatedAt = time.Now().UnixMilli()
	payload, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`UPDATE assistant_action_plans SET status=?,payload=?,updated_at=? WHERE conversation_id=? AND id=?`, p.Status, string(payload), p.UpdatedAt, p.ConversationID, p.ID)
	return err
}

// DecideAssistantPlan atomically binds a decision to the immutable reviewed payload.
// An identical receipt returns the current outcome without scheduling work again.
func (s *Store) DecideAssistantPlan(conversation, id, request, fingerprint, decision, digest string, revision int) (AssistantPlan, bool, error) {
	var p AssistantPlan
	tx, err := s.DB.Begin()
	if err != nil {
		return p, false, err
	}
	defer tx.Rollback()
	var payload string
	if err := tx.QueryRow(`SELECT payload FROM assistant_action_plans WHERE conversation_id=? AND id=?`, conversation, id).Scan(&payload); err != nil {
		return p, false, err
	}
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		return p, false, err
	}
	if p.Revision != revision || p.Digest != digest {
		return p, false, ErrAssistantConflict
	}
	var previous string
	err = tx.QueryRow(`SELECT fingerprint FROM assistant_decisions WHERE conversation_id=? AND request_id=?`, conversation, request).Scan(&previous)
	if err == nil {
		if previous != fingerprint {
			return p, false, ErrAssistantConflict
		}
		return p, false, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return p, false, err
	}
	if p.Status != "pending" && !(decision == "cancel" && p.Status == "running") {
		return p, false, ErrAssistantConflict
	}
	if decision == "approve" {
		p.Status = "running"
		if len(p.Steps) > 0 {
			p.Steps[0].Status = "running"
		}
	} else if p.Status == "running" {
		p.Status = "cancelling"
	} else {
		p.Status = "cancelled"
		for i := range p.Steps {
			p.Steps[i].Status = "cancelled"
		}
	}
	p.UpdatedAt = time.Now().UnixMilli()
	raw, err := json.Marshal(p)
	if err != nil {
		return p, false, err
	}
	if _, err := tx.Exec(`INSERT INTO assistant_decisions(conversation_id,request_id,plan_id,fingerprint) VALUES(?,?,?,?)`, conversation, request, id, fingerprint); err != nil {
		return p, false, err
	}
	if _, err := tx.Exec(`UPDATE assistant_action_plans SET status=?,payload=?,updated_at=? WHERE id=?`, p.Status, string(raw), p.UpdatedAt, id); err != nil {
		return p, false, err
	}
	return p, true, tx.Commit()
}

func (s *Store) AddAssistantActivity(conversation, run, capability, status string, result any) error {
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO assistant_tool_calls(conversation_id,run_id,capability,status,result,created_at) VALUES(?,?,?,?,?,?)`, conversation, run, capability, status, string(data), time.Now().UnixMilli())
	return err
}

func (s *Store) AssistantActivities(conversation string, runs ...string) ([]AssistantActivity, error) {
	where, args := assistantActionHistory("assistant_tool_calls", conversation, "id DESC", runs, nil)
	rows, err := s.DB.Query(`SELECT id,run_id,capability,status,result,created_at FROM assistant_tool_calls WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AssistantActivity{}
	for rows.Next() {
		var v AssistantActivity
		var result string
		if err := rows.Scan(&v.ID, &v.RunID, &v.Capability, &v.Status, &result, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Result = json.RawMessage(result)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Store) AssistantRunContext(conversation, run string) (json.RawMessage, error) {
	var raw string
	err := s.DB.QueryRow(`SELECT context FROM assistant_run_contexts WHERE conversation_id=? AND run_id=?`, conversation, run).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return json.RawMessage(`{}`), nil
	}
	return json.RawMessage(raw), err
}
