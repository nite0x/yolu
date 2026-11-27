package session

import (
	"database/sql"
	"errors"
	"net/http"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

// The creation default is independent of each provider's model and permissions.
func (a *Service) DefaultAgentHandler(w http.ResponseWriter, r *http.Request) {
	const key = "conversation_default_agent:v1"
	settings := struct {
		Provider string `json:"provider"`
	}{}
	if r.Method == http.MethodGet {
		provider, err := a.Execution.Store.Setting(r.Context(), key)
		settings.Provider = model.NormalizeProvider(provider)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			httpx.DbError(w, err)
			return
		}
	} else {
		if !httpx.Decode(w, r, &settings) {
			return
		}
		if settings.Provider == "" || !model.SupportedProvider(settings.Provider) {
			httpx.WriteError(w, http.StatusBadRequest, "不支持的对话引擎")
			return
		}
		if err := a.Execution.Store.SaveSetting(r.Context(), key, settings.Provider); err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, settings)
}
