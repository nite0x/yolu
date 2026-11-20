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
	workspaces, err := a.environment.Store.Workspaces()
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
	LinkWorktrees(projects, workspaces)
	httpx.WriteJSON(w, 200, map[string]any{"projects": projects, "workspaces": workspaces, "root": a.environment.Root, "refreshed_at": updatedAt, "status_refreshing": refreshing, "terminal": terminal, "read_only_sessions": a.environment.ReadOnlySessions})
}

// LinkWorktrees attaches the current environment's cached Git state to its workspaces.
func LinkWorktrees(projects []model.Project, workspaces []model.Workspace) {
	index := map[string]*model.Worktree{}
	projectStatus := map[string]model.Project{}
	for i := range projects {
		projectStatus[projects[i].ID] = projects[i]
		for j := range projects[i].Worktrees {
			t := &projects[i].Worktrees[j]
			index[t.Path] = t
		}
	}
	for i := range workspaces {
		for j := range workspaces[i].Members {
			m := &workspaces[i].Members[j]
			if t, ok := index[m.Path]; ok {
				t.Workspaces = append(t.Workspaces, model.WorkspaceLink{ID: workspaces[i].ID, Name: workspaces[i].Name})
				if t.WorkspaceID == "" {
					t.WorkspaceID = workspaces[i].ID
					t.WorkspaceName = workspaces[i].Name
				}
				observed := *t
				observed.WorkspaceID, observed.WorkspaceName = workspaces[i].ID, workspaces[i].Name
				observed.ExpectedBranch = m.Branch
				if m.Mode == "new" && observed.ExpectedBranch == "" {
					observed.ExpectedBranch = workspaces[i].Branch
				}
				m.Worktree = &observed
			} else if p, ok := projectStatus[m.ProjectID]; ok && (p.Error != "" || (p.StatusUpdatedAt != "" && !p.Refreshing)) {
				m.Worktree = &model.Worktree{Path: m.Path, Missing: p.Error == "", Error: p.Error, StatusUpdatedAt: p.StatusUpdatedAt}
			}
		}
	}
}
