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
	gitLocks          sync.Map // common Git directory -> *sync.Mutex
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

func (s *Service) lockGit(common string) func() {
	value, _ := s.gitLocks.LoadOrStore(common, &sync.Mutex{})
	mu := value.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}
func (s *Service) Snapshot(projects []model.Project, force bool) (bool, string) {
	return s.cache.snapshot(projects, force)
}
