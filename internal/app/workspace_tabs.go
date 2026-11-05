package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"worktree-hub/internal/httpx"
)

type workspaceTab struct {
	ID       string          `json:"id"`
	Snapshot json.RawMessage `json:"snapshot"`
}

type workspaceTabs struct {
	Selected    string           `json:"selected"`
	Tabs        []workspaceTab   `json:"tabs"`
	Initialized bool             `json:"initialized"`
	Layout      *workspaceLayout `json:"layout,omitempty"`
}

type workspaceLayout struct {
	Columns int        `json:"columns"`
	Panes   []string   `json:"panes"`
	Groups  [][]string `json:"groups,omitempty"`
	Widths  []float64  `json:"widths"`
}

var workspaceTabID = regexp.MustCompile(`^[\w-]{1,100}$`)

// Host navigation belongs to the local data directory, independent of the
// sidecar port and of any remote environment displayed inside a tab.
func (a *App) workspaceTabsHandler(w http.ResponseWriter, r *http.Request) {
	const key = "workspace_tabs:v1"
	if r.Method == http.MethodPut {
		var input struct {
			Selected   string           `json:"selected"`
			Tabs       []workspaceTab   `json:"tabs"`
			Initialize bool             `json:"initialize"`
			Layout     *workspaceLayout `json:"layout"`
		}
		if !httpx.Decode(w, r, &input) {
			return
		}
		seen := map[string]bool{}
		for _, tab := range input.Tabs {
			var snapshot map[string]json.RawMessage
			if !workspaceTabID.MatchString(tab.ID) || seen[tab.ID] || json.Unmarshal(tab.Snapshot, &snapshot) != nil || snapshot == nil {
				httpx.WriteError(w, http.StatusBadRequest, "标签页状态无效")
				return
			}
			seen[tab.ID] = true
		}
		if len(input.Tabs) > 0 && !seen[input.Selected] {
			httpx.WriteError(w, http.StatusBadRequest, "当前标签页不存在")
			return
		}
		if layout := input.Layout; layout != nil {
			valid := layout.Columns >= 1 && layout.Columns <= 3 && len(layout.Panes) == layout.Columns && len(layout.Widths) == layout.Columns
			panes := map[string]bool{}
			for i, id := range layout.Panes {
				if !seen[id] || panes[id] || i >= len(layout.Widths) || layout.Widths[i] <= 0 || layout.Widths[i] > 100 {
					valid = false
				}
				panes[id] = true
			}
			if !valid || !panes[input.Selected] {
				httpx.WriteError(w, http.StatusBadRequest, "分栏布局无效")
				return
			}
			if layout.Groups != nil {
				assigned := map[string]bool{}
				valid = len(layout.Groups) == layout.Columns
				for i, group := range layout.Groups {
					active := false
					for _, id := range group {
						if !seen[id] || assigned[id] {
							valid = false
						}
						assigned[id] = true
						if i < len(layout.Panes) && layout.Panes[i] == id {
							active = true
						}
					}
					if !active {
						valid = false
					}
				}
				if !valid || len(assigned) != len(seen) {
					httpx.WriteError(w, http.StatusBadRequest, "分栏标签页分组无效")
					return
				}
			}
		}
		value := workspaceTabs{Selected: input.Selected, Tabs: input.Tabs, Initialized: true, Layout: input.Layout}
		raw, err := json.Marshal(value)
		if err != nil {
			httpx.DbError(w, err)
			return
		}
		query := `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
		if input.Initialize {
			query = `INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING`
		}
		if _, err := a.Workspace.Store.DB.ExecContext(r.Context(), query, key, string(raw)); err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	value := workspaceTabs{Tabs: []workspaceTab{}}
	var raw string
	err := a.Workspace.Store.DB.QueryRowContext(r.Context(), `SELECT value FROM settings WHERE key=?`, key).Scan(&raw)
	if err == nil {
		err = json.Unmarshal([]byte(raw), &value)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, value)
}
