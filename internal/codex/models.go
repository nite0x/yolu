package codex

import (
	"fmt"
	"worktree-hub/internal/model"
)

// ListModels reads the complete model catalog from the current Codex runtime.
func ListModels(call func(string, any, any) error) ([]model.ChatModel, error) {
	models := []model.ChatModel{}
	params := map[string]any{}
	seen := map[string]bool{}
	for {
		var page struct {
			Data []model.ChatModel `json:"data"`
			Next *string           `json:"nextCursor"`
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
