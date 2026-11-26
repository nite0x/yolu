package store

import (
	"context"
	"database/sql"

	"worktree-hub/internal/model"
)

// ReserveCreation records intent before invoking a provider. A missing result
// is durable and must not be interpreted as permission to repeat the call.
func (s *Store) ReserveCreation(ctx context.Context, request, fingerprint string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO conversation_create_requests(request_id,fingerprint) VALUES(?,?)`, request, fingerprint)
	return err
}

func (s *Store) CreationReceipt(ctx context.Context, request string) (session, fingerprint string, err error) {
	err = s.DB.QueryRowContext(ctx, `SELECT session_id,fingerprint FROM conversation_create_requests WHERE request_id=?`, request).Scan(&session, &fingerprint)
	return
}

func completeCreation(ctx context.Context, db interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, request, result string) error {
	return MustAffected(db.ExecContext(ctx, `UPDATE conversation_create_requests SET session_id=? WHERE request_id=? AND session_id=''`, result, request))
}

func (s *Store) CompleteCreation(ctx context.Context, request, result string) error {
	return completeCreation(ctx, s.DB, request, result)
}

// SaveCreatedSession publishes the local index, directory state and receipt
// together after the provider returns. A nil bindings slice keeps native
// directory metadata unmanaged, including for forks of unmanaged threads.
func (s *Store) SaveCreatedSession(ctx context.Context, request string, session model.Session, bindings []model.SessionProjectBinding) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := saveSession(tx, session); err != nil {
		return err
	}
	if bindings != nil {
		if err := insertSessionBindings(tx, session.ID, bindings); err != nil {
			return err
		}
	} else if err := saveSessionDirectories(tx, session.ID, session.AdditionalDirectories); err != nil {
		return err
	}
	if err := completeCreation(ctx, tx, request, session.ID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) InputReceipt(ctx context.Context, session, request string) (fingerprint, status string, err error) {
	err = s.DB.QueryRowContext(ctx, `SELECT fingerprint,status FROM conversation_input_requests WHERE session_id=? AND request_id=?`, session, request).Scan(&fingerprint, &status)
	return
}

func (s *Store) ReserveInput(ctx context.Context, session, request, fingerprint string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO conversation_input_requests(session_id,request_id,fingerprint,status) VALUES(?,?,?,'pending')`, session, request, fingerprint)
	return err
}

func (s *Store) AcceptInput(ctx context.Context, session, request string) error {
	return acceptInput(ctx, s.DB, session, request)
}

func acceptInput(ctx context.Context, db interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, session, request string) error {
	return MustAffected(db.ExecContext(ctx, `UPDATE conversation_input_requests SET status='accepted' WHERE session_id=? AND request_id=?`, session, request))
}

// ConfirmCloudInput commits the acknowledgement and session activity together.
func (s *Store) ConfirmCloudInput(ctx context.Context, session, request string, updated int64) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := acceptInput(ctx, tx, session, request); err != nil {
		return err
	}
	if err := MustAffected(tx.ExecContext(ctx, `UPDATE sessions SET updated_at=MAX(updated_at,?) WHERE id=?`, updated, session)); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Draft(ctx context.Context, key string) (payload string, err error) {
	err = s.DB.QueryRowContext(ctx, `SELECT payload FROM conversation_drafts WHERE key=?`, key).Scan(&payload)
	return
}

func (s *Store) SaveDraft(ctx context.Context, key, payload string, updated int64) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO conversation_drafts(key,payload,updated_at) VALUES(?,?,?)
		ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at
		WHERE excluded.updated_at>=conversation_drafts.updated_at`, key, payload, updated)
	return err
}

type AsyncQuestionKey struct{ Item, Turn string }

func (s *Store) AsyncAnswer(ctx context.Context, session string, key AsyncQuestionKey) (fingerprint, status string, err error) {
	err = s.DB.QueryRowContext(ctx, `SELECT fingerprint,status FROM conversation_async_answers WHERE session_id=? AND item_id=? AND turn_id=?`, session, key.Item, key.Turn).Scan(&fingerprint, &status)
	return
}

func (s *Store) AsyncAnswerStatuses(ctx context.Context, session string) (map[AsyncQuestionKey]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT item_id,turn_id,status FROM conversation_async_answers WHERE session_id=?`, session)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	statuses := map[AsyncQuestionKey]string{}
	for rows.Next() {
		var key AsyncQuestionKey
		var status string
		if err := rows.Scan(&key.Item, &key.Turn, &status); err != nil {
			return nil, err
		}
		statuses[key] = status
	}
	return statuses, rows.Err()
}

func (s *Store) SaveAsyncAnswer(ctx context.Context, session string, key AsyncQuestionKey, request, fingerprint, status string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO conversation_async_answers(session_id,item_id,turn_id,fingerprint,status,request_id) VALUES(?,?,?,?,?,?)`, session, key.Item, key.Turn, fingerprint, status, request)
	return err
}

func (s *Store) AcceptAsyncAnswer(ctx context.Context, session, request string) error {
	return MustAffected(s.DB.ExecContext(ctx, `UPDATE conversation_async_answers SET status='accepted' WHERE session_id=? AND request_id=?`, session, request))
}

func (s *Store) TouchSession(ctx context.Context, session string, updated int64) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE sessions SET updated_at=? WHERE id=?`, updated, session)
	return err
}
