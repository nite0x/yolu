package workspace

import "net/http"

func (s *Service) RegisterRoutes(mux *http.ServeMux, invalidate func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("POST /api/workspaces", invalidate(s.CreateWorkspaceHandler))
	mux.HandleFunc("GET /api/workspaces/creation-progress", s.CreationProgressHandler)
	mux.HandleFunc("PATCH /api/workspaces/{id}", s.UpdateWorkspaceHandler)
	mux.HandleFunc("DELETE /api/workspaces/{id}", invalidate(s.DeleteWorkspaceHandler))
	mux.HandleFunc("PUT /api/workspaces/{id}/projects/{project}", invalidate(s.ReplaceWorkspaceProjectHandler))
	mux.HandleFunc("DELETE /api/workspaces/{id}/projects/{project}", invalidate(s.RemoveWorkspaceProjectHandler))
	mux.HandleFunc("POST /api/workspaces/{id}/projects", invalidate(s.AddWorkspaceProjectsHandler))
	mux.HandleFunc("POST /api/workspaces/{id}/retry", invalidate(s.RetryHandler))
	mux.HandleFunc("POST /api/workspaces/{id}/archive", s.ArchiveHandler)
	mux.HandleFunc("GET /api/workspaces/{id}/launch", s.LaunchPlanHandler)
}
