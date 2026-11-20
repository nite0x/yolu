package store

import "fmt"

// Upgrade saved records before creating the current schema. SQLite updates
// foreign keys and indexes along with the renamed tables and columns.
func (s *Store) renameWorkspaceSchema() error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, rename := range []struct{ old, current string }{
		{"requirements", "workspaces"},
		{"requirement_sessions", "workspace_sessions"},
		{"task_session_pins", "workspace_session_pins"},
	} {
		columns, err := tableColumns(tx, rename.old)
		if err != nil {
			return err
		}
		if len(columns) > 0 {
			if _, err := tx.Exec("ALTER TABLE " + rename.old + " RENAME TO " + rename.current); err != nil {
				return fmt.Errorf("rename workspace table %s: %w", rename.old, err)
			}
		}
	}
	for _, rename := range []struct{ table, old, current string }{
		{"workspaces", "has_workspace", "has_directory"},
		{"members", "requirement_id", "workspace_id"},
		{"workspace_sessions", "requirement_id", "workspace_id"},
		{"session_create_requests", "requirement_id", "workspace_id"},
		{"workspace_session_pins", "requirement_id", "workspace_id"},
	} {
		columns, err := tableColumns(tx, rename.table)
		if err != nil {
			return err
		}
		if columns[rename.old] {
			if _, err := tx.Exec("ALTER TABLE " + rename.table + " RENAME COLUMN " + rename.old + " TO " + rename.current); err != nil {
				return fmt.Errorf("rename workspace column %s.%s: %w", rename.table, rename.old, err)
			}
		}
	}
	return tx.Commit()
}

// A launch preference is optional and must always refer to a current member.
const repairWorkspacePrimary = `UPDATE workspaces SET primary_project_id=(
 SELECT project_id FROM members WHERE workspace_id=workspaces.id ORDER BY project_id LIMIT 1
) WHERE primary_project_id IS NULL OR NOT EXISTS (
 SELECT 1 FROM members WHERE workspace_id=workspaces.id AND project_id=primary_project_id
)`

func (s *Store) finishWorkspaceMigration() error {
	var required int
	if err := s.DB.QueryRow(`SELECT "notnull" FROM pragma_table_info('workspaces') WHERE name='primary_project_id'`).Scan(&required); err != nil {
		return err
	}
	if required != 0 {
		// Rebuild the parent under the same name; dependent tables, workspace IDs and
		// saved workspace paths are preserved. Foreign keys are restored on error.
		if _, err := s.DB.Exec(`PRAGMA foreign_keys=OFF`); err != nil {
			return err
		}
		err := s.makeWorkspacePrimaryOptional()
		_, restoreErr := s.DB.Exec(`PRAGMA foreign_keys=ON`)
		if err != nil {
			return err
		}
		if restoreErr != nil {
			return restoreErr
		}
	}
	if _, err := s.DB.Exec(repairWorkspacePrimary); err != nil {
		return err
	}
	return s.migrateSessions()
}

func (s *Store) makeWorkspacePrimaryOptional() error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`CREATE TABLE workspaces_optional (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
 description TEXT NOT NULL, branch TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
 primary_project_id TEXT REFERENCES projects(id), state TEXT NOT NULL,
 created_at TEXT NOT NULL, has_directory INTEGER NOT NULL DEFAULT 1);
INSERT INTO workspaces_optional SELECT id,name,slug,description,branch,path,primary_project_id,state,created_at,has_directory FROM workspaces;
DROP TABLE workspaces;
ALTER TABLE workspaces_optional RENAME TO workspaces;`)
	if err != nil {
		return fmt.Errorf("迁移工作区启动偏好失败：%w", err)
	}
	if _, err := tx.Exec(repairWorkspacePrimary); err != nil {
		return err
	}
	return tx.Commit()
}
