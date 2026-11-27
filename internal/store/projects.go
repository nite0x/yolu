package store

import (
	"context"
	"worktree-hub/internal/model"
)

func (s *Store) ProjectMap() (map[string]model.Project, error) {
	ps, err := s.Projects()
	if err != nil {
		return nil, err
	}
	out := map[string]model.Project{}
	for _, p := range ps {
		out[p.ID] = p
	}
	return out, nil
}

const projectColumns = "id,name,path,common_dir,folder,created_at"

func scanProject(scan func(...any) error) (model.Project, error) {
	var p model.Project
	err := scan(&p.ID, &p.Name, &p.Path, &p.CommonDir, &p.Folder, &p.CreatedAt)
	return p, err
}

func (s *Store) Project(ctx context.Context, id string) (model.Project, error) {
	return scanProject(s.DB.QueryRowContext(ctx, "SELECT "+projectColumns+" FROM projects WHERE id=?", id).Scan)
}

func (s *Store) ProjectIDForRepository(ctx context.Context, common string) (id string, err error) {
	err = s.DB.QueryRowContext(ctx, "SELECT id FROM projects WHERE common_dir=?", common).Scan(&id)
	return
}

func (s *Store) RegistrationExists(ctx context.Context, common, name, folder string) (exists bool, err error) {
	err = s.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE common_dir=? OR name=? COLLATE NOCASE OR folder=? COLLATE NOCASE)`, common, name, folder).Scan(&exists)
	return
}

func (s *Store) InsertProject(ctx context.Context, p model.Project) error {
	_, err := s.DB.ExecContext(ctx, "INSERT INTO projects("+projectColumns+") VALUES(?,?,?,?,?,?)", p.ID, p.Name, p.Path, p.CommonDir, p.Folder, p.CreatedAt)
	return err
}

func (s *Store) RemoveProject(ctx context.Context, id string) (bool, error) {
	result, err := s.DB.ExecContext(ctx, "DELETE FROM projects WHERE id=?", id)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}

type ProjectSessionReference struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *Store) ProjectSessionReferences(ctx context.Context, id string) ([]ProjectSessionReference, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT DISTINCT s.id,s.name FROM sessions AS s
		JOIN session_project_bindings AS b ON b.session_id=s.id
		WHERE b.project_id=? ORDER BY s.name,s.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	references := []ProjectSessionReference{}
	for rows.Next() {
		var ref ProjectSessionReference
		if err := rows.Scan(&ref.ID, &ref.Name); err != nil {
			return nil, err
		}
		references = append(references, ref)
	}
	return references, rows.Err()
}
