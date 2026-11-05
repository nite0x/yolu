package app

import (
	"database/sql"
	"errors"
	"net/http"

	"worktree-hub/internal/httpx"
)

const uiLanguageKey = "ui_language:v1"

// Language is local application metadata, shared across execution environments
// and independent of the ephemeral HTTP port used by the desktop sidecar.
func (a *App) uiLanguage() string {
	var value string
	err := a.Workspace.Store.DB.QueryRow(`SELECT value FROM settings WHERE key=?`, uiLanguageKey).Scan(&value)
	if err != nil || (value != "en" && value != "zh-CN") {
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
		_, err := a.Workspace.Store.DB.ExecContext(r.Context(), `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, uiLanguageKey, input.Language)
		if err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	var value string
	err := a.Workspace.Store.DB.QueryRowContext(r.Context(), `SELECT value FROM settings WHERE key=?`, uiLanguageKey).Scan(&value)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"language": a.uiLanguage()})
}
