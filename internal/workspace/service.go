// Package workspace manages workspace membership, worktree creation and saved workspace scope.
package workspace

import (
	"context"

	"worktree-hub/internal/execution"
)

type Service struct {
	Execution        *execution.Service
	LockRepositories func(context.Context, []string) (func(), error)
	StateChanged     func()
}

func (s *Service) lockProjects(ctx context.Context, ids []string) (func(), error) {
	if s.LockRepositories != nil {
		return s.LockRepositories(ctx, ids)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return func() {}, nil
}
func (s *Service) stateChanged() {
	if s.StateChanged != nil {
		s.StateChanged()
	}
}

func creationProjectIDs(in CreateWorkspaceInput) []string {
	ids := append([]string{}, in.ProjectIDs...)
	if in.PrimaryProjectID != "" {
		ids = append(ids, in.PrimaryProjectID)
	}
	for _, m := range in.Members {
		ids = append(ids, m.ProjectID)
	}
	return ids
}
func attachmentProjectIDs(in AttachProjectsInput) []string {
	ids := append([]string{}, in.ProjectIDs...)
	for _, m := range in.Members {
		ids = append(ids, m.ProjectID)
	}
	return ids
}

func New(environment *execution.Service) *Service { return &Service{Execution: environment} }
