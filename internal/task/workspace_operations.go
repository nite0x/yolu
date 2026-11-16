package task

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"reflect"
	"strings"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/workspace"
)

type OperationError struct {
	Status  int
	Message string
	Details []string
}

func (e *OperationError) Error() string { return e.Message }

// WorkspaceReview contains the normalized request, resolved baseline and stable
// resource ID. It has no filesystem or database side effects.
type WorkspaceReview struct {
	Input       CreateRequirement `json:"input"`
	Requirement model.Requirement `json:"requirement"`
	Projects    []model.Project   `json:"projects"`
}

func (a *Service) workspaceReview(ctx context.Context, in CreateRequirement) (WorkspaceReview, map[string]model.Project, error) {
	in.Name = strings.TrimSpace(in.Name)
	in.Slug = strings.TrimSpace(in.Slug)
	if in.Slug == "" {
		in.Slug = "task-" + model.NewID()[:12]
	}
	in.Branch = strings.TrimSpace(in.Branch)
	if in.Name == "" || len([]rune(in.Name)) > 100 || len(in.Description) > 20000 {
		return WorkspaceReview{}, nil, &OperationError{Status: 400, Message: "请填写任务名称（最多 100 字），说明最多 20000 字节"}
	}
	if !workspace.ValidSlug.MatchString(in.Slug) {
		return WorkspaceReview{}, nil, &OperationError{Status: 400, Message: "目录标识应为 1–64 位英文字母、数字、短横线或下划线，以字母或数字开头"}
	}
	if in.Branch == "" {
		in.Branch = "codex/" + in.Slug
	}
	ps, err := a.Workspace.Store.ProjectMap()
	if err != nil {
		return WorkspaceReview{}, nil, err
	}
	if in.PrimaryProjectID != "" {
		if _, ok := ps[in.PrimaryProjectID]; !ok {
			return WorkspaceReview{}, nil, &OperationError{Status: 400, Message: "请选择已登记的主项目"}
		}
	}
	ids := []string{}
	seen := map[string]bool{}
	if in.PrimaryProjectID != "" {
		ids = append(ids, in.PrimaryProjectID)
		seen[in.PrimaryProjectID] = true
	}
	for _, id := range in.ProjectIDs {
		if !seen[id] {
			if _, ok := ps[id]; !ok {
				return WorkspaceReview{}, nil, &OperationError{Status: 400, Message: "参与项目不存在，请刷新页面"}
			}
			ids = append(ids, id)
			seen[id] = true
		}
	}
	selections, err := selectionsByProject(in.Members)
	if err != nil {
		return WorkspaceReview{}, nil, &OperationError{Status: 400, Message: err.Error()}
	}
	for _, selection := range in.Members {
		if _, ok := ps[selection.ProjectID]; !ok {
			return WorkspaceReview{}, nil, &OperationError{Status: 400, Message: "参与项目不存在，请刷新页面"}
		}
		if !seen[selection.ProjectID] {
			ids = append(ids, selection.ProjectID)
			seen[selection.ProjectID] = true
		}
	}
	if len(ids) == 0 || len(ids) > 30 {
		return WorkspaceReview{}, nil, &OperationError{Status: 400, Message: "请选择 1–30 个项目"}
	}
	if in.PrimaryProjectID == "" {
		in.PrimaryProjectID = ids[0]
	}
	var count int
	if err := a.Workspace.Store.DB.QueryRow(`SELECT count(*) FROM requirements WHERE slug=? COLLATE NOCASE`, in.Slug).Scan(&count); err != nil {
		return WorkspaceReview{}, nil, err
	}
	if count > 0 {
		return WorkspaceReview{}, nil, &OperationError{Status: 409, Message: "任务目录标识已使用，请换一个标识"}
	}
	directory := platform.JoinWorkspacePath(a.Workspace.Root, in.Slug)
	resolved, err := workspace.Eval(ctx, a.Workspace.Root)
	if err != nil || resolved != a.Workspace.Root || !platform.Within(a.Workspace.Root, directory) {
		return WorkspaceReview{}, nil, &OperationError{Status: 422, Message: "工作区根目录已移动或不可用，请检查服务配置"}
	}
	if _, err := workspace.Stat(ctx, directory, false); !errors.Is(err, os.ErrNotExist) {
		return WorkspaceReview{}, nil, &OperationError{Status: 409, Message: "工作区目录已存在或无法检查，不能覆盖：" + directory}
	}
	q := model.Requirement{ID: model.NewID(), Name: in.Name, Slug: in.Slug, Description: in.Description, Branch: in.Branch, Path: directory, PrimaryProjectID: in.PrimaryProjectID, State: "creating", CreatedAt: model.Now(), Members: []model.Member{}}
	problems := []string{}
	for _, id := range ids {
		p := ps[id]
		m, err := selectedMember(ctx, p, directory, in.Branch, selections[id])
		if err != nil {
			problems = append(problems, p.Name+"："+err.Error())
			continue
		}
		q.Members = append(q.Members, m)
	}
	if len(problems) > 0 {
		return WorkspaceReview{}, nil, &OperationError{Status: 422, Message: "创建前检查未通过，未创建任何 Worktree", Details: problems}
	}
	hasNew := false
	for _, m := range q.Members {
		hasNew = hasNew || createsWorktree(m.Mode)
	}
	q.HasWorkspace = hasNew
	if !hasNew {
		q.Branch = ""
	}
	projects := make([]model.Project, 0, len(ids))
	for _, id := range ids {
		projects = append(projects, ps[id])
	}
	return WorkspaceReview{Input: in, Requirement: q, Projects: projects}, ps, nil
}

func (a *Service) persistWorkspace(ctx context.Context, q model.Requirement, ps map[string]model.Project) (model.Requirement, error) {
	if err := ctx.Err(); err != nil {
		return q, err
	}
	directory := q.Path
	if q.HasWorkspace {
		if err := workspace.Mkdir(ctx, directory, 0755, false); err != nil {
			return q, &OperationError{Status: 409, Message: "无法创建工作区目录：" + err.Error()}
		}
	}
	tx, err := a.Workspace.Store.DB.Begin()
	if err != nil {
		if q.HasWorkspace {
			_ = workspace.Remove(ctx, directory)
		}
		return q, err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`INSERT INTO requirements(id,name,slug,description,branch,path,primary_project_id,state,created_at,has_workspace) VALUES(?,?,?,?,?,?,?,?,?,?)`, q.ID, q.Name, q.Slug, q.Description, q.Branch, q.Path, q.PrimaryProjectID, q.State, q.CreatedAt, q.HasWorkspace)
	if err == nil {
		for _, m := range q.Members {
			_, err = tx.Exec(`INSERT INTO members(requirement_id,project_id,path,base_commit,state,mode,base_ref,branch) VALUES(?,?,?,?,?,?,?,?)`, q.ID, m.ProjectID, m.Path, m.BaseCommit, m.State, m.Mode, m.BaseRef, m.Branch)
			if err != nil {
				break
			}
		}
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		if q.HasWorkspace {
			_ = workspace.Remove(ctx, directory)
		}
		return q, err
	}
	if err := a.Prepare(ctx, &q, ps); err != nil {
		return q, err
	}
	return q, nil
}

func (a *Service) ReviewWorkspace(ctx context.Context, in CreateRequirement) (WorkspaceReview, error) {
	unlock, err := a.lockProjects(ctx, creationProjectIDs(in))
	if err != nil {
		return WorkspaceReview{}, err
	}
	defer unlock()

	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	review, _, err := a.workspaceReview(ctx, in)
	return review, err
}

func (a *Service) CreateWorkspace(ctx context.Context, in CreateRequirement) (model.Requirement, error) {
	defer a.stateChanged()
	unlock, err := a.lockProjects(ctx, creationProjectIDs(in))
	if err != nil {
		return model.Requirement{}, err
	}
	defer unlock()

	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	review, ps, err := a.workspaceReview(ctx, in)
	if err != nil {
		return model.Requirement{}, err
	}
	return a.persistWorkspace(ctx, review.Requirement, ps)
}

func (a *Service) ExecuteWorkspace(ctx context.Context, review WorkspaceReview) (model.Requirement, error) {
	defer a.stateChanged()
	unlock, err := a.lockProjects(ctx, creationProjectIDs(review.Input))
	if err != nil {
		return model.Requirement{}, err
	}
	defer unlock()

	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	if q, found, err := a.reconcileWorkspace(ctx, review); err != nil || found {
		return q, err
	}
	current, ps, err := a.workspaceReview(ctx, review.Input)
	if err != nil {
		return model.Requirement{}, err
	}
	current.Requirement.ID = review.Requirement.ID
	current.Requirement.CreatedAt = review.Requirement.CreatedAt
	if !reflect.DeepEqual(current, review) {
		return model.Requirement{}, &OperationError{Status: 409, Message: "项目、分支或工作目录已变化，请重新检查并确认计划"}
	}
	return a.persistWorkspace(ctx, review.Requirement, ps)
}

// A committed metadata record is authoritative after interruption. Recovery
// returns its actual member states without silently retrying Git preparation.
func (a *Service) reconcileWorkspace(ctx context.Context, review WorkspaceReview) (model.Requirement, bool, error) {
	q, err := a.Workspace.Store.Requirement(review.Requirement.ID)
	if errors.Is(err, sql.ErrNoRows) {
		if review.Requirement.Path != "" {
			if _, statErr := workspace.Stat(ctx, review.Requirement.Path, false); !errors.Is(statErr, os.ErrNotExist) {
				return q, false, &OperationError{Status: 409, Message: "发现未登记的工作区目录，执行结果不确定，请检查实际目录后恢复"}
			}
		}
		return q, false, nil
	}
	if err != nil {
		return q, false, err
	}
	if !sameWorkspaceIdentity(q, review.Requirement) {
		return q, true, &OperationError{Status: 409, Message: "工作区结果与已确认计划不一致，请检查实际资源"}
	}
	return q, true, nil
}
func (a *Service) ReconcileWorkspace(ctx context.Context, review WorkspaceReview) (model.Requirement, bool, error) {
	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	return a.reconcileWorkspace(ctx, review)
}

func sameMemberIdentity(a, b model.Member) bool {
	return a.ProjectID == b.ProjectID && a.Path == b.Path && a.BaseCommit == b.BaseCommit && a.BaseRef == b.BaseRef && a.Branch == b.Branch && a.Mode == b.Mode
}
func sameWorkspaceIdentity(a, b model.Requirement) bool {
	if a.ID != b.ID || a.Name != b.Name || a.Slug != b.Slug || a.Description != b.Description || a.Branch != b.Branch || a.Path != b.Path || a.PrimaryProjectID != b.PrimaryProjectID || a.HasWorkspace != b.HasWorkspace || len(a.Members) != len(b.Members) {
		return false
	}
	members := make(map[string]model.Member, len(a.Members))
	for _, m := range a.Members {
		members[m.ProjectID] = m
	}
	for _, m := range b.Members {
		if !sameMemberIdentity(members[m.ProjectID], m) {
			return false
		}
	}
	return true
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
