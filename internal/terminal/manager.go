// Package terminal owns local PTYs independently of browser pages and agent protocols.
package terminal

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	pty "github.com/aymanbagabas/go-pty"
	"worktree-hub/internal/model"
)

const bufferLimit = 1 << 20
const flowLimit = 256 << 10

type Profile struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Executable string   `json:"executable"`
	Args       []string `json:"args"`
	Available  bool     `json:"available"`
}

type Info struct {
	ID        string `json:"id"`
	TaskID    string `json:"task_id"`
	ProjectID string `json:"project_id"`
	Cwd       string `json:"cwd"`
	Name      string `json:"name"`
	ProfileID string `json:"profile_id"`
	CreatedAt int64  `json:"created_at"`
	State     string `json:"state"`
	ExitCode  *int   `json:"exit_code,omitempty"`
	Attached  bool   `json:"attached"`
}

type Start struct {
	TaskID     string            `json:"task_id"`
	ProjectID  string            `json:"project_id"`
	ProfileID  string            `json:"profile_id"`
	Name       string            `json:"name"`
	Executable string            `json:"executable"`
	Args       []string          `json:"args"`
	Env        map[string]string `json:"env"`
	Cols       int               `json:"cols"`
	Rows       int               `json:"rows"`
	Cwd        string            `json:"-"`
}

type Session struct {
	mu             sync.Mutex
	ioMu           sync.Mutex
	info           Info
	pty            pty.Pty
	cmd            *pty.Cmd
	buffer         []byte
	base, end, ack uint64
	attached       bool
	processExited  bool
	changed        chan struct{}
	done           chan struct{}
	readDone       chan struct{}
	ptyCloseOnce   sync.Once
	stopOnce       sync.Once
}

type ticket struct {
	session string
	expires time.Time
}
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*Session
	tickets  map[string]ticket
	closed   bool
}

func New() *Manager { return &Manager{sessions: map[string]*Session{}, tickets: map[string]ticket{}} }

// GUI applications need predictable CLI discovery even when launched without a shell.
// This environment is passed to the child only; the host process is never modified.
func commandEnv(overrides map[string]string) []string {
	env := map[string]string{}
	for _, pair := range os.Environ() {
		if k, v, ok := strings.Cut(pair, "="); ok {
			env[k] = v
		}
	}
	if runtime.GOOS != "windows" {
		home, _ := os.UserHomeDir()
		extra := []string{filepath.Join(home, ".local", "bin"), filepath.Join(home, ".cargo", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"}
		env["PATH"] = env["PATH"] + string(os.PathListSeparator) + strings.Join(extra, string(os.PathListSeparator))
	}
	env["TERM"], env["COLORTERM"] = "xterm-256color", "truecolor"
	for k, v := range overrides {
		env[k] = v
	}
	out := make([]string, 0, len(env))
	for k, v := range env {
		out = append(out, k+"="+v)
	}
	sort.Strings(out)
	return out
}

func resolve(name string, env []string) (string, error) {
	if filepath.IsAbs(name) {
		return exec.LookPath(name)
	}
	if strings.ContainsAny(name, "/\\") {
		return "", errors.New("可执行文件请填写名称或绝对路径")
	}
	for _, entry := range env {
		k, v, ok := strings.Cut(entry, "=")
		if !ok || !strings.EqualFold(k, "PATH") {
			continue
		}
		for _, dir := range filepath.SplitList(v) {
			if !filepath.IsAbs(dir) {
				continue
			}
			if p, e := exec.LookPath(filepath.Join(dir, name)); e == nil {
				return p, nil
			}
		}
	}
	return "", fmt.Errorf("未找到 %s，请安装后重试或填写可执行文件的绝对路径", name)
}

func Profiles() []Profile {
	shell := os.Getenv("SHELL")
	args := []string{"-l"}
	if shell == "" {
		shell = "/bin/sh"
	}
	if runtime.GOOS == "windows" {
		shell = "powershell.exe"
		args = []string{"-NoLogo"}
	}
	profiles := []Profile{{ID: "shell", Name: "Shell", Executable: shell, Args: args}, {ID: "codex", Name: "Codex", Executable: "codex"}, {ID: "claude", Name: "Claude Code", Executable: "claude"}, {ID: "gemini", Name: "Gemini CLI", Executable: "gemini"}, {ID: "opencode", Name: "OpenCode", Executable: "opencode"}}
	for i := range profiles {
		_, e := resolve(profiles[i].Executable, commandEnv(nil))
		profiles[i].Available = e == nil
	}
	return profiles
}

func ProfileAvailable(profile Profile) bool {
	_, err := resolve(profile.Executable, commandEnv(nil))
	return err == nil
}

func (m *Manager) Start(input Start) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return nil, errors.New("终端服务已退出")
	}
	if len(m.sessions) >= 32 {
		return nil, errors.New("最多保留 32 个终端，请先移除已结束的终端")
	}
	name := input.Executable
	if input.ProfileID != "custom" {
		found := false
		for _, p := range Profiles() {
			if p.ID == input.ProfileID {
				name, input.Executable, input.Args = p.Name, p.Executable, p.Args
				found = true
				break
			}
		}
		if !found {
			return nil, errors.New("请选择有效的终端或 Agent")
		}
	}
	if input.ProfileID == "custom" && strings.TrimSpace(input.Name) != "" {
		name = strings.TrimSpace(input.Name)
	}
	if len(name) > 200 {
		return nil, errors.New("终端名称过长")
	}
	if len(input.Args) > 128 || len(input.Env) > 128 {
		return nil, errors.New("启动参数过多")
	}
	for k, v := range input.Env {
		if k == "" || strings.ContainsAny(k, "=\x00") || strings.ContainsRune(v, 0) {
			return nil, errors.New("环境变量无效")
		}
	}
	env := commandEnv(input.Env)
	path, err := resolve(input.Executable, env)
	if err != nil {
		return nil, err
	}
	p, err := pty.New()
	if err != nil {
		return nil, err
	}
	cols, rows := input.Cols, input.Rows
	if cols < 2 || cols > 500 {
		cols = 100
	}
	if rows < 1 || rows > 300 {
		rows = 30
	}
	if err = p.Resize(cols, rows); err != nil {
		_ = p.Close()
		return nil, err
	}
	cmd := p.Command(path, input.Args...)
	cmd.Dir = input.Cwd
	cmd.Env = env
	if err = cmd.Start(); err != nil {
		_ = p.Close()
		return nil, fmt.Errorf("无法启动终端：%w", err)
	}
	// The parent must not keep the slave open, otherwise EOF never arrives.
	if unix, ok := p.(pty.UnixPty); ok {
		_ = unix.Slave().Close()
	}
	s := &Session{info: Info{ID: model.NewID(), TaskID: input.TaskID, ProjectID: input.ProjectID, Cwd: input.Cwd, Name: filepath.Base(name), ProfileID: input.ProfileID, CreatedAt: time.Now().Unix(), State: "running"}, pty: p, cmd: cmd, changed: make(chan struct{}), done: make(chan struct{}), readDone: make(chan struct{})}
	m.sessions[s.info.ID] = s
	go s.read()
	go s.wait()
	return s, nil
}

func (s *Session) signal() { close(s.changed); s.changed = make(chan struct{}) }
func (s *Session) Info() Info {
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.info
	v.Attached = s.attached
	return v
}
func (s *Session) read() {
	defer close(s.readDone)
	buf := make([]byte, 16<<10)
	for {
		s.mu.Lock()
		for s.attached && !s.processExited && s.end-s.ack >= flowLimit {
			ch := s.changed
			s.mu.Unlock()
			select {
			case <-ch:
			case <-s.done:
				return
			}
			s.mu.Lock()
		}
		s.mu.Unlock()
		n, err := s.pty.Read(buf)
		if n > 0 {
			s.mu.Lock()
			s.buffer = append(s.buffer, buf[:n]...)
			s.end += uint64(n)
			if len(s.buffer) > bufferLimit {
				s.buffer = append([]byte(nil), s.buffer[len(s.buffer)-bufferLimit:]...)
			}
			s.base = s.end - uint64(len(s.buffer))
			s.signal()
			s.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}
func (s *Session) wait() {
	_ = s.cmd.Wait()
	// ConPTY closure can wait for its output pipe to drain. Release the
	// frontend flow-control gate before closing the console, even if the
	// browser has stopped acknowledging output.
	s.mu.Lock()
	s.processExited = true
	s.signal()
	s.mu.Unlock()
	select {
	case <-s.readDone:
	case <-time.After(500 * time.Millisecond):
	}
	s.closePTY()
	s.mu.Lock()
	code := -1
	if s.cmd.ProcessState != nil {
		code = s.cmd.ProcessState.ExitCode()
	}
	s.info.State = "exited"
	s.info.ExitCode = &code
	close(s.done)
	s.signal()
	s.mu.Unlock()
}
func (s *Session) closePTY() { s.ptyCloseOnce.Do(func() { _ = s.pty.Close() }) }
func (s *Session) Stop() {
	s.stopOnce.Do(func() {
		s.mu.Lock()
		if s.info.State == "running" {
			terminateTree(s.cmd.Process)
		}
		s.processExited = true
		s.signal()
		s.mu.Unlock()
		s.closePTY()
	})
}
func (s *Session) Write(data []byte) error {
	s.ioMu.Lock()
	defer s.ioMu.Unlock()
	_, err := s.pty.Write(data)
	return err
}
func (s *Session) Resize(cols, rows int) error {
	if cols < 2 || cols > 500 || rows < 1 || rows > 300 {
		return errors.New("终端尺寸无效")
	}
	s.ioMu.Lock()
	defer s.ioMu.Unlock()
	return s.pty.Resize(cols, rows)
}

func (m *Manager) Get(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	return s, ok
}
func (m *Manager) List() []Info {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []Info{}
	for _, s := range m.sessions {
		out = append(out, s.Info())
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}
func (m *Manager) Remove(id string) error {
	m.mu.Lock()
	s := m.sessions[id]
	m.mu.Unlock()
	if s != nil {
		s.Stop()
		// Keep the process visible to directory-occupancy checks until it exits.
		select {
		case <-s.done:
		case <-time.After(3 * time.Second):
			return errors.New("终端尚未退出，请稍后重试")
		}
		m.mu.Lock()
		delete(m.sessions, id)
		m.mu.Unlock()
	}
	return nil
}
func (m *Manager) Close() {
	m.mu.Lock()
	m.closed = true
	all := []*Session{}
	for _, s := range m.sessions {
		all = append(all, s)
	}
	m.tickets = map[string]ticket{}
	m.mu.Unlock()
	for _, s := range all {
		s.Stop()
	}
	for _, s := range all {
		select {
		case <-s.done:
		case <-time.After(3 * time.Second):
		}
	}
}

func (m *Manager) Ticket(id string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed || m.sessions[id] == nil {
		return "", errors.New("终端不存在或后台已重启，请重新创建")
	}
	for key, v := range m.tickets {
		if time.Now().After(v.expires) {
			delete(m.tickets, key)
		}
	}
	if len(m.tickets) >= 128 {
		return "", errors.New("连接请求过多，请稍后重试")
	}
	key := model.NewID() + model.NewID()
	m.tickets[key] = ticket{id, time.Now().Add(15 * time.Second)}
	return key, nil
}
func (m *Manager) consume(key, id string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	t, ok := m.tickets[key]
	delete(m.tickets, key)
	if m.closed || !ok || t.session != id || time.Now().After(t.expires) {
		return nil, errors.New("终端连接凭证无效或已过期")
	}
	s := m.sessions[id]
	if s == nil {
		return nil, io.EOF
	}
	return s, nil
}
