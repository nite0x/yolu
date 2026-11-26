package app

import (
	"context"
	"net/http"

	"worktree-hub/internal/httpx"
	"worktree-hub/web"
)

const uiColorThemeKey = "ui_color_theme:v1"

// Appearance belongs to this application database, independently of the
// selected execution environment or the sidecar's current HTTP port.
func (a *App) uiColorTheme() string {
	if value, err := a.Execution.Store.Setting(context.Background(), uiColorThemeKey); err == nil && web.ValidColorTheme(value) {
		return value
	}
	return "mint"
}

func (a *App) appearanceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		var input struct {
			ColorTheme string `json:"color_theme"`
		}
		if !httpx.Decode(w, r, &input) {
			return
		}
		if !web.ValidColorTheme(input.ColorTheme) {
			httpx.WriteError(w, http.StatusBadRequest, "Unsupported color theme")
			return
		}
		if err := a.Execution.Store.SaveSetting(r.Context(), uiColorThemeKey, input.ColorTheme); err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"color_theme": a.uiColorTheme()})
}
