package task

import (
	"context"
	"database/sql"
	"errors"
	"reflect"

	"worktree-hub/internal/model"
)

type AttachProjectsInput struct {
	ProjectIDs []string          `json:"project_ids"`
	Members    []MemberSelection `json:"members"`
}

// AttachmentReview binds an addition to the workspace's current metadata and
// the exact new member paths, branches and source commits.
type AttachmentReview struct {
	Input       AttachProjectsInput `json:"input"`
	Requirement model.Requirement   `json:"requirement"`
	Added       []model.Member      `json:"added"`
	Projects    []model.Project     `json:"projects"`
}

func (a *Service) attachmentReview(ctx context.Context, id string, in AttachProjectsInput) (AttachmentReview, map[string]model.Project, error) {
	q, err := a.Workspace.Store.Requirement(id)
	if errors.Is(err, sql.ErrNoRows) {
		return AttachmentReview{}, nil, &OperationError{Status: 404, Message: "任务不存在"}
	}
	if err != nil {
		return AttachmentReview{}, nil, err
	}
	if q.State == "archived" || q.State == "creating" {
		return AttachmentReview{}, nil, &OperationError{Status: 409, Message: "请先取消归档或等待任务创建完成，再添加项目"}
	}
	ps, err := a.Workspace.Store.ProjectMap()
	if err != nil {
		return AttachmentReview{}, nil, err
	}
	selections, err := selectionsByProject(in.Members)
	if err != nil {
		return AttachmentReview{}, nil, &OperationError{Status: 400, Message: err.Error()}
	}
	ids := append([]string{}, in.ProjectIDs...)
	for _, selection := range in.Members {
		ids = append(ids, selection.ProjectID)
	}
	existing := map[string]bool{}
	for _, m := range q.Members {
		existing[m.ProjectID] = true
	}
	selected := map[string]bool{}
	added := []model.Member{}
	problems := []string{}
	for _, id := range ids {
		if selected[id] {
			continue
		}
		p, ok := ps[id]
		if !ok {
			return AttachmentReview{}, nil, &OperationError{Status: 400, Message: "参与项目不存在，请刷新页面"}
		}
		if existing[id] {
			return AttachmentReview{}, nil, &OperationError{Status: 409, Message: "项目已关联当前任务：" + p.Name}
		}
		selected[id] = true
		branch := q.Branch
		if branch == "" {
			branch = "codex/" + q.Slug
		}
		m, err := selectedMember(ctx, p, q.Path, branch, selections[id])
		if err != nil {
			problems = append(problems, p.Name+"："+err.Error())
			continue
		}
		added = append(added, m)
	}
	if len(selected) == 0 || len(q.Members)+len(selected) > 30 {
		return AttachmentReview{}, nil, &OperationError{Status: 400, Message: "请选择要添加的项目，单个任务最多包含 30 个项目"}
	}
	if len(problems) > 0 {
		return AttachmentReview{}, nil, &OperationError{Status: 422, Message: "添加前检查未通过，未添加任何项目", Details: problems}
	}
	projects := make([]model.Project, 0, len(added))
	for _, m := range added {
		projects = append(projects, ps[m.ProjectID])
	}
	return AttachmentReview{Input: in, Requirement: q, Added: added, Projects: projects}, ps, nil
}

func (a *Service) persistAttachment(ctx context.Context, review AttachmentReview, ps map[string]model.Project) (model.Requirement, error) {
	q := review.Requirement
	if err := ctx.Err(); err != nil {
		return q, err
	}
	added := review.Added
	selected := make(map[string]bool, len(added))
	for _, m := range added {
		selected[m.ProjectID] = true
	}
	var err error
	preview := q
	preview.Members = append(append([]model.Member{}, q.Members...), added...)
	needsWorkspace := false
	for _, m := range added {
		needsWorkspace = needsWorkspace || createsWorktree(m.Mode)
		q.HasWorkspace = q.HasWorkspace || createsWorktree(m.Mode)
	}
	if needsWorkspace {
		err = ensureTaskWorkspace(ctx, preview)
	}
	if err != nil {
		return q, &OperationError{Status: 422, Message: err.Error()}
	}
	tx, err := a.Workspace.Store.DB.Begin()
	if err != nil {
		return q, err
	}
	defer tx.Rollback()
	for _, m := range added {
		if _, err := tx.Exec(`INSERT INTO members(requirement_id,project_id,path,base_commit,state,mode,base_ref,branch) VALUES(?,?,?,?,?,?,?,?)`, q.ID, m.ProjectID, m.Path, m.BaseCommit, m.State, m.Mode, m.BaseRef, m.Branch); err != nil {
			return q, err
		}
	}
	if q.PrimaryProjectID == "" && len(added) > 0 {
		q.PrimaryProjectID = added[0].ProjectID
	}
	if _, err := tx.Exec(`UPDATE requirements SET state='creating',has_workspace=?,primary_project_id=NULLIF(?,'') WHERE id=?`, q.HasWorkspace, q.PrimaryProjectID, q.ID); err != nil {
		return q, err
	}
	// Append the new scope while preserving all existing task notes.
	if err := appendProjectsBriefContext(ctx, q, added); err != nil {
		return q, &OperationError{Status: 422, Message: "无法更新任务说明，未添加项目：" + err.Error()}
	}
	if err := tx.Commit(); err != nil {
		return q, err
	}
	q.Members = append(q.Members, added...)
	if err := a.PrepareMembers(ctx, &q, ps, selected); err != nil {
		return q, err
	}
	return q, nil
}

func (a *Service) ReviewAttachProjects(ctx context.Context, id string, in AttachProjectsInput) (AttachmentReview, error) {
	unlock, err := a.lockProjects(ctx, attachmentProjectIDs(in))
	if err != nil {
		return AttachmentReview{}, err
	}
	defer unlock()

	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	review, _, err := a.attachmentReview(ctx, id, in)
	return review, err
}

func (a *Service) AttachProjects(ctx context.Context, id string, in AttachProjectsInput) (model.Requirement, error) {
	defer a.stateChanged()
	unlock, err := a.lockProjects(ctx, attachmentProjectIDs(in))
	if err != nil {
		return model.Requirement{}, err
	}
	defer unlock()

	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	review, ps, err := a.attachmentReview(ctx, id, in)
	if err != nil {
		return model.Requirement{}, err
	}
	return a.persistAttachment(ctx, review, ps)
}

func (a *Service) ExecuteAttachProjects(ctx context.Context, review AttachmentReview) (model.Requirement, error) {
	defer a.stateChanged()
	unlock, err := a.lockProjects(ctx, attachmentProjectIDs(review.Input))
	if err != nil {
		return model.Requirement{}, err
	}
	defer unlock()

	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	if q, found, err := a.reconcileAttachment(ctx, review); err != nil || found {
		return q, err
	}
	current, ps, err := a.attachmentReview(ctx, review.Requirement.ID, review.Input)
	if err != nil {
		return model.Requirement{}, err
	}
	if !reflect.DeepEqual(current, review) {
		return model.Requirement{}, &OperationError{Status: 409, Message: "工作区、项目或来源分支已变化，请重新检查并确认计划"}
	}
	return a.persistAttachment(ctx, review, ps)
}

func (a *Service) reconcileAttachment(ctx context.Context, review AttachmentReview) (model.Requirement, bool, error) {
	q, err := a.Workspace.Store.Requirement(review.Requirement.ID)
	if err != nil {
		return q, false, err
	}
	count := 0
	members := make(map[string]model.Member, len(q.Members))
	for _, m := range q.Members {
		members[m.ProjectID] = m
	}
	for _, m := range review.Added {
		if actual, ok := members[m.ProjectID]; ok {
			count++
			if !sameMemberIdentity(actual, m) {
				return q, true, &OperationError{Status: 409, Message: "已添加的项目与已确认计划不一致，请检查实际资源"}
			}
		}
	}
	if count == 0 {
		return q, false, nil
	}
	if count != len(review.Added) {
		return q, true, &OperationError{Status: 409, Message: "只找到部分添加结果，请检查实际资源后恢复"}
	}
	expected := review.Requirement
	expected.Members = append(append([]model.Member{}, expected.Members...), review.Added...)
	for _, m := range review.Added {
		expected.HasWorkspace = expected.HasWorkspace || createsWorktree(m.Mode)
	}
	if expected.PrimaryProjectID == "" && len(review.Added) > 0 {
		expected.PrimaryProjectID = review.Added[0].ProjectID
	}
	if !sameWorkspaceIdentity(q, expected) {
		return q, true, &OperationError{Status: 409, Message: "工作区结果与已确认计划不一致，请检查实际资源"}
	}
	return q, true, nil
}
func (a *Service) ReconcileAttachProjects(ctx context.Context, review AttachmentReview) (model.Requirement, bool, error) {
	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	return a.reconcileAttachment(ctx, review)
}
