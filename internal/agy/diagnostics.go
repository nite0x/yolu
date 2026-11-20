package agy

import (
	"context"
	"os/user"
	"runtime"
	"time"

	"worktree-hub/internal/acp"
)

type DiagnosticCheck struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Advice  string `json:"advice,omitempty"`
}

type Diagnostics struct {
	Platform    string            `json:"platform"`
	User        string            `json:"user"`
	CLIPath     string            `json:"cli_path"`
	Candidates  []string          `json:"candidates"`
	Version     string            `json:"version,omitempty"`
	AgentName   string            `json:"agent_name,omitempty"`
	CheckedAt   string            `json:"checked_at"`
	Status      string            `json:"status"`
	Checks      []DiagnosticCheck `json:"checks"`
	AuthMethods []acp.AuthMethod  `json:"auth_methods,omitempty"`
}

func currentUser() string {
	if u, err := user.Current(); err == nil {
		return u.Username
	}
	return ""
}

func Diagnose(ctx context.Context, open func(context.Context, ...string) (acp.Client, acp.InitializeResult, error)) Diagnostics {
	if open == nil {
		open = OpenACP
	}
	cliPath, candidates := ResolveBinary()
	report := Diagnostics{
		Platform:   runtime.GOOS,
		User:       currentUser(),
		CLIPath:    cliPath,
		Candidates: candidates,
		CheckedAt:  time.Now().UTC().Format(time.RFC3339),
		Status:     "ok",
		Checks:     []DiagnosticCheck{},
	}
	if report.Candidates == nil {
		report.Candidates = []string{}
	}
	if cliPath == "" {
		report.Status = "error"
		report.Checks = append(report.Checks, DiagnosticCheck{
			ID:      "cli",
			Name:    "CLI 安装与路径",
			Status:  "error",
			Message: "未找到 agy 可执行文件",
			Advice:  "请先安装 Antigravity CLI（agy）并确认 ~/.local/bin 在 PATH 中。",
		})
		return report
	}
	report.Checks = append(report.Checks, DiagnosticCheck{
		ID:      "cli",
		Name:    "CLI 安装与路径",
		Status:  "ok",
		Message: cliPath,
	})

	probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, initRes, err := open(probeCtx)
	if err != nil {
		report.Status = "error"
		report.Checks = append(report.Checks, DiagnosticCheck{
			ID:      "acp",
			Name:    "ACP 协议握手",
			Status:  "error",
			Message: err.Error(),
			Advice:  "请确认当前环境的 agy 版本支持 agy acp 子命令。",
		})
		return report
	}
	defer client.Close()

	report.AgentName = initRes.AgentInfo.Name
	report.Version = initRes.AgentInfo.Version
	report.AuthMethods = initRes.AuthMethods
	versionText := initRes.AgentInfo.Name
	if initRes.AgentInfo.Version != "" {
		versionText += " " + initRes.AgentInfo.Version
	}
	report.Checks = append(report.Checks, DiagnosticCheck{
		ID:      "acp",
		Name:    "ACP 协议握手",
		Status:  "ok",
		Message: versionText,
	})

	var list acp.SessionListResult
	listCtx, listCancel := context.WithTimeout(probeCtx, 10*time.Second)
	defer listCancel()
	if err := client.Call(listCtx, "session/list", map[string]any{}, &list); err != nil {
		if acp.IsAuthRequired(err) {
			report.Status = "warning"
			report.Checks = append(report.Checks, DiagnosticCheck{
				ID:      "auth",
				Name:    "登录与对话接口",
				Status:  "warning",
				Message: "Antigravity 尚未登录",
				Advice:  "请在终端运行 agy 或 agy acp --login 完成认证后重试。",
			})
		} else {
			report.Status = "warning"
			report.Checks = append(report.Checks, DiagnosticCheck{
				ID:      "auth",
				Name:    "登录与对话接口",
				Status:  "warning",
				Message: err.Error(),
				Advice:  "ACP 已连接，但读取会话列表失败；请确认登录状态或网络环境。",
			})
		}
		return report
	}
	report.Checks = append(report.Checks, DiagnosticCheck{
		ID:      "auth",
		Name:    "登录与对话接口",
		Status:  "ok",
		Message: "已完成认证并成功读取对话列表",
	})
	return report
}
