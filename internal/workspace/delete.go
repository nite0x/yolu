package workspace

import (
	"database/sql"
	"errors"
	"net/http"

	"worktree-hub/internal/httpx"
)

// DeleteWorkspaceHandler removes only Yolu metadata, never working files or
// the independent session index / original Codex conversations.
func (a *Service) DeleteWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	q, err := a.Execution.Store.Workspace(r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "工作区不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if q.State == "creating" {
		httpx.WriteError(w, 409, "工作区正在准备中，请完成后再删除")
		return
	}
	tx, err := a.Execution.Store.DB.Begin()
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	defer tx.Rollback()
	for _, table := range []string{"workspace_session_pins", "session_create_requests", "workspace_sessions", "members"} {
		if _, err := tx.Exec(`DELETE FROM `+table+` WHERE workspace_id=?`, q.ID); err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	if _, err := tx.Exec(`DELETE FROM workspaces WHERE id=?`, q.ID); err != nil {
		httpx.DbError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "已删除工作区记录；目录、分支和原始对话均保留"})
}
