// Package cursor connects Yolu to the locally installed Cursor Agent over ACP.
package cursor

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

func ResolveBinary() (string, []string) {
	candidates := []string{}
	seen := map[string]bool{}
	add := func(path string) {
		if path == "" {
			return
		}
		path = filepath.Clean(path)
		if seen[path] {
			return
		}
		info, err := os.Stat(path)
		if err != nil || info.IsDir() || runtime.GOOS != "windows" && info.Mode()&0111 == 0 {
			return
		}
		seen[path] = true
		candidates = append(candidates, path)
	}
	if override := strings.TrimSpace(os.Getenv("CURSOR_AGENT_PATH")); override != "" {
		add(override)
	}
	// Prefer the unambiguous binary; an unrelated executable may also be named agent.
	names := []string{"cursor-agent", "agent"}
	for _, name := range names {
		if found, err := exec.LookPath(name); err == nil {
			add(found)
		}
		if home, err := os.UserHomeDir(); err == nil {
			suffix := ""
			if runtime.GOOS == "windows" {
				suffix = ".exe"
			}
			add(filepath.Join(home, ".local", "bin", name+suffix))
		}
	}
	if len(candidates) == 0 {
		return "", candidates
	}
	return candidates[0], candidates
}

func Command(ctx context.Context, args ...string) *exec.Cmd {
	bin, _ := ResolveBinary()
	if bin == "" {
		bin = "cursor-agent"
	}
	cmd := exec.CommandContext(ctx, bin, args...)
	platform.HideCommand(cmd)
	return cmd
}

func OpenACP(ctx context.Context, flags ...string) (acp.Client, acp.InitializeResult, error) {
	bin, _ := ResolveBinary()
	if bin == "" {
		return nil, acp.InitializeResult{}, fmt.Errorf("未找到 Cursor Agent，请先安装并确认 ~/.local/bin 在 PATH 中")
	}
	// Root flags precede the hidden ACP subcommand; Cursor does not accept --stdio.
	args := append(append([]string{}, flags...), "acp")
	cmd := exec.CommandContext(ctx, bin, args...)
	platform.HideCommand(cmd)
	client, err := acp.StartStdio(ctx, cmd)
	if err != nil {
		return nil, acp.InitializeResult{}, fmt.Errorf("启动 Cursor ACP 失败：%w", err)
	}
	initCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	result, err := acp.Initialize(initCtx, client, acp.ClientInfo{Name: "yolu", Version: "0.1.0"})
	if err == nil && result.ProtocolVersion != acp.ProtocolVersion {
		err = fmt.Errorf("Cursor ACP 协议版本不兼容：%d", result.ProtocolVersion)
	}
	if err == nil {
		err = client.Call(initCtx, "authenticate", map[string]any{"methodId": "cursor_login"}, nil)
	}
	if err != nil {
		client.Close()
		return nil, result, fmt.Errorf("初始化或认证 Cursor ACP 失败（请运行 cursor-agent login）：%w", err)
	}
	return client, result, nil
}

func ACPFlagsForPermission(permission string, directories []string) []string {
	flags := []string{}
	switch permission {
	case "ask":
		flags = append(flags, "--sandbox", "enabled")
	case "auto":
		flags = append(flags, "--auto-review")
	case "full":
		flags = append(flags, "--force")
	}
	for _, dir := range directories {
		if strings.TrimSpace(dir) != "" {
			flags = append(flags, "--add-dir", dir)
		}
	}
	return flags
}
