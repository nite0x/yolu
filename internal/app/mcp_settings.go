package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/platform"
)

const (
	mcpSettingsPath = "/api/settings/mcp"
	mcpServerName   = "yolu"
)

type mcpInstallStatus struct {
	Agent  string `json:"agent"`
	Status string `json:"status"`
}

type mcpAgentSettings struct {
	CanManage bool               `json:"can_manage"`
	Agents    []mcpInstallStatus `json:"agents"`
}

type mcpLaunch struct {
	Command string
	DataDir string
}

func (a *App) mcpSettingsHandler(w http.ResponseWriter, r *http.Request) {
	if isBrowserRequest(r) || a.Execution.Remote != nil {
		if r.Method == http.MethodPost {
			httpx.WriteError(w, http.StatusForbidden, "请在主机上的 Yolu 中安装 MCP")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, mcpAgentSettings{Agents: []mcpInstallStatus{}})
		return
	}
	if r.Method == http.MethodPost {
		var input struct {
			Agent string `json:"agent"`
		}
		if !httpx.DecodeLimit(w, r, &input, 1024) {
			return
		}
		if input.Agent != "codex" && input.Agent != "claude" {
			httpx.WriteError(w, http.StatusBadRequest, "请选择支持的 Agent")
			return
		}
		a.mcpInstallMu.Lock()
		defer a.mcpInstallMu.Unlock()
		ctx, cancel := context.WithTimeout(r.Context(), 18*time.Second)
		defer cancel()
		result := a.mcpAgentStatus(ctx, input.Agent, true)
		if result.Status == "install_failed" {
			httpx.WriteError(w, http.StatusBadGateway, "未能保存 MCP 配置，请检查 Agent 设置与文件权限后重试。")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, result)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	httpx.WriteJSON(w, http.StatusOK, mcpAgentSettings{CanManage: true, Agents: []mcpInstallStatus{
		a.mcpAgentStatus(ctx, "codex", false), a.mcpAgentStatus(ctx, "claude", false),
	}})
}

func (a *App) mcpAgentStatus(ctx context.Context, agent string, install bool) mcpInstallStatus {
	result := mcpInstallStatus{Agent: agent, Status: "unavailable"}
	launcher, err := currentMCPLaunch(a.Execution.DataDir)
	home, homeErr := os.UserHomeDir()
	if err != nil || homeErr != nil || !filepath.IsAbs(home) {
		return result
	}
	command := func(args ...string) *exec.Cmd {
		var cmd *exec.Cmd
		if agent == "codex" {
			cmd = codex.Command(ctx, args...)
		} else {
			cmd = claudeMCPCommand(ctx, args...)
		}
		cmd.Dir = home
		cmd.WaitDelay = time.Second
		platform.HideCommand(cmd)
		return cmd
	}
	if command("--version").Err != nil {
		result.Status = "missing_cli"
		return result
	}
	inspect := func() (string, error) {
		if agent == "codex" {
			return codexMCPStatus(command("mcp", "list", "--json"), launcher)
		}
		return claudeMCPStatus(home, launcher)
	}
	status, err := inspect()
	if err != nil {
		return result
	}
	result.Status = status
	if !install || status != "available" {
		return result
	}
	args := []string{"mcp", "add"}
	if agent == "claude" {
		args = append(args, "--scope", "user", "--transport", "stdio")
	}
	args = append(args, mcpServerName, "--", launcher.Command, "--mcp", "--data", launcher.DataDir)
	// Check what was saved even if the CLI exits with an error after writing.
	// Its output can contain local configuration, so keep it out of API responses.
	_ = command(args...).Run()
	if status, err := inspect(); err == nil && (status == "installed" || status == "conflict") {
		result.Status = status
	} else {
		result.Status = "install_failed"
	}
	return result
}

func currentMCPLaunch(dataDir string) (mcpLaunch, error) {
	command, err := os.Executable()
	if err != nil {
		return mcpLaunch{}, err
	}
	// An AppImage remounts at a different location each time. Register the
	// AppImage itself so the command can survive backend and machine restarts.
	if runtime.GOOS == "linux" {
		image, mount := os.Getenv("APPIMAGE"), os.Getenv("APPDIR")
		if filepath.IsAbs(image) && filepath.IsAbs(mount) && platform.Within(mount, command) {
			command = image
		}
	}
	return mcpLaunch{Command: command, DataDir: dataDir}, nil
}

func claudeMCPCommand(ctx context.Context, args ...string) *exec.Cmd {
	if runtime.GOOS != "windows" {
		return exec.CommandContext(ctx, "claude", args...)
	}
	if executable, err := exec.LookPath("claude.exe"); err == nil {
		return exec.CommandContext(ctx, executable, args...)
	}
	if shim, err := exec.LookPath("claude.cmd"); err == nil {
		pkg := filepath.Join(filepath.Dir(shim), "node_modules", "@anthropic-ai", "claude-code")
		if entry, err := exec.LookPath(filepath.Join(pkg, "bin", "claude.exe")); err == nil {
			return exec.CommandContext(ctx, entry, args...)
		}
		entry := filepath.Join(pkg, "cli.js")
		if info, err := os.Stat(entry); err == nil && info.Mode().IsRegular() {
			return exec.CommandContext(ctx, "node.exe", append([]string{entry}, args...)...)
		}
	}
	return exec.CommandContext(ctx, "claude.exe", args...)
}

func codexMCPStatus(cmd *exec.Cmd, want mcpLaunch) (string, error) {
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	var servers []struct {
		Name      string          `json:"name"`
		Enabled   *bool           `json:"enabled"`
		Transport json.RawMessage `json:"transport"`
	}
	if err := json.Unmarshal(out, &servers); err != nil {
		return "", err
	}
	for _, server := range servers {
		if server.Name == mcpServerName {
			if server.Enabled != nil && !*server.Enabled {
				return "conflict", nil
			}
			if len(server.Transport) == 0 {
				return "conflict", nil
			}
			return mcpRegistrationStatus(server.Transport, want), nil
		}
	}
	return "available", nil
}

func claudeMCPStatus(home string, want mcpLaunch) (string, error) {
	if directory := os.Getenv("CLAUDE_CONFIG_DIR"); directory != "" {
		home = directory
	}
	raw, err := os.ReadFile(filepath.Join(home, ".claude.json"))
	if errors.Is(err, os.ErrNotExist) {
		return "available", nil
	}
	if err != nil {
		return "", err
	}
	var config struct {
		Servers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		return "", err
	}
	return mcpRegistrationStatus(config.Servers[mcpServerName], want), nil
}

func mcpRegistrationStatus(raw json.RawMessage, want mcpLaunch) string {
	if raw == nil {
		return "available"
	}
	var configured struct {
		Command string   `json:"command"`
		Args    []string `json:"args"`
		Type    string   `json:"type"`
	}
	if json.Unmarshal(raw, &configured) != nil || (configured.Type != "" && configured.Type != "stdio") ||
		!filepath.IsAbs(configured.Command) || !platform.SameWorkspacePath(configured.Command, want.Command) {
		return "conflict"
	}
	if len(configured.Args) == 1 && configured.Args[0] == "--mcp" && platform.SameWorkspacePath(platform.DefaultDataDir(), want.DataDir) {
		return "installed"
	}
	if len(configured.Args) == 3 && configured.Args[0] == "--mcp" && configured.Args[1] == "--data" &&
		filepath.IsAbs(configured.Args[2]) && platform.SameWorkspacePath(configured.Args[2], want.DataDir) {
		return "installed"
	}
	return "conflict"
}
