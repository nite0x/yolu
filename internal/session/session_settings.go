package session

import (
	"fmt"
	"strings"
)

type TurnSettings struct {
	Model                string `json:"model,omitempty"`
	Effort               string `json:"effort,omitempty"`
	Mode                 string `json:"mode,omitempty"`
	Permission           string `json:"permission,omitempty"`
	ServiceTier          string `json:"serviceTier,omitempty"`
	UseModelEffort       bool   `json:"useModelEffort,omitempty"`
	UseDefaultSpeed      bool   `json:"useDefaultSpeed,omitempty"`
	UseDefaultPermission bool   `json:"useDefaultPermission,omitempty"`
}

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

func (s TurnSettings) validateForModel(selected *chatModel) error {
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

func (s TurnSettings) validate() error {
	if s.Permission != "" && s.Permission != "ask" && s.Permission != "auto" && s.Permission != "full" {
		return fmt.Errorf("不支持的权限模式")
	}
	if len(s.Model) > 200 {
		return fmt.Errorf("模型名称过长")
	}
	if len(s.ServiceTier) > 100 || strings.TrimSpace(s.ServiceTier) != s.ServiceTier {
		return fmt.Errorf("不支持的响应速度")
	}
	if s.Mode != "" && !strings.Contains("|plan|default|accept-edits|auto|ask|code|architect|", "|"+s.Mode+"|") {
		return fmt.Errorf("不支持的工作模式")
	}
	if s.Effort != "" && !strings.Contains("|none|minimal|low|medium|high|xhigh|max|ultra|", "|"+s.Effort+"|") {
		return fmt.Errorf("不支持的思考强度")
	}
	return nil
}
