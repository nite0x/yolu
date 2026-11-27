package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"worktree-hub/internal/httpx"
)

const uiLanguageKey = "ui_language:v1"

// Language is local application metadata, shared across execution environments
// and independent of the ephemeral HTTP port used by the desktop sidecar.
func (a *App) uiLanguage() string {
	value, _ := a.Execution.Store.Setting(context.Background(), uiLanguageKey)
	return normalizeLanguage(value)
}

func normalizeLanguage(value string) string {
	if value != "en" && value != "zh-CN" {
		return "system"
	}
	return value
}

func (a *App) languageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		var input struct {
			Language string `json:"language"`
		}
		if !httpx.Decode(w, r, &input) {
			return
		}
		if input.Language != "en" && input.Language != "zh-CN" && input.Language != "system" {
			httpx.WriteError(w, http.StatusBadRequest, "Unsupported interface language")
			return
		}
		err := a.Execution.Store.SaveSetting(r.Context(), uiLanguageKey, input.Language)
		if err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	value, err := a.Execution.Store.Setting(r.Context(), uiLanguageKey)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"language": normalizeLanguage(value)})
}
