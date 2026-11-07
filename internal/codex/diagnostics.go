package codex

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"worktree-hub/internal/platform"
)

type DiagnosticCheck struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
	Advice  string `json:"advice,omitempty"`
}

// No auth files, account identity, credentials, environment dump or transcript
// are included in the report. Reading credentials is left to account/read.
type Diagnostics struct {
	Platform      string            `json:"platform"`
	User          string            `json:"user"`
	CodexHome     string            `json:"codex_home"`
	CLIPath       string            `json:"cli_path"`
	CLIEntry      string            `json:"cli_entry,omitempty"`
	Candidates    []string          `json:"candidates"`
	Version       string            `json:"version,omitempty"`
	DaemonPath    string            `json:"daemon_path,omitempty"`
	DaemonVersion string            `json:"daemon_version,omitempty"`
	DaemonStatus  string            `json:"daemon_status,omitempty"`
	CheckedAt     time.Time         `json:"checked_at"`
	Status        string            `json:"status"`
	Checks        []DiagnosticCheck `json:"checks"`
}

// Diagnose runs bounded local checks using the same resolver and metadata
// client as the application. It never starts/restarts a daemon or an agent turn.
func Diagnose(ctx context.Context, openSessions func(context.Context) (SessionClient, error)) Diagnostics {
	return diagnose(ctx, openSessions, Command)
}

func diagnose(parent context.Context, openSessions func(context.Context) (SessionClient, error), command func(context.Context, ...string) *exec.Cmd) Diagnostics {
	ctx, cancel := context.WithTimeout(parent, 25*time.Second)
	defer cancel()
	report := Diagnostics{Platform: runtime.GOOS, User: os.Getenv("USER"), CodexHome: os.Getenv("CODEX_HOME"), CheckedAt: time.Now(), Status: "ok", Candidates: codexCandidates(), Checks: []DiagnosticCheck{}}
	if report.User == "" {
		report.User = os.Getenv("USERNAME")
	}
	if report.CodexHome == "" {
		if home, err := os.UserHomeDir(); err == nil {
			report.CodexHome = filepath.Join(home, ".codex")
		}
	}
	add := func(id, name, status, message, advice string) {
		report.Checks = append(report.Checks, DiagnosticCheck{id, name, status, diagnosticText(message), advice})
		if status == "error" || status == "warning" && report.Status == "ok" {
			report.Status = status
		}
	}
	versionCtx, endVersion := context.WithTimeout(ctx, 4*time.Second)
	cmd := command(versionCtx, "--version")
	report.CLIPath = cmd.Path
	if len(cmd.Args) > 2 { // Windows npm: node.exe /.../codex.js --version.
		report.CLIEntry = cmd.Args[1]
	}
	raw, err := diagnosticOutput(cmd)
	if versionCtx.Err() != nil {
		err = versionCtx.Err()
	}
	endVersion()
	if err != nil {
		add("cli", "CLI 安装与版本", "error", err.Error(), "在此执行环境安装 Codex CLI，并确认 PATH 可找到它；安装后退出并停止 Yolu 后台再打开。WSL 需在对应发行版和用户下安装。")
		for _, item := range []struct{ id, name string }{{"sessions", "对话接口"}, {"auth", "登录状态"}, {"daemon", "共享后台"}} {
			add(item.id, item.name, "skipped", "CLI 无法执行，未继续检测", "")
		}
		return report
	}
	report.Version = diagnosticText(strings.TrimSpace(string(raw)))
	if report.Version == "" {
		add("cli", "CLI 安装与版本", "warning", "程序可执行，但没有返回版本号", "检查上面的程序路径是否为 Codex CLI。")
	} else {
		add("cli", "CLI 安装与版本", "ok", report.Version, "")
	}
	metadataCtx, endMetadata := context.WithTimeout(ctx, 10*time.Second)
	c, err := openSessions(metadataCtx)
	if err == nil {
		var page SessionPage
		err = c.Call("thread/list", map[string]any{"limit": 1}, &page)
	}
	if err != nil {
		add("sessions", "对话接口", "error", err.Error(), "检查 CLI 配置和上面的实际程序路径；若刚更新 CLI，请退出并停止 Yolu 后台后重试。")
		add("auth", "登录状态", "skipped", "对话接口不可用，无法读取登录状态", "")
	} else {
		add("sessions", "对话接口", "ok", "已完成初始化并成功读取对话列表", "")
		var account struct {
			Account *struct {
				Type string `json:"type"`
			} `json:"account"`
			RequiresAuth *bool `json:"requiresOpenaiAuth"`
		}
		if err := c.Call("account/read", map[string]any{"refreshToken": false}, &account); err != nil {
			add("auth", "登录状态", "warning", err.Error(), "无法读取认证状态；请在此环境运行 codex login status 检查。")
		} else if account.Account != nil && account.Account.Type != "" {
			add("auth", "登录状态", "ok", "已配置认证方式："+account.Account.Type+"（未验证凭证有效性或模型访问）", "")
		} else if account.RequiresAuth != nil && !*account.RequiresAuth {
			add("auth", "登录状态", "ok", "当前模型提供方不要求 OpenAI 登录（未验证模型访问）", "")
		} else if account.RequiresAuth != nil && *account.RequiresAuth {
			add("auth", "登录状态", "error", "当前模型提供方需要登录，但没有可用登录信息", "请在此执行环境运行 codex login。Windows 本机与 WSL 用户的登录信息独立。")
		} else {
			add("auth", "登录状态", "warning", "CLI 未返回可识别的认证状态", "在此环境运行 codex login status 检查。")
		}
	}
	if c != nil {
		c.Close()
	}
	endMetadata()
	// A current CLI and a running daemon may be different installations/versions.
	daemonCtx, endDaemon := context.WithTimeout(ctx, 8*time.Second)
	defer endDaemon()
	cmd = command(daemonCtx, "app-server", "daemon", "version")
	report.DaemonPath = cmd.Path
	raw, err = diagnosticOutput(cmd)
	if daemonCtx.Err() != nil {
		err = daemonCtx.Err()
	}
	if err != nil {
		add("daemon", "共享后台", "error", err.Error(), "此功能需要 CLI 支持 app-server daemon。检查 CLI 和托管后台的安装路径，确认安装方式及版本支持此接口。")
		return report
	}
	var daemon struct {
		Status           string `json:"status"`
		SocketPath       string `json:"socketPath"`
		AppServerVersion string `json:"appServerVersion"`
	}
	if err := json.Unmarshal(raw, &daemon); err != nil {
		add("daemon", "共享后台", "error", "无法解析后台版本信息："+err.Error(), "检查 CLI 是否支持 app-server daemon version 的 JSON 输出。")
		return report
	}
	if daemon.Status == "" {
		add("daemon", "共享后台", "error", "后台版本信息缺少运行状态", "检查 CLI 是否支持 app-server daemon version 的状态输出。")
		return report
	}
	report.DaemonStatus, report.DaemonVersion = daemon.Status, daemon.AppServerVersion
	if daemon.SocketPath == "" && daemon.Status != "running" {
		add("daemon", "共享后台", "warning", "共享后台未运行；检测没有启动后台", "首次发送会尝试启动；若启动失败，在此环境运行 codex app-server daemon start 查看原因。")
		return report
	}
	conn, err := dialDaemonSocket(daemonCtx, daemonCtx, daemon.SocketPath)
	if err == nil {
		var live LiveClient
		live, err = StartWebSocket(daemonCtx, conn)
		if err == nil {
			var page SessionPage
			err = live.Call(daemonCtx, "thread/list", map[string]any{"limit": 1}, &page)
			live.Close()
		}
	}
	if err != nil {
		add("daemon", "共享后台", "error", err.Error(), "后台报告已运行但连接失败。请检查此环境的 Codex 后台；处理前先确认没有正在运行的 Codex 任务。")
	} else {
		add("daemon", "共享后台", "ok", "已连接共享后台并成功读取对话列表", "")
	}
	return report
}

func codexCandidates() []string {
	result := []string{}
	seen := map[string]bool{}
	names := []string{"codex"}
	if runtime.GOOS == "windows" {
		names = []string{"codex.exe", "codex.cmd"}
	}
	for _, dir := range filepath.SplitList(os.Getenv("PATH")) {
		if !filepath.IsAbs(dir) {
			continue
		}
		for _, name := range names {
			if path, err := exec.LookPath(filepath.Join(dir, name)); err == nil && !seen[path] {
				seen[path] = true
				result = append(result, path)
			}
		}
	}
	return result
}

type diagnosticBuffer struct {
	mu sync.Mutex
	b  []byte
}

func (b *diagnosticBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.b = append(b.b, p[:min(len(p), 8192-len(b.b))]...)
	return len(p), nil
}

func diagnosticOutput(cmd *exec.Cmd) ([]byte, error) {
	platform.HideCommand(cmd)
	cmd.WaitDelay = 200 * time.Millisecond
	var output, stderr diagnosticBuffer
	cmd.Stdout, cmd.Stderr = &output, &stderr
	err := cmd.Run()
	if err != nil {
		if detail := strings.TrimSpace(string(stderr.b)); detail != "" {
			err = fmt.Errorf("%w：%s", err, diagnosticText(detail))
		}
	}
	return output.b, err
}

var diagnosticSecret = regexp.MustCompile(`(?i)(?:\b(?:sk-|sess-)[a-z0-9_-]+|\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|(?:bearer\s+)[a-z0-9_.-]+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\s*["']?\s*[:=]\s*["']?(?:bearer\s+)?[^\s,"'}]+)`)

func diagnosticText(value string) string {
	value = diagnosticSecret.ReplaceAllString(value, "[已隐藏凭证]")
	runes := []rune(strings.ToValidUTF8(value, "�"))
	if len(runes) > 2000 {
		return string(runes[:2000]) + "…"
	}
	return string(runes)
}
