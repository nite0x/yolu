package acp

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

const ProtocolVersion = 1

type RPCError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *RPCError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("ACP RPC error %d", e.Code)
}

func IsAuthRequired(err error) bool {
	if err == nil {
		return false
	}
	var rpcErr *RPCError
	if errors.As(err, &rpcErr) {
		if rpcErr.Code == -32000 {
			return true
		}
		lower := strings.ToLower(rpcErr.Message)
		if strings.Contains(lower, "auth") || strings.Contains(lower, "login") {
			return true
		}
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "authentication required") || strings.Contains(lower, "not authenticated")
}

type Message struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
}

type ClientInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type AgentInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type PromptCapabilities struct {
	Image           bool `json:"image"`
	Audio           bool `json:"audio"`
	EmbeddedContext bool `json:"embeddedContext"`
}

type SessionCapabilities struct {
	List                  json.RawMessage `json:"list,omitempty"`
	Load                  json.RawMessage `json:"load,omitempty"`
	Resume                json.RawMessage `json:"resume,omitempty"`
	Close                 json.RawMessage `json:"close,omitempty"`
	Fork                  json.RawMessage `json:"fork,omitempty"`
	AdditionalDirectories json.RawMessage `json:"additionalDirectories,omitempty"`
}

type AgentCapabilities struct {
	LoadSession         bool                `json:"loadSession"`
	PromptCapabilities  PromptCapabilities  `json:"promptCapabilities"`
	SessionCapabilities SessionCapabilities `json:"sessionCapabilities"`
	Meta                json.RawMessage     `json:"_meta,omitempty"`
}

type AuthMethod struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type InitializeResult struct {
	ProtocolVersion   int               `json:"protocolVersion"`
	AgentCapabilities AgentCapabilities `json:"agentCapabilities"`
	AgentInfo         AgentInfo         `json:"agentInfo"`
	AuthMethods       []AuthMethod      `json:"authMethods,omitempty"`
}

type SessionSummary struct {
	SessionID string          `json:"sessionId"`
	Cwd       string          `json:"cwd"`
	Title     string          `json:"title,omitempty"`
	UpdatedAt json.RawMessage `json:"updatedAt,omitempty"`
	CreatedAt json.RawMessage `json:"createdAt,omitempty"`
}

type SessionListResult struct {
	Sessions   []SessionSummary `json:"sessions"`
	NextCursor *string          `json:"nextCursor,omitempty"`
}

type ModeInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type ModesState struct {
	CurrentModeID  string     `json:"currentModeId"`
	AvailableModes []ModeInfo `json:"availableModes,omitempty"`
}

type ModelInfo struct {
	ModelID     string `json:"modelId"`
	ID          string `json:"id,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type ModelsState struct {
	CurrentModelID  string      `json:"currentModelId"`
	AvailableModels []ModelInfo `json:"availableModels,omitempty"`
}

type ConfigOptionValue struct {
	Value       string `json:"value"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type ConfigOptionGroup struct {
	Group   string              `json:"group,omitempty"`
	Name    string              `json:"name,omitempty"`
	Options []ConfigOptionValue `json:"options,omitempty"`
}

type ConfigOption struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Description  string          `json:"description,omitempty"`
	Category     string          `json:"category,omitempty"`
	Type         string          `json:"type,omitempty"`
	CurrentValue string          `json:"currentValue,omitempty"`
	Options      json.RawMessage `json:"options,omitempty"`
}

// FlatOptions extracts selectable values whether ACP encodes options as a flat
// array of values or grouped option buckets.
func (o ConfigOption) FlatOptions() []ConfigOptionValue {
	if len(o.Options) == 0 || string(o.Options) == "null" {
		return nil
	}
	var raw []json.RawMessage
	if err := json.Unmarshal(o.Options, &raw); err != nil {
		return nil
	}
	out := make([]ConfigOptionValue, 0, len(raw))
	for _, item := range raw {
		var group ConfigOptionGroup
		if json.Unmarshal(item, &group) == nil && len(group.Options) > 0 {
			out = append(out, group.Options...)
			continue
		}
		var val ConfigOptionValue
		if json.Unmarshal(item, &val) == nil && val.Value != "" {
			out = append(out, val)
		}
	}
	return out
}

type SessionSetupResult struct {
	SessionID     string         `json:"sessionId"`
	Modes         *ModesState    `json:"modes,omitempty"`
	Models        *ModelsState   `json:"models,omitempty"`
	ConfigOptions []ConfigOption `json:"configOptions,omitempty"`
}

type PromptResult struct {
	StopReason string `json:"stopReason"`
}

type ContentBlock struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Data     string `json:"data,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	URI      string `json:"uri,omitempty"`
}

type ToolCallLocation struct {
	Path string `json:"path"`
	Line *int   `json:"line,omitempty"`
}

type ToolCallContent struct {
	Type    string        `json:"type"`
	Content *ContentBlock `json:"content,omitempty"`
	Path    string        `json:"path,omitempty"`
	OldText *string       `json:"oldText,omitempty"`
	NewText string        `json:"newText,omitempty"`
	Text    string        `json:"text,omitempty"`
}

type PlanEntry struct {
	Content  string `json:"content"`
	Priority string `json:"priority,omitempty"`
	Status   string `json:"status,omitempty"`
}

type SessionUpdateEnvelope struct {
	SessionID string        `json:"sessionId"`
	Update    SessionUpdate `json:"update"`
}

type SessionUpdate struct {
	SessionUpdate string             `json:"sessionUpdate"`
	Type          string             `json:"type,omitempty"`
	MessageID     string             `json:"messageId,omitempty"`
	Content       json.RawMessage    `json:"content,omitempty"`
	ToolCallID    string             `json:"toolCallId,omitempty"`
	Title         string             `json:"title,omitempty"`
	Name          string             `json:"name,omitempty"`
	Kind          string             `json:"kind,omitempty"`
	Status        string             `json:"status,omitempty"`
	RawInput      json.RawMessage    `json:"rawInput,omitempty"`
	RawOutput     json.RawMessage    `json:"rawOutput,omitempty"`
	Locations     []ToolCallLocation `json:"locations,omitempty"`
	Entries       []PlanEntry        `json:"entries,omitempty"`
	CurrentModeID string             `json:"currentModeId,omitempty"`
	ConfigOptions []ConfigOption     `json:"configOptions,omitempty"`
	UpdatedAt     json.RawMessage    `json:"updatedAt,omitempty"`
}

func (u SessionUpdate) KindName() string {
	if u.SessionUpdate != "" {
		return u.SessionUpdate
	}
	return u.Type
}

type PermissionOption struct {
	OptionID string `json:"optionId"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
}

type PermissionToolCall struct {
	ToolCallID string             `json:"toolCallId,omitempty"`
	ID         string             `json:"id,omitempty"`
	Title      string             `json:"title,omitempty"`
	Kind       string             `json:"kind,omitempty"`
	Status     string             `json:"status,omitempty"`
	RawInput   json.RawMessage    `json:"rawInput,omitempty"`
	Locations  []ToolCallLocation `json:"locations,omitempty"`
}

type PermissionRequest struct {
	SessionID  string              `json:"sessionId"`
	ToolCallID string              `json:"toolCallId,omitempty"`
	ToolCall   *PermissionToolCall `json:"toolCall,omitempty"`
	Options    []PermissionOption  `json:"options"`
}

func ParseTimestamp(raw json.RawMessage) int64 {
	if len(raw) == 0 || string(raw) == "null" {
		return 0
	}
	var num int64
	if json.Unmarshal(raw, &num) == nil && num > 0 {
		if num > 1_000_000_000_000 {
			return num / 1000
		}
		return num
	}
	var floatNum float64
	if json.Unmarshal(raw, &floatNum) == nil && floatNum > 0 {
		if floatNum > 1_000_000_000_000 {
			return int64(floatNum / 1000)
		}
		return int64(floatNum)
	}
	var text string
	if json.Unmarshal(raw, &text) == nil {
		text = strings.TrimSpace(text)
		if text == "" {
			return 0
		}
		if parsed, err := time.Parse(time.RFC3339Nano, text); err == nil {
			return parsed.Unix()
		}
		if parsed, err := time.Parse(time.RFC3339, text); err == nil {
			return parsed.Unix()
		}
		if n, err := strconv.ParseInt(text, 10, 64); err == nil && n > 0 {
			if n > 1_000_000_000_000 {
				return n / 1000
			}
			return n
		}
	}
	return 0
}
