package app

import (
	"context"
	"encoding/json"
	"net/http"

	"worktree-hub/internal/httpx"
)

const conversationProjectOrderKey = "conversation_project_order:v1"

func (a *App) conversationProjectOrder() []string {
	var order []string
	if value, err := a.Execution.Store.Setting(context.Background(), conversationProjectOrderKey); err == nil {
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
	if err := a.Execution.Store.SaveSetting(r.Context(), conversationProjectOrderKey, string(value)); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, input)
}
