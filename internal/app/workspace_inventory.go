package app

import (
	"fmt"
	"net/http"
	"path/filepath"
	"runtime"
	"sort"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/overview"
	"worktree-hub/internal/store"
)

type workspaceInventoryEntry struct {
	model.Workspace
	EnvironmentID   string `json:"environment_id"`
	EnvironmentName string `json:"environment_name"`
	Connected       bool   `json:"connected"`
}

type workspaceInventoryEnvironment struct {
	Environment
	Error string `json:"error,omitempty"`
}

func (a *App) workspaceInventoryHandler(w http.ResponseWriter, r *http.Request) {
	entries := []workspaceInventoryEnvironment{{Environment: Environment{ID: "local", Name: "本机 · " + runtime.GOOS, Root: a.Execution.Root, Connected: true}}}
	apps := map[string]*App{"local": a}
	if h := a.environments; h != nil {
		// Reconnection closes stores. Keep their lifetime stable while composing
		// this metadata-only view; no WSL process is started by this endpoint.
		h.mu.Lock()
		defer h.mu.Unlock()
		for _, e := range h.entries {
			e.Connected = false
			if app := h.apps[e.ID]; app != nil {
				apps[e.ID] = app
				if app.Execution.Remote != nil {
					select {
					case <-app.Execution.Remote.Done():
					default:
						e.Connected = true
					}
				}
			}
			entries = append(entries, workspaceInventoryEnvironment{Environment: e})
		}
	}
	items := []workspaceInventoryEntry{}
	projectCount := 0
	refreshing := false
	for i := range entries {
		e := &entries[i]
		app := apps[e.ID]
		var s *store.Store
		if app != nil {
			s = app.Execution.Store
		} else {
			var err error
			s, err = store.OpenReadOnly(filepath.Join(a.Execution.DataDir, "environments", e.ID))
			if err != nil {
				e.Error = "无法读取已保存的工作区：" + err.Error()
				continue
			}
		}
		projects, err := s.Projects()
		var workspaces []model.Workspace
		if err == nil {
			workspaces, err = s.Workspaces()
		}
		if app == nil {
			_ = s.DB.Close()
		}
		if err != nil {
			if e.ID == "local" {
				httpx.DbError(w, err)
				return
			}
			e.Error = fmt.Sprintf("无法读取已保存的工作区：%v", err)
			continue
		}
		if app != nil && e.Connected {
			pending, _ := app.Projects.Snapshot(projects, r.URL.Query().Get("refresh") == "1")
			refreshing = refreshing || pending
			overview.LinkWorktrees(projects, workspaces)
		}
		projectCount += len(projects)
		for _, q := range workspaces {
			items = append(items, workspaceInventoryEntry{Workspace: q, EnvironmentID: e.ID, EnvironmentName: e.Name, Connected: e.Connected})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt != items[j].CreatedAt {
			return items[i].CreatedAt > items[j].CreatedAt
		}
		if items[i].EnvironmentID != items[j].EnvironmentID {
			return items[i].EnvironmentID < items[j].EnvironmentID
		}
		return items[i].ID < items[j].ID
	})
	httpx.WriteJSON(w, 200, map[string]any{"workspaces": items, "environments": entries, "project_count": projectCount, "status_refreshing": refreshing})
}
