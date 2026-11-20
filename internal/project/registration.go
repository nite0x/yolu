package project

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"reflect"
	"sort"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

// OperationError preserves the manual API's status while exposing domain errors
// to other application entry points.
type OperationError struct {
	Status  int
	Message string
	Details []string
}

func (e *OperationError) Error() string { return e.Message }

// RegistrationReview records the canonical repository identity before a write.
// The application persists this value with the approved plan.
type RegistrationReview struct {
	Project model.Project `json:"project"`
}

func (a *Service) registration(ctx context.Context, name, path, id string) (RegistrationReview, error) {
	var review RegistrationReview
	path, err := execution.Normalize(ctx, path)
	if err != nil {
		return review, &OperationError{Status: 400, Message: err.Error()}
	}
	root, err := execution.Git(ctx, path, "rev-parse", "--show-toplevel")
	if err != nil {
		return review, &OperationError{Status: 422, Message: "该目录不是可用的 Git 工作目录：" + err.Error()}
	}
	root, err = execution.Eval(ctx, strings.TrimSpace(root))
	if err != nil {
		return review, &OperationError{Status: 422, Message: err.Error()}
	}
	common, err := execution.Git(ctx, root, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return review, &OperationError{Status: 422, Message: err.Error()}
	}
	common, err = execution.Eval(ctx, strings.TrimSpace(common))
	if err != nil {
		return review, &OperationError{Status: 422, Message: err.Error()}
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = platform.BaseWorkspacePath(root)
	}
	if len([]rune(name)) > 80 {
		return review, &OperationError{Status: 400, Message: "项目名称不能超过 80 字"}
	}
	folder := execution.Slugify(name)
	if folder == "" {
		folder = "project-" + id[:6]
	}
	var exists int
	err = a.Execution.Store.DB.QueryRowContext(ctx, `SELECT count(*) FROM projects WHERE common_dir=? OR name=? COLLATE NOCASE OR folder=? COLLATE NOCASE`, common, name, folder).Scan(&exists)
	if err != nil {
		return review, err
	}
	if exists > 0 {
		return review, &OperationError{Status: 409, Message: "仓库已登记，或项目名称/目录名重复，请使用不同的项目名称"}
	}
	review.Project = model.Project{ID: id, Name: name, Path: root, CommonDir: common, Folder: folder}
	return review, nil
}

func (a *Service) ReviewRegistration(ctx context.Context, name, path string) (RegistrationReview, error) {
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	return a.registration(ctx, name, path, model.NewID())
}

func (a *Service) insertRegistration(ctx context.Context, review RegistrationReview) (model.Project, error) {
	p := review.Project
	p.CreatedAt = model.Now()
	_, err := a.Execution.Store.DB.ExecContext(ctx, `INSERT INTO projects(id,name,path,common_dir,folder,created_at) VALUES(?,?,?,?,?,?)`, p.ID, p.Name, p.Path, p.CommonDir, p.Folder, p.CreatedAt)
	return p, err
}

// RegisterProject is the common operation used by registration and clone HTTP
// handlers. Reviewed execution uses the same validation and persistence below.
func (a *Service) RegisterProject(ctx context.Context, name, path string) (model.Project, error) {
	defer a.cache.invalidate()
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	review, err := a.registration(ctx, name, path, model.NewID())
	if err != nil {
		return model.Project{}, err
	}
	return a.insertRegistration(ctx, review)
}

func (a *Service) reconcileRegistration(ctx context.Context, review RegistrationReview) (model.Project, bool, error) {
	var p model.Project
	err := a.Execution.Store.DB.QueryRowContext(ctx, `SELECT id,name,path,common_dir,folder,created_at FROM projects WHERE id=?`, review.Project.ID).Scan(&p.ID, &p.Name, &p.Path, &p.CommonDir, &p.Folder, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return p, false, nil
	}
	if err != nil {
		return p, false, err
	}
	expected := review.Project
	expected.CreatedAt = p.CreatedAt
	if !reflect.DeepEqual(p, expected) {
		return p, true, &OperationError{Status: 409, Message: "项目登记结果与已确认计划不一致，请检查实际资源"}
	}
	return p, true, nil
}

// ReconcileRegistration reads the stable proposed ID without repeating a write.
func (a *Service) ReconcileRegistration(ctx context.Context, review RegistrationReview) (model.Project, bool, error) {
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	return a.reconcileRegistration(ctx, review)
}

func (a *Service) ExecuteRegistration(ctx context.Context, review RegistrationReview) (model.Project, error) {
	defer a.cache.invalidate()
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	if p, found, err := a.reconcileRegistration(ctx, review); err != nil || found {
		return p, err
	}
	p := review.Project
	if len(p.ID) < 6 {
		return model.Project{}, &OperationError{Status: 400, Message: "项目登记计划无效"}
	}
	current, err := a.registration(ctx, p.Name, p.Path, p.ID)
	if err != nil {
		return model.Project{}, err
	}
	if !reflect.DeepEqual(current, review) {
		return model.Project{}, &OperationError{Status: 409, Message: "仓库位置已变化，请重新检查并确认计划"}
	}
	return a.insertRegistration(ctx, review)
}

func writeOperationError(w http.ResponseWriter, err error) {
	var issue *OperationError
	if errors.As(err, &issue) {
		if len(issue.Details) > 0 {
			httpx.WriteJSON(w, issue.Status, map[string]any{"error": issue.Message, "details": issue.Details})
			return
		}
		httpx.WriteError(w, issue.Status, issue.Message)
		return
	}
	httpx.DbError(w, err)
}

// LockRepositories shares Git serialization with ordinary project operations.
// Callers acquire this before the environment metadata mutex, matching the
// repository -> metadata order used by branch switching.
func (a *Service) LockRepositories(ctx context.Context, ids []string) (func(), error) {
	a.Execution.GitActivity.RLock()
	if a.Execution.Closing.Load() {
		a.Execution.GitActivity.RUnlock()
		return nil, &OperationError{Status: 503, Message: "后台正在退出"}
	}
	projects, err := a.Execution.Store.ProjectMap()
	if err != nil {
		a.Execution.GitActivity.RUnlock()
		return nil, err
	}
	common := make(map[string]bool)
	for _, id := range ids {
		if p, ok := projects[id]; ok {
			common[p.CommonDir] = true
		}
	}
	keys := make([]string, 0, len(common))
	for key := range common {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	unlocks := make([]func(), 0, len(keys))
	release := func() {
		for i := len(unlocks) - 1; i >= 0; i-- {
			unlocks[i]()
		}
		a.Execution.GitActivity.RUnlock()
	}
	for _, key := range keys {
		if err := ctx.Err(); err != nil {
			release()
			return nil, err
		}
		unlocks = append(unlocks, a.lockGit(key))
	}
	if err := ctx.Err(); err != nil {
		release()
		return nil, err
	}
	return release, nil
}

// InvalidateState refreshes ordinary UI readers after non-HTTP domain callers.
func (a *Service) InvalidateState() { a.cache.invalidate() }
