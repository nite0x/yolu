package app

import (
	"context"
	"sync"
	"sync/atomic"

	"worktree-hub/internal/assistant"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/project"
	"worktree-hub/internal/session"
	"worktree-hub/internal/terminal"
	"worktree-hub/internal/workspace"
)

type App struct {
	Assistant           *assistant.Service
	Execution           *execution.Service
	Projects            *project.Service
	Workspaces          *workspace.Service
	Sessions            *session.Service
	Terminals           *terminal.Manager
	token               string
	environments        *environmentHub
	shutdown            func()
	closeOnce           sync.Once
	closeErr            error
	pickDirectory       func(context.Context) (string, error)
	directoryPickerBusy atomic.Bool
	terminalWorktreeMu  sync.RWMutex
	assistantUse        sync.RWMutex // capability callbacks lease execution resources through teardown
	browser             *browserAccess
	voice               *codex.VoiceService
}

func openApp(dataDir, root string) (*App, error) { return openAppForExecution(dataDir, root, nil) }
func openAppForExecution(dataDir, root string, remote *execution.Client) (*App, error) {
	env, err := execution.Open(dataDir, root, remote)
	if err != nil {
		return nil, err
	}
	workspaces := workspace.New(env)
	sessions := session.New(env, workspaces)
	projects := project.New(env)
	workspaces.LockRepositories = projects.LockRepositories
	workspaces.StateChanged = projects.InvalidateState
	projects.ReserveWorktree = sessions.ReserveWorktree
	projects.WorkspaceContextUpdated = workspace.WriteBriefContext
	a := &App{Execution: env, Workspaces: workspaces, Projects: projects, Sessions: sessions, Terminals: terminal.New(), token: model.NewID() + model.NewID(), pickDirectory: platform.PickDirectory}
	if remote == nil {
		a.voice = codex.NewVoiceService(env.DataDir, codex.OpenLive)
		a.browser = newBrowserAccess(a)
		a.Assistant = assistant.New(env.Store, env.DataDir)
		if err := a.configureAssistant(); err != nil {
			_ = a.Close()
			return nil, err
		}
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
		if a.Assistant != nil {
			a.Assistant.Close()
		}
		a.assistantUse.Lock()
		defer a.assistantUse.Unlock()
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
