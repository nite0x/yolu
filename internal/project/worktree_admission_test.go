package project

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"worktree-hub/internal/execution"
)

func TestWorktreeCheckoutReservesDestinationUntilHookFinishes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture uses a POSIX checkout hook")
	}
	a := testApp(t)
	repository := repo(t, "repository", "main")
	id := register(t, a, "Repository", repository)
	marker, release := filepath.Join(t.TempDir(), "running"), filepath.Join(t.TempDir(), "release")
	releaseHook := func() { _ = os.WriteFile(release, nil, 0600) }
	defer releaseHook()
	checkoutHook(t, repository,
		"touch "+shellQuote(marker)+"\n"+
			"i=0; while [ ! -f "+shellQuote(release)+" ] && [ \"$i\" -lt 100 ]; do i=$((i+1)); sleep .05; done")
	running := createWorktreeAsync(t, a, id, "checkout", "test-branch")
	waitForCheckoutHook(t, marker)
	target := filepath.Join(a.Execution.Root, "checkout", "repository")
	if _, err := a.Execution.Directories.UseDirectories(filepath.Join(target, "nested")); !errors.Is(err, execution.ErrDirectoryChanging) {
		t.Fatalf("partial worktree allowed a directory admission: %v", err)
	}
	releaseOther, err := a.Execution.Directories.UseDirectories(filepath.Join(a.Execution.Root, "other"))
	if err != nil {
		t.Fatalf("unrelated directory was blocked: %v", err)
	}
	releaseOther()
	releaseHook()
	if result := <-running; result.code != 201 {
		t.Fatal(result)
	}
	releaseTarget, err := a.Execution.Directories.UseDirectories(target)
	if err != nil {
		t.Fatalf("completed checkout retained a reservation: %v", err)
	}
	releaseTarget()
}
