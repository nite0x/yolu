package project

import (
	"database/sql"
	"errors"
	"net/http"

	"worktree-hub/internal/httpx"
)

type projectReference struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type projectRemoval struct {
	Name     string             `json:"name"`
	Sessions []projectReference `json:"sessions"`
}

func (a *Service) ProjectRemovalHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	plan := projectRemoval{Sessions: []projectReference{}}
	db := a.Execution.Store.DB
	err := db.QueryRowContext(r.Context(), `SELECT name FROM projects WHERE id=?`, id).Scan(&plan.Name)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "项目不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT DISTINCT s.id,s.name FROM sessions AS s
		JOIN session_project_bindings AS b ON b.session_id=s.id
		WHERE b.project_id=? ORDER BY s.name,s.id`, id)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var ref projectReference
		if err := rows.Scan(&ref.ID, &ref.Name); err != nil {
			httpx.DbError(w, err)
			return
		}
		plan.Sessions = append(plan.Sessions, ref)
	}
	if err := rows.Err(); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, plan)
}

func (a *Service) RemoveProjectHandler(w http.ResponseWriter, r *http.Request) {
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	// Deleting registration clears only the foreign key. Each associated
	// conversation retains its directory, access choice and history.
	result, err := a.Execution.Store.DB.ExecContext(r.Context(), `DELETE FROM projects WHERE id=?`, r.PathValue("id"))
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if count, _ := result.RowsAffected(); count == 0 {
		httpx.WriteError(w, 404, "项目不存在")
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "已移除项目登记；仓库、分支、Worktree 和对话目录均保留"})
}
