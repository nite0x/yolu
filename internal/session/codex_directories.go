package session

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

type codexPermissionProfile struct {
	ID string `json:"id"`
}

const assistantMCPName = "yolu_builtin"

func (a *Service) configureCodexThread(ctx context.Context, client codex.LiveClient, params map[string]any, plan model.LaunchPlan, permission string) error {
	if plan.YoluAssistant {
		if len(a.AssistantMCP) == 0 || a.Execution.Remote != nil {
			return fmt.Errorf("当前执行环境无法启动 Yolu 助手")
		}
		if !plan.ManagedBindings || permission == "full" {
			return fmt.Errorf("Yolu 助手需要本机 Codex 和受管目录权限")
		}
	}
	if !plan.ManagedBindings {
		setThreadPermissions(params, permission)
		return nil
	}
	if permission == "full" {
		params["cwd"] = plan.Cwd
		params["runtimeWorkspaceRoots"] = uniqueDirectories(append([]string{plan.Cwd}, plan.AdditionalDirectories...))
		setThreadPermissions(params, permission)
		return nil
	}
	fileCtx := execution.WithClient(ctx, a.Execution.Remote)
	fs := map[string]string{":minimal": "read"}
	// The native sandbox helper relaunches the installed binary, including
	// when the Linux peer runs Codex from its user's home directory.
	if remote := a.Execution.Remote; remote != nil {
		check, cancel := context.WithTimeout(ctx, 2*time.Second)
		var path string
		if err := remote.Call(check, execution.Request{Op: "codex-executable"}, &path); err == nil && platform.AbsoluteWorkspacePath(path) {
			fs[path] = "read"
		}
		cancel()
	} else if path := codex.Command(ctx, "app-server", "daemon", "version").Path; filepath.IsAbs(path) {
		fs[path] = "read"
		if canonical, err := filepath.EvalSymlinks(path); err == nil {
			fs[canonical] = "read"
		}
	}
	// A conversation with no primary binding owns its default directory.
	// A primary binding below supersedes this grant with its confirmed access.
	fs[plan.Cwd] = model.SessionBindingWrite
	for _, binding := range plan.Bindings {
		fs[binding.Directory] = binding.Access
		if binding.ProjectID != "" {
			// A linked worktree's .git file points outside the checkout. Grant
			// read access to shared metadata and write only to its own index.
			common, commonErr := execution.Git(fileCtx, binding.Directory, "rev-parse", "--path-format=absolute", "--git-common-dir")
			gitDir, gitErr := execution.Git(fileCtx, binding.Directory, "rev-parse", "--absolute-git-dir")
			if commonErr != nil || gitErr != nil {
				return fmt.Errorf("无法核对工作目录的 Git 元数据：%s", binding.Directory)
			}
			commonPath, commonErr := execution.Eval(fileCtx, strings.TrimSpace(common))
			gitPath, gitErr := execution.Eval(fileCtx, strings.TrimSpace(gitDir))
			if commonErr != nil || gitErr != nil || gitPath != commonPath && !platform.Within(platform.JoinWorkspacePath(commonPath, "worktrees"), gitPath) {
				return fmt.Errorf("工作目录的 Git 元数据位置无效：%s", binding.Directory)
			}
			if !platform.Within(binding.Directory, commonPath) {
				fs[commonPath] = "read"
			}
			if gitPath != commonPath && !platform.Within(binding.Directory, gitPath) {
				fs[gitPath] = binding.Access
			}
		}
	}
	settings, _ := json.Marshal(fs)
	profile := fmt.Sprintf("yolu-%x", sha256.Sum256(settings))
	config, _ := params["config"].(map[string]any)
	if config == nil {
		config = map[string]any{}
		params["config"] = config
	}
	config["permissions"] = map[string]any{profile: map[string]any{
		"filesystem": fs, "network": map[string]bool{"enabled": false},
	}}
	config["default_permissions"] = profile
	for _, feature := range []string{"hooks", "plugins", "apps", "multi_agent", "multi_agent_v2", "enable_fanout", "skill_mcp_dependency_install"} {
		config["features."+feature] = false
	}
	config["features.request_permissions_tool"] = true
	config["web_search"] = "disabled"
	config["thread_unload_delay_secs"] = 0
	// Unscoped local MCP processes and plugins can otherwise open files outside
	// the filesystem sandbox. Disable their effective configurations for this
	// managed thread without changing the user's native configuration.
	var effective struct {
		Config struct {
			MCPServers map[string]json.RawMessage `json:"mcp_servers"`
			Plugins    map[string]json.RawMessage `json:"plugins"`
		} `json:"config"`
	}
	check, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := client.Call(check, "config/read", map[string]any{"cwd": plan.Cwd}, &effective); err != nil {
		return fmt.Errorf("无法检查 Codex 目录权限配置：%w", err)
	}
	if len(effective.Config.MCPServers) > 0 || plan.YoluAssistant {
		servers := map[string]any{}
		for name := range effective.Config.MCPServers {
			servers[name] = map[string]bool{"enabled": false}
		}
		if plan.YoluAssistant {
			if _, exists := effective.Config.MCPServers[assistantMCPName]; exists {
				return fmt.Errorf("Codex 配置已使用保留的 MCP 名称 %s", assistantMCPName)
			}
			servers[assistantMCPName] = map[string]any{
				"command": a.AssistantMCP[0], "args": a.AssistantMCP[1:],
				"enabled": true, "required": true, "startup_timeout_sec": 5,
				"enabled_tools": []string{"list_projects", "get_project"},
			}
			params["developerInstructions"] = assistantInstructions + "\n" + codexDirectoryInstructions(managedDirectoryInstructions) + "\n" + chatQuestionInstructions
		}
		config["mcp_servers"] = servers
	}
	if len(effective.Config.Plugins) > 0 {
		plugins := map[string]any{}
		for name := range effective.Config.Plugins {
			plugins[name] = map[string]bool{"enabled": false}
		}
		config["plugins"] = plugins
	}
	params["cwd"] = plan.Cwd
	params["runtimeWorkspaceRoots"] = uniqueDirectories(append([]string{plan.Cwd}, plan.AdditionalDirectories...))
	params["permissions"] = profile
	params["approvalPolicy"] = "on-request"
	if permission == "auto" {
		params["approvalsReviewer"] = "auto_review"
	} else {
		params["approvalsReviewer"] = "user"
	}
	return nil
}

const assistantInstructions = `You are Yolu Assistant in a standard Yolu conversation. Help users find registered projects and understand their worktrees, branches and local Git status.
Use the built-in Yolu MCP list_projects and get_project tools for Yolu state. Treat stale or refreshing status accordingly. To let the user open a project or worktree, include the exact open_url or worktree_links URL returned by get_project as a Markdown link. Users can click links to navigate in Yolu. Ask when a project or environment is ambiguous. Respect existing conversation directory grants.`

func verifyCodexProfile(params map[string]any, effective *codexPermissionProfile) error {
	profile, _ := params["permissions"].(string)
	if profile == "" {
		return nil
	}
	if effective == nil || effective.ID != profile {
		return fmt.Errorf("Codex 未确认此对话的目录权限。请更新 Codex 或结束占用此对话的原生进程后重试。")
	}
	return nil
}

func codexDirectoryInstructions(instructions string) string {
	return strings.TrimSpace(instructions + "\n请通过 Codex 原生权限申请工具逐个申请额外目录，说明用途与所需的读取或写入权限。获得授权后再操作。")
}

func addCodexDirectoryContext(params map[string]any, bindings []model.SessionProjectBinding) {
	if len(bindings) == 0 {
		return
	}
	var message strings.Builder
	message.WriteString("Yolu 当前已关联的实际目录及访问权限（JSON）：")
	for _, binding := range bindings {
		entry, _ := json.Marshal(map[string]string{"directory": binding.Directory, "role": binding.Role, "access": binding.Access})
		if message.Len()+len(entry) < 8192 {
			message.WriteByte('\n')
			message.Write(entry)
		}
	}
	params["additionalContext"] = map[string]any{"yolu-directories": map[string]string{"kind": "application", "value": message.String()}}
}
