package session

import (
	"fmt"

	"worktree-hub/internal/apitypes"
)

type TurnSettings = apitypes.TurnSettings

func newConversationSettings(settings TurnSettings, defaults conversationPreferences) TurnSettings {
	if settings.Permission == "" && !settings.UseDefaultPermission {
		settings.Permission = defaults.Permission
	}
	// Effort and speed are choices for the saved default model.
	if settings.Model == "" || settings.Model == defaults.Model {
		if settings.Effort == "" && !settings.UseModelEffort {
			settings.Effort = defaults.Effort
		}
		if settings.ServiceTier == "" && !settings.UseDefaultSpeed {
			settings.ServiceTier = defaults.ServiceTier
		}
	}
	if settings.Model == "" {
		settings.Model = defaults.Model
	}
	return settings
}

func validateSettingsForModel(s TurnSettings, selected *chatModel) error {
	if s.ServiceTier != "" {
		supported := false
		for _, tier := range selected.ServiceTiers {
			supported = supported || tier.ID == s.ServiceTier
		}
		if !supported {
			return fmt.Errorf("所选模型不支持该响应速度")
		}
	}
	if s.Effort != "" {
		for _, effort := range selected.Efforts {
			if effort.Effort == s.Effort {
				return nil
			}
		}
		return fmt.Errorf("所选模型不支持该思考强度")
	}
	return nil
}
