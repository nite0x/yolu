package project

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"reflect"
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

func inspectRegistration(ctx context.Context, name, path, id string) (RegistrationReview, error) {
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
	review.Project = model.Project{ID: id, Name: name, Path: root, CommonDir: common, Folder: folder}
	return review, nil
}

func (a *Service) checkRegistrationAvailable(ctx context.Context, p model.Project) error {
	exists, err := a.Execution.Store.RegistrationExists(ctx, p.CommonDir, p.Name, p.Folder)
	if err != nil {
		return err
	}
	if exists {
		return &OperationError{Status: 409, Message: "仓库已登记，或项目名称/目录名重复，请使用不同的项目名称"}
	}
	return nil
}

func (a *Service) ReviewRegistration(ctx context.Context, name, path string) (RegistrationReview, error) {
	review, err := inspectRegistration(ctx, name, path, model.NewID())
	if err != nil {
		return review, err
	}
	return review, a.checkRegistrationAvailable(ctx, review.Project)
}

func (a *Service) insertRegistration(ctx context.Context, review RegistrationReview) (model.Project, error) {
	p := review.Project
	if a.Execution.Closing.Load() {
		return p, &OperationError{Status: 503, Message: "后台正在退出"}
	}
	if err := a.checkRegistrationAvailable(ctx, p); err != nil {
		return p, err
	}
	p.CreatedAt = model.Now()
	err := a.Execution.Store.InsertProject(ctx, p)
	return p, err
}

// RegisterProject is the common operation used by registration and clone HTTP
// handlers. Reviewed execution uses the same validation and persistence below.
func (a *Service) RegisterProject(ctx context.Context, name, path string) (model.Project, error) {
	defer a.cache.invalidate()
	review, err := inspectRegistration(ctx, name, path, model.NewID())
	if err != nil {
		return model.Project{}, err
	}
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	return a.insertRegistration(ctx, review)
}

func (a *Service) reconcileRegistration(ctx context.Context, review RegistrationReview) (model.Project, bool, error) {
	p, err := a.Execution.Store.Project(ctx, review.Project.ID)
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
	if p, found, err := a.reconcileRegistration(ctx, review); err != nil || found {
		return p, err
	}
	p := review.Project
	if len(p.ID) < 6 {
		return model.Project{}, &OperationError{Status: 400, Message: "项目登记计划无效"}
	}
	current, err := inspectRegistration(ctx, p.Name, p.Path, p.ID)
	if err != nil {
		return model.Project{}, err
	}
	if !reflect.DeepEqual(current, review) {
		return model.Project{}, &OperationError{Status: 409, Message: "仓库位置已变化，请重新检查并确认计划"}
	}
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	if p, found, err := a.reconcileRegistration(ctx, review); err != nil || found {
		return p, err
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
