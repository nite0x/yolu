package app

import (
	"context"

	"worktree-hub/internal/assistant"
	"worktree-hub/internal/model"
	"worktree-hub/internal/session"
	"worktree-hub/internal/store"
	"worktree-hub/internal/workspace"
)

type assistantWorkspaceReview struct {
	workspace.WorkspaceReview
	Codex *session.WorkspaceCodexLaunch `json:"codex,omitempty"`
}

func (a *App) executeAssistantCodexLaunch(ctx context.Context, environment string, q model.Workspace, launch session.WorkspaceCodexLaunch, reconcile bool, result *assistant.ExecutionResult) error {
	if !reconcile && q.State == "ready" {
		// The native service journals before thread/start. Inspect its receipt
		// even when startup fails, since Codex might have accepted the request.
		_ = a.Sessions.StartWorkspaceCodex(ctx, q.ID, launch)
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	outcome, err := a.Sessions.ObserveWorkspaceCodexLaunch(ctx, q.ID, launch)
	if outcome.Session.ID != "" {
		s := outcome.Session
		result.Resources = append(result.Resources, assistantResource("conversation", environment, s.ID, s.Name, s.Cwd))
	}
	step := store.AssistantStep{ID: "codex", Label: "conversation.start_codex", Status: "succeeded"}
	switch {
	case err != nil || outcome.Uncertain:
		step.Status, result.Status = "unknown", "unknown"
		step.Error = "Codex 首条指令的发送结果未确认，请打开对话或工作区查看。"
	case outcome.Accepted:
	case q.State != "ready":
		step.Status, result.Status = "failed", "partial"
		step.Error = "工作目录尚未全部就绪，未启动 Codex。"
	default:
		step.Status, result.Status = "failed", "partial"
		step.Error = "工作区已就绪，但 Codex 未启动。请检查目标环境的 Codex 设置。"
	}
	result.Steps = append(result.Steps, step)
	return nil
}
