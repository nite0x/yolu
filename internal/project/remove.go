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
	Name       string             `json:"name"`
	Workspaces []projectReference `json:"workspaces"`
}

type removalQuery interface {
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
}

func readProjectRemoval(db removalQuery, id string) (projectRemoval, error) {
	plan := projectRemoval{Workspaces: []projectReference{}}
	if err := db.QueryRow(`SELECT name FROM projects WHERE id=?`, id).Scan(&plan.Name); err != nil {
		return plan, err
	}
	rows, err := db.Query(`SELECT id,name,state FROM workspaces WHERE primary_project_id=? OR id IN (SELECT workspace_id FROM members WHERE project_id=?) ORDER BY id`, id, id)
	if err != nil {
		return plan, err
	}
	defer rows.Close()
	for rows.Next() {
		var ref projectReference
		if err := rows.Scan(&ref.ID, &ref.Name, &ref.State); err != nil {
			return plan, err
		}
		plan.Workspaces = append(plan.Workspaces, ref)
	}
	return plan, rows.Err()
}

func (a *Service) ProjectRemovalHandler(w http.ResponseWriter, r *http.Request) {
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	plan, err := readProjectRemoval(a.Execution.Store.DB, r.PathValue("id"))
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
		Workspaces []string `json:"workspaces"`
	}
	detach := r.URL.Query().Get("detach") == "1"
	if detach && !httpx.Decode(w, r, &input) {
		return
	}
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	tx, err := a.Execution.Store.DB.Begin()
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
	for _, ref := range plan.Workspaces {
		expected = append(expected, ref.ID)
	}
	if !detach && len(expected) > 0 {
		httpx.WriteError(w, 409, "项目仍有关联工作区，请保留登记以便追溯")
		return
	}
	slices.Sort(input.Workspaces)
	if detach && !slices.Equal(input.Workspaces, expected) {
		httpx.WriteError(w, 409, "项目关联已变化，请关闭弹窗后重新检查")
		return
	}
	for _, ref := range plan.Workspaces {
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
	if _, err := tx.Exec(`UPDATE workspaces SET primary_project_id=(SELECT project_id FROM members WHERE workspace_id=workspaces.id ORDER BY project_id LIMIT 1) WHERE primary_project_id=?`, id); err != nil {
		httpx.DbError(w, err)
		return
	}
	for _, ref := range plan.Workspaces {
		if _, err := tx.Exec(`UPDATE workspaces SET state=CASE WHEN EXISTS(SELECT 1 FROM members WHERE workspace_id=? AND state!='ready') THEN 'partial' ELSE 'ready' END WHERE id=? AND state!='archived'`, ref.ID, ref.ID); err != nil {
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
	if a.WorkspaceContextUpdated != nil {
		for _, ref := range plan.Workspaces {
			q, err := a.Execution.Store.Workspace(ref.ID)
			if err == nil {
				err = a.WorkspaceContextUpdated(r.Context(), q)
			}
			if err != nil {
				warning += ref.Name + "：" + err.Error() + "\n"
			}
		}
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "已移除项目登记并解除工作区关联；仓库、分支、Worktree 和对话均保留", "context_warning": warning})
}
