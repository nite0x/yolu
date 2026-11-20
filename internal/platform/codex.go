package platform

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// CodexInstallDir is the visible command directory used by the official installer.
func CodexInstallDir() string {
	if dir := os.Getenv("CODEX_INSTALL_DIR"); dir != "" {
		if filepath.IsAbs(dir) {
			return filepath.Clean(dir)
		}
		return ""
	}
	if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); filepath.IsAbs(local) {
			return filepath.Join(local, "Programs", "OpenAI", "Codex", "bin")
		}
		return ""
	}
	if home, err := os.UserHomeDir(); err == nil && filepath.IsAbs(home) {
		return filepath.Join(home, ".local", "bin")
	}
	return ""
}

func PathWithCodexInstallDir(path string) string {
	dir := CodexInstallDir()
	if dir == "" || path == "" {
		return path
	}
	for _, entry := range filepath.SplitList(path) {
		if entry == dir || runtime.GOOS == "windows" && strings.EqualFold(entry, dir) {
			return path
		}
	}
	return path + string(os.PathListSeparator) + dir
}
