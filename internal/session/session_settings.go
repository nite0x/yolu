package session

import (
	"fmt"
	"strings"
)

type TurnSettings struct {
	Model      string `json:"model,omitempty"`
	Effort     string `json:"effort,omitempty"`
	Mode       string `json:"mode,omitempty"`
	Permission string `json:"permission,omitempty"`
}

func newConversationSettings(settings TurnSettings, defaults conversationPreferences) TurnSettings {
	if settings.Permission == "" {
		settings.Permission = defaults.Permission
	}
	if settings.Model == "" {
		settings.Model = defaults.Model
	}
	return settings
}

func (s TurnSettings) validate() error {
	if s.Permission != "" && s.Permission != "ask" && s.Permission != "auto" && s.Permission != "full" {
		return fmt.Errorf("不支持的权限模式")
	}
	if len(s.Model) > 200 {
		return fmt.Errorf("模型名称过长")
	}
	if s.Mode != "" && s.Mode != "plan" && s.Mode != "default" {
		return fmt.Errorf("不支持的工作模式")
	}
	if s.Effort != "" && !strings.Contains("|none|minimal|low|medium|high|xhigh|max|ultra|", "|"+s.Effort+"|") {
		return fmt.Errorf("不支持的思考强度")
	}
	return nil
}
