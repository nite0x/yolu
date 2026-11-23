// Package overview composes the workbench read model without owning business state.
package overview

import (
	"net/http"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

type ProjectStatus interface {
	Snapshot([]model.Project, bool) (bool, string)
}
type Service struct {
	environment *execution.Service
	projects    ProjectStatus
}

func New(environment *execution.Service, projects ProjectStatus) *Service {
	return &Service{environment: environment, projects: projects}
}
func (a *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	projects, err := a.environment.Store.Projects()
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	settings, err := a.environment.TerminalSettings()
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	force := r.URL.Query().Get("refresh") == "1"
	refreshing, updatedAt := a.projects.Snapshot(projects, force)
	terminal, terminalRefreshing := a.environment.TerminalSnapshot(settings, force)
	refreshing = refreshing || terminalRefreshing
	httpx.WriteJSON(w, 200, map[string]any{"projects": projects, "root": a.environment.Root, "refreshed_at": updatedAt, "status_refreshing": refreshing, "terminal": terminal, "read_only_sessions": a.environment.ReadOnlySessions})
}
