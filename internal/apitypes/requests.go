// Package apitypes defines transport contracts shared by the backend and generated TypeScript.
package apitypes

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

type DirectoryBindingInput struct {
	SessionID   string `json:"session_id,omitempty"`
	Provider    string `json:"provider,omitempty"`
	ProjectID   string `json:"project_id,omitempty"`
	Directory   string `json:"directory,omitempty"`
	Role        string `json:"role,omitempty"`
	Access      string `json:"access,omitempty"`
	AllowShared bool   `json:"allow_shared,omitempty"`
}

type CreateSessionInput struct {
	Text        string                  `json:"text"`
	Project     string                  `json:"project_id"`
	Cwd         string                  `json:"cwd"`
	RequestID   string                  `json:"request_id"`
	Purpose     string                  `json:"purpose"`
	MergeHead   string                  `json:"merge_head"`
	Provider    string                  `json:"provider"`
	Images      []string                `json:"images"`
	Settings    TurnSettings            `json:"settings"`
	Bindings    []DirectoryBindingInput `json:"bindings,omitempty"`
	Access      string                  `json:"access,omitempty"`
	AllowShared bool                    `json:"allow_shared,omitempty"`
}

func (s TurnSettings) Validate() error {
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
