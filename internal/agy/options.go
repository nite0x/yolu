package agy

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/codex"
)

var DefaultModes = []string{"default", "plan", "accept-edits", "auto"}

type OptionCatalog struct {
	Models           []codex.ChatModel
	Modes            []string
	CurrentModel     string
	CurrentEffort    string
	CurrentMode      string
	ModelConfigID    string
	EffortConfigID   string
	ModeConfigID     string
	HasConfigOptions bool
}

func effortList(values []string) []struct {
	Effort string `json:"reasoningEffort"`
} {
	out := make([]struct {
		Effort string `json:"reasoningEffort"`
	}, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		out = append(out, struct {
			Effort string `json:"reasoningEffort"`
		}{Effort: value})
	}
	return out
}

// CatalogFromSetup extracts model, effort and mode options from an ACP
// session/new or session/load response, supporting both modern configOptions
// and legacy models/modes fields.
func CatalogFromSetup(setup acp.SessionSetupResult) OptionCatalog {
	cat := OptionCatalog{
		Models:           []codex.ChatModel{},
		Modes:            []string{},
		HasConfigOptions: len(setup.ConfigOptions) > 0,
	}
	var efforts []string
	defaultEffort := ""

	for _, opt := range setup.ConfigOptions {
		catName := strings.ToLower(strings.TrimSpace(opt.Category))
		idLower := strings.ToLower(strings.TrimSpace(opt.ID))
		switch {
		case catName == "thought_level" || strings.Contains(idLower, "effort") || strings.Contains(idLower, "thought"):
			cat.EffortConfigID = opt.ID
			cat.CurrentEffort = opt.CurrentValue
			defaultEffort = opt.CurrentValue
			if vals := opt.FlatOptions(); len(vals) > 0 {
				efforts = efforts[:0]
				for _, v := range vals {
					efforts = append(efforts, v.Value)
				}
			}
		case catName == "mode" || idLower == "mode":
			cat.ModeConfigID = opt.ID
			cat.CurrentMode = opt.CurrentValue
			for _, v := range opt.FlatOptions() {
				cat.Modes = append(cat.Modes, v.Value)
			}
		}
	}

	for _, opt := range setup.ConfigOptions {
		catName := strings.ToLower(strings.TrimSpace(opt.Category))
		idLower := strings.ToLower(strings.TrimSpace(opt.ID))
		if catName == "model" || idLower == "model" {
			cat.ModelConfigID = opt.ID
			cat.CurrentModel = opt.CurrentValue
			for _, v := range opt.FlatOptions() {
				name := v.Name
				if name == "" {
					name = v.Value
				}
				cat.Models = append(cat.Models, codex.ChatModel{
					ID:            v.Value,
					Model:         v.Value,
					Name:          name,
					Default:       v.Value == opt.CurrentValue,
					DefaultEffort: defaultEffort,
					Efforts:       effortList(efforts),
				})
			}
		}
	}

	if len(cat.Models) == 0 && setup.Models != nil {
		cat.CurrentModel = setup.Models.CurrentModelID
		for _, m := range setup.Models.AvailableModels {
			id := m.ModelID
			if id == "" {
				id = m.ID
			}
			if id == "" {
				continue
			}
			name := m.Name
			if name == "" {
				name = id
			}
			cat.Models = append(cat.Models, codex.ChatModel{
				ID:            id,
				Model:         id,
				Name:          name,
				Default:       id == setup.Models.CurrentModelID,
				DefaultEffort: defaultEffort,
				Efforts:       effortList(efforts),
			})
		}
	}

	if len(cat.Modes) == 0 && setup.Modes != nil {
		cat.CurrentMode = setup.Modes.CurrentModeID
		for _, m := range setup.Modes.AvailableModes {
			if m.ID != "" {
				cat.Modes = append(cat.Modes, m.ID)
			}
		}
	}
	if len(cat.Modes) == 0 {
		cat.Modes = append([]string(nil), DefaultModes...)
	}
	return cat
}

// DiscoverCatalog reads model-specific options in a temporary ACP session
// without sending a prompt or registering a Yolu conversation.
func DiscoverCatalog(ctx context.Context, open func(context.Context, ...string) (acp.Client, acp.InitializeResult, error)) (OptionCatalog, error) {
	dir, err := os.MkdirTemp("", "yolu-agy-options-")
	if err != nil {
		return OptionCatalog{}, err
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, _, err := open(ctx, "--sandbox")
	if err != nil {
		return OptionCatalog{}, err
	}
	defer client.Close()
	var setup acp.SessionSetupResult
	if err := client.Call(ctx, "session/new", map[string]any{"cwd": dir, "mcpServers": []any{}}, &setup); err != nil {
		return OptionCatalog{}, err
	}
	if setup.SessionID == "" {
		return OptionCatalog{}, fmt.Errorf("Antigravity 未返回选项会话标识")
	}
	defer func() {
		closeCtx, end := context.WithTimeout(context.Background(), 2*time.Second)
		defer end()
		_ = client.Call(closeCtx, "session/close", map[string]any{"sessionId": setup.SessionID}, nil)
	}()
	catalog := CatalogFromSetup(setup)
	if catalog.ModelConfigID == "" || catalog.EffortConfigID == "" {
		return catalog, nil
	}
	for i := range catalog.Models {
		model := &catalog.Models[i]
		if model.Default {
			continue
		}
		// The options initially reported for thought_level are for the active model.
		model.Efforts, model.DefaultEffort = nil, ""
		var updated acp.SessionSetupResult
		err := client.Call(ctx, "session/set_config_option", map[string]any{
			"sessionId": setup.SessionID, "configId": catalog.ModelConfigID, "value": model.Model,
		}, &updated)
		if err != nil {
			continue
		}
		for _, candidate := range CatalogFromSetup(updated).Models {
			if candidate.Model == model.Model && candidate.Default {
				model.Efforts, model.DefaultEffort = candidate.Efforts, candidate.DefaultEffort
				break
			}
		}
	}
	return catalog, nil
}

func ACPFlagsForPermission(permission string, additionalDirs []string) []string {
	args := []string{}
	switch permission {
	case "full":
		args = append(args, "--dangerously-skip-permissions")
	case "ask":
		args = append(args, "--sandbox")
	}
	for _, dir := range additionalDirs {
		dir = strings.TrimSpace(dir)
		if dir != "" {
			args = append(args, "--add-dir", dir)
		}
	}
	return args
}

// ListCLIModels tries `agy models` as a read-only way to discover models
// without creating a conversation session.
func ListCLIModels(ctx context.Context) []codex.ChatModel {
	runCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := Command(runCtx, "models").Output()
	if err != nil {
		return nil
	}
	return ParseModelsOutput(string(out))
}

func ParseModelsOutput(output string) []codex.ChatModel {
	models := []codex.ChatModel{}
	seen := map[string]bool{}
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "-") && strings.Trim(line, "- ") == "" {
			continue
		}
		isDefault := strings.Contains(strings.ToLower(line), "(default)") || strings.HasPrefix(line, "*")
		line = strings.TrimSpace(strings.TrimPrefix(line, "*"))
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		id := fields[0]
		lower := strings.ToLower(id)
		if lower == "id" || lower == "model" || lower == "models" || lower == "available" || strings.HasSuffix(id, ":") {
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		display := id
		if len(fields) > 1 {
			rest := strings.TrimSpace(strings.TrimPrefix(line, id))
			rest = strings.TrimSpace(strings.TrimLeft(rest, "-–—:|"))
			if rest != "" {
				display = rest
			}
		}
		models = append(models, codex.ChatModel{
			ID:      id,
			Model:   id,
			Name:    display,
			Default: isDefault,
		})
	}
	return models
}
