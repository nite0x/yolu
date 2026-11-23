package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/store"
)

type Environment struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Distro         string `json:"distro,omitempty"`
	User           string `json:"user,omitempty"`
	Root           string `json:"root"`
	Connected      bool   `json:"connected"`
	ImportExisting bool   `json:"import_existing,omitempty"`
}
type environmentHub struct {
	mu      sync.Mutex
	local   *App
	entries []Environment
	apps    map[string]*App
}

func newEnvironmentHub(a *App) (*environmentHub, error) {
	h := &environmentHub{local: a, apps: map[string]*App{}}
	raw, err := os.ReadFile(filepath.Join(a.Execution.DataDir, "environments.json"))
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &h.entries); err != nil {
			return nil, fmt.Errorf("无法读取执行环境配置：%w", err)
		}
	}
	for _, e := range h.entries {
		if e.ID != environmentID(e.Distro, e.User) {
			return nil, fmt.Errorf("执行环境标识无效")
		}
	}
	a.environments = h
	return h, nil
}
func environmentID(distro, user string) string {
	sum := sha256.Sum256([]byte(distro + "\x00" + user))
	return "wsl-" + hex.EncodeToString(sum[:8])
}
func (h *environmentHub) Close() {
	h.local.Execution.Closing.Store(true)
	h.mu.Lock()
	apps := make([]*App, 0, len(h.apps))
	for _, app := range h.apps {
		app.Execution.Closing.Store(true)
		apps = append(apps, app)
	}
	h.mu.Unlock()
	// Close environment applications after releasing the hub lock.
	for _, app := range apps {
		_ = app.Close()
	}
}

func (h *environmentHub) get(id string) (*App, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if a := h.apps[id]; a != nil {
		if a.Execution.Closing.Load() {
			return nil, fmt.Errorf("执行环境正在退出，请稍后重新连接")
		}
		select {
		case <-a.Execution.Remote.Done():
			return nil, fmt.Errorf("WSL 连接已断开，请在执行环境设置中重新连接")
		default:
			return a, nil
		}
	}
	for _, entry := range h.entries {
		if entry.ID == id {
			return h.connectLocked(entry)
		}
	}
	return nil, fmt.Errorf("执行环境不存在，请重新选择")
}
func (h *environmentHub) connectLocked(e Environment) (*App, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c, err := execution.StartWSL(ctx, e.Distro, e.User)
	if err != nil {
		return nil, err
	}
	if e.User != "" && e.User != c.Identity.User {
		c.Close()
		return nil, fmt.Errorf("WSL 用户与已登记环境不一致")
	}
	if e.Root == "" {
		e.Root = platform.JoinWorkspacePath(c.Identity.Home, "workspaces")
	}
	// Metadata is partitioned by environment, but all databases live on the
	// Windows host. The helper never stores project and conversation records.
	a, err := openAppForExecution(filepath.Join(h.local.Execution.DataDir, "environments", e.ID), e.Root, c)
	if err != nil {
		c.Close()
		return nil, err
	}
	a.token = h.local.token
	a.Execution.ReadOnlySessions = h.local.Execution.ReadOnlySessions
	h.apps[e.ID] = a
	return a, nil
}
func (h *environmentHub) listHandler(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	entries := []Environment{{ID: "local", Name: "本机 · " + runtime.GOOS, Root: h.local.Execution.Root, Connected: true}}
	for _, e := range h.entries {
		if a := h.apps[e.ID]; a != nil {
			select {
			case <-a.Execution.Remote.Done():
			default:
				e.Connected = true
			}
		}
		entries = append(entries, e)
	}
	h.mu.Unlock()
	distros, err := execution.ListWSLDistributions(r.Context())
	message := ""
	if err != nil {
		message = err.Error()
	}
	httpx.WriteJSON(w, 200, map[string]any{"environments": entries, "distributions": distros, "wsl_message": message, "platform": runtime.GOOS, "wsl_supported": runtime.GOOS == "windows"})
}
func (h *environmentHub) addHandler(w http.ResponseWriter, r *http.Request) {
	var e Environment
	if !httpx.Decode(w, r, &e) {
		return
	}
	e.Distro = strings.TrimSpace(e.Distro)
	e.User = strings.TrimSpace(e.User)
	distros, err := execution.ListWSLDistributions(r.Context())
	if err != nil {
		httpx.WriteError(w, 422, err.Error())
		return
	}
	found := false
	for _, d := range distros {
		if d == e.Distro {
			found = true
		}
	}
	if !found {
		httpx.WriteError(w, 400, "请选择已安装的 WSL 发行版")
		return
	}
	if strings.ContainsAny(e.User, "\x00\r\n") || strings.HasPrefix(e.User, "-") {
		httpx.WriteError(w, 400, "WSL 用户名无效")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	c, err := execution.StartWSL(ctx, e.Distro, e.User)
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	e.User = c.Identity.User
	e.ID = environmentID(e.Distro, e.User)
	e.Name = "WSL · " + e.Distro + " / " + e.User
	if e.Root == "" {
		e.Root = platform.JoinWorkspacePath(c.Identity.Home, "workspaces")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, old := range h.entries {
		if old.ID == e.ID {
			c.Close()
			httpx.WriteError(w, 409, "该 WSL 用户已经登记，请直接选择或重新连接")
			return
		}
	}
	a, err := openAppForExecution(filepath.Join(h.local.Execution.DataDir, "environments", e.ID), e.Root, c)
	if err != nil {
		c.Close()
		httpx.WriteError(w, 422, err.Error())
		return
	}
	if e.ImportExisting {
		var snapshot store.MetadataSnapshot
		err := c.Call(r.Context(), execution.Request{Op: "export-metadata"}, &snapshot)
		if err == nil {
			err = a.Execution.Store.ImportMetadata(snapshot)
		}
		if err != nil {
			_ = a.Close()
			httpx.WriteError(w, 422, "导入原有 WSL 记录失败："+err.Error())
			return
		}
		e.ImportExisting = false
	}
	entries := append(append([]Environment{}, h.entries...), e)
	raw, _ := json.MarshalIndent(entries, "", "  ")
	config := filepath.Join(h.local.Execution.DataDir, "environments.json")
	if err := os.WriteFile(config+".tmp", raw, 0600); err != nil {
		_ = a.Close()
		httpx.DbError(w, err)
		return
	}
	if err := os.Rename(config+".tmp", config); err != nil {
		_ = a.Close()
		httpx.DbError(w, err)
		return
	}
	h.entries = entries
	a.token = h.local.token
	a.Execution.ReadOnlySessions = h.local.Execution.ReadOnlySessions
	h.apps[e.ID] = a
	e.Connected = true
	e.Root = a.Execution.Root
	httpx.WriteJSON(w, 201, e)
}
func (h *environmentHub) reconnectHandler(w http.ResponseWriter, r *http.Request) {
	if !h.mu.TryLock() {
		httpx.WriteError(w, 409, "有项目操作正在执行，请完成后重试")
		return
	}
	id := r.PathValue("environment")
	var entry *Environment
	for i := range h.entries {
		if h.entries[i].ID == id {
			copy := h.entries[i]
			entry = &copy
			break
		}
	}
	if entry == nil {
		h.mu.Unlock()
		httpx.WriteError(w, 404, "执行环境不存在")
		return
	}
	if h.local.Execution.Closing.Load() {
		h.mu.Unlock()
		httpx.WriteError(w, 503, "后台正在退出")
		return
	}
	if old := h.apps[id]; old != nil {
		if old.Execution.Closing.Load() {
			h.mu.Unlock()
			httpx.WriteError(w, 409, "有项目操作正在执行，请完成后重试")
			return
		}
		old.Execution.Closing.Store(true)
		// Retain the closing entry until disposal completes so concurrent
		// lookups cannot start a replacement app against its still-open store.
		h.mu.Unlock()
		_ = old.Close()
		h.mu.Lock()
		if h.apps[id] == old {
			delete(h.apps, id)
		}
		if h.local.Execution.Closing.Load() {
			h.mu.Unlock()
			httpx.WriteError(w, 503, "后台正在退出")
			return
		}
	}
	app, err := h.connectLocked(*entry)
	h.mu.Unlock()
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"id": id, "root": app.Execution.Root})
}
