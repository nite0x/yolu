package execution

import (
	"errors"
	"sync"

	"worktree-hub/internal/platform"
)

var ErrDirectoryChanging = errors.New("目录正在创建或被其他操作使用，请等待完成后重试")

// DirectoryOperations coordinates checkout creation with admissions. It owns
// only in-flight claims. Repository locks and the existing cleanup gate own
// branch mutations and the lifetime of established conversations.
type DirectoryOperations struct {
	mu     sync.Mutex
	claims map[*directoryClaim]struct{}
}

type directoryClaim struct {
	paths    []string
	creation bool
}

func (d *DirectoryOperations) ReserveCheckout(path string) (func(), error) {
	return d.reserve(&directoryClaim{paths: []string{path}, creation: true})
}

func (d *DirectoryOperations) UseDirectories(paths ...string) (func(), error) {
	return d.reserve(&directoryClaim{paths: paths})
}

func (d *DirectoryOperations) reserve(claim *directoryClaim) (func(), error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for previous := range d.claims {
		if !previous.creation && !claim.creation {
			continue
		}
		creation, use := previous, claim
		if claim.creation {
			creation, use = claim, previous
		}
		target := creation.paths[0]
		for _, path := range use.paths {
			if path != "" && (platform.SameWorkspacePath(target, path) || platform.Within(target, path) ||
				use.creation && platform.Within(path, target)) {
				return nil, ErrDirectoryChanging
			}
		}
	}
	if d.claims == nil {
		d.claims = make(map[*directoryClaim]struct{})
	}
	d.claims[claim] = struct{}{}
	return func() {
		d.mu.Lock()
		delete(d.claims, claim)
		d.mu.Unlock()
	}, nil
}
