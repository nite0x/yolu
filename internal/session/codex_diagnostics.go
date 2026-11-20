package session

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
)

func (a *Service) CodexDiagnosticsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if a.Execution.Remote != nil {
		var report codex.Diagnostics
		if err := a.Execution.Remote.Call(ctx, execution.Request{Op: "codex-diagnostics"}, &report); err != nil {
			httpx.WriteError(w, 503, "无法在 WSL 环境执行检测："+err.Error())
			return
		}
		httpx.WriteJSON(w, 200, report)
		return
	}
	httpx.WriteJSON(w, 200, a.codexInstaller.Diagnose(ctx, a.openSessions))
}

func (a *Service) CodexInstallHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && a.Execution.Remote == nil {
		httpx.WriteJSON(w, http.StatusOK, a.codexInstaller.State())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	request := execution.Request{Op: "codex-install-status"}
	var plan codex.InstallPlan
	if r.Method == http.MethodPost {
		if a.Execution.ReadOnlySessions {
			httpx.WriteError(w, http.StatusMethodNotAllowed, "只读模式下无法安装或升级 Codex")
			return
		}
		if !httpx.DecodeLimit(w, r, &plan, 16<<10) {
			return
		}
		request.Op = "codex-install"
		request.Params, _ = json.Marshal(plan)
	}
	var state codex.InstallState
	var err error
	if a.Execution.Remote != nil {
		err = a.Execution.Remote.Call(ctx, request, &state)
	} else {
		state, err = a.codexInstaller.Start(plan)
	}
	if err != nil {
		status := http.StatusConflict
		if r.Method != http.MethodPost {
			status = http.StatusServiceUnavailable
		}
		httpx.WriteError(w, status, err.Error())
		return
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusAccepted
	}
	httpx.WriteJSON(w, status, state)
}
