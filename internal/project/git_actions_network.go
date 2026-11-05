package project

import (
	"context"

	"worktree-hub/internal/model"
	"worktree-hub/internal/workspace"
)

func (a *Service) fetchGit(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	found := false
	for _, remote := range v.Remotes {
		if remote.Name == in.Remote {
			found = true
		}
	}
	if !found {
		return nil, gitIssue(gitInvalid, "请选择已配置的远端")
	}
	if in.Action == "fetch_terminal" {
		plan, e := a.LaunchGitTerminal(p, p.Path, in.Remote)
		if e != nil {
			return nil, gitTerminalIssue(e, plan.Command)
		}
		return map[string]any{"message": "已发送终端打开请求，请在终端完成登录和获取；完成后点击“刷新列表”", "output": a.CredentialSupport().Message + " 终端中的 Git 获取结果为准。"}, nil
	}
	// Explicitly fetch all branch heads, even if the repository was cloned with a narrow refspec.
	output, err = a.GitNetwork(ctx, p.Path, "fetch", "--prune", "--", in.Remote, "+refs/heads/*:refs/remotes/"+in.Remote+"/*")
	message = "已获取远端全部分支，本地工作文件与当前分支保留"
	return gitCommandResult(message, output, err)
}

func (a *Service) pullGit(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	t, e := selectedWorktree(ctx, p, in.Path)
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	if t.Dirty > 0 || t.Detached || t.Operation != "" {
		return nil, gitIssue(gitConflict, "快进拉取需要干净且已检出分支的工作目录")
	}
	if _, e := workspace.Git(ctx, t.Path, "rev-parse", "--verify", "@{upstream}"); e != nil {
		return nil, gitIssue(gitConflict, "当前分支尚未设置远端跟踪，请先创建跟踪分支或在 Git 终端配置 upstream")
	}
	output, err = a.GitNetwork(ctx, t.Path, "pull", "--ff-only", "--no-rebase", "--no-autostash")
	message = "已完成快进拉取"
	return gitCommandResult(message, output, err)
}

func (a *Service) pushGit(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	t, e := selectedWorktree(ctx, p, in.Path)
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	if t.Detached || t.Branch == "" || t.Operation != "" {
		return nil, gitIssue(gitConflict, "请先完成进行中的 Git 操作并检出分支")
	}
	if !hasRemote(v, in.Remote) {
		return nil, gitIssue(gitInvalid, "请选择已配置的远端")
	}
	if e := validBranchName(ctx, p.Path, in.Name); e != nil {
		return nil, gitIssue(gitInvalid, e.Error())
	}
	args := []string{"push", "--porcelain", "--no-follow-tags", "--recurse-submodules=no"}
	if in.Track {
		if e := EnsureTrackingRefspec(ctx, p, v, "refs/remotes/"+in.Remote+"/"+in.Name); e != nil {
			return nil, gitIssue(gitConflict, RedactGitOutput(e.Error()))
		}
		args = append(args, "--set-upstream")
	}
	args = append(args, "--", in.Remote, "HEAD:refs/heads/"+in.Name)
	output, err = a.GitNetwork(ctx, t.Path, args...)
	message = "已推送 " + t.Branch + " → " + in.Remote + "/" + in.Name
	return gitCommandResult(message, output, err)
}

func (a *Service) openGitTerminal(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	t, e := selectedWorktree(ctx, p, in.Path)
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	if plan, e := a.LaunchGitTerminal(p, t.Path, ""); e != nil {
		return nil, gitTerminalIssue(e, plan.Command)
	}
	message = "已向系统终端发送打开请求"
	return gitCommandResult(message, output, err)
}
