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

type shortcutPins struct {
	Tasks       []string                `json:"tasks"`
	Directories []string                `json:"directories"`
	Initialized bool                    `json:"initialized"`
	Icons       map[string]shortcutIcon `json:"icons,omitempty"`
}

type shortcutIcon struct {
	Icon  string `json:"icon"`
	Color string `json:"color"`
}

// These are host UI preferences, including pins for disconnected environments.
// Persist them with the data directory rather than a WebView's changing origin.
func (a *App) shortcutPinsHandler(w http.ResponseWriter, r *http.Request) {
	environment := r.URL.Query().Get("environment")
	if environment == "" {
		environment = "local"
	}
	if len(environment) > 128 || strings.ContainsAny(environment, "\x00\r\n") {
		httpx.WriteError(w, 400, "执行环境标识无效")
		return
	}
	key := "shortcut_pins:" + environment
	if r.Method == http.MethodPut {
		var input struct {
			Tasks       []string                `json:"tasks"`
			Directories []string                `json:"directories"`
			Initialize  bool                    `json:"initialize"`
			Icons       map[string]shortcutIcon `json:"icons"`
		}
		if !httpx.Decode(w, r, &input) {
			return
		}
		pins := shortcutPins{Tasks: uniqueShortcutValues(input.Tasks, false), Directories: uniqueShortcutValues(input.Directories, true), Initialized: true}
		// Older clients omit icons when updating pins; keep their saved appearance.
		pins.Icons = input.Icons
		if pins.Icons == nil {
			var previous string
			err := a.Workspace.Store.DB.QueryRowContext(r.Context(), `SELECT value FROM settings WHERE key=?`, key).Scan(&previous)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				httpx.DbError(w, err)
				return
			}
			if err == nil {
				var saved shortcutPins
				if err := json.Unmarshal([]byte(previous), &saved); err != nil {
					httpx.DbError(w, err)
					return
				}
				pins.Icons = saved.Icons
			}
		}
		for id, icon := range pins.Icons {
			if len(id) > 8192 || (!strings.HasPrefix(id, "task:") && !strings.HasPrefix(id, "directory:")) ||
				!slices.Contains([]string{"auto", "folder", "code", "terminal", "rocket", "bug", "sparkles", "database", "globe", "layers", "briefcase", "flask"}, icon.Icon) ||
				!slices.Contains([]string{"indigo", "blue", "teal", "green", "amber", "rose", "violet", "slate"}, icon.Color) {
				httpx.WriteError(w, 400, "固定入口图标无效")
				return
			}
		}
		raw, err := json.Marshal(pins)
		if err != nil {
			httpx.DbError(w, err)
			return
		}
		query := `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
		if input.Initialize {
			// Import localStorage once. Old origins must never resurrect removed pins.
			query = `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING`
		}
		if _, err := a.Workspace.Store.DB.ExecContext(r.Context(), query, key, string(raw)); err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	pins := shortcutPins{Tasks: []string{}, Directories: []string{}}
	var raw string
	err := a.Workspace.Store.DB.QueryRowContext(r.Context(), `SELECT value FROM settings WHERE key=?`, key).Scan(&raw)
	if err == nil {
		err = json.Unmarshal([]byte(raw), &pins)
		pins.Initialized = true
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, pins)
}

func uniqueShortcutValues(values []string, paths bool) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		if strings.TrimSpace(value) == "" {
			continue
		}
		key := value
		if paths {
			key = strings.ReplaceAll(key, `\`, "/")
			if key != "/" {
				key = strings.TrimRight(key, "/")
			}
			if strings.HasPrefix(key, "//") || len(key) > 1 && key[1] == ':' {
				key = strings.ToLower(key)
			}
		}
		if !seen[key] {
			out = append(out, value)
			seen[key] = true
		}
	}
	return out
}
