package acp

import (
	"strings"

	"worktree-hub/internal/codex"
)

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
func CatalogFromSetup(setup SessionSetupResult) OptionCatalog {
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
	return cat
}
