package session

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/project"
)

type bindingInput struct {
	SessionID   string `json:"session_id,omitempty"`
	Provider    string `json:"provider,omitempty"`
	ProjectID   string `json:"project_id,omitempty"`
	Directory   string `json:"directory,omitempty"`
	Role        string `json:"role,omitempty"`
	Access      string `json:"access,omitempty"`
	AllowShared bool   `json:"allow_shared,omitempty"`
}

type directoryConflict struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Cwd  string `json:"cwd"`
}

type bindingView struct {
	MainDirectory string `json:"main_directory,omitempty"`
	model.SessionProjectBinding
	ProjectName string              `json:"project_name,omitempty"`
	WorktreeID  string              `json:"worktree_id,omitempty"`
	Worktree    *model.Worktree     `json:"worktree,omitempty"`
	Conflicts   []directoryConflict `json:"conflicts,omitempty"`
	Git         *bindingGit         `json:"git,omitempty"`
	Warning     string              `json:"warning,omitempty"`
	Observed    []string            `json:"observed,omitempty"`
	Attributed  []string            `json:"attributed,omitempty"`
	Activities  []HistoryEntry      `json:"activities,omitempty"`
}

type bindingGit struct {
	Files     []project.ChangedFile `json:"files"`
	Additions int                   `json:"additions,omitempty"`
	Deletions int                   `json:"deletions,omitempty"`
}

const maxSessionBindings = 24

func canonicalDirectory(ctx context.Context, path string) (string, error) {
	if !platform.AbsoluteWorkspacePath(path) || strings.ContainsRune(path, 0) || len(path) > 4096 {
		return "", invalidSessionTarget("请选择绝对工作目录")
	}
	for _, part := range strings.FieldsFunc(path, func(ch rune) bool { return ch == '/' || ch == '\\' }) {
		if part == ".." {
			return "", invalidSessionTarget("请选择不包含上级路径的实际目录")
		}
	}
	p, err := execution.Eval(ctx, path)
	if err != nil {
		return "", fmt.Errorf("工作目录不可用 %s：%w", path, err)
	}
	info, err := execution.Stat(ctx, p, false)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("工作目录不可用：%s", path)
	}
	return p, nil
}

func (a *Service) inspectBinding(ctx context.Context, input bindingInput, files bool) (bindingView, error) {
	v := bindingView{SessionProjectBinding: model.SessionProjectBinding{
		SessionID: input.SessionID, ProjectID: input.ProjectID, Role: input.Role, Access: input.Access, Status: "pending",
	}}
	if v.Role == "" {
		v.Role = model.SessionBindingAdditional
	}
	if v.Role != model.SessionBindingPrimary && v.Role != model.SessionBindingAdditional {
		return v, invalidSessionTarget("目录角色无效")
	}
	if v.Access == "" {
		v.Access = model.SessionBindingRead
	}
	if v.Access != model.SessionBindingRead && v.Access != model.SessionBindingWrite {
		return v, invalidSessionTarget("目录访问权限无效")
	}
	var p model.Project
	var err error
	if input.ProjectID != "" {
		p, err = project.LookupProject(ctx, a.Execution, input.ProjectID)
		if err != nil {
			return v, err
		}
		v.ProjectName = p.Name
		if input.Directory == "" {
			input.Directory = p.Path
		}
	}
	v.Directory, err = canonicalDirectory(ctx, input.Directory)
	if err != nil {
		return v, err
	}
	top, gitErr := execution.Git(ctx, v.Directory, "rev-parse", "--show-toplevel")
	if gitErr != nil && input.ProjectID != "" {
		return v, fmt.Errorf("无法验证项目的 Git 工作目录：%w", gitErr)
	}
	isGitRoot := false
	if gitErr == nil {
		top, gitErr = execution.Eval(ctx, strings.TrimSpace(top))
		isGitRoot = gitErr == nil && platform.SameWorkspacePath(top, v.Directory)
	}
	if input.ProjectID != "" {
		if !isGitRoot {
			return v, invalidSessionTarget("请选择该项目实际存在的 Worktree")
		}
		common, err := execution.Git(ctx, v.Directory, "rev-parse", "--path-format=absolute", "--git-common-dir")
		if err != nil {
			return v, err
		}
		common, err = execution.Eval(ctx, strings.TrimSpace(common))
		if err != nil || !platform.SameWorkspacePath(common, p.CommonDir) {
			return v, invalidSessionTarget("工作目录的仓库归属与所选项目不匹配")
		}
		raw, err := execution.Git(ctx, p.Path, "worktree", "list", "--porcelain", "-z")
		if err != nil {
			return v, fmt.Errorf("无法核对登记的 Worktree：%w", err)
		}
		listed := false
		for _, worktree := range project.ParseWorktrees(raw) {
			if !worktree.Bare && platform.SameWorkspacePath(worktree.Path, v.Directory) {
				listed = true
				break
			}
		}
		if !listed {
			return v, invalidSessionTarget("目录已不在项目的 Worktree 列表中")
		}
	}
	if isGitRoot {
		if files {
			if raw, err := execution.Git(ctx, v.Directory, "worktree", "list", "--porcelain", "-z"); err == nil {
				if trees := project.ParseWorktrees(raw); len(trees) > 0 {
					v.MainDirectory = trees[0].Path
				}
			}

			state, err := execution.ReadGitState(ctx, v.Directory)
			if err != nil {
				return v, fmt.Errorf("无法读取 Git 状态：%w", err)
			}
			v.Branch, v.Worktree = state.Branch, &state
			changed, err := project.ReadDirectoryChanges(ctx, v.Directory)
			if err != nil {
				v.Warning = "无法监测 Git 文件状态：" + err.Error()
			} else {
				additions, deletions := project.ReadDirectoryDiffStats(ctx, v.Directory, changed)
				v.Git = &bindingGit{Files: changed, Additions: additions, Deletions: deletions}
			}
		} else {
			branch, err := execution.Git(ctx, v.Directory, "symbolic-ref", "--short", "HEAD")
			if err == nil {
				v.Branch = strings.TrimSpace(branch)
			}
		}
		v.WorktreeID = v.Directory
	} else if files {
		v.Warning = "此目录没有独立 Git 状态。对话期间仅监测普通文件变化。"
	}
	return v, nil
}

func sameOrNested(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	if platform.SameWorkspacePath(a, b) || platform.Within(a, b) || platform.Within(b, a) {
		return true
	}
	// Some local volumes accept multiple case spellings of the same path.
	if !filepath.IsAbs(a) || !filepath.IsAbs(b) {
		return false
	}
	left, leftErr := os.Stat(a)
	right, rightErr := os.Stat(b)
	return leftErr == nil && rightErr == nil && (directoryContainsInode(left, b) || directoryContainsInode(right, a))
}

func directoryContainsInode(ancestor os.FileInfo, directory string) bool {
	for {
		current, err := os.Stat(directory)
		if err == nil && os.SameFile(ancestor, current) {
			return true
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return false
		}
		directory = parent
	}
}

func validateBindingSet(items []model.SessionProjectBinding) error {
	if len(items) > maxSessionBindings {
		return invalidSessionTarget("对话关联目录数量已达上限")
	}
	for i, item := range items {
		for _, previous := range items[:i] {
			if previous.Role == model.SessionBindingPrimary && item.Role == model.SessionBindingPrimary {
				return invalidSessionTarget("对话只能设置一个主项目目录")
			}
			if sameOrNested(previous.Directory, item.Directory) {
				return invalidSessionTarget("同一对话的关联目录不能重复或互相包含")
			}
		}
	}
	return nil
}

func (a *Service) neutralDirectoryRoot(ctx context.Context) (string, error) {
	root := a.Execution.DataDir
	if a.Execution.Remote != nil {
		root = a.Execution.Remote.Identity.Home
	}
	base, err := canonicalDirectory(ctx, root)
	if err != nil {
		return "", err
	}
	root = platform.JoinWorkspacePath(base, "conversation-directories")
	if a.Execution.Remote != nil {
		root = platform.JoinWorkspacePath(base, ".local", "share", "yolu", "conversation-directories")
	}
	if err := execution.Mkdir(ctx, root, 0700, true); err != nil {
		return "", err
	}
	dir, err := canonicalDirectory(ctx, root)
	if err != nil || !platform.Within(base, dir) || !platform.SameWorkspacePath(dir, root) {
		return "", fmt.Errorf("对话目录根路径已变化")
	}
	return dir, nil
}

func (a *Service) neutralDirectory(ctx context.Context, key string) (string, error) {
	root, err := a.neutralDirectoryRoot(ctx)
	if err != nil {
		return "", fmt.Errorf("无法准备对话目录：%w", err)
	}
	path := platform.JoinWorkspacePath(root, fmt.Sprintf("%x", sha256.Sum256([]byte(key))))
	if err := execution.Mkdir(ctx, path, 0700, true); err != nil {
		return "", fmt.Errorf("无法准备对话目录：%w", err)
	}
	dir, err := canonicalDirectory(ctx, path)
	if err != nil || !platform.SameWorkspacePath(dir, path) {
		return "", fmt.Errorf("对话目录路径已变化")
	}
	return dir, nil
}

func (a *Service) resolveCreation(ctx context.Context, target SessionTarget, key string) (executionContext, error) {
	var out executionContext
	if len(target.Bindings) > maxSessionBindings {
		return out, invalidSessionTarget("对话关联目录数量已达上限")
	}
	requested := target.Bindings
	if target.ProjectID != "" || target.Cwd != "" {
		access := target.Access
		if access == "" {
			access = model.SessionBindingWrite
		}
		requested = append([]bindingInput{{
			ProjectID: target.ProjectID, Directory: target.Cwd, Access: access, Role: model.SessionBindingPrimary, AllowShared: target.AllowShared,
		}}, requested...)
	}
	dirs := []string{}
	allowedShared := []string{}
	for _, input := range requested {
		v, err := a.inspectBinding(ctx, input, false)
		if err != nil {
			return out, err
		}
		if v.Role == model.SessionBindingPrimary {
			out.plan.Cwd = v.Directory
		} else {
			dirs = append(dirs, v.Directory)
		}
		if input.AllowShared {
			allowedShared = append(allowedShared, v.Directory)
		}
		out.bindings = append(out.bindings, v.SessionProjectBinding)
	}
	if err := validateBindingSet(out.bindings); err != nil {
		return out, err
	}
	if out.plan.Cwd == "" {
		var err error
		out.plan.Cwd, err = a.neutralDirectory(ctx, "request:"+key)
		if err != nil {
			return out, err
		}
	}
	out.plan.AdditionalDirectories = dirs
	out.plan.Bindings = out.bindings
	out.plan.ManagedBindings = true
	out.plan.SharedDirectories = allowedShared
	out.plan.Title = "Codex"
	if model.NormalizeProvider(target.Provider) == model.ProviderAgy {
		out.plan.Title = "Antigravity"
	}
	out.instructions = "修改前请阅读实际工作目录中的 AGENTS.md，并在对应目录运行 Git、构建和测试。"
	return out, nil
}

// savedSessionPlan revalidates every grant on every run. The provider's original
// cwd is metadata and may lag an explicit context switch until the next turn.
func (a *Service) savedSessionPlan(ctx context.Context, record model.Session, allowShared bool) (model.LaunchPlan, error) {
	plan := model.LaunchPlan{Cwd: record.Cwd, AdditionalDirectories: []string{}, Permission: record.Permission, AllowShared: allowShared}
	var err error
	plan.ManagedBindings, err = a.Execution.Store.SessionBindingsManaged(record.ID)
	if err != nil {
		return plan, err
	}
	if !plan.ManagedBindings {
		plan.Cwd, err = canonicalDirectory(ctx, record.Cwd)
		if err != nil {
			return plan, err
		}
		for _, path := range record.AdditionalDirectories {
			dir, err := canonicalDirectory(ctx, path)
			if err != nil {
				return plan, err
			}
			plan.AdditionalDirectories = append(plan.AdditionalDirectories, dir)
		}
		return plan, nil
	}
	plan.Bindings, err = a.Execution.Store.SessionBindings(record.ID)
	if err != nil {
		return plan, err
	}
	if err := validateBindingSet(plan.Bindings); err != nil {
		return plan, err
	}
	plan.Cwd = ""
	for _, binding := range plan.Bindings {
		if _, err := a.validateStoredBinding(ctx, binding, false); err != nil {
			return plan, err
		}
		if binding.Role == model.SessionBindingPrimary {
			plan.Cwd = binding.Directory
		} else {
			plan.AdditionalDirectories = append(plan.AdditionalDirectories, binding.Directory)
		}
	}
	if plan.Cwd == "" {
		root, rootErr := a.neutralDirectoryRoot(ctx)
		if rootErr != nil {
			return plan, rootErr
		}
		if stored, readErr := canonicalDirectory(ctx, record.Cwd); readErr == nil && platform.Within(root, stored) {
			plan.Cwd = stored
		} else {
			plan.Cwd, err = a.neutralDirectory(ctx, "session:"+record.ID)
		}
	}
	return plan, err
}

func (a *Service) validateStoredBinding(ctx context.Context, binding model.SessionProjectBinding, files bool) (bindingView, error) {
	v, err := a.inspectBinding(ctx, bindingInput{SessionID: binding.SessionID, ProjectID: binding.ProjectID, Directory: binding.Directory, Access: binding.Access, Role: binding.Role}, files)
	if err == nil && !platform.SameWorkspacePath(binding.Directory, v.Directory) {
		err = fmt.Errorf("工作目录的实际路径已变化，请重新关联：%s", binding.Directory)
	}
	return v, err
}

// BindingDirectory gives host integrations the current canonical directory for
// a binding only after checking the persisted path and repository identity.
func (a *Service) BindingDirectory(ctx context.Context, id, bindingID string) (string, error) {
	ctx = execution.WithClient(ctx, a.Execution.Remote)
	b, err := a.lookupBinding(id, bindingID)
	if err != nil {
		return "", err
	}
	v, err := a.validateStoredBinding(ctx, b, false)
	return v.Directory, err
}

func (a *Service) lookupBinding(id, bindingID string) (model.SessionProjectBinding, error) {
	bindings, err := a.Execution.Store.SessionBindings(id)
	if err != nil {
		return model.SessionProjectBinding{}, err
	}
	for _, b := range bindings {
		if b.ID == bindingID {
			return b, nil
		}
	}
	return model.SessionProjectBinding{}, sql.ErrNoRows
}

func writeBindingError(w http.ResponseWriter, err error) {
	status := 409
	var invalid invalidSessionTarget
	if errors.Is(err, sql.ErrNoRows) {
		status = 404
	} else if errors.As(err, &invalid) {
		status = 400
	}
	httpx.WriteError(w, status, err.Error())
}

func (a *Service) InspectBindingHandler(w http.ResponseWriter, r *http.Request) {
	var input bindingInput
	if !httpx.Decode(w, r, &input) {
		return
	}
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	v, err := a.inspectBinding(ctx, input, true)
	if err != nil {
		writeBindingError(w, err)
		return
	}
	if v.Access == model.SessionBindingWrite {
		v.Conflicts = a.directoryConflicts(v.Directory, input.SessionID)
	}
	httpx.WriteJSON(w, 200, v)
}

func (a *Service) SessionBindingsHandler(w http.ResponseWriter, r *http.Request) {
	record, ok := a.requestSession(w, r)
	if ok {
		a.writeSessionBindings(w, r, record)
	}
}

func (a *Service) writeSessionBindings(w http.ResponseWriter, r *http.Request, record model.Session) {
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	managed, err := a.Execution.Store.SessionBindingsManaged(record.ID)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	bindings, err := a.Execution.Store.SessionBindings(record.ID)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	cwd := record.Cwd
	items := make([]bindingView, 0, len(bindings))
	for _, binding := range bindings {
		v, err := a.validateStoredBinding(ctx, binding, true)
		v.ID, v.CreatedAt, v.UpdatedAt = binding.ID, binding.CreatedAt, binding.UpdatedAt
		v.Status = "pending"
		if err != nil {
			v.Directory, v.Status, v.Error = binding.Directory, "error", err.Error()
		} else {
			if binding.Branch != "" && binding.Branch != v.Branch {
				v.Warning = "当前分支已从 " + binding.Branch + " 变化。"
			}
			if v.Access == model.SessionBindingWrite {
				v.Conflicts = a.directoryConflicts(v.Directory, record.ID)
			}
			a.decorateBindingRuntime(ctx, record, &v)
		}
		if v.Role == model.SessionBindingPrimary {
			cwd = v.Directory
		}
		items = append(items, v)
	}
	httpx.WriteJSON(w, 200, map[string]any{
		"bindings": items, "cwd": cwd, "capabilities": model.CapabilitiesForProvider(record.Provider),
		"native_resume_requires_confirmation": managed,
	})
}

func (a *Service) MutateBindingHandler(w http.ResponseWriter, r *http.Request) {
	if a.Execution.ReadOnlySessions {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "当前为只读对话模式")
		return
	}
	id, bindingID := r.PathValue("session"), r.PathValue("binding")
	release := a.lockSessionControl(id)
	defer release()
	record, ok := a.requestSession(w, r)
	if !ok {
		return
	}
	if record.Provider == model.ProviderCodexCloud {
		httpx.WriteError(w, 409, "云端目录由 Codex Cloud 环境管理")
		return
	}
	if err := a.checkBindingMutation(r.Context(), record); err != nil {
		writeBindingError(w, err)
		return
	}
	if r.Method == http.MethodDelete {
		if _, err := a.lookupBinding(id, bindingID); err != nil {
			writeBindingError(w, err)
			return
		}
		if err := a.Execution.Store.DeleteSessionBinding(id, bindingID); err != nil {
			httpx.DbError(w, err)
			return
		}
		a.writeSessionBindings(w, r, record)
		return
	}
	var body struct {
		bindingInput
		ProjectIDs []string `json:"project_ids"`
	}
	if !httpx.Decode(w, r, &body) {
		return
	}
	if r.Method == http.MethodPost && body.ProjectIDs != nil {
		if err := a.bindProjectReferences(r.Context(), record, body.ProjectIDs); err != nil {
			writeBindingError(w, err)
			return
		}
		a.writeSessionBindings(w, r, record)
		return
	}
	input := body.bindingInput
	bindings, err := a.Execution.Store.SessionBindings(id)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	managed, err := a.Execution.Store.SessionBindingsManaged(id)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	var old model.SessionProjectBinding
	if bindingID != "" {
		old, err = a.lookupBinding(id, bindingID)
		if err != nil {
			writeBindingError(w, err)
			return
		}
		if input.ProjectID == "" {
			input.ProjectID = old.ProjectID
		}
		if input.Directory == "" {
			input.Directory = old.Directory
		}
		if input.Role == "" {
			input.Role = old.Role
		}
		if input.Access == "" {
			input.Access = old.Access
		}
	}
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	input.SessionID = id
	v, err := a.inspectBinding(ctx, input, false)
	if err == nil && !managed && v.Role != model.SessionBindingPrimary {
		if path, readErr := canonicalDirectory(ctx, record.Cwd); readErr == nil {
			if platform.SameWorkspacePath(v.Directory, path) {
				v.Role = model.SessionBindingPrimary
			} else {
				previous := model.SessionProjectBinding{SessionID: id, Directory: path, Role: model.SessionBindingPrimary, Access: model.SessionBindingRead}
				bindings = append(bindings, previous)
			}
		}
	}
	if err == nil {
		v.ID = bindingID
		next := []model.SessionProjectBinding{v.SessionProjectBinding}
		for _, b := range bindings {
			if b.ID != bindingID {
				if v.Role == model.SessionBindingPrimary {
					b.Role = model.SessionBindingAdditional
				}
				next = append(next, b)
			}
		}
		err = validateBindingSet(next)
	}
	if err != nil {
		writeBindingError(w, err)
		return
	}
	a.directoryStarts.Lock()
	conflicts := []directoryConflict{}
	if v.Access == model.SessionBindingWrite {
		conflicts = a.directoryConflictsLocked(v.Directory, record.ID)
	}
	if len(conflicts) != 0 && !input.AllowShared {
		a.directoryStarts.Unlock()
		writeBindingConflict(w, conflicts)
		return
	}
	if !managed {
		err = a.Execution.Store.InsertSessionBindings(id, append(bindings, v.SessionProjectBinding))
	} else {
		_, err = a.Execution.Store.BindSessionDirectory(v.SessionProjectBinding)
	}
	a.directoryStarts.Unlock()
	if err != nil {
		writeBindingError(w, err)
		return
	}
	a.writeSessionBindings(w, r, record)
}

// bindProjectReferences appends read-only grants together. An existing
// project checkout or canonical directory already satisfies the reference.
func (a *Service) bindProjectReferences(ctx context.Context, record model.Session, ids []string) error {
	if len(ids) > maxSessionBindings {
		return invalidSessionTarget("对话关联目录数量已达上限")
	}
	ctx = execution.WithClient(ctx, a.Execution.Remote)
	bindings, err := a.Execution.Store.SessionBindings(record.ID)
	if err != nil {
		return err
	}
	managed, err := a.Execution.Store.SessionBindingsManaged(record.ID)
	if err != nil {
		return err
	}
	var existing, additions []model.SessionProjectBinding
	if !managed {
		paths := append([]string{record.Cwd}, record.AdditionalDirectories...)
		for i, path := range paths {
			directory, err := canonicalDirectory(ctx, path)
			if err != nil {
				return err
			}
			role := model.SessionBindingAdditional
			if i == 0 {
				role = model.SessionBindingPrimary
			}
			if !hasProjectReference(existing, "", directory) {
				existing = append(existing, model.SessionProjectBinding{Directory: directory, Role: role, Access: model.SessionBindingRead})
			}
		}
	}
	bindings = append(bindings, existing...)
	for _, id := range ids {
		if id == "" {
			return invalidSessionTarget("请选择项目")
		}
		if hasProjectReference(bindings, id, "") {
			continue
		}
		v, err := a.inspectBinding(ctx, bindingInput{SessionID: record.ID, ProjectID: id}, false)
		if err != nil {
			return err
		}
		if hasProjectReference(bindings, "", v.Directory) {
			continue
		}
		bindings = append(bindings, v.SessionProjectBinding)
		additions = append(additions, v.SessionProjectBinding)
	}
	if len(additions) == 0 {
		return nil
	}
	if err := validateBindingSet(bindings); err != nil {
		return err
	}
	return a.Execution.Store.InsertSessionBindings(record.ID, append(existing, additions...))
}

func hasProjectReference(bindings []model.SessionProjectBinding, projectID, directory string) bool {
	for _, binding := range bindings {
		if projectID != "" && binding.ProjectID == projectID || directory != "" && platform.SameWorkspacePath(binding.Directory, directory) {
			return true
		}
	}
	return false
}

func (a *Service) checkBindingMutation(ctx context.Context, record model.Session) error {
	if a.ChatBusy(record.ID) || a.BridgeFor(record.ID) != nil {
		return fmt.Errorf("请先结束当前 Agent 运行或终端会话，再更新关联目录")
	}
	if model.NormalizeProvider(record.Provider) == model.ProviderCodex {
		if err := a.AppTerminalConflict(record.ID, record.Cwd); err != nil {
			return err
		}
		if activity, ok := a.externalActivity(ctx, record.ID); ok && (activity.Status == "running" || activity.Status == "waiting") {
			return fmt.Errorf("请先结束原生 Codex 运行，再更新关联目录")
		}
	}
	return nil
}

func (a *Service) BindingDiffHandler(w http.ResponseWriter, r *http.Request) {
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	directory, err := a.BindingDirectory(ctx, r.PathValue("session"), r.PathValue("binding"))
	if err != nil {
		writeBindingError(w, err)
		return
	}
	file := r.URL.Query().Get("file")
	if file == "" {
		file = r.URL.Query().Get("path")
	}
	result, err := project.ReadDirectoryDiff(ctx, directory, file, r.URL.Query().Get("mode"))
	if err != nil {
		writeBindingError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, result)
}

func validateProviderBindings(provider string, plan model.LaunchPlan) error {
	if model.NormalizeProvider(provider) == model.ProviderAgy && plan.ManagedBindings {
		for _, b := range plan.Bindings {
			if b.Role == model.SessionBindingPrimary && b.Access == model.SessionBindingRead {
				return fmt.Errorf("Antigravity 无法强制只读工作目录。请选择 Codex，或明确允许修改主目录。")
			}
		}
	}
	return nil
}
