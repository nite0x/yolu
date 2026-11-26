package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"

	"worktree-hub/internal/httpx"
)

type resourceIcon struct {
	Icon  string `json:"icon"`
	Color string `json:"color"`
}
type resourceIcons struct {
	Icons map[string]resourceIcon `json:"icons"`
}

// Saved appearances survive the removal of pinned navigation. Read the legacy
// preference only as a fallback; all new writes store resource appearance alone.
func decodeResourceIcons(raw string) (resourceIcons, error) {
	result := resourceIcons{Icons: map[string]resourceIcon{}}
	if raw == "" {
		return result, nil
	}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return result, err
	}
	if result.Icons == nil {
		result.Icons = map[string]resourceIcon{}
	}
	for key := range result.Icons {
		if !strings.HasPrefix(key, "project:") {
			delete(result.Icons, key)
		}
	}
	return result, nil
}

func (a *App) resourceIconsHandler(w http.ResponseWriter, r *http.Request) {
	environment := r.URL.Query().Get("environment")
	if environment == "" {
		environment = "local"
	}
	if len(environment) > 128 || strings.ContainsAny(environment, "\x00\r\n") {
		httpx.WriteError(w, 400, "执行环境标识无效")
		return
	}
	if r.Method == http.MethodPut {
		var input struct {
			ID         string       `json:"id"`
			Appearance resourceIcon `json:"appearance"`
		}
		if !httpx.Decode(w, r, &input) {
			return
		}
		kind, id, ok := strings.Cut(input.ID, ":")
		if !ok || id == "" || len(input.ID) > 8192 || kind != "project" ||
			!slices.Contains([]string{"auto", "folder", "code", "terminal", "rocket", "bug", "sparkles", "database", "globe", "layers", "briefcase", "flask", "box", "cpu", "server", "bot", "wrench", "shield", "book", "compass", "puzzle"}, input.Appearance.Icon) ||
			!slices.Contains([]string{"", "theme", "indigo", "blue", "teal", "green", "amber", "rose", "violet", "slate"}, input.Appearance.Color) {
			httpx.WriteError(w, 400, "资源图标无效")
			return
		}
		var result resourceIcons
		err := a.Execution.Store.UpdateSetting(r.Context(), "resource_icons:"+environment, "shortcut_pins:"+environment, func(raw string) (string, error) {
			var err error
			result, err = decodeResourceIcons(raw)
			if err != nil {
				return "", err
			}
			result.Icons[input.ID] = input.Appearance
			encoded, err := json.Marshal(result)
			return string(encoded), err
		})
		if err != nil {
			httpx.DbError(w, err)
			return
		}

		httpx.WriteJSON(w, 200, result)
		return
	}
	raw, err := a.Execution.Store.Setting(r.Context(), "resource_icons:"+environment)
	if errors.Is(err, sql.ErrNoRows) {
		raw, err = a.Execution.Store.Setting(r.Context(), "shortcut_pins:"+environment)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.DbError(w, err)
		return
	}
	result, err := decodeResourceIcons(raw)

	if err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, result)
}
