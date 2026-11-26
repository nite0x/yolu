package project

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/platform"
)

type CreateWorktree struct {
	Slug   string `json:"slug"`
	Mode   string `json:"mode"`
	Branch string `json:"branch"`
	Source string `json:"source"`
}

func (a *Service) CreateWorktreeHandler(w http.ResponseWriter, r *http.Request) {
	var in CreateWorktree
	if !httpx.Decode(w, r, &in) {
		return
	}
	result, err := a.CreateProjectWorktree(r.Context(), r.PathValue("id"), in)
	if err != nil {
		writeOperationError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, result)
}

// CreateProjectWorktree serializes Git by common directory, with a separate
// reservation for the destination. The environment metadata lock is not held
// across subprocesses, including post-checkout hooks.
func (a *Service) CreateProjectWorktree(ctx context.Context, id string, in CreateWorktree) (map[string]string, error) {
	defer a.cache.invalidate()
	a.Execution.GitActivity.RLock()
	defer a.Execution.GitActivity.RUnlock()
	if a.Execution.Closing.Load() {
		return nil, &OperationError{Status: 503, Message: "后台正在退出"}
	}
	p, err := a.RegisteredProject(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, &OperationError{Status: 404, Message: "项目不存在"}
	}
	if err != nil {
		return nil, &OperationError{Status: 422, Message: err.Error()}
	}
	unlock := a.lockGit(p.CommonDir)
	defer unlock()
	current, err := a.RegisteredProject(ctx, p.ID)
	if err != nil || !platform.SameWorkspacePath(current.CommonDir, p.CommonDir) {
		return nil, &OperationError{Status: 409, Message: "项目登记已变化，请刷新后重试"}
	}
	p = current
	in.Slug, in.Branch = strings.TrimSpace(in.Slug), strings.TrimSpace(in.Branch)
	if !execution.ValidSlug.MatchString(in.Slug) {
		return nil, &OperationError{Status: 400, Message: "工作标识应为 1–64 位字母、数字、短横线或下划线，以字母或数字开头"}
	}
	if in.Mode != "new" && in.Mode != "existing" {
		return nil, &OperationError{Status: 400, Message: "请选择新建分支或使用已有本地分支"}
	}
	if in.Branch == "" && in.Mode == "new" {
		in.Branch = "codex/" + in.Slug
	}
	if in.Branch == "" || len(in.Branch) > 160 || strings.HasPrefix(in.Branch, "-") || strings.Contains(in.Branch, "@{") {
		return nil, &OperationError{Status: 400, Message: "分支名无效"}
	}
	if _, err := execution.Git(ctx, p.Path, "check-ref-format", "--branch", in.Branch); err != nil {
		return nil, &OperationError{Status: 400, Message: "分支名无效"}
	}
	v, err := InspectGit(ctx, p)
	if err != nil {
		return nil, &OperationError{Status: 422, Message: err.Error()}
	}
	source, commit := strings.TrimSpace(in.Source), ""
	if source == "" && in.Mode == "new" {
		source = execution.DefaultBranchSource(ctx, p.Path)
	}
	if in.Mode == "existing" {
		b, err := findBranch(v, "refs/heads/"+in.Branch, "local")
		if err != nil {
			return nil, &OperationError{Status: 409, Message: "本地分支不存在，请刷新后重新选择"}
		}
		if len(b.Worktrees) > 0 {
			return nil, &OperationError{Status: 409, Message: "该分支已被 Worktree 占用：" + strings.Join(b.Worktrees, "、")}
		}
		source, commit = b.Ref, b.Commit
	} else {
		for _, b := range v.Branches {
			if b.Ref == "refs/heads/"+in.Branch {
				return nil, &OperationError{Status: 409, Message: "本地分支已存在，请选择“使用已有分支”或换一个新分支名"}
			}
		}
		if source == "HEAD" {
			commit, err = execution.Git(ctx, p.Path, "rev-parse", "--verify", "HEAD^{commit}")
			commit = strings.TrimSpace(commit)
		} else {
			var b GitBranch
			b, err = findBranch(v, source, "")
			commit = b.Commit
		}
		if err != nil || commit == "" {
			return nil, &OperationError{Status: 409, Message: "请选择仍然存在的来源分支或明确选择当前 HEAD，不会自动替换来源"}
		}
	}
	directory := platform.JoinWorkspacePath(a.Execution.Root, in.Slug)
	target := platform.JoinWorkspacePath(directory, p.Folder)
	releaseTarget := a.lockWorktreeTarget(target)
	defer releaseTarget()
	resolved, err := execution.Eval(ctx, a.Execution.Root)
	if err != nil || !platform.SameWorkspacePath(resolved, a.Execution.Root) || !platform.Within(a.Execution.Root, directory) || !platform.Within(directory, target) {
		return nil, &OperationError{Status: 422, Message: "Worktree 根目录已变化或路径无效，请检查服务配置"}
	}
	if info, err := execution.Stat(ctx, directory, false); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return nil, &OperationError{Status: 409, Message: "工作目录不是普通目录，拒绝使用符号链接或文件"}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, &OperationError{Status: 409, Message: "无法检查工作目录：" + err.Error()}
	}
	if _, err := execution.Stat(ctx, target, false); !errors.Is(err, os.ErrNotExist) {
		return nil, &OperationError{Status: 409, Message: "目标目录已存在或无法检查，不会覆盖：" + target}
	}
	for _, t := range v.Project.Worktrees {
		if t.Path == target {
			return nil, &OperationError{Status: 409, Message: "该路径仍有 Git Worktree 登记，请先在 Git 终端检查或修复"}
		}
	}
	if err := execution.Mkdir(ctx, directory, 0755, false); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, &OperationError{Status: 409, Message: "无法创建工作目录：" + err.Error()}
	}
	// Recheck after mkdir; a pre-existing parent may contain other directories.
	if resolved, err := execution.Eval(ctx, directory); err != nil || !platform.SameWorkspacePath(resolved, directory) {
		return nil, &OperationError{Status: 409, Message: "工作目录已变化，停止创建"}
	}
	args := []string{"worktree", "add"}
	if in.Mode == "new" {
		// Use the inspected commit rather than letting Git guess a remote branch.
		args = append(args, "--no-track", "-b", in.Branch, "--", target, commit)
	} else {
		args = append(args, "--", target, in.Branch)
	}
	if _, err := execution.GitOperation(ctx, p.Path, args...); err != nil {
		// Hooks can fail after Git has created a branch or files. Preserve all
		// partial results for inspection rather than removing user work.
		return nil, &OperationError{Status: 409, Message: "Worktree 创建未完成，请刷新列表并检查现场；已有文件和分支均保留", Details: []string{RedactGitOutput(err.Error()), "目标目录：" + target, "分支：" + in.Branch}}
	}
	return map[string]string{"message": "Worktree 已创建，已加入项目列表", "path": target, "branch": in.Branch, "source": source, "base_commit": commit}, nil
}
