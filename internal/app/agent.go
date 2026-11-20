package app

import (
	"io"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/session"
)

func runWorkspaceAgent(input io.Reader, output io.Writer) error {
	return execution.RunAgent(input, output, execution.AgentHooks{WatchHistory: session.WatchCodexHistoryRaw, TerminalConflict: session.TerminalSessionConflict})
}
