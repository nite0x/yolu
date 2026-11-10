package project

import (
	"database/sql"
	"errors"
	"net/http"
	"slices"

	"worktree-hub/internal/httpx"
)

type projectReference struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
}

type projectRemoval struct {
	Name         string             `json:"name"`
	Requirements []projectReference `json:"requirements"`
}

type removalQuery interface {
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
}

func readProjectRemoval(db removalQuery, id string) (projectRemoval, error) {
	plan := projectRemoval{Requirements: []projectReference{}}
	if err := db.QueryRow(`SELECT name FROM projects WHERE id=?`, id).Scan(&plan.Name); err != nil {
		return plan, err
	}
	rows, err := db.Query(`SELECT id,name,state FROM requirements WHERE primary_project_id=? OR id IN (SELECT requirement_id FROM members WHERE project_id=?) ORDER BY id`, id, id)
	if err != nil {
		return plan, err
	}
	defer rows.Close()
	for rows.Next() {
		var ref projectReference
		if err := rows.Scan(&ref.ID, &ref.Name, &ref.State); err != nil {
			return plan, err
		}
		plan.Requirements = append(plan.Requirements, ref)
	}
	return plan, rows.Err()
}

func (a *Service) ProjectRemovalHandler(w http.ResponseWriter, r *http.Request) {
	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	plan, err := readProjectRemoval(a.Workspace.Store.DB, r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "项目不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, plan)
}

func (a *Service) RemoveProjectHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Requirements []string `json:"requirements"`
	}
	detach := r.URL.Query().Get("detach") == "1"
	if detach && !httpx.Decode(w, r, &input) {
		return
	}
	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	tx, err := a.Workspace.Store.DB.Begin()
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	defer tx.Rollback()
	id := r.PathValue("id")
	plan, err := readProjectRemoval(tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "项目不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	expected := []string{}
	for _, ref := range plan.Requirements {
		expected = append(expected, ref.ID)
	}
	if !detach && len(expected) > 0 {
		httpx.WriteError(w, 409, "项目仍有关联任务，请保留登记以便追溯")
		return
	}
	slices.Sort(input.Requirements)
	if detach && !slices.Equal(input.Requirements, expected) {
		httpx.WriteError(w, 409, "项目关联已变化，请关闭弹窗后重新检查")
		return
	}
	for _, ref := range plan.Requirements {
		if ref.State == "creating" {
			httpx.WriteError(w, 409, "关联工作区正在准备中，请完成后再移除项目")
			return
		}
	}
	if _, err := tx.Exec(`DELETE FROM members WHERE project_id=?`, id); err != nil {
		httpx.DbError(w, err)
		return
	}
	// Repair launch preferences without changing archived or remaining member states.
	if _, err := tx.Exec(`UPDATE requirements SET primary_project_id=(SELECT project_id FROM members WHERE requirement_id=requirements.id ORDER BY project_id LIMIT 1) WHERE primary_project_id=?`, id); err != nil {
		httpx.DbError(w, err)
		return
	}
	for _, ref := range plan.Requirements {
		if _, err := tx.Exec(`UPDATE requirements SET state=CASE WHEN EXISTS(SELECT 1 FROM members WHERE requirement_id=? AND state!='ready') THEN 'partial' ELSE 'ready' END WHERE id=? AND state!='archived'`, ref.ID, ref.ID); err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	if _, err := tx.Exec(`DELETE FROM projects WHERE id=?`, id); err != nil {
		httpx.DbError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.DbError(w, err)
		return
	}
	warning := ""
	if a.TaskContextUpdated != nil {
		for _, ref := range plan.Requirements {
			q, err := a.Workspace.Store.Requirement(ref.ID)
			if err == nil {
				err = a.TaskContextUpdated(r.Context(), q)
			}
			if err != nil {
				warning += ref.Name + "：" + err.Error() + "\n"
			}
		}
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "已移除项目登记并解除工作区关联；仓库、分支、Worktree 和对话均保留", "context_warning": warning})
}
