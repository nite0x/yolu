package session

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/project"
)

// A scope is a query, never an owner of a session. A nil directory set lists all
// sessions in this environment; an empty set lists none.
type sessionScope struct {
	paths            []string
	boundDirectories map[string][]string
	cwd              string
}

type invalidSessionTarget string

func (e invalidSessionTarget) Error() string { return string(e) }

func (s sessionScope) includes(id, cwd string) bool {
	if s.cwd != "" && !platform.SameWorkspacePath(s.cwd, cwd) {
		return false
	}
	if s.paths == nil || len(s.boundDirectories[id]) != 0 {
		return true
	}
	for _, p := range s.paths {
		if platform.SameWorkspacePath(p, cwd) {
			return true
		}
	}
	return false
}

func uniqueDirectories(paths []string) []string {
	out := []string{}
	for _, p := range paths {
		if p == "" {
			continue
		}
		p = platform.CleanWorkspacePath(p)
		found := false
		for _, old := range out {
			if platform.SameWorkspacePath(old, p) {
				found = true
				break
			}
		}
		if !found {
			out = append(out, p)
		}
	}
	return out
}

func (a *Service) projectScope(ctx context.Context, id string) (sessionScope, error) {
	p, err := project.LookupProject(ctx, a.Execution, id)
	if errors.Is(err, sql.ErrNoRows) {
		return sessionScope{}, err
	}
	scope := sessionScope{paths: []string{}}
	if err == nil {
		if found, err := projectDirectoryScope(ctx, p); err == nil {
			scope.paths = found.paths
		}
	}
	// Explicit associations remain visible when Git or the checkout is unavailable.
	scope.boundDirectories, err = a.Execution.Store.SessionDirectoriesForProject(id, scope.paths...)
	return scope, err
}

func projectDirectoryScope(ctx context.Context, p model.Project) (sessionScope, error) {
	raw, err := execution.Git(ctx, p.Path, "worktree", "list", "--porcelain", "-z")
	if err != nil {
		return sessionScope{}, err
	}
	paths := []string{}
	for _, tree := range project.ParseWorktrees(raw) {
		if !tree.Bare {
			paths = append(paths, tree.Path)
		}
	}
	return sessionScope{paths: uniqueDirectories(paths)}, nil
}

func (a *Service) queryScope(r *http.Request) (sessionScope, error) {
	projectID, cwd := r.URL.Query().Get("project_id"), r.URL.Query().Get("cwd")
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	scope := sessionScope{}
	var err error
	if projectID != "" {
		scope, err = a.projectScope(ctx, projectID)
	}
	if err != nil {
		return scope, err
	}
	if cwd != "" {
		if !platform.AbsoluteWorkspacePath(cwd) {
			return scope, fmt.Errorf("工作目录必须是绝对路径")
		}
		if resolved, err := execution.Eval(ctx, cwd); err == nil {
			cwd = resolved
		}
		if !scope.includes("", cwd) {
			return scope, fmt.Errorf("工作目录不在所选项目内")
		}
		scope.cwd = cwd
		scope.paths = []string{cwd}
	}

	return scope, nil
}

func (a *Service) cachedScope(scope sessionScope, cloudIdentity string) ([]model.Session, error) {
	all, err := a.Execution.Store.SessionsForCloudIdentity(cloudIdentity)
	if err != nil {
		return nil, err
	}
	out := []model.Session{}
	for _, s := range all {
		if scope.includes(s.ID, s.Cwd) {
			s.ProjectDirectories = scope.boundDirectories[s.ID]
			out = append(out, s)
		}
	}
	return out, nil
}

// Session IDs are local to the selected execution environment.
func (a *Service) requestSession(w http.ResponseWriter, r *http.Request) (model.Session, bool) {
	id := r.PathValue("session")
	s, err := a.Execution.Store.Session(id)
	if errors.Is(err, sql.ErrNoRows) {
		c, openErr := a.openSessions(r.Context())
		if openErr != nil {
			httpx.WriteError(w, 503, openErr.Error())
			return s, false
		}
		defer c.Close()
		var current codex.Session
		titleObservedAt := time.Now().UnixNano()
		current, err = readSession(c, id)
		if err == nil {
			err = a.SaveSession(current, "codex", titleObservedAt)
			if err == nil {
				s, err = a.Execution.Store.Session(id)
			}
		}
	}
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, 404, "对话不存在")
		} else {
			httpx.WriteError(w, 503, err.Error())
		}
		return s, false
	}
	return s, true
}

// SessionTarget selects the execution directory and the initial associations.
type SessionTarget struct {
	ProjectID   string
	Cwd         string
	Access      string
	AllowShared bool
	Bindings    []bindingInput
	Provider    string
}

type executionContext struct {
	plan         model.LaunchPlan
	instructions string
	bindings     []model.SessionProjectBinding
}
