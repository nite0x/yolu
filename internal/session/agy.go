package session

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"worktree-hub/internal/agy"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

func (a *Service) AgyDiagnosticsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if a.Execution.Remote != nil {
		var report agy.Diagnostics
		if err := a.Execution.Remote.Call(ctx, execution.Request{Op: "agy-diagnostics"}, &report); err != nil {
			httpx.WriteError(w, 503, "无法在远端环境执行 Antigravity 检测："+err.Error())
			return
		}
		httpx.WriteJSON(w, 200, report)
		return
	}
	httpx.WriteJSON(w, 200, a.diagnoseAgy(ctx))
}

func (a *Service) acpOptionsCatalog(ctx context.Context, provider string, refresh bool) (agy.OptionCatalog, error) {
	if provider == model.ProviderCursor {
		return a.cursorOptionsCatalog(ctx, refresh)
	}
	fallback := agy.OptionCatalog{Models: []codex.ChatModel{}, Modes: agy.DefaultModes}
	if a.Execution.Remote != nil {
		return fallback, fmt.Errorf("暂不支持在远端 WSL 环境运行 Antigravity 对话")
	}
	a.agyCatalogMu.Lock()
	cached := a.agyCatalog
	a.agyCatalogMu.Unlock()
	if cached != nil && !refresh {
		return *cached, nil
	}
	catalog, err := agy.DiscoverCatalog(ctx, a.openAgy)
	if err == nil && len(catalog.Models) > 0 {
		a.agyCatalogMu.Lock()
		a.agyCatalog = &catalog
		a.agyCatalogMu.Unlock()
		return catalog, nil
	}
	if cached != nil {
		return *cached, err
	}
	if models := agy.ListCLIModels(ctx); len(models) > 0 {
		fallback.Models = models
		return fallback, nil
	}
	return fallback, err
}
