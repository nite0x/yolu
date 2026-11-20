package agy

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/platform"
)

func binaryName() string {
	if runtime.GOOS == "windows" {
		return "agy.exe"
	}
	return "agy"
}

func candidateDirs() []string {
	dirs := []string{}
	seen := map[string]bool{}
	add := func(dir string) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			return
		}
		clean := filepath.Clean(dir)
		key := clean
		if runtime.GOOS == "windows" {
			key = strings.ToLower(clean)
		}
		if seen[key] {
			return
		}
		seen[key] = true
		dirs = append(dirs, clean)
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		add(filepath.Join(home, ".local", "bin"))
		add(filepath.Join(home, ".gemini", "antigravity-cli", "bin"))
		if runtime.GOOS == "windows" {
			add(filepath.Join(home, "AppData", "Local", "Programs", "antigravity"))
		}
	}
	for _, entry := range filepath.SplitList(os.Getenv("PATH")) {
		add(entry)
	}
	if runtime.GOOS != "windows" {
		add("/opt/homebrew/bin")
		add("/usr/local/bin")
	}
	return dirs
}

func ResolveBinary() (string, []string) {
	candidates := []string{}
	seen := map[string]bool{}
	addCandidate := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" {
			return
		}
		clean := filepath.Clean(path)
		if seen[clean] {
			return
		}
		info, err := os.Stat(clean)
		if err != nil || info.IsDir() {
			return
		}
		if runtime.GOOS != "windows" && info.Mode()&0111 == 0 {
			return
		}
		seen[clean] = true
		candidates = append(candidates, clean)
	}
	if override := strings.TrimSpace(os.Getenv("AGY_CLI_PATH")); override != "" {
		addCandidate(override)
	}
	if found, err := exec.LookPath("agy"); err == nil {
		addCandidate(found)
	}
	name := binaryName()
	for _, dir := range candidateDirs() {
		addCandidate(filepath.Join(dir, name))
	}
	if len(candidates) == 0 {
		return "", candidates
	}
	return candidates[0], candidates
}

func Command(ctx context.Context, args ...string) *exec.Cmd {
	bin, _ := ResolveBinary()
	if bin == "" {
		bin = "agy"
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	platform.HideCommand(cmd)
	return cmd
}

func OpenACP(ctx context.Context, extraArgs ...string) (acp.Client, acp.InitializeResult, error) {
	bin, _ := ResolveBinary()
	if bin == "" {
		return nil, acp.InitializeResult{}, fmt.Errorf("未找到 Antigravity CLI（agy），请先安装并确认其在 PATH 中")
	}
	args := append([]string{"acp", "--stdio"}, extraArgs...)
	cmd := exec.CommandContext(ctx, bin, args...)
	platform.HideCommand(cmd)
	client, err := acp.StartStdio(ctx, cmd)
	if err != nil {
		return nil, acp.InitializeResult{}, fmt.Errorf("启动 Antigravity ACP 失败：%w", err)
	}
	initCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	initRes, err := acp.Initialize(initCtx, client, acp.ClientInfo{Name: "yolu", Version: "0.1.0"})
	if err != nil {
		client.Close()
		return nil, acp.InitializeResult{}, fmt.Errorf("初始化 Antigravity ACP 失败：%w", err)
	}
	return client, initRes, nil
}
