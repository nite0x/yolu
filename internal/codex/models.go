package codex

import "fmt"

type ChatModel struct {
	ID            string             `json:"id"`
	Model         string             `json:"model"`
	Name          string             `json:"displayName"`
	Default       bool               `json:"isDefault"`
	DefaultEffort string             `json:"defaultReasoningEffort"`
	ServiceTiers  []ModelServiceTier `json:"serviceTiers,omitempty"`
	Efforts       []struct {
		Effort string `json:"reasoningEffort"`
	} `json:"supportedReasoningEfforts"`
}

type ModelServiceTier struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ListModels reads the complete model catalog from the current Codex runtime.
func ListModels(call func(string, any, any) error) ([]ChatModel, error) {
	models := []ChatModel{}
	params := map[string]any{}
	seen := map[string]bool{}
	for {
		var page struct {
			Data []ChatModel `json:"data"`
			Next *string     `json:"nextCursor"`
		}
		if err := call("model/list", params, &page); err != nil {
			return nil, err
		}
		models = append(models, page.Data...)
		if page.Next == nil {
			return models, nil
		}
		if seen[*page.Next] {
			return nil, fmt.Errorf("模型分页未前进")
		}
		seen[*page.Next] = true
		params["cursor"] = *page.Next
	}
}
