// Package project manages registered repositories, Git operations and status.
package project

import (
	"context"
	"sync"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

type Service struct {
	Execution         *execution.Service
	cache             *stateCache
	CredentialHelper  string
	locksMu           sync.Mutex
	locks             map[string]*operationLock
	OpenEditor        func(tool, path, distro string) error
	OpenDirectory     func(path, distro string) error
	OpenExternal      func(string) error
	ReserveWorktree   func(context.Context, string) (func(), error)
	CheckWorktreeIdle func(string) error
}

func New(environment *execution.Service) *Service {
	s := &Service{Execution: environment, cache: newStateCache(), CredentialHelper: execution.CredentialHelperCommand(), OpenEditor: platform.OpenEditor, OpenDirectory: platform.OpenDirectory, OpenExternal: platform.OpenExternal}
	if environment.Remote != nil {
		s.CredentialHelper = environment.Remote.Identity.CredentialHelper
		s.cache.ctx = execution.WithClient(s.cache.ctx, environment.Remote)
	}
	return s
}

func (s *Service) Close() { s.cache.Close() }

type operationLock struct {
	mu   sync.Mutex
	refs int
}

func (s *Service) lockGit(common string) func() {

	s.locksMu.Lock()
	if s.locks == nil {
		s.locks = make(map[string]*operationLock)
	}
	entry := s.locks[common]
	if entry == nil {
		entry = &operationLock{}
		s.locks[common] = entry
	}
	entry.refs++
	s.locksMu.Unlock()
	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		s.locksMu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(s.locks, common)
		}
		s.locksMu.Unlock()
	}
}

func (s *Service) Snapshot(projects []model.Project, force bool) (bool, string) {
	return s.cache.snapshot(projects, force)
}
