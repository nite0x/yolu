package app

import (
	"context"
	"crypto/subtle"
	"net/http"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/overview"
	"worktree-hub/internal/platform"
	"worktree-hub/web"
)

func (a *App) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Worktree-Hub-Instance")), []byte(a.token)) != 1 {
			httpx.WriteError(w, 403, "实例认证失败")
			return
		}
		info := a.desktopInfo("")
		info.Token = "" // Instance credentials never travel in the health response.
		httpx.WriteJSON(w, 200, info)
	})
	if a.shutdown != nil {
		mux.HandleFunc("POST /api/service/stop", a.stopServiceHandler)
	}
	if a.environments != nil {
		mux.HandleFunc("GET /api/environments", a.environments.listHandler)
		mux.HandleFunc("POST /api/environments", a.environments.addHandler)
		mux.HandleFunc("POST /api/environments/{environment}/reconnect", a.environments.reconnectHandler)
	}
	mux.Handle("GET /api/state", overview.New(a.Execution, a.Projects))
	mux.HandleFunc("POST /api/dialogs/directory", a.pickDirectoryHandler)
	mux.HandleFunc("GET /api/project-inventory", a.projectInventoryHandler)
	mux.HandleFunc("POST /api/issues/open-linear", func(w http.ResponseWriter, r *http.Request) {
		if isBrowserRequest(r) {
			httpx.WriteError(w, http.StatusForbidden, "请在浏览器中打开 Linear")
			return
		}
		if err := platform.OpenExternal("https://linear.app/"); err != nil {
			httpx.WriteError(w, http.StatusInternalServerError, "无法打开 Linear")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/resource-icons", a.resourceIconsHandler)
	mux.HandleFunc("PUT /api/resource-icons", a.resourceIconsHandler)
	mux.HandleFunc("GET /api/settings/language", a.languageHandler)
	mux.HandleFunc("PUT /api/settings/language", a.languageHandler)
	mux.HandleFunc("GET /api/settings/appearance", a.appearanceHandler)
	mux.HandleFunc("PUT /api/settings/appearance", a.appearanceHandler)
	mux.HandleFunc("PUT /api/settings/conversation-project-order", a.saveConversationProjectOrder)
	mux.HandleFunc("GET /api/settings/pane-layout", a.paneLayoutHandler)
	mux.HandleFunc("PUT /api/settings/pane-layout", a.paneLayoutHandler)
	mux.HandleFunc("GET /api/settings/chat-input", a.chatInputHandler)
	mux.HandleFunc("PUT /api/settings/chat-input", a.chatInputHandler)
	mux.HandleFunc("GET /api/settings/browser-access", a.browserAccessHandler)
	mux.HandleFunc("PUT /api/settings/browser-access", a.browserAccessHandler)
	mux.HandleFunc("GET "+mcpSettingsPath, a.mcpSettingsHandler)
	mux.HandleFunc("POST "+mcpSettingsPath, a.mcpSettingsHandler)
	mux.HandleFunc("POST "+memoryCallPath, a.memoryCallHandler)
	if a.voice != nil {
		a.voiceRoutes(mux)
	}
	a.Projects.RegisterRoutes(mux)
	a.Sessions.RegisterRoutes(mux)
	a.Execution.RegisterRoutes(mux)
	a.terminalRoutes(mux)
	mux.Handle("/", a.assetsHandler())
	return httpx.Diagnostics(a.secureHandler(mux))
}

func (a *App) assetsHandler() http.Handler {
	return web.Handler(a.token, a.Execution.ReadOnlySessions, func() web.UISettings {
		return web.UISettings{
			Language: a.uiLanguage(), ColorTheme: a.uiColorTheme(), SendShortcut: a.uiSendShortcut(),
			ConversationProjectOrder: a.conversationProjectOrder(),
			PaneLayout:               a.savedPaneLayout(context.Background(), defaultPaneLayoutCtx),
		}
	})
}
