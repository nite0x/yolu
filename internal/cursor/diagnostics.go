package cursor

import (
	"context"
	"os/user"
	"runtime"
	"strings"
	"time"

	"worktree-hub/internal/acp"
)

type Diagnostics = acp.Diagnostics

func Diagnose(ctx context.Context, open func(context.Context, ...string) (acp.Client, acp.InitializeResult, error)) Diagnostics {
	if open == nil {
		open = OpenACP
	}
	path, candidates := ResolveBinary()
	report := Diagnostics{Platform: runtime.GOOS, CLIPath: path, Candidates: candidates, AgentName: "Cursor Agent", CheckedAt: time.Now().UTC().Format(time.RFC3339), Status: "ok", Checks: []acp.DiagnosticCheck{}}
	if u, err := user.Current(); err == nil {
		report.User = u.Username
	}
	check := func(id, name, status, message, advice string) {
		report.Checks = append(report.Checks, acp.DiagnosticCheck{ID: id, Name: name, Status: status, Message: message, Advice: advice})
		if status == "error" || status == "warning" && report.Status == "ok" {
			report.Status = status
		}
	}
	if path == "" {
		check("cli", "CLI 安装与路径", "error", "未找到 Cursor Agent", "请安装 Cursor Agent，或通过 CURSOR_AGENT_PATH 指定可执行文件。")
		return report
	}
	check("cli", "CLI 安装与路径", "ok", path, "")
	versionCtx, stop := context.WithTimeout(ctx, 5*time.Second)
	if out, err := Command(versionCtx, "--version").Output(); err == nil {
		report.Version = strings.TrimSpace(string(out))
	}
	stop()
	probeCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client, init, err := open(probeCtx)
	if err != nil {
		check("acp", "ACP 协议握手与认证", "error", err.Error(), "请运行 cursor-agent login 完成登录，并确认版本支持 ACP。")
		return report
	}
	defer client.Close()
	report.AuthMethods = init.AuthMethods
	check("acp", "ACP 协议握手与认证", "ok", "Cursor ACP 已连接并完成认证", "")
	var list acp.SessionListResult
	if err := client.Call(probeCtx, "session/list", map[string]any{}, &list); err != nil {
		check("sessions", "登录与对话接口", "warning", err.Error(), "请检查 Cursor 登录状态或网络环境。")
		return report
	}
	check("sessions", "登录与对话接口", "ok", "已完成认证并成功读取对话列表", "")
	return report
}
