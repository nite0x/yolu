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

type OptionCatalog = acp.OptionCatalog

func CatalogFromSetup(setup acp.SessionSetupResult) OptionCatalog {
	cat := acp.CatalogFromSetup(setup)
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
