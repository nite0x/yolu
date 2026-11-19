package model

import (
	"errors"
	"strings"
)

const AssistantQueryOnly = "query"

// AssistantSettings applies to an individual management assistant turn.
// An empty permission preserves the existing reviewed-change workflow.
type AssistantSettings struct {
	Model      string `json:"model,omitempty"`
	Permission string `json:"permission,omitempty"`
}

func (s AssistantSettings) Validate() error {
	if len(s.Model) > 200 || strings.TrimSpace(s.Model) != s.Model {
		return errors.New("助手模型无效")
	}
	if s.Permission != "" && s.Permission != AssistantQueryOnly {
		return errors.New("助手权限无效")
	}
	return nil
}
