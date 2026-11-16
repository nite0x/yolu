// Package task manages task membership, worktree creation and saved task scope.
package task

import (
	"context"

	"worktree-hub/internal/workspace"
)

type Service struct {
	Workspace        *workspace.Service
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

func creationProjectIDs(in CreateRequirement) []string {
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

func New(environment *workspace.Service) *Service { return &Service{Workspace: environment} }
