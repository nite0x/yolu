package app

import (
	"context"
	"sync"
	"sync/atomic"

	"worktree-hub/internal/assistant"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/project"
	"worktree-hub/internal/session"
	"worktree-hub/internal/task"
	"worktree-hub/internal/terminal"
	"worktree-hub/internal/workspace"
)

type App struct {
	Assistant           *assistant.Service
	Workspace           *workspace.Service
	Projects            *project.Service
	Tasks               *task.Service
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
}

func openApp(dataDir, root string) (*App, error) { return openAppForWorkspace(dataDir, root, nil) }
func openAppForWorkspace(dataDir, root string, remote *workspace.Client) (*App, error) {
	env, err := workspace.Open(dataDir, root, remote)
	if err != nil {
		return nil, err
	}
	tasks := task.New(env)
	sessions := session.New(env, tasks)
	projects := project.New(env)
	tasks.LockRepositories = projects.LockRepositories
	tasks.StateChanged = projects.InvalidateState
	projects.ReserveWorktree = sessions.ReserveWorktree
	projects.TaskContextUpdated = task.WriteBriefContext
	a := &App{Workspace: env, Tasks: tasks, Projects: projects, Sessions: sessions, Terminals: terminal.New(), token: model.NewID() + model.NewID(), pickDirectory: platform.PickDirectory}
	if remote == nil {
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
		a.Workspace.Closing.Store(true)
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
		if a.Workspace.Remote != nil {
			a.Workspace.Remote.Close()
		}
		a.Sessions.Close()
		a.Projects.Close()
		a.closeErr = a.Workspace.Close()
	})
	return a.closeErr
}
