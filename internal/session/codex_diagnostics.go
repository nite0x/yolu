package session

import (
	"context"
	"net/http"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/workspace"
)

func (a *Service) CodexDiagnosticsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if a.Workspace.Remote != nil {
		var report codex.Diagnostics
		if err := a.Workspace.Remote.Call(ctx, workspace.Request{Op: "codex-diagnostics"}, &report); err != nil {
			httpx.WriteError(w, 503, "无法在 WSL 环境执行检测："+err.Error())
			return
		}
		httpx.WriteJSON(w, 200, report)
		return
	}
	httpx.WriteJSON(w, 200, codex.Diagnose(ctx, a.openSessions))
}
