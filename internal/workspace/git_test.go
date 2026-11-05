package workspace

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestGitOperationPreservesPorcelainFailureOutput(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix executable fixture")
	}
	dir := t.TempDir()
	script := "#!/bin/sh\nprintf '!\\tHEAD:refs/heads/task\\t[rejected] (non-fast-forward)\\n'\nprintf 'error: failed to push some refs\\n' >&2\nexit 1\n"
	if err := os.WriteFile(filepath.Join(dir, "git"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir)
	_, err := GitOperation(context.Background(), dir, "push", "--porcelain")
	if err == nil || !strings.Contains(err.Error(), "[rejected] (non-fast-forward)") || !strings.Contains(err.Error(), "error: failed to push some refs") {
		t.Fatalf("push failure lost its porcelain status: %v", err)
	}
}
