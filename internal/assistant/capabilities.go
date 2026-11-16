package assistant

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"worktree-hub/internal/store"
)

type Resource = store.AssistantResource

type CapabilityError struct {
	Code    string   `json:"code"`
	Message string   `json:"message"`
	Details []string `json:"details,omitempty"`
}

func (e *CapabilityError) Error() string { return e.Message }

type ExecutionResult struct {
	Data      any                   `json:"data,omitempty"`
	Resources []Resource            `json:"resources"`
	Status    string                `json:"status"`
	Steps     []store.AssistantStep `json:"steps,omitempty"`
}

// Review produces resolved, immutable arguments. Only the decision endpoint can
// invoke Execute, which must revalidate that review under the domain write lock.
type Capability struct {
	Name        string                                                                `json:"name"`
	Description string                                                                `json:"description"`
	InputSchema map[string]any                                                        `json:"input_schema"`
	Mutation    bool                                                                  `json:"requires_approval"`
	Read        func(context.Context, json.RawMessage) (any, error)                   `json:"-"`
	Review      func(context.Context, json.RawMessage) (any, error)                   `json:"-"`
	Execute     func(context.Context, json.RawMessage) (ExecutionResult, error)       `json:"-"`
	Reconcile   func(context.Context, json.RawMessage) (ExecutionResult, bool, error) `json:"-"`
	Progress    func(context.Context, json.RawMessage) (ExecutionResult, bool, error) `json:"-"`
	schema      *jsonschema.Schema
}

type Registry struct{ capabilities map[string]Capability }

func NewRegistry() *Registry { return &Registry{capabilities: map[string]Capability{}} }

func (r *Registry) Register(c Capability) error {
	if !dynamicToolName.MatchString(c.Name) || c.Description == "" || (c.Mutation && (c.Review == nil || c.Execute == nil)) || (!c.Mutation && c.Read == nil) {
		return fmt.Errorf("invalid assistant capability %s", c.Name)
	}
	if _, exists := r.capabilities[c.Name]; exists {
		return fmt.Errorf("duplicate assistant capability %s", c.Name)
	}
	compiler := jsonschema.NewCompiler()
	location := "https://yolu.invalid/capabilities/" + c.Name
	raw, err := json.Marshal(c.InputSchema)
	if err != nil {
		return err
	}
	document, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return err
	}
	if err := compiler.AddResource(location, document); err != nil {
		return err
	}
	schema, err := compiler.Compile(location)
	if err != nil {
		return err
	}
	c.schema = schema
	r.capabilities[c.Name] = c
	return nil
}

func (r *Registry) Definitions() []Capability {
	out := make([]Capability, 0, len(r.capabilities))
	for _, c := range r.capabilities {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (r *Registry) Tools(readOnly bool) []ToolDefinition {
	tools := []ToolDefinition{}
	for _, c := range r.Definitions() {
		if readOnly && c.Mutation {
			continue
		}
		tools = append(tools, ToolDefinition{Name: c.Name, Description: c.Description, InputSchema: c.InputSchema})
	}
	return tools
}

func (r *Registry) Validate(name string, raw json.RawMessage) (Capability, json.RawMessage, error) {
	c, ok := r.capabilities[name]
	if !ok {
		return c, nil, &CapabilityError{Code: "unknown_capability", Message: "请求的应用能力不存在。"}
	}
	if len(raw) > 64000 {
		return c, nil, &CapabilityError{Code: "invalid_input", Message: "请求参数过长。"}
	}
	value, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil || c.schema.Validate(value) != nil {
		return c, nil, &CapabilityError{Code: "invalid_input", Message: "参数与应用能力的格式要求不匹配，请重新查询资源并选择有效参数。"}
	}
	canonical, err := json.Marshal(value)
	return c, canonical, err
}

func withFreshness(result any) any {
	if resource, ok := result.(Resource); ok {
		return map[string]any{"resources": []Resource{resource}, "refreshed_at": time.Now().UnixMilli()}
	}
	if v, ok := result.(map[string]any); ok {
		v["refreshed_at"] = time.Now().UnixMilli()
		return v
	}
	return map[string]any{"data": result, "refreshed_at": time.Now().UnixMilli()}
}
