package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

const bindingColumns = `id,session_id,COALESCE(project_id,''),directory,branch,role,access,created_at,updated_at`

const sessionBindingSchema = `
CREATE TABLE IF NOT EXISTS session_project_bindings (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
 directory TEXT NOT NULL, directory_key TEXT NOT NULL,
 branch TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('primary','additional')),
 access TEXT NOT NULL CHECK(access IN ('read','write')),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(session_id,directory_key));
CREATE UNIQUE INDEX IF NOT EXISTS session_primary_binding
 ON session_project_bindings(session_id) WHERE role='primary';
CREATE INDEX IF NOT EXISTS session_binding_project ON session_project_bindings(project_id,session_id);
CREATE INDEX IF NOT EXISTS session_binding_directory ON session_project_bindings(directory_key,session_id);
CREATE TABLE IF NOT EXISTS migration_recovery (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, record_key TEXT NOT NULL,
 reason TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE(kind,record_key));`

var ErrSessionBindingDuplicate = errors.New("directory is already associated with this conversation")

// Directory identity is scoped to the execution environment. Callers resolve
// symlinks in that environment before persisting a directory.
func bindingDirectoryKey(directory string) string {
	directory = platform.CleanWorkspacePath(directory)
	if runtime.GOOS == "windows" && !strings.HasPrefix(directory, "/") {
		return strings.ToLower(directory)
	}
	return directory
}

func (s *Store) SessionBindings(id string) ([]model.SessionProjectBinding, error) {
	return s.queryBindings(`WHERE session_id=? ORDER BY role DESC,created_at,id`, id)
}

func (s *Store) BindingsWithinDirectory(path string) ([]model.SessionProjectBinding, error) {
	key := bindingDirectoryKey(path)
	separator := string(filepath.Separator)
	if strings.HasPrefix(key, "/") {
		separator = "/"
	}
	prefix := strings.TrimSuffix(key, separator) + separator
	return s.queryBindings(
		`WHERE directory_key=? OR substr(directory_key,1,length(?))=? ORDER BY session_id,id`,
		key, prefix, prefix,
	)
}

func (s *Store) queryBindings(where string, args ...any) ([]model.SessionProjectBinding, error) {
	rows, err := s.DB.Query(`SELECT `+bindingColumns+` FROM session_project_bindings `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.SessionProjectBinding{}
	for rows.Next() {
		var b model.SessionProjectBinding
		if err := rows.Scan(&b.ID, &b.SessionID, &b.ProjectID, &b.Directory, &b.Branch, &b.Role, &b.Access, &b.CreatedAt, &b.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) SessionDirectoriesForProject(projectID string, paths ...string) (map[string][]string, error) {
	keys := make([]string, len(paths))
	for i, path := range paths {
		keys[i] = bindingDirectoryKey(path)
	}
	raw, err := json.Marshal(keys)
	if err != nil {
		return nil, err
	}
	rows, err := s.DB.Query(`SELECT session_id,directory FROM session_project_bindings
 WHERE project_id=? OR directory_key IN (SELECT value FROM json_each(?)) ORDER BY directory`, projectID, string(raw))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	directories := map[string][]string{}
	for rows.Next() {
		var id, directory string
		if err := rows.Scan(&id, &directory); err != nil {
			return nil, err
		}
		directories[id] = append(directories[id], directory)
	}
	return directories, rows.Err()
}

func (s *Store) SessionBindingsManaged(id string) (bool, error) {
	var managed bool
	err := s.DB.QueryRow(`SELECT bindings_managed FROM sessions WHERE id=?`, id).Scan(&managed)
	return managed, err
}

func markSessionBindingsManaged(tx *sql.Tx, id string) error {
	return MustAffected(tx.Exec(`UPDATE sessions SET bindings_managed=1 WHERE id=?`, id))
}

// InsertSessionBindings saves all initial bindings together. An empty set
// marks an explicitly projectless conversation as managed.
func (s *Store) InsertSessionBindings(id string, bindings []model.SessionProjectBinding) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := insertSessionBindings(tx, id, bindings); err != nil {
		return err
	}
	return tx.Commit()
}

func insertSessionBindings(tx *sql.Tx, id string, bindings []model.SessionProjectBinding) error {
	if err := markSessionBindingsManaged(tx, id); err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	for _, b := range bindings {
		b.ID, b.SessionID, b.CreatedAt, b.UpdatedAt = model.NewID(), id, now, now
		if err := insertSessionBinding(tx, b); err != nil {
			return err
		}
	}
	return nil
}

// BindSessionDirectory creates a binding when ID is empty and updates the
// identified binding otherwise. Primary selection moves atomically.
func (s *Store) BindSessionDirectory(b model.SessionProjectBinding) (model.SessionProjectBinding, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return b, err
	}
	defer tx.Rollback()
	if err := markSessionBindingsManaged(tx, b.SessionID); err != nil {
		return b, err
	}
	b.UpdatedAt = time.Now().UnixMilli()
	b.Directory = platform.CleanWorkspacePath(b.Directory)
	if !platform.AbsoluteWorkspacePath(b.Directory) {
		return b, fmt.Errorf("binding directory must be an absolute path")
	}
	key := bindingDirectoryKey(b.Directory)
	var existing string
	err = tx.QueryRow(`SELECT id FROM session_project_bindings WHERE session_id=? AND directory_key=?`, b.SessionID, key).Scan(&existing)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return b, err
	}
	if existing != "" && existing != b.ID {
		return b, ErrSessionBindingDuplicate
	}
	if b.Role == model.SessionBindingPrimary {
		if _, err := tx.Exec(`UPDATE session_project_bindings SET role='additional',updated_at=? WHERE session_id=? AND role='primary' AND id<>?`, b.UpdatedAt, b.SessionID, b.ID); err != nil {
			return b, err
		}
	}
	if b.ID == "" {
		b.ID, b.CreatedAt = model.NewID(), b.UpdatedAt
		err = insertSessionBinding(tx, b)
	} else {
		err = tx.QueryRow(`UPDATE session_project_bindings
 SET project_id=NULLIF(?,''),directory=?,directory_key=?,branch=?,role=?,access=?,updated_at=?
 WHERE session_id=? AND id=? RETURNING created_at`, b.ProjectID, b.Directory, key, b.Branch, b.Role, b.Access, b.UpdatedAt, b.SessionID, b.ID).Scan(&b.CreatedAt)
	}
	if err != nil {
		return b, err
	}
	return b, tx.Commit()
}

func insertSessionBinding(tx *sql.Tx, b model.SessionProjectBinding) error {
	directory := platform.CleanWorkspacePath(b.Directory)
	if !platform.AbsoluteWorkspacePath(directory) {
		return fmt.Errorf("binding directory must be an absolute path")
	}
	_, err := tx.Exec(`INSERT INTO session_project_bindings(id,session_id,project_id,directory,directory_key,branch,role,access,created_at,updated_at)
 VALUES(?,?,NULLIF(?,''),?,?,?,?,?,?,?)`, b.ID, b.SessionID, b.ProjectID, directory, bindingDirectoryKey(directory), b.Branch, b.Role, b.Access, b.CreatedAt, b.UpdatedAt)
	return err
}

func (s *Store) DeleteSessionBinding(sessionID, bindingID string) error {
	return MustAffected(s.DB.Exec(`DELETE FROM session_project_bindings WHERE session_id=? AND id=?`, sessionID, bindingID))
}
