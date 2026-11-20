package workspace

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

type CreateWorkspaceInput struct {
	Name             string            `json:"name"`
	Slug             string            `json:"slug"`
	Description      string            `json:"description"`
	Branch           string            `json:"branch"`
	PrimaryProjectID string            `json:"primary_project_id"`
	ProjectIDs       []string          `json:"project_ids"`
	Members          []MemberSelection `json:"members"`
}

// Read the persisted workspace without waiting on the lock held by its Git work.
func (a *Service) CreationProgressHandler(w http.ResponseWriter, r *http.Request) {
	slug := r.URL.Query().Get("slug")
	if !execution.ValidSlug.MatchString(slug) {
		httpx.WriteError(w, 400, "无效的工作区目录标识")
		return
	}
	q, err := a.Execution.Store.WorkspaceBySlug(slug)
	if errors.Is(err, sql.ErrNoRows) {
		// Validation and preflight run before the workspace is saved.
		httpx.WriteJSON(w, 200, nil)
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, q)
}

func (a *Service) CreateWorkspaceHandler(w http.ResponseWriter, r *http.Request) {
	var in CreateWorkspaceInput
	if !httpx.Decode(w, r, &in) {
		return
	}
	q, err := a.CreateWorkspace(r.Context(), in)
	if err != nil {
		writeOperationError(w, err)
		return
	}
	httpx.WriteJSON(w, 201, q)
}

func VerifyMember(ctx context.Context, p model.Project, m model.Member, branch string) error {
	st, err := execution.Stat(ctx, m.Path, false)
	if err != nil {
		return err
	}
	if st.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("Worktree 路径是符号链接，拒绝使用")
	}
	top, err := execution.Git(ctx, m.Path, "rev-parse", "--show-toplevel")
	if err != nil {
		return err
	}
	if !platform.SameWorkspacePath(strings.TrimSpace(top), m.Path) {
		return fmt.Errorf("该路径已不再是独立 Worktree")
	}
	common, err := execution.Git(ctx, m.Path, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return err
	}
	commonPath, err := execution.Eval(ctx, strings.TrimSpace(common))
	if err != nil || commonPath != p.CommonDir {
		return fmt.Errorf("该路径属于其他仓库")
	}
	if m.Mode == "project" || m.Mode == "worktree" {
		raw, err := execution.Git(ctx, p.Path, "worktree", "list", "--porcelain", "-z")
		if err != nil {
			return err
		}
		for _, field := range strings.Split(raw, "\x00") {
			if strings.HasPrefix(field, "worktree ") && platform.SameWorkspacePath(strings.TrimPrefix(field, "worktree "), m.Path) {
				return nil
			}
		}
		return fmt.Errorf("该目录不是此项目的已登记 Worktree")
	}
	branch = memberBranch(m, branch)
	actual, err := execution.Git(ctx, m.Path, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err != nil || strings.TrimSpace(actual) != branch {
		return fmt.Errorf("实际分支与工作区分支 %s 不一致，请恢复后再启动", branch)
	}
	// The creation baseline is a recovery guard, not a restriction on later
	// explicit branch switches. Keep it intact as historical workspace metadata.
	if m.State != "ready" {
		if _, err := execution.Git(ctx, m.Path, "merge-base", "--is-ancestor", m.BaseCommit, "HEAD"); err != nil {
			return fmt.Errorf("Worktree 已偏离创建时记录的基线，请检查后处理")
		}
	}
	return nil
}
func (a *Service) Prepare(ctx context.Context, q *model.Workspace, ps map[string]model.Project) error {
	return a.PrepareMembers(ctx, q, ps, nil)
}

// selected limits an addition to its new members; existing failures remain available for explicit retry.
func (a *Service) PrepareMembers(ctx context.Context, q *model.Workspace, ps map[string]model.Project, selected map[string]bool) error {
	q.State = "creating"
	if _, err := a.Execution.Store.DB.Exec(`UPDATE workspaces SET state='creating' WHERE id=?`, q.ID); err != nil {
		return err
	}
	briefErr := WriteBriefContext(ctx, *q)
	if briefErr != nil {
		q.ContextWarning = briefErr.Error()
	}
	for i := range q.Members {
		m := &q.Members[i]
		if m.State == "ready" || (selected != nil && !selected[m.ProjectID]) {
			continue
		}
		initialExisting := m.Mode == "existing" && m.State == "pending"
		restoreRemoved := m.State == "removed"
		verify := func() error {
			observed := *m
			if restoreRemoved {
				observed.State = "ready"
			}
			if err := VerifyMember(ctx, ps[m.ProjectID], observed, q.Branch); err != nil {
				return err
			}
			if initialExisting {
				head, err := execution.Git(ctx, m.Path, "rev-parse", "--verify", "HEAD^{commit}")
				if err != nil || strings.TrimSpace(head) != m.BaseCommit {
					return fmt.Errorf("已有分支提交已变化，请检查实际 Worktree 后重新确认")
				}
			}
			return nil
		}
		m.State = "creating"
		m.Error = ""
		if _, err := a.Execution.Store.DB.Exec(`UPDATE members SET state='creating',error='' WHERE workspace_id=? AND project_id=?`, q.ID, m.ProjectID); err != nil {
			return err
		}
		p := ps[m.ProjectID]
		var createErr error
		if briefErr != nil {
			createErr = briefErr
		} else if (m.Mode == "project" || m.Mode == "worktree") && !restoreRemoved {
			createErr = VerifyMember(ctx, p, *m, "")
		} else if !platform.Within(q.Path, m.Path) {
			createErr = fmt.Errorf("Worktree 路径越过工作区目录")
		} else if _, err := execution.Stat(ctx, m.Path, false); err == nil {
			// Recover only the exact persisted repository/path/branch combination, never overwrite it.
			createErr = verify()
		} else if !errors.Is(err, os.ErrNotExist) {
			createErr = err
		} else if m.Mode == "existing" || restoreRemoved {
			createErr = availableLocalBranch(ctx, p, m.Branch)
			if createErr == nil && initialExisting {
				head, err := execution.Git(ctx, p.Path, "rev-parse", "--verify", "refs/heads/"+m.Branch+"^{commit}")
				if err != nil || strings.TrimSpace(head) != m.BaseCommit {
					createErr = fmt.Errorf("已有分支提交已变化，请重新检查并确认")
				}
			}
			if createErr == nil {
				_, createErr = execution.Git(ctx, p.Path, "worktree", "add", "--", m.Path, m.Branch)
			}
			if createErr == nil {
				createErr = verify()
			}
		} else if _, err := execution.Git(ctx, p.Path, "rev-parse", "--verify", "--quiet", "refs/heads/"+memberBranch(*m, q.Branch)); err == nil {
			createErr = fmt.Errorf("分支 %s 已存在但 Worktree 不存在，请先检查残留分支", memberBranch(*m, q.Branch))
		} else {
			_, createErr = execution.Git(ctx, p.Path, "worktree", "add", "--no-track", "-b", memberBranch(*m, q.Branch), "--", m.Path, m.BaseCommit)
			if createErr == nil {
				createErr = verify()
			}
		}
		if createErr != nil {
			m.State = "failed"
			m.Error = createErr.Error()
		} else {
			m.State = "ready"
		}
		if _, err := a.Execution.Store.DB.Exec(`UPDATE members SET state=?,error=? WHERE workspace_id=? AND project_id=?`, m.State, m.Error, q.ID, m.ProjectID); err != nil {
			return err
		}
	}
	q.State = "ready"
	for _, m := range q.Members {
		if m.State != "ready" {
			q.State = "partial"
			break
		}
	}
	_, err := a.Execution.Store.DB.Exec(`UPDATE workspaces SET state=? WHERE id=?`, q.State, q.ID)
	return err
}
func writeBrief(q model.Workspace) error {
	return WriteBriefContext(context.Background(), q)
}
func WriteBriefContext(ctx context.Context, q model.Workspace) error {
	if !q.HasDirectory {
		return nil
	}
	if _, err := execution.Stat(ctx, q.Path, false); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n%s\n\n## 项目与工作目录\n\n各项目使用下列工作目录；新建工作目录的来源与提交分别记录。\n\n", q.Name, q.Description)
	for _, m := range q.Members {
		role := "参与项目"
		if m.ProjectID == q.PrimaryProjectID {
			role = "主项目"
		}
		fmt.Fprintf(&b, "- %s（%s）：%s\n  %s\n", m.ProjectName, role, m.Path, memberDescription(m))
	}
	b.WriteString("\n请分别遵循每个项目内适用的 AGENTS.md。Git、构建和测试命令需在对应项目目录执行。\n")
	const marker = "<!-- work-hub:workspace-context v1 -->\n"
	const previousMarker = "<!-- work-hub:task-context v1 -->\n"
	if err := execution.WriteGenerated(ctx, platform.JoinWorkspacePath(q.Path, "WORK_HUB_CONTEXT.md"), []byte(marker+"\n"+b.String()), marker, previousMarker); err != nil {
		return fmt.Errorf("无法更新自动工作区上下文：%w", err)
	}
	path := platform.JoinWorkspacePath(q.Path, "BRIEF.md")
	err := execution.Write(ctx, path, []byte("> 最新工作区目标与目录清单见 WORK_HUB_CONTEXT.md（自动更新）；此文件保留为工作区笔记。\n\n"+b.String()), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if errors.Is(err, os.ErrExist) {
		st, statErr := execution.Stat(ctx, path, false)
		if statErr != nil || !st.Mode().IsRegular() {
			return fmt.Errorf("工作区说明不是普通文件，请检查 BRIEF.md")
		}
		return nil // Preserve user notes when retrying an interrupted creation.
	}
	if err != nil {
		return fmt.Errorf("无法写入工作区说明：%w", err)
	}
	return nil
}
func (a *Service) RetryHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ProjectID string `json:"project_id"`
	}
	if r.ContentLength != 0 && !httpx.Decode(w, r, &input) {
		return
	}
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	q, err := a.Execution.Store.Workspace(r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "工作区不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if q.State == "archived" {
		httpx.WriteError(w, 409, "请先取消归档")
		return
	}
	var selected map[string]bool
	if input.ProjectID != "" {
		selected = map[string]bool{input.ProjectID: true}
		found := false
		for _, m := range q.Members {
			found = found || m.ProjectID == input.ProjectID
		}
		if !found {
			httpx.WriteError(w, 404, "项目未关联当前工作区")
			return
		}
	}
	needsWorkspace := false
	for _, m := range q.Members {
		if (selected == nil || selected[m.ProjectID]) && ((m.Mode != "project" && m.Mode != "worktree") || m.State == "removed") {
			needsWorkspace = true
		}
	}
	if needsWorkspace {
		if err := ensureWorkspaceDirectory(r.Context(), q); err != nil {
			httpx.WriteError(w, 422, err.Error())
			return
		}
	}
	ps, err := a.Execution.Store.ProjectMap()
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if err := a.PrepareMembers(r.Context(), &q, ps, selected); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, q)
}
func (a *Service) ArchiveHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Archived bool `json:"archived"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	q, err := a.Execution.Store.Workspace(r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "工作区不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	state := "archived"
	if !in.Archived {
		state = "ready"
		for _, m := range q.Members {
			if m.State != "ready" {
				state = "partial"
			}
		}
	}
	if _, err := a.Execution.Store.DB.Exec(`UPDATE workspaces SET state=? WHERE id=?`, state, q.ID); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "状态已更新，Worktree 和分支均保留"})
}
