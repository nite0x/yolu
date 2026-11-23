package execution

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

// ReadGitState reads branch, upstream and index from one status snapshot. The
// operation markers are worktree-local (not the repository's shared git dir).
func ReadGitState(ctx context.Context, path string) (model.Worktree, error) {
	v := model.Worktree{Path: path}
	raw, err := Git(ctx, path, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all")
	if err != nil {
		return v, err
	}
	v.Changes = &model.WorktreeChanges{}
	fields := strings.Split(raw, "\x00")
	for i := 0; i < len(fields); i++ {
		f := fields[i]
		switch {
		case strings.HasPrefix(f, "# branch.oid "):
			v.Head = strings.TrimPrefix(f, "# branch.oid ")
			if v.Head == "(initial)" {
				v.Head = ""
			}
		case strings.HasPrefix(f, "# branch.head "):
			v.Branch = strings.TrimPrefix(f, "# branch.head ")
			v.Detached = v.Branch == "(detached)"
			if v.Detached {
				v.Branch = ""
			}
		case strings.HasPrefix(f, "# branch.upstream "):
			v.Upstream = strings.TrimPrefix(f, "# branch.upstream ")
		case strings.HasPrefix(f, "# branch.ab "):
			parts := strings.Fields(f)
			if len(parts) == 4 {
				v.SyncAhead, _ = strconv.Atoi(strings.TrimPrefix(parts[2], "+"))
				v.SyncBehind, _ = strconv.Atoi(strings.TrimPrefix(parts[3], "-"))
				v.SyncAvailable = true
			}
		case strings.HasPrefix(f, "? "):
			v.Changes.Added++
		case (strings.HasPrefix(f, "1 ") || strings.HasPrefix(f, "2 ")) && len(f) >= 4:
			switch status := f[2:4]; {
			case strings.ContainsRune(status, 'D'):
				v.Changes.Deleted++
			case strings.ContainsRune(status, 'A'):
				v.Changes.Added++
			default:
				v.Changes.Modified++
			}
			if f[0] == '2' {
				i++ // original path in rename/copy records
			}
		case strings.HasPrefix(f, "u "):
			v.Changes.Modified++
			parts := strings.SplitN(f, " ", 11)
			if len(parts) == 11 {
				v.Conflicts = append(v.Conflicts, parts[10])
			}
		}
	}
	v.Dirty = v.Changes.Modified + v.Changes.Added + v.Changes.Deleted
	dir, err := Git(ctx, path, "rev-parse", "--absolute-git-dir")
	if err != nil {
		return v, err
	}
	for _, marker := range []struct{ name, operation string }{
		{"rebase-merge", "rebase"}, {"rebase-apply", "rebase"},
		{"MERGE_HEAD", "merge"}, {"CHERRY_PICK_HEAD", "cherry-pick"},
		{"REVERT_HEAD", "revert"}, {"sequencer", "sequencer"}, {"BISECT_LOG", "bisect"},
	} {
		_, err := Stat(ctx, platform.JoinWorkspacePath(strings.TrimSpace(dir), marker.name), true)
		if err == nil {
			v.Operation = marker.operation
			break
		}
		if !errors.Is(err, os.ErrNotExist) {
			return v, fmt.Errorf("无法检查 Git 操作状态：%w", err)
		}
	}
	if v.Operation == "merge" {
		head, err := Git(ctx, path, "rev-parse", "--verify", "MERGE_HEAD")
		if err != nil {
			return v, err
		}
		v.MergeHead = strings.TrimSpace(head)
	}
	return v, nil
}
