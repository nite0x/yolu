package project

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/workspace"
)

func (a *Service) ScanProjectsHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path string `json:"path"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Path) == "" {
		httpx.WriteError(w, 400, "请选择要扫描的目录")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	result, err := workspace.ScanRepositories(ctx, input.Path)
	if err != nil {
		httpx.WriteJSON(w, 422, map[string]any{"error": "扫描目录失败", "details": []string{err.Error()}})
		return
	}
	projects, err := a.Workspace.Store.ProjectMap()
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	registered := make(map[string]model.Project)
	names, folders := make(map[string]bool), make(map[string]bool)
	for _, p := range projects {
		registered[p.CommonDir] = p
		names[strings.ToLower(p.Name)] = true
		folders[strings.ToLower(p.Folder)] = true
	}
	for i := range result.Repositories {
		repository := &result.Repositories[i]
		if p, ok := registered[repository.CommonDir]; ok {
			repository.ProjectID = p.ID
			repository.Name = p.Name
			continue
		}
		base := []rune(repository.Name)
		if len(base) > 70 {
			base = base[:70]
		}
		repository.Name = string(base)
		for suffix := 2; names[strings.ToLower(repository.Name)] || workspace.Slugify(repository.Name) != "" && folders[strings.ToLower(workspace.Slugify(repository.Name))]; suffix++ {
			repository.Name = fmt.Sprintf("%s (%d)", string(base[:min(len(base), 45)]), suffix)
		}
		names[strings.ToLower(repository.Name)] = true
		folders[strings.ToLower(workspace.Slugify(repository.Name))] = true
	}
	httpx.WriteJSON(w, 200, result)
}

type projectImportInput struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	CommonDir string `json:"common_dir"`
}

type projectImportResult struct {
	Path   string `json:"path"`
	ID     string `json:"id,omitempty"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// Each item is committed independently. Retrying a partial batch returns the
// existing registration for the same canonical Git directory.
func (a *Service) importProject(ctx context.Context, input projectImportInput) (string, bool, error) {
	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	if input.Path == "" || input.CommonDir == "" {
		return "", false, fmt.Errorf("仓库扫描结果无效，请重新扫描")
	}
	common, err := workspace.Git(ctx, input.Path, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return "", false, err
	}
	common, err = workspace.Eval(ctx, strings.TrimSpace(common))
	if err != nil {
		return "", false, err
	}
	if common != input.CommonDir {
		return "", false, fmt.Errorf("仓库位置已变化，请重新扫描")
	}
	var id string
	err = a.Workspace.Store.DB.QueryRowContext(ctx, `SELECT id FROM projects WHERE common_dir=?`, common).Scan(&id)
	if err == nil {
		return id, true, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", false, err
	}
	review, err := a.registration(ctx, input.Name, input.Path, model.NewID())
	if err != nil {
		return "", false, err
	}
	if review.Project.CommonDir != input.CommonDir {
		return "", false, fmt.Errorf("仓库位置已变化，请重新扫描")
	}
	p, err := a.insertRegistration(ctx, review)
	return p.ID, false, err
}

func (a *Service) ImportProjectsHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Repositories []projectImportInput `json:"repositories"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	if len(input.Repositories) == 0 || len(input.Repositories) > workspace.RepositoryScanLimit {
		httpx.WriteError(w, 400, "请选择 1 到 1000 个仓库")
		return
	}
	defer a.cache.invalidate()
	results := make([]projectImportResult, 0, len(input.Repositories))
	for _, repository := range input.Repositories {
		if r.Context().Err() != nil {
			return
		}
		result := projectImportResult{Path: repository.Path, Status: "registered"}
		id, existing, err := a.importProject(r.Context(), repository)
		result.ID = id
		if err != nil {
			result.ID = ""
			result.Status = "error"
			result.Error = err.Error()
		} else if existing {
			result.Status = "existing"
		}
		results = append(results, result)
	}
	httpx.WriteJSON(w, 200, map[string]any{"results": results})
}
