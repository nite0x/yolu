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
func readResourceIcons(query func(string, ...any) *sql.Row, environment string) (resourceIcons, error) {
	result := resourceIcons{Icons: map[string]resourceIcon{}}
	var raw string
	err := query(`SELECT value FROM settings WHERE key=?`, "resource_icons:"+environment).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		err = query(`SELECT value FROM settings WHERE key=?`, "shortcut_pins:"+environment).Scan(&raw)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return result, err
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
			!slices.Contains([]string{"auto", "folder", "code", "terminal", "rocket", "bug", "sparkles", "database", "globe", "layers", "briefcase", "flask"}, input.Appearance.Icon) ||
			!slices.Contains([]string{"indigo", "blue", "teal", "green", "amber", "rose", "violet", "slate"}, input.Appearance.Color) {
			httpx.WriteError(w, 400, "资源图标无效")
			return
		}
		tx, err := a.Execution.Store.DB.BeginTx(r.Context(), nil)
		if err != nil {
			httpx.DbError(w, err)
			return
		}
		defer tx.Rollback()
		result, err := readResourceIcons(func(q string, args ...any) *sql.Row { return tx.QueryRowContext(r.Context(), q, args...) }, environment)
		if err != nil {
			httpx.DbError(w, err)
			return
		}
		result.Icons[input.ID] = input.Appearance
		raw, err := json.Marshal(result)
		if err != nil {
			httpx.DbError(w, err)
			return
		}
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, "resource_icons:"+environment, string(raw)); err != nil {
			httpx.DbError(w, err)
			return
		}
		if err = tx.Commit(); err != nil {
			httpx.DbError(w, err)
			return
		}
		httpx.WriteJSON(w, 200, result)
		return
	}
	result, err := readResourceIcons(func(q string, args ...any) *sql.Row {
		return a.Execution.Store.DB.QueryRowContext(r.Context(), q, args...)
	}, environment)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, result)
}
