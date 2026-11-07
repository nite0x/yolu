package project

import (
	"context"

	"worktree-hub/internal/model"
	"worktree-hub/internal/workspace"
)

func (a *Service) mergeGit(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	t, e := selectedWorktree(ctx, p, in.Path)
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	if t.Dirty > 0 || t.Detached || t.Operation != "" {
		return nil, gitIssue(gitConflict, "合并需要干净且没有未结束 Git 操作的分支目录")
	}
	b, e := findBranch(v, in.Source, "")
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	if in.Action == "merge_preview" {
		log, e := workspace.Git(ctx, t.Path, "log", "--format=%h %s", "-20", t.Head+".."+b.Commit)
		if e != nil {
			return nil, e
		}
		return map[string]any{"message": b.Name + " → " + t.Branch, "output": log, "source_commit": b.Commit, "expected_head": t.Head}, nil
	}
	if in.ExpectedHead == "" || in.ExpectedHead != t.Head || in.SourceCommit != b.Commit {
		return nil, gitIssue(gitConflict, "合并预览已过期，请重新预览")
	}
	output, err = workspace.GitOperation(ctx, t.Path, "-c", "merge.autoStash=false", "-c", "rerere.enabled=false", "merge", "--ff", "--commit", "--no-edit", "--no-autostash", "--no-overwrite-ignore", "--", b.Commit)
	if err != nil {
		after, inspectErr := workspace.ReadGitState(ctx, t.Path)
		if inspectErr == nil && after.Operation == "merge" && len(after.Conflicts) > 0 {
			return map[string]any{"message": "合并出现冲突，将打开 AI 对话完成合并", "conflict": true, "conflicts": after.Conflicts, "merge_head": after.MergeHead}, nil
		}
	}
	message = "已合并 " + b.Name + " → " + t.Branch
	return gitCommandResult(message, output, err)
}

func (a *Service) abortGitMerge(ctx context.Context, p model.Project, v GitOverview, in GitAction) (map[string]any, error) {
	var output, message string
	var err error
	t, e := selectedWorktree(ctx, p, in.Path)
	if e != nil {
		return nil, gitIssue(gitConflict, e.Error())
	}
	if t.Operation != "merge" {
		return nil, gitIssue(gitConflict, "当前没有进行中的合并")
	}
	output, err = workspace.GitOperation(ctx, t.Path, "merge", "--abort")
	message = "已中止合并"
	return gitCommandResult(message, output, err)
}
