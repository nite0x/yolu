package project

import (
	"context"
	"fmt"
	"strings"

	"worktree-hub/internal/model"
	"worktree-hub/internal/workspace"
)

func (a *Service) createGitBranch(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" || len(in.Name) > 160 || strings.HasPrefix(in.Name, "-") || strings.Contains(in.Name, "@{") {
		return nil, gitIssue(gitInvalid, "分支名无效")
	}
	if _, e := workspace.Git(ctx, p.Path, "check-ref-format", "refs/heads/"+in.Name); e != nil {
		return nil, gitIssue(gitInvalid, "分支名无效")
	}
	for _, b := range v.Branches {
		if b.Ref == "refs/heads/"+in.Name {
			return nil, gitIssue(gitConflict, "本地分支已存在，不会覆盖")
		}
	}
	if in.Source == "HEAD" {
		if in.Track {
			return nil, gitIssue(gitInvalid, "当前 HEAD 不能设为远端跟踪来源")
		}
		path := p.Path
		if in.Path != "" {
			t, e := selectedWorktree(ctx, p, in.Path)
			if e != nil {
				return nil, gitIssue(gitConflict, e.Error())
			}
			path = t.Path
		}
		var commit string
		commit, err = workspace.Git(ctx, path, "rev-parse", "--verify", "HEAD^{commit}")
		in.Source = strings.TrimSpace(commit)
	} else {
		var source GitBranch
		source, err = findBranch(v, in.Source, "")
		if err == nil && in.Track && source.Kind != "remote" {
			err = fmt.Errorf("只能跟踪远端分支")
		}
	}
	if err != nil {
		return nil, gitIssue(gitConflict, err.Error())
	}
	tracking := "--no-track"
	if in.Track {
		// Single-branch clones may have the ref after an explicit fetch, while
		// remote.<name>.fetch still excludes it. Add just this branch's mapping
		// so Git can resolve and later pull its upstream; retain other mappings.
		if e := EnsureTrackingRefspec(ctx, p, v, in.Source); e != nil {
			return nil, gitIssue(gitConflict, RedactGitOutput(e.Error()))
		}
		tracking = "--track"
	}
	output, err = workspace.Git(ctx, p.Path, "branch", tracking, "--", in.Name, in.Source)
	message = "已创建本地分支 " + in.Name + "，当前工作目录未切换"
	return gitCommandResult(message, output, err)
}

func (a *Service) switchGitBranch(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	if in.RequirementID != "" {
		if e := a.validateGitTask(p.ID, in); e != nil {
			return nil, gitIssue(gitConflict, e.Error())
		}
	}
	if e := a.checkSharedSwitch(p.ID, in); e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	t, e := selectedWorktree(ctx, p, in.Path)
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	if t.Dirty > 0 || t.Operation != "" {
		return nil, gitIssue(gitConflict, "所选目录有未提交修改或未结束的 Git 操作，请先在终端或编辑器处理后再切换分支")
	}
	b, e := findBranch(v, in.Source, "")
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	for _, path := range b.Worktrees {
		if path != t.Path {
			return nil, gitIssue(gitConflict, "该分支正被另一个 Worktree 使用："+path)
		}
	}
	if b.Kind == "remote" {
		if e := validBranchName(ctx, p.Path, in.Name); e != nil {
			return nil, gitIssue(gitInvalid, e.Error())
		}
		if e := EnsureTrackingRefspec(ctx, p, v, b.Ref); e != nil {
			return nil, gitIssue(gitConflict, e.Error())
		}
		output, err = workspace.Git(ctx, t.Path, "switch", "--track", "-c", in.Name, b.Ref)
		b.Name = in.Name
	} else {
		output, err = workspace.Git(ctx, t.Path, "switch", "--no-guess", "--", b.Name)
	}
	message = "所选工作目录已切换到 " + b.Name
	if err == nil && in.RequirementID != "" {
		_, err = a.Workspace.Store.DB.Exec(`UPDATE members SET branch=? WHERE requirement_id=? AND project_id=? AND path=?`, b.Name, in.RequirementID, p.ID, t.Path)
		if err != nil {
			err = fmt.Errorf("分支已切换，但任务关联更新失败，请刷新后采用当前分支：%w", err)
		}
	}
	return gitCommandResult(message, output, err)
}

func (a *Service) adoptGitBranch(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	if in.RequirementID == "" {
		return nil, gitIssue(gitInvalid, "请从任务内采用当前分支")
	}
	if e := a.validateGitTask(p.ID, in); e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	t, e := selectedWorktree(ctx, p, in.Path)
	if e != nil || t.Detached || t.Branch == "" {
		return nil, gitIssue(gitConflict, "当前目录未检出可关联的分支")
	}
	_, err = a.Workspace.Store.DB.Exec(`UPDATE members SET branch=? WHERE requirement_id=? AND project_id=? AND path=?`, t.Branch, in.RequirementID, p.ID, t.Path)
	message = "任务已采用当前分支 " + t.Branch
	return gitCommandResult(message, output, err)
}

func (a *Service) fastForwardGitBranch(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	b, e := findBranch(v, "refs/heads/"+in.Name, "local")
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	source, e := findBranch(v, in.Source, "remote")
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	if len(b.Worktrees) > 0 {
		return nil, gitIssue(gitConflict, "该分支已在 Worktree 检出，请选择对应目录使用“快进拉取”")
	}
	if _, e := workspace.Git(ctx, p.Path, "merge-base", "--is-ancestor", b.Commit, source.Commit); e != nil {
		return nil, gitIssue(gitConflict, "分支存在分歧，不能快进；请在终端检查，不会覆盖本地提交")
	}
	// Expected-old-value prevents overwriting a concurrently updated branch.
	output, err = workspace.Git(ctx, p.Path, "update-ref", "-m", "worktree-hub: fast-forward", b.Ref, source.Commit, b.Commit)
	message = "已快进更新 " + b.Name + " 到 " + source.Name
	return gitCommandResult(message, output, err)
}
