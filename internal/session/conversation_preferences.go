package session

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

// Empty fields inherit provider configuration. Preferences belong to this execution
// environment and are applied only when creating a conversation.
type conversationPreferences struct {
	Model      string `json:"model,omitempty"`
	Permission string `json:"permission,omitempty"`
}

func conversationPreferencesKey(provider string) string {
	if model.NormalizeProvider(provider) == model.ProviderAgy {
		return "conversation_defaults:v1:agy"
	}
	return "conversation_defaults:v1"
}

func (a *Service) conversationPreferences(ctx context.Context) (conversationPreferences, error) {
	return a.conversationPreferencesForProvider(ctx, model.ProviderCodex)
}

func (a *Service) conversationPreferencesForProvider(ctx context.Context, provider string) (conversationPreferences, error) {
	var settings conversationPreferences
	var raw string
	err := a.Execution.Store.DB.QueryRowContext(ctx, `SELECT value FROM settings WHERE key=?`, conversationPreferencesKey(provider)).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return settings, nil
	}
	if err != nil {
		return settings, err
	}
	if err := json.Unmarshal([]byte(raw), &settings); err != nil {
		return settings, err
	}
	return settings, (TurnSettings{Model: settings.Model, Permission: settings.Permission}).validate()
}

func (a *Service) conversationModels(ctx context.Context) ([]chatModel, error) {
	c, err := a.openSessions(ctx)
	if err != nil {
		return nil, err
	}
	defer c.Close()
	return codex.ListModels(c.Call)
}

func availableConversationModel(models []chatModel, model string) bool {
	for _, candidate := range models {
		if candidate.Model == model {
			return true
		}
	}
	return false
}

func (a *Service) ConversationPreferencesHandler(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	if !model.SupportedProvider(provider) {
		httpx.WriteError(w, http.StatusBadRequest, "不支持的对话引擎")
		return
	}
	provider = model.NormalizeProvider(provider)
	key := conversationPreferencesKey(provider)
	if r.Method == http.MethodGet {
		settings, err := a.conversationPreferencesForProvider(r.Context(), provider)
		if err != nil {
			httpx.DbError(w, err)
			return
		}
		if provider == model.ProviderAgy {
			opts := a.agyChatOptions(r.Context())
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"provider": provider, "settings": settings, "models": opts["models"]})
			return
		}
		models, err := a.conversationModels(r.Context())
		result := map[string]any{"provider": provider, "settings": settings, "models": models}
		if err != nil {
			// Keep saved preferences editable so an offline CLI cannot prevent
			// restoring native defaults or changing the permission preference.
			result["models"] = []chatModel{}
			result["models_error"] = fmt.Sprintf("无法读取可用模型：%v", err)
		}
		httpx.WriteJSON(w, http.StatusOK, result)
		return
	}
	var settings conversationPreferences
	if !httpx.Decode(w, r, &settings) {
		return
	}
	settings.Model = strings.TrimSpace(settings.Model)
	if err := (TurnSettings{Model: settings.Model, Permission: settings.Permission}).validate(); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if settings.Model != "" && provider == model.ProviderCodex {
		models, err := a.conversationModels(r.Context())
		if err != nil {
			httpx.WriteError(w, http.StatusServiceUnavailable, "无法核对默认模型："+err.Error())
			return
		}
		if !availableConversationModel(models, settings.Model) {
			httpx.WriteError(w, http.StatusBadRequest, "请选择当前 Codex 可用的模型，或沿用 Codex 默认模型")
			return
		}
	}
	raw, _ := json.Marshal(settings)
	if _, err := a.Execution.Store.DB.ExecContext(r.Context(), `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, string(raw)); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"provider": provider, "settings": settings})
}
