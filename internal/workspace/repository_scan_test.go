package workspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestScanRepositoriesUsesEnvironmentTransportAndCancellation(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "repository")
	if err := os.Mkdir(path, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := Git(context.Background(), path, "init", "-b", "main"); err != nil {
		t.Fatal(err)
	}
	contexts := []context.Context{context.Background(), WithClient(context.Background(), streamTestClient(t))}
	for _, ctx := range contexts {
		result, err := ScanRepositories(ctx, root)
		if err != nil || len(result.Repositories) != 1 || result.Repositories[0].Path != path {
			t.Fatalf("scan: %+v %v", result, err)
		}
		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		if _, err := ScanRepositories(cancelled, root); !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled scan: %v", err)
		}
	}
}
