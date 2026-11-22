package app

import (
	"net/http"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
)

func (a *App) secureHandler(next http.Handler) http.Handler {
	return httpx.Handler(a.token, func() bool { return a.Execution.ReadOnlySessions }, func() bool { return a.Execution.Closing.Load() }, func(r *http.Request) bool {
		return isBrowserRequest(r) || httpx.IsLocalHost(r.Host)
	}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isBrowserRequest(r) && (r.URL.Path == "/healthz" || strings.HasPrefix(r.URL.Path, "/api/service/") || r.URL.Path == "/api/dialogs/directory") {
			httpx.WriteError(w, http.StatusForbidden, "请在主机上的 Yolu 中执行此操作")
			return
		}
		if a.Execution.Remote != nil {
			r = r.WithContext(execution.WithClient(r.Context(), a.Execution.Remote))
		}
		if a.environments != nil && strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/api/environments") && !strings.HasPrefix(r.URL.Path, "/api/voice/") && r.URL.Path != "/api/workspace-inventory" && r.URL.Path != "/api/dialogs/directory" && r.URL.Path != "/api/resource-icons" && r.URL.Path != "/api/settings/language" && r.URL.Path != "/api/settings/chat-input" && r.URL.Path != "/api/settings/browser-access" {
			if id := r.Header.Get("X-Environment-ID"); id != "" && id != "local" {
				app, err := a.environments.get(id)
				if err != nil {
					httpx.WriteError(w, 503, err.Error())
					return
				}
				app.handler().ServeHTTP(w, r)
				return
			}
		}
		next.ServeHTTP(w, r)
	}))
}
