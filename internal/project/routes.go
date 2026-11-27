package project

import "net/http"

func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/projects/scan", s.ScanProjectsHandler)
	mux.HandleFunc("POST /api/projects/import", s.InvalidateStateAfter(s.ImportProjectsHandler))
	mux.HandleFunc("POST /api/projects/clone", s.InvalidateStateAfter(s.CloneProjectHandler))
	mux.HandleFunc("POST /api/projects", s.InvalidateStateAfter(s.AddProjectHandler))
	mux.HandleFunc("GET /api/projects/{id}/removal", s.ProjectRemovalHandler)
	mux.HandleFunc("DELETE /api/projects/{id}", s.InvalidateStateAfter(s.RemoveProjectHandler))
	mux.HandleFunc("GET /api/projects/{id}/git", s.GitOverviewHandler)
	mux.HandleFunc("GET /api/projects/{id}/changes", s.ChangesHandler)
	mux.HandleFunc("GET /api/projects/{id}/files", s.FilesHandler)
	mux.HandleFunc("GET /api/projects/{id}/worktree", s.WorktreeReviewHandler)
	mux.HandleFunc("DELETE /api/projects/{id}/worktree", s.InvalidateStateAfter(s.CleanupWorktreeHandler))
	mux.HandleFunc("GET /api/projects/{id}/remote", s.ProjectRemoteHandler)
	mux.HandleFunc("POST /api/projects/{id}/open", s.OpenProjectHandler)
	mux.HandleFunc("POST /api/projects/{id}/git", s.GitActionHandler)
	mux.HandleFunc("POST /api/projects/{id}/worktrees", s.CreateWorktreeHandler)
}
