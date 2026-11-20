package execution

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

const RepositoryScanLimit = 1000
const repositoryScanDirectoryLimit = 50000

type DiscoveredRepository struct {
	Path      string `json:"path"`
	CommonDir string `json:"common_dir"`
	Name      string `json:"name"`
	ProjectID string `json:"project_id,omitempty"`
}

type RepositoryScanWarning struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

type RepositoryScan struct {
	Repositories []DiscoveredRepository  `json:"repositories"`
	Warnings     []RepositoryScanWarning `json:"warnings"`
	Truncated    bool                    `json:"truncated"`
}

// ScanRepositories runs in the selected execution environment. Nested checkouts
// are included, while Git metadata and directory symlinks are skipped.
func ScanRepositories(ctx context.Context, root string) (RepositoryScan, error) {
	result := RepositoryScan{Repositories: []DiscoveredRepository{}, Warnings: []RepositoryScanWarning{}}
	if c := RemoteClient(ctx); c != nil {
		err := c.Call(ctx, Request{Op: "scan-repositories", Path: root}, &result)
		return result, err
	}
	root, err := Normalize(ctx, root)
	if err != nil {
		return result, err
	}
	seen := make(map[string]bool)
	directories := 0
	warn := func(path string, err error) {
		if len(result.Warnings) < 100 {
			result.Warnings = append(result.Warnings, RepositoryScanWarning{Path: path, Message: err.Error()})
		}
	}
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			if path == root {
				return walkErr
			}
			warn(path, walkErr)
			return nil
		}
		if !entry.IsDir() {
			return nil
		}
		if path != root && entry.Name() == ".git" {
			return filepath.SkipDir
		}
		directories++
		if directories > repositoryScanDirectoryLimit || len(result.Repositories) >= RepositoryScanLimit {
			result.Truncated = true
			return filepath.SkipAll
		}
		if _, err := os.Lstat(filepath.Join(path, ".git")); errors.Is(err, os.ErrNotExist) {
			return nil
		} else if err != nil {
			warn(path, err)
			return nil
		}
		common, err := Git(ctx, path, "rev-parse", "--path-format=absolute", "--git-common-dir")
		if err != nil {
			warn(path, err)
			return nil
		}
		common, err = filepath.EvalSymlinks(strings.TrimSpace(common))
		if err != nil {
			warn(path, err)
			return nil
		}
		if !seen[common] {
			seen[common] = true
			result.Repositories = append(result.Repositories, DiscoveredRepository{Path: path, CommonDir: common, Name: filepath.Base(path)})
		}
		return nil
	})
	if err != nil {
		return result, err
	}
	return result, ctx.Err()
}
