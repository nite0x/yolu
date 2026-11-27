package session

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

type ChatContext struct {
	ActivePermissionProfile *codexPermissionProfile `json:"activePermissionProfile,omitempty"`
	Model                   string                  `json:"model"`
	Effort                  string                  `json:"reasoningEffort"`
	Mode                    string                  `json:"mode,omitempty"`
	ServiceTier             string                  `json:"serviceTier,omitempty"`
	Cwd                     string                  `json:"cwd"`
	ApprovalPolicy          any                     `json:"approvalPolicy,omitempty"`
	ApprovalsReviewer       string                  `json:"approvalsReviewer,omitempty"`
	Sandbox                 any                     `json:"sandbox,omitempty"`
	AdditionalDirectories   []string                `json:"additional_directories"`
}
type chatModel = model.ChatModel

func (a *Service) ChatOptionsHandler(w http.ResponseWriter, r *http.Request) {
	provider := r.URL.Query().Get("provider")
	if !model.SupportedProvider(provider) {
		httpx.WriteError(w, 400, "不支持的对话引擎")
		return
	}
	provider = model.NormalizeProvider(provider)
	if model.IsACPProvider(provider) {
		httpx.WriteJSON(w, 200, a.acpChatOptions(r.Context(), provider))
		return
	}
	defaults, err := a.conversationPreferences(r.Context())
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	c, err := a.openSessions(r.Context())
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	defer c.Close()
	models, err := codex.ListModels(c.Call)
	if err != nil {
		httpx.WriteError(w, 503, "无法读取可用模型："+err.Error())
		return
	}
	var modes struct {
		Data []struct {
			Mode string `json:"mode"`
		} `json:"data"`
	}
	modeNames := []string{}
	if c.Call("collaborationMode/list", map[string]any{}, &modes) == nil {
		for _, m := range modes.Data {
			if m.Mode == "plan" || m.Mode == "default" {
				modeNames = append(modeNames, m.Mode)
			}
		}
	}
	httpx.WriteJSON(w, 200, map[string]any{"provider": provider, "models": models, "modes": modeNames, "defaults": defaults, "capabilities": model.CapabilitiesForProvider(provider)})
}
func (a *Service) ChatContextHandler(w http.ResponseWriter, r *http.Request) {
	record, ok := a.requestSession(w, r)
	if !ok {
		return
	}
	if record.Provider == model.ProviderCodexCloud {
		cloud, err := a.Execution.Store.CodexCloudSession(record.ID)
		if err != nil {
			httpx.DbError(w, err)
			return
		}
		httpx.WriteJSON(w, 200, ChatContext{Cwd: record.Cwd, Model: cloud.Model})
		return
	}
	if model.IsACPProvider(model.NormalizeProvider(record.Provider)) {
		result := ChatContext{Cwd: record.Cwd, AdditionalDirectories: record.AdditionalDirectories}
		if run := a.ChatFor(record.ID); run != nil {
			state := run.snapshot()
			if state.Context != nil {
				result = *state.Context
			}
		}
		httpx.WriteJSON(w, 200, result)
		return
	}
	c, err := a.openSessions(r.Context())
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	defer c.Close()
	s, err := codex.ReadSession(c, record.ID)
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	// Reading a context must never resume or mutate a thread owned by another client.
	result := ChatContext{Model: s.Model, Effort: s.Effort, Cwd: s.Cwd, AdditionalDirectories: record.AdditionalDirectories}
	switch record.Permission {
	case "full":
		result.ApprovalPolicy = "never"
		result.ApprovalsReviewer = "user"
		result.Sandbox = map[string]any{"type": "dangerFullAccess"}
	case "auto":
		result.ApprovalPolicy = "on-request"
		result.ApprovalsReviewer = "auto_review"
		result.Sandbox = map[string]any{"type": "workspaceWrite"}
	case "ask":
		result.ApprovalPolicy = "on-request"
		result.ApprovalsReviewer = "user"
		result.Sandbox = map[string]any{"type": "workspaceWrite"}
	}
	if run := a.ChatFor(record.ID); run != nil {
		state := run.snapshot()
		if state.Context != nil && state.Busy {
			result = *state.Context
		}
	}
	httpx.WriteJSON(w, 200, result)
}
func (a *Service) applyTurnSettings(ctx context.Context, c codex.LiveClient, params map[string]any, settings TurnSettings, currentModel, currentEffort string) error {
	if err := settings.Validate(); err != nil {
		return err
	}
	if settings.Model == "" && settings.Effort == "" && settings.Mode == "" && settings.ServiceTier == "" {
		return nil
	}
	call := func(method string, p any, out any) error {
		ctx, end := context.WithTimeout(ctx, 10*time.Second)
		defer end()
		return c.Call(ctx, method, p, out)
	}
	models, err := codex.ListModels(call)
	if err != nil {
		return fmt.Errorf("无法核对模型设置：%w", err)
	}
	model := settings.Model
	if model == "" {
		model = currentModel
	}
	selected := findConversationModel(models, model)
	if selected == nil {
		return fmt.Errorf("当前模型不可用，请重新选择模型")
	}
	model = selected.Model
	if err := validateSettingsForModel(settings, selected); err != nil {
		return err
	}
	if settings.ServiceTier != "" {
		params["serviceTierForTurn"] = settings.ServiceTier
	}
	if settings.Model != "" {
		params["model"] = model
	}
	if settings.Effort != "" {
		params["effort"] = settings.Effort
	}
	if settings.Model != "" && settings.Model != currentModel && settings.Effort == "" {
		params["effort"] = selected.DefaultEffort
	}
	if settings.Mode != "" {
		var modes struct {
			Data []struct {
				Mode string `json:"mode"`
			} `json:"data"`
		}
		if err := call("collaborationMode/list", map[string]any{}, &modes); err != nil {
			return fmt.Errorf("无法核对工作模式：%w", err)
		}
		supported := false
		for _, m := range modes.Data {
			supported = supported || m.Mode == settings.Mode
		}
		if !supported {
			return fmt.Errorf("当前 Codex 不支持所选工作模式")
		}
		var effort any = selected.DefaultEffort
		if settings.Effort != "" {
			effort = settings.Effort
		} else if settings.Model == "" || settings.Model == currentModel {
			for _, e := range selected.Efforts {
				if e.Effort == currentEffort {
					effort = currentEffort
					break
				}
			}
		}
		params["collaborationMode"] = map[string]any{"mode": settings.Mode, "settings": map[string]any{"model": model, "reasoning_effort": effort, "developer_instructions": nil}}
	}
	return nil
}
