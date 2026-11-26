package cursor

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"worktree-hub/internal/platform"

	"worktree-hub/internal/acp"
)

// CLI aliases differ from ACP model IDs (for example auto versus default[]).
// Read the exact supported values from ACP without sending a model prompt.
func DiscoverCatalog(ctx context.Context, open func(context.Context, ...string) (acp.Client, acp.InitializeResult, error)) (acp.OptionCatalog, error) {
	dir, err := os.MkdirTemp("", "yolu-cursor-options-")
	if err != nil {
		return acp.OptionCatalog{}, err
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	client, _, err := open(ctx, "--sandbox", "enabled")
	if err != nil {
		return acp.OptionCatalog{}, err
	}
	defer client.Close()
	var setup acp.SessionSetupResult
	if err := client.Call(ctx, "session/new", map[string]any{"cwd": dir, "mcpServers": []any{}}, &setup); err != nil {
		return acp.OptionCatalog{}, err
	}
	if setup.SessionID == "" {
		return acp.OptionCatalog{}, fmt.Errorf("Cursor 未返回选项会话标识")
	}
	return acp.CatalogFromSetup(setup), nil
}

// Option discovery may leave an empty native record on agents without a delete
// operation. These private probes are never user conversations in Yolu's index.
func IsOptionsDirectory(directory string) bool {
	if !strings.HasPrefix(filepath.Base(directory), "yolu-cursor-options-") {
		return false
	}
	parent := filepath.Dir(directory)
	if platform.SameWorkspacePath(parent, os.TempDir()) {
		return true
	}
	temp, err := filepath.EvalSymlinks(os.TempDir())
	return err == nil && platform.SameWorkspacePath(parent, temp)
}
