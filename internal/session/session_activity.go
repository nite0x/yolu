package session

import (
	"context"
	"slices"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
)

func (a *Service) sessionActivity(ctx context.Context, s codex.Session) codex.Activity {
	if s.Status.Type == "active" {
		status := "running"
		if slices.Contains(s.Status.ActiveFlags, "waitingOnApproval") || slices.Contains(s.Status.ActiveFlags, "waitingOnUserInput") {
			status = "waiting"
		}
		return codex.Activity{Status: status}
	}
	if s.Path == "" {
		if s.Status.Type == "idle" {
			return codex.Activity{Status: "completed"}
		}
		return codex.Activity{Status: "unknown"}
	}
	if a.Execution.Remote != nil {
		var activity codex.Activity
		if a.Execution.Remote.Call(ctx, execution.Request{Op: "rollout-activity", Path: s.Path}, &activity) != nil {
			return codex.Activity{Status: "unknown"}
		}
		return activity
	}
	activity := codex.RolloutActivity(s.Path)
	if s.Status.Type == "idle" && (activity.Status == "unknown" || activity.Status == "running") {
		// A loaded idle runtime is stronger evidence than a delayed rollout
		// lifecycle event or an unreadable/compressed preview file.
		activity.Status = "completed"
	}
	return activity
}
func (a *Service) externalActivity(ctx context.Context, id string) (codex.Activity, bool) {
	c, err := a.openSessions(ctx)
	if err != nil {
		return codex.Activity{Status: "unknown"}, true
	}
	defer c.Close()
	s, err := readSession(c, id)
	if err != nil {
		return codex.Activity{Status: "unknown"}, true
	}
	// Old CLI protocols and test doubles may omit both fields altogether.
	if s.Path == "" && s.Status.Type == "" {
		return codex.Activity{}, false
	}
	return a.sessionActivity(ctx, s), true
}
