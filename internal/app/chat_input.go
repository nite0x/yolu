package app

import (
	"net/http"

	"worktree-hub/internal/httpx"
)

const uiSendShortcutKey = "ui_send_shortcut:v1"

func (a *App) uiSendShortcut() string {
	var value string
	if err := a.Workspace.Store.DB.QueryRow(`SELECT value FROM settings WHERE key=?`, uiSendShortcutKey).Scan(&value); err == nil && value == "ctrlEnter" {
		return value
	}
	return "enter"
}

func (a *App) chatInputHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		var input struct {
			SendShortcut string `json:"send_shortcut"`
		}
		if !httpx.Decode(w, r, &input) {
			return
		}
		if input.SendShortcut != "enter" && input.SendShortcut != "ctrlEnter" {
			httpx.WriteError(w, http.StatusBadRequest, "Unsupported send shortcut")
			return
		}
		if _, err := a.Workspace.Store.DB.ExecContext(r.Context(), `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, uiSendShortcutKey, input.SendShortcut); err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"send_shortcut": a.uiSendShortcut()})
}
