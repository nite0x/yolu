package project

import (
	"context"
	"database/sql"
	"errors"
)

type gitIssueKind string

const (
	gitInvalid     gitIssueKind = "invalid"
	gitMissing     gitIssueKind = "missing"
	gitConflict    gitIssueKind = "conflict"
	gitInspection  gitIssueKind = "inspection"
	gitUnavailable gitIssueKind = "unavailable"
)

type gitActionIssue struct {
	kind    gitIssueKind
	message string
	command *string
}

func (e *gitActionIssue) Error() string { return e.message }
func gitIssue(kind gitIssueKind, message string) error {
	return &gitActionIssue{kind: kind, message: message}
}
func gitTerminalIssue(err error, command string) error {
	return &gitActionIssue{kind: gitUnavailable, message: err.Error(), command: &command}
}
func gitCommandResult(message, output string, err error) (map[string]any, error) {
	if err != nil {
		return nil, err
	}
	return map[string]any{"message": message, "output": RedactGitOutput(output)}, nil
}

// PerformGitAction owns validation, repository serialization and task metadata
// updates. HTTP handlers only decode requests and translate the result/error.
func (a *Service) PerformGitAction(ctx context.Context, id string, in GitAction) (map[string]any, error) {
	// Failed commands can still change a checkout; invalidate after every action,
	// including service callers that do not pass through the HTTP adapter.
	defer a.cache.invalidate()
	a.Workspace.GitActivity.RLock()
	defer a.Workspace.GitActivity.RUnlock()
	if a.Workspace.Closing.Load() {
		return nil, gitIssue(gitUnavailable, "后台正在退出")
	}
	p, err := a.RegisteredProject(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, gitIssue(gitMissing, "项目不存在")
	}
	if err != nil {
		return nil, gitIssue(gitInspection, err.Error())
	}
	unlock := a.lockGit(p.CommonDir)
	defer unlock()
	// Only Git actions for this repository serialize; network waits never hold
	// the environment's metadata lock.
	v, err := InspectGit(ctx, p)
	if err != nil {
		return nil, gitIssue(gitInspection, err.Error())
	}
	if in.RequirementID != "" {
		if err := a.validateGitTask(p.ID, in); err != nil {
			return nil, gitIssue(gitConflict, err.Error())
		}
	}
	if in.Path != "" && in.ExpectedBranch != "" {
		t, e := selectedWorktree(ctx, p, in.Path)
		if e != nil || t.Branch != in.ExpectedBranch {
			return nil, gitIssue(gitConflict, "当前分支已变化，请刷新后重新操作")
		}
	}
	// Metadata and the Git checkout must change together. Keep the original
	// repository -> metadata lock order through task-context publication.
	if in.Action == "switch" || in.Action == "adopt_branch" {
		a.Workspace.Mu.Lock()
		defer a.Workspace.Mu.Unlock()
	}
	var result map[string]any
	switch in.Action {
	case "fetch", "fetch_terminal":
		result, err = a.fetchGit(ctx, p, v, in)
	case "create_branch":
		result, err = a.createGitBranch(ctx, p, v, in)
	case "switch":
		result, err = a.switchGitBranch(ctx, p, v, in)
	case "adopt_branch":
		result, err = a.adoptGitBranch(ctx, p, v, in)
	case "pull":
		result, err = a.pullGit(ctx, p, v, in)
	case "push":
		result, err = a.pushGit(ctx, p, v, in)
	case "merge_into_preview", "merge_into":
		result, err = a.mergeInto(ctx, p, v, in)
	case "merge_preview", "merge":
		result, err = a.mergeGit(ctx, p, v, in)
	case "merge_abort":
		result, err = a.abortGitMerge(ctx, p, v, in)
	case "fast_forward":
		result, err = a.fastForwardGitBranch(ctx, p, v, in)
	case "terminal":
		result, err = a.openGitTerminal(ctx, p, v, in)
	default:
		return nil, gitIssue(gitInvalid, "不支持的 Git 操作")
	}

	if err != nil {
		return nil, err
	}
	if in.RequirementID != "" && (in.Action == "switch" || in.Action == "adopt_branch") && a.TaskContextUpdated != nil {
		if q, e := a.Workspace.Store.Requirement(in.RequirementID); e == nil {
			if e := a.TaskContextUpdated(ctx, q); e != nil {
				result["message"] = result["message"].(string) + "；自动任务上下文更新失败：" + e.Error()
			}
		}
	}
	return result, nil
}
