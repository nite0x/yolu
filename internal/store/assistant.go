package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

type AssistantConversation struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Environment string `json:"environment_id"`
	Title       string `json:"title"`
	Updated     int64  `json:"updated_at"`
	Activity    string `json:"activity,omitempty"`
}
type AssistantMessage struct {
	ID    int64  `json:"id"`
	RunID string `json:"run_id"`
	Role  string `json:"role"`
	Text  string `json:"text"`
}
type AssistantRun struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversation_id"`
	Input          string `json:"-"`
	Status         string `json:"status"`
	Error          string `json:"error_code"`
}

var ErrAssistantConflict = errors.New("assistant request conflict")

func (s *Store) migrateAssistant() error {
	_, err := s.DB.Exec(`
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
UPDATE assistant_runs SET status='interrupted',error_code='interrupted' WHERE status='running';`)
	if err != nil {
		return err
	}
	return s.migrateAssistantActions()
}
func (s *Store) CreateAssistant(id string) error {
	now := time.Now().UnixMilli()
	_, err := s.DB.Exec(`INSERT OR IGNORE INTO assistant_conversations(id,title,created_at,updated_at) VALUES(?,'',?,?)`, id, now, now)
	return err
}
func (s *Store) AssistantConversations() ([]AssistantConversation, error) {
	rows, err := s.DB.Query(`
SELECT c.id,c.title,c.updated_at,
 CASE
  WHEN EXISTS (SELECT 1 FROM assistant_action_plans WHERE conversation_id=c.id AND status='pending') THEN 'waiting'
  WHEN EXISTS (SELECT 1 FROM assistant_runs WHERE conversation_id=c.id AND status='running')
    OR EXISTS (SELECT 1 FROM assistant_action_plans WHERE conversation_id=c.id AND status IN ('running','cancelling')) THEN 'running'
  ELSE ''
 END
FROM assistant_conversations c ORDER BY c.updated_at DESC,c.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AssistantConversation{}
	for rows.Next() {
		v := AssistantConversation{Kind: "yolu", Environment: "local"}
		if err := rows.Scan(&v.ID, &v.Title, &v.Updated, &v.Activity); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) AssistantMessages(id string, before int64, limit int) ([]AssistantMessage, error) {
	var exists string
	if err := s.DB.QueryRow(`SELECT id FROM assistant_conversations WHERE id=?`, id).Scan(&exists); err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(`SELECT id,run_id,role,text FROM (SELECT id,run_id,role,text FROM assistant_messages WHERE conversation_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT ?) ORDER BY id`, id, before, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AssistantMessage{}
	for rows.Next() {
		var v AssistantMessage
		if err := rows.Scan(&v.ID, &v.RunID, &v.Role, &v.Text); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Store) AssistantRun(conversation, id string) (AssistantRun, error) {
	var v AssistantRun
	err := s.DB.QueryRow(`SELECT id,conversation_id,input,status,error_code FROM assistant_runs WHERE conversation_id=? AND id=?`, conversation, id).Scan(&v.ID, &v.ConversationID, &v.Input, &v.Status, &v.Error)
	return v, err
}
func (s *Store) LatestAssistantRun(conversation string) (*AssistantRun, error) {
	var id string
	err := s.DB.QueryRow(`SELECT run_id FROM assistant_messages WHERE conversation_id=? AND role='user' ORDER BY id DESC LIMIT 1`, conversation).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v, err := s.AssistantRun(conversation, id)
	return &v, err
}

// BeginAssistantRun commits intent before contacting the model. The partial
// unique index also protects callers that bypass the service's runtime lock.
func (s *Store) BeginAssistantRun(conversation, id, text string, selection ...json.RawMessage) (AssistantRun, bool, error) {
	v, err := s.AssistantRun(conversation, id)
	if err == nil {
		if v.Input != text {
			return v, false, ErrAssistantConflict
		}
		if len(selection) > 0 {
			previous, err := s.AssistantRunContext(conversation, id)
			if err != nil {
				return v, false, err
			}
			if string(previous) != string(selection[0]) {
				return v, false, ErrAssistantConflict
			}
		}
		return v, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return v, false, err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return v, false, err
	}
	defer tx.Rollback()
	var active int
	if err := tx.QueryRow(`SELECT count(*) FROM assistant_runs WHERE conversation_id=? AND status='running'`, conversation).Scan(&active); err != nil {
		return v, false, err
	}
	if active > 0 {
		return v, false, ErrAssistantConflict
	}
	v = AssistantRun{ID: id, ConversationID: conversation, Input: text, Status: "running"}
	if _, err := tx.Exec(`INSERT INTO assistant_runs(id,conversation_id,input,status) VALUES(?,?,?,'running')`, id, conversation, text); err != nil {
		return v, false, err
	}
	if len(selection) > 0 {
		if _, err := tx.Exec(`INSERT INTO assistant_run_contexts(conversation_id,run_id,context) VALUES(?,?,?)`, conversation, id, string(selection[0])); err != nil {
			return v, false, err
		}
	}
	if _, err := tx.Exec(`INSERT INTO assistant_messages(conversation_id,run_id,role,text) VALUES(?,?,'user',?)`, conversation, id, text); err != nil {
		return v, false, err
	}
	title := []rune(text)
	title = title[:min(len(title), 60)]
	if _, err := tx.Exec(`UPDATE assistant_conversations SET updated_at=?,title=CASE WHEN title='' THEN ? ELSE title END WHERE id=?`, time.Now().UnixMilli(), string(title), conversation); err != nil {
		return v, false, err
	}
	return v, true, tx.Commit()
}
func (s *Store) FinishAssistantRun(conversation, id, status, code, output string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`UPDATE assistant_runs SET status=?,error_code=? WHERE conversation_id=? AND id=? AND status='running'`, status, code, conversation, id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return tx.Commit()
	}
	if output != "" {
		if _, err := tx.Exec(`INSERT INTO assistant_messages(conversation_id,run_id,role,text) VALUES(?,?,'assistant',?)`, conversation, id, output); err != nil {
			return err
		}
	}
	_, err = tx.Exec(`UPDATE assistant_conversations SET updated_at=? WHERE id=?`, time.Now().UnixMilli(), conversation)
	if err != nil {
		return err
	}
	return tx.Commit()
}
