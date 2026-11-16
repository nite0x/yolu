package project

import (
	"net/http"

	"worktree-hub/internal/httpx"
)

func (a *Service) AddProjectHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	a.registerProject(w, r, input.Name, input.Path)
}

// registerProject is shared by existing repositories and completed clones.
func (a *Service) registerProject(w http.ResponseWriter, r *http.Request, name, path string) {
	p, err := a.RegisterProject(r.Context(), name, path)
	if err != nil {
		writeOperationError(w, err)
		return
	}
	httpx.WriteJSON(w, 201, map[string]string{"id": p.ID})
}
