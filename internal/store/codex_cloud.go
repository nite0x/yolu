package store

import (
	"database/sql"

	"worktree-hub/internal/model"
)

type CodexCloudSession struct {
	ThreadID    string
	Identity    string
	Environment string
	Model       string
}

type CodexCloudListing struct {
	Session model.Session
	Cloud   CodexCloudSession
	Named   bool
}

func saveCodexCloudLink(tx *sql.Tx, id string, cloud CodexCloudSession) error {
	return MustAffected(tx.Exec(`INSERT INTO codex_cloud_sessions(session_id,thread_id,account_identity,environment_name,model)
	 VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET
	 environment_name=COALESCE(NULLIF(excluded.environment_name,''),codex_cloud_sessions.environment_name),
	 model=COALESCE(NULLIF(excluded.model,''),codex_cloud_sessions.model)
	 WHERE codex_cloud_sessions.account_identity=excluded.account_identity AND codex_cloud_sessions.thread_id=excluded.thread_id`,
		id, cloud.ThreadID, cloud.Identity, cloud.Environment, cloud.Model))
}

// Commit the cloud association and the idempotency receipt together.
func (s *Store) SaveCodexCloudSession(session model.Session, cloud CodexCloudSession, request string) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := saveSession(tx, session); err != nil {
		return err
	}
	if err := saveCodexCloudLink(tx, session.ID, cloud); err != nil {
		return err
	}
	if err := MustAffected(tx.Exec(`UPDATE conversation_create_requests SET session_id=? WHERE request_id=?`, session.ID, request)); err != nil {
		return err
	}
	return tx.Commit()
}

// SaveCodexCloudListings preserves Yolu's local names and archive actions.
func (s *Store) SaveCodexCloudListings(entries []CodexCloudListing, archived bool, observedAt int64) error {
	if len(entries) == 0 {
		return nil
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, entry := range entries {
		v := entry.Session
		if _, err := tx.Exec(`INSERT INTO sessions(id,name,cwd,created_at,updated_at,source,provider,last_synced_at)
		 VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
		 name=CASE WHEN excluded.name<>'' AND sessions.title_source<>'manual' AND
		 (sessions.name='' OR (? AND sessions.title_changed_at<?)) THEN excluded.name ELSE sessions.name END,
		 cwd=COALESCE(NULLIF(excluded.cwd,''),sessions.cwd),
		 created_at=COALESCE(NULLIF(excluded.created_at,0),sessions.created_at),
		 updated_at=MAX(sessions.updated_at,excluded.updated_at),
		 last_synced_at=excluded.last_synced_at`,
			v.ID, v.Name, v.Cwd, v.CreatedAt, v.UpdatedAt, v.Source, v.Provider, observedAt/1e9, entry.Named, observedAt); err != nil {
			return err
		}
		if err := saveCodexCloudLink(tx, v.ID, entry.Cloud); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO session_organization(session_id,archived) VALUES(?,?)
		 ON CONFLICT(session_id) DO UPDATE SET archived=excluded.archived WHERE session_organization.updated_at=0`,
			v.ID, archived); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) CodexCloudSession(id string) (CodexCloudSession, error) {
	var result CodexCloudSession
	err := s.DB.QueryRow(`SELECT thread_id,account_identity,environment_name,model FROM codex_cloud_sessions WHERE session_id=?`, id).Scan(&result.ThreadID, &result.Identity, &result.Environment, &result.Model)
	return result, err
}

func (s *Store) HasCodexCloudSessions() (bool, error) {
	var exists bool
	err := s.DB.QueryRow(`SELECT EXISTS(SELECT 1 FROM codex_cloud_sessions)`).Scan(&exists)
	return exists, err
}
