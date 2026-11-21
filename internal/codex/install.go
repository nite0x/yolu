package codex

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"worktree-hub/internal/platform"
)

type InstallPlan struct {
	Action  string `json:"action,omitempty"`
	Manager string `json:"manager,omitempty"`
	Path    string `json:"path,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

type InstallState struct {
	Status  string `json:"status"`
	Action  string `json:"action,omitempty"`
	Stage   string `json:"stage,omitempty"`
	Version string `json:"version,omitempty"`
	Error   string `json:"error,omitempty"`
}

// Installer owns one operation per backend or WSL helper. The operation
// survives page navigation and is cancelled when its execution host shuts down.
type Installer struct {
	mu     sync.Mutex
	state  InstallState
	cancel context.CancelFunc
	done   chan struct{}
	closed bool
}

func (i *Installer) State() InstallState {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.state
}

func (i *Installer) Start(expected InstallPlan) (InstallState, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.closed {
		return InstallState{}, errors.New("后台正在退出，请稍后重新打开应用")
	}
	if i.state.Status == "running" {
		return i.state, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	plan, cmd := installationPlan(ctx)
	if plan.Action == "" || plan != expected {
		cancel()
		return InstallState{}, errors.New("Codex 安装状态已变化，请重新检测后再试")
	}
	i.cancel, i.done = cancel, make(chan struct{})
	i.state = InstallState{Status: "running", Action: plan.Action}
	go i.run(ctx, plan, cmd)
	return i.state, nil
}

func (i *Installer) run(ctx context.Context, plan InstallPlan, cmd *exec.Cmd) {
	err := runInstaller(ctx, plan, cmd)
	var version string
	if err == nil {
		checkCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
		check := Command(checkCtx, "--version")
		if !sameInstallPath(commandLocation(check), plan.Path) {
			err = errors.New("安装程序已完成，但 Yolu 找到了其他 Codex。请检查 PATH 后重新检测。")
		} else {
			var output []byte
			output, err = diagnosticOutput(check)
			version = diagnosticText(strings.TrimSpace(string(output)))
			if err == nil && version == "" {
				err = errors.New("Codex CLI 没有返回版本号")
			}
		}
		cancel()
	}
	if err == nil {
		i.mu.Lock()
		i.state.Stage = "daemon"
		i.state.Version = version
		i.mu.Unlock()
		daemonCtx, cancel := context.WithTimeout(ctx, 40*time.Second)
		conn, startErr := DialDaemon(daemonCtx)
		err = startErr
		if err == nil {
			err = verifyDaemonSessions(daemonCtx, conn)
		}
		cancel()
	}
	if ctx.Err() == context.DeadlineExceeded {
		err = errors.New("Codex 安装或升级超时，请重新检测后再试")
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	i.cancel()
	i.state.Status = "succeeded"
	i.state.Version = version
	if err != nil {
		i.state.Status = "failed"
		i.state.Error = diagnosticText(err.Error())
	}
	close(i.done)
}

func (i *Installer) Close() {
	i.mu.Lock()
	i.closed = true
	done := i.done
	if i.cancel != nil {
		i.cancel()
	}
	i.mu.Unlock()
	if done != nil {
		<-done
	}
}

func standalonePath() string {
	dir := platform.CodexInstallDir()
	if dir == "" {
		return ""
	}
	if runtime.GOOS == "windows" {
		return filepath.Join(dir, "codex.exe")
	}
	return filepath.Join(dir, "codex")
}

func codexHome() string {
	if home := os.Getenv("CODEX_HOME"); home != "" {
		return home
	}
	if home, err := os.UserHomeDir(); err == nil && filepath.IsAbs(home) {
		return filepath.Join(home, ".codex")
	}
	return ""
}

// VisualizationRoot is the local Codex conversation artifact directory.
func VisualizationRoot() string {
	if home := codexHome(); filepath.IsAbs(home) {
		return filepath.Join(home, "visualizations")
	}
	return ""
}

func commandLocation(cmd *exec.Cmd) string {
	if len(cmd.Args) > 2 { // Windows npm shim uses Node and the package entry point.
		return cmd.Args[1]
	}
	return cmd.Path
}

func sameInstallPath(left, right string) bool {
	return left == right || runtime.GOOS == "windows" && strings.EqualFold(left, right)
}

func installationPlan(ctx context.Context) (InstallPlan, *exec.Cmd) {
	cli := Command(ctx, "--version")
	path := commandLocation(cli)
	target := standalonePath()
	home := codexHome()
	real, _ := filepath.EvalSymlinks(path)
	standaloneRoot, _ := filepath.EvalSymlinks(filepath.Join(home, "packages", "standalone"))
	owned := func(path string) bool {
		rel, err := filepath.Rel(standaloneRoot, path)
		return err == nil && standaloneRoot != "" && strings.HasPrefix(rel, "releases"+string(os.PathSeparator))
	}
	if runtime.GOOS == "darwin" && real != "" {
		if prefix, _, ok := strings.Cut(real, "/Caskroom/codex/"); ok && filepath.IsAbs(prefix) {
			brew, err := exec.LookPath(filepath.Join(prefix, "bin", "brew"))
			if err != nil {
				return InstallPlan{Reason: "未找到此 Codex 安装对应的 Homebrew"}, nil
			}
			cmd := exec.CommandContext(ctx, brew, "upgrade", "--cask", "codex")
			cmd.Env = append(cmd.Environ(), "HOMEBREW_NO_INSTALL_CLEANUP=1")
			return InstallPlan{Action: "upgrade", Manager: "brew", Path: path}, cmd
		}
	}
	if prefix := npmPrefix(path, real); prefix != "" {
		cmd := npmUpgrade(ctx, prefix)
		if cmd.Err != nil {
			return InstallPlan{Reason: "未找到此 Codex 安装所需的 npm 或 Node.js"}, nil
		}
		return InstallPlan{Action: "upgrade", Manager: "npm", Path: path}, cmd
	}
	if target != "" && !filepath.IsAbs(path) && cli.Err != nil {
		// LookPath also skips existing non-executable entries. Check the
		// destination before allowing the official installer to replace it.
		if _, err := os.Lstat(target); errors.Is(err, os.ErrNotExist) {
			return standalonePlan("install", target, home)
		}
	}
	if sameInstallPath(path, target) && owned(real) {
		if runtime.GOOS == "darwin" {
			host := filepath.Join(filepath.Dir(target), "codex-code-mode-host")
			if _, err := os.Lstat(host); !errors.Is(err, os.ErrNotExist) {
				if actual, _ := filepath.EvalSymlinks(host); !owned(actual) {
					return InstallPlan{Reason: "安装目录中已有其他 Codex 文件，请使用原安装方式更新"}, nil
				}
			}
		}
		return standalonePlan("upgrade", target, home)
	}
	return InstallPlan{Reason: "请使用原安装方式管理此 Codex。"}, nil
}

func standalonePlan(action, path, home string) (InstallPlan, *exec.Cmd) {
	if !filepath.IsAbs(home) || (runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64") {
		return InstallPlan{Reason: "当前系统架构或 Codex 安装目录不受自动安装支持"}, nil
	}
	if runtime.GOOS == "darwin" && action == "install" {
		if _, err := os.Lstat(filepath.Join(filepath.Dir(path), "codex-code-mode-host")); !errors.Is(err, os.ErrNotExist) {
			return InstallPlan{Reason: "安装目录中已有其他 Codex 文件，请使用原安装方式更新"}, nil
		}
	}
	return InstallPlan{Action: action, Manager: "standalone", Path: path}, nil
}

func npmPrefix(path, resolved string) string {
	if !filepath.IsAbs(path) {
		return ""
	}
	dir := filepath.Dir(path)
	if runtime.GOOS == "windows" {
		if strings.HasSuffix(strings.ToLower(filepath.ToSlash(path)), "/node_modules/@openai/codex/bin/codex.js") {
			return filepath.Join(dir, "..", "..", "..", "..")
		}
		return ""
	}
	prefix := filepath.Dir(dir)
	entry, err := filepath.EvalSymlinks(filepath.Join(prefix, "lib", "node_modules", "@openai", "codex", "bin", "codex.js"))
	if filepath.Base(dir) == "bin" && err == nil && resolved == entry {
		return prefix
	}
	return ""
}

func npmUpgrade(ctx context.Context, prefix string) *exec.Cmd {
	args := []string{"install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", "@openai/codex@latest"}
	if runtime.GOOS != "windows" {
		return exec.CommandContext(ctx, "npm", args...)
	}
	if shim, err := exec.LookPath("npm.cmd"); err == nil {
		entry := filepath.Join(filepath.Dir(shim), "node_modules", "npm", "bin", "npm-cli.js")
		if info, err := os.Stat(entry); err == nil && info.Mode().IsRegular() {
			return exec.CommandContext(ctx, "node.exe", append([]string{entry}, args...)...)
		}
	}
	return &exec.Cmd{Err: exec.ErrNotFound}
}

func runInstaller(ctx context.Context, plan InstallPlan, cmd *exec.Cmd) error {
	if plan.Manager == "standalone" {
		dir, err := os.MkdirTemp("", "yolu-codex-install-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(dir)
		filename := "install.sh"
		if runtime.GOOS == "windows" {
			filename = "install.ps1"
		}
		path := filepath.Join(dir, filename)
		if err := downloadInstaller(ctx, filename, path); err != nil {
			return err
		}
		cmd = exec.CommandContext(ctx, "/bin/sh", path, "--release", "latest")
		if runtime.GOOS == "windows" {
			cmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path, "-Release", "latest")
		}
		cmd.Env = append(cmd.Environ(),
			"CODEX_NON_INTERACTIVE=1", "CODEX_INSTALL_DAEMON_ONLY=0", "CODEX_INSTALL_DEFER_SELECTION=0",
			"CODEX_INSTALL_IF_LATEST=0", "CODEX_INSTALL_IF_CURRENT=0",
			"CODEX_INSTALL_DIR="+filepath.Dir(plan.Path))
	}
	cmd.Dir, _ = os.UserHomeDir()
	_, err := diagnosticOutput(cmd)
	return err
}

func downloadInstaller(ctx context.Context, filename, target string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://releases.openai.com/codex/"+filename, nil)
	if err != nil {
		return err
	}
	client := http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if req.URL.Scheme != "https" || req.URL.Host != "releases.openai.com" || len(via) >= 5 {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("下载 Codex 官方安装程序失败（HTTP %d）", response.StatusCode)
	}
	const maxBytes = 1 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return err
	}
	if len(data) == 0 || len(data) > maxBytes {
		return errors.New("Codex 官方安装程序大小异常")
	}
	return os.WriteFile(target, data, 0600)
}
