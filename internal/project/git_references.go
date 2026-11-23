package project

import (
	"context"
	"fmt"
	"strings"

	"worktree-hub/internal/execution"
)

func hasRemote(v GitOverview, name string) bool {
	for _, remote := range v.Remotes {
		if remote.Name == name && !strings.HasPrefix(name, "-") {
			return true
		}
	}
	return false
}

func validBranchName(ctx context.Context, path, name string) error {
	if name == "" || len(name) > 160 || strings.HasPrefix(name, "-") || strings.Contains(name, "@{") {
		return fmt.Errorf("分支名无效")
	}
	if _, err := execution.Git(ctx, path, "check-ref-format", "refs/heads/"+name); err != nil {
		return fmt.Errorf("分支名无效")
	}
	return nil
}

func (a *Service) checkSharedSwitch(path string, confirmed bool) error {
	if confirmed {
		return nil
	}
	bindings, err := a.Execution.Store.BindingsWithinDirectory(path)
	if err != nil {
		return err
	}
	if len(bindings) > 1 {
		return fmt.Errorf("多个对话关联了此目录，请确认切换分支会影响这些对话")
	}
	return nil
}
