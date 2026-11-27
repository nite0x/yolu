package session

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/agy"
	"worktree-hub/internal/cursor"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

func (a *Service) openACP(ctx context.Context, provider string, flags ...string) (acp.Client, acp.InitializeResult, error) {
	if provider == model.ProviderCursor {
		if a.openCursor == nil {
			return nil, acp.InitializeResult{}, fmt.Errorf("Cursor Agent 不可用")
		}
		return a.openCursor(ctx, flags...)
	}
	return a.openAgy(ctx, flags...)
}
func (a *Service) acpFlags(provider, permission string, directories []string) []string {
	if provider == model.ProviderCursor {
		return cursor.ACPFlagsForPermission(permission, directories)
	}
	return agy.ACPFlagsForPermission(permission, directories)
}
func acpLoginAdvice(provider string) string {
	if provider == model.ProviderCursor {
		return "Cursor 尚未登录，请先在终端运行 cursor-agent login 完成登录"
	}
	return "Antigravity 尚未登录，请先在终端运行 agy 或 agy acp --login 完成登录"
}
func (a *Service) acpCatalogFromSetup(provider string, setup acp.SessionSetupResult) acp.OptionCatalog {
	if provider == model.ProviderCursor {
		return acp.CatalogFromSetup(setup)
	}
	return agy.CatalogFromSetup(setup)
}
func (a *Service) cursorOptionsCatalog(ctx context.Context, refresh bool) (acp.OptionCatalog, error) {
	fallback := acp.OptionCatalog{Models: []model.ChatModel{}, Modes: []string{"agent", "plan", "ask"}}
	if a.Execution.Remote != nil {
		return fallback, fmt.Errorf("暂不支持在远端 WSL 环境运行 Cursor 对话")
	}
	a.cursorCatalogMu.Lock()
	defer a.cursorCatalogMu.Unlock()
	cached := a.cursorCatalog
	if cached != nil && !refresh {
		return *cached, nil
	}
	catalog, err := cursor.DiscoverCatalog(ctx, a.openCursor)
	if err != nil {
		if cached != nil {
			return *cached, err
		}
		return fallback, err
	}
	fallback = catalog
	a.cursorCatalog = &fallback
	return fallback, nil
}
func (a *Service) CursorDiagnosticsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if a.Execution.Remote != nil {
		var report cursor.Diagnostics
		if err := a.Execution.Remote.Call(ctx, execution.Request{Op: "cursor-diagnostics"}, &report); err != nil {
			httpx.WriteError(w, 503, "无法在远端环境执行 Cursor 检测："+err.Error())
			return
		}
		httpx.WriteJSON(w, 200, report)
		return
	}
	httpx.WriteJSON(w, 200, cursor.Diagnose(ctx, a.openCursor))
}
