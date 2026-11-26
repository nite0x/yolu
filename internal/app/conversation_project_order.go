package app

import (
	"encoding/json"
	"net/http"

	"worktree-hub/internal/httpx"
)

const conversationProjectOrderKey = "conversation_project_order:v1"

func (a *App) conversationProjectOrder() []string {
	var value string
	var order []string
	if err := a.Execution.Store.DB.QueryRow(`SELECT value FROM settings WHERE key=?`, conversationProjectOrderKey).Scan(&value); err == nil {
		if err := json.Unmarshal([]byte(value), &order); err == nil {
			return order
		}
	}
	return nil
}

func (a *App) saveConversationProjectOrder(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Order []string `json:"order"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	value, _ := json.Marshal(input.Order)
	if _, err := a.Execution.Store.DB.ExecContext(r.Context(), `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, conversationProjectOrderKey, string(value)); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, input)
}
