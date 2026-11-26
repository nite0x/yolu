package app

import (
	"context"
	"sync"
	"sync/atomic"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/project"
	"worktree-hub/internal/session"
	"worktree-hub/internal/terminal"
)

type App struct {
	Execution           *execution.Service
	Projects            *project.Service
	Sessions            *session.Service
	Terminals           *terminal.Manager
	token               string
	environments        *environmentHub
	shutdown            func()
	closeOnce           sync.Once
	closeErr            error
	pickDirectory       func(context.Context) (string, error)
	directoryPickerBusy atomic.Bool
	mcpInstallMu        sync.Mutex
	terminalWorktreeMu  sync.RWMutex
	browser             *browserAccess
	voice               *codex.VoiceService
}

func openApp(dataDir, root string) (*App, error) { return openAppForExecution(dataDir, root, nil) }
func openAppForExecution(dataDir, root string, remote *execution.Client) (*App, error) {
	env, err := execution.Open(dataDir, root, remote)
	if err != nil {
		return nil, err
	}
	sessions := session.New(env)
	projects := project.New(env)
	projects.ReserveWorktree = sessions.ReserveWorktree
	a := &App{Execution: env, Projects: projects, Sessions: sessions, Terminals: terminal.New(), token: model.NewID() + model.NewID(), pickDirectory: platform.PickDirectory}
	if remote == nil {
		if launch, err := currentMCPLaunch(env.DataDir); err == nil {
			sessions.AssistantMCP = []string{launch.Command, "--mcp", "--data", launch.DataDir}
		}
		a.voice = codex.NewVoiceService(env.DataDir, codex.OpenLive)
		a.browser = newBrowserAccess(a)
		projects.CheckWorktreeIdle = a.checkTerminalWorktree
		projects.ReserveWorktree = a.reserveWorktree
	}
	return a, nil
}

// Close releases the resources owned by this application, including partially
// initialized remote environments. Schedulers are stopped by their owner first.
func (a *App) Close() error {
	a.closeOnce.Do(func() {
		a.Execution.Closing.Store(true)
		if a.voice != nil {
			a.voice.Close()
		}
		if a.browser != nil {
			a.browser.close()
		}
		if a.Terminals != nil {
			a.Terminals.Close()
		}
		if a.Execution.Remote != nil {
			a.Execution.Remote.Close()
		}
		a.Sessions.Close()
		a.Projects.Close()
		a.closeErr = a.Execution.Close()
	})
	return a.closeErr
}
