package app

import (
	"context"
	"net/http"

	"worktree-hub/internal/httpx"
)

const uiSendShortcutKey = "ui_send_shortcut:v1"

func (a *App) uiSendShortcut() string {
	if value, err := a.Execution.Store.Setting(context.Background(), uiSendShortcutKey); err == nil && value == "ctrlEnter" {
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
		if err := a.Execution.Store.SaveSetting(r.Context(), uiSendShortcutKey, input.SendShortcut); err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"send_shortcut": a.uiSendShortcut()})
}
