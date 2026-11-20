package agy

import (
	"context"
	"strings"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/codex"
)

var DefaultEfforts = []string{"low", "medium", "high", "xhigh", "max"}
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
	efforts := append([]string(nil), DefaultEfforts...)
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
	efforts := effortList(DefaultEfforts)
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
			ID:            id,
			Model:         id,
			Name:          display,
			Default:       isDefault,
			DefaultEffort: "medium",
			Efforts:       efforts,
		})
	}
	return models
}
