package execution

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitPreviewDrainsAndBoundsLargeOutput(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s %v", args, out, err)
		}
	}
	git("init")
	git("config", "user.name", "Test")
	git("config", "user.email", "test@example.test")
	file := filepath.Join(root, "large.txt")
	os.WriteFile(file, []byte("base\n"), 0600)
	git("add", "large.txt")
	git("commit", "-m", "base")
	os.WriteFile(file, []byte(strings.Repeat("a long changed line\n", GitPreviewLimit)), 0600)
	preview, err := RunGitPreview(context.Background(), root, "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--", "large.txt")
	if err != nil || !preview.Truncated || len(preview.Text) > GitPreviewLimit {
		t.Fatalf("len=%d truncated=%v err=%v", len(preview.Text), preview.Truncated, err)
	}
	remote := WithClient(context.Background(), streamTestClient(t))
	preview, err = RunGitPreview(remote, root, "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--", "large.txt")
	if err != nil || !preview.Truncated || len(preview.Text) > GitPreviewLimit {
		t.Fatalf("remote len=%d truncated=%v err=%v", len(preview.Text), preview.Truncated, err)
	}
}
