package project

import (
	"database/sql"
	"errors"
	"net/http"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/store"
)

type projectRemoval struct {
	Name     string                          `json:"name"`
	Sessions []store.ProjectSessionReference `json:"sessions"`
}

func (a *Service) ProjectRemovalHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := a.Execution.Store.Project(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "项目不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	references, err := a.Execution.Store.ProjectSessionReferences(r.Context(), id)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, projectRemoval{Name: p.Name, Sessions: references})

}

func (a *Service) RemoveProjectHandler(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	p, err := a.Execution.Store.Project(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "项目不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	unlock := a.lockGit(p.CommonDir)
	defer unlock()

	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	// Deleting registration clears only the foreign key. Each associated
	// conversation retains its directory, access choice and history.
	removed, err := a.Execution.Store.RemoveProject(r.Context(), id)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if !removed {
		httpx.WriteError(w, 404, "项目不存在")
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "已移除项目登记；仓库、分支、Worktree 和对话目录均保留"})
}
