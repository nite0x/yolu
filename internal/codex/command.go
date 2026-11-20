package codex

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// npm's Windows shim is a .cmd file. Start its JS entry point directly so
// app-server JSONL travels over pipes without shell argument interpretation.
func Command(ctx context.Context, args ...string) *exec.Cmd {
	// On macOS the desktop CLI can install a managed daemon runtime even when
	// an older Homebrew CLI remains first on PATH. Use that runtime for daemon
	// lifecycle commands so a cold start does not require the legacy installer.
	if runtime.GOOS == "darwin" && len(args) >= 2 && args[0] == "app-server" && args[1] == "daemon" {
		if root := codexHome(); filepath.IsAbs(root) {
			managed := filepath.Join(root, "packages", "app-server-daemon", "current", "bin", "codex")
			if info, err := os.Stat(managed); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0 {
				return exec.CommandContext(ctx, managed, args...)
			}
		}
	}
	if runtime.GOOS == "windows" {
		if executable, err := exec.LookPath("codex.exe"); err == nil {
			return exec.CommandContext(ctx, executable, args...)
		}
		if shim, err := exec.LookPath("codex.cmd"); err == nil {
			entry := filepath.Join(filepath.Dir(shim), "node_modules", "@openai", "codex", "bin", "codex.js")
			if _, err := os.Stat(entry); err == nil {
				return exec.CommandContext(ctx, "node.exe", append([]string{entry}, args...)...)
			}
		}
	}
	cmd := exec.CommandContext(ctx, "codex", args...)
	if cmd.Err != nil {
		if path := standalonePath(); path != "" {
			if installed, err := exec.LookPath(path); err == nil {
				return exec.CommandContext(ctx, installed, args...)
			}
		}
	}
	return cmd
}
