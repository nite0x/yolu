package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/terminal"
)

func (a *App) terminalRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/terminal-profiles", func(w http.ResponseWriter, r *http.Request) {
		if a.localTerminals(w, r) {
			custom, err := a.customTerminalProfiles()
			if err != nil {
				httpx.DbError(w, err)
				return
			}
			for i := range custom {
				custom[i].Available = terminal.ProfileAvailable(custom[i])
			}
			httpx.WriteJSON(w, 200, append(terminal.Profiles(), custom...))
		}
	})
	mux.HandleFunc("POST /api/terminal-profiles", a.saveTerminalProfileHandler)
	mux.HandleFunc("GET /api/terminals", func(w http.ResponseWriter, r *http.Request) {
		if a.localTerminals(w, r) {
			httpx.WriteJSON(w, 200, a.Terminals.List())
		}
	})
	mux.HandleFunc("POST /api/terminals", a.createTerminalHandler)
	mux.HandleFunc("POST /api/terminals/{id}/ticket", func(w http.ResponseWriter, r *http.Request) {
		if !a.localTerminals(w, r) {
			return
		}
		key, err := a.Terminals.Ticket(r.PathValue("id"))
		if err != nil {
			httpx.WriteError(w, 404, err.Error())
			return
		}
		httpx.WriteJSON(w, 200, map[string]string{"ticket": key})
	})
	mux.HandleFunc("POST /api/terminals/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		if !a.localTerminals(w, r) {
			return
		}
		s, ok := a.Terminals.Get(r.PathValue("id"))
		if !ok {
			httpx.WriteError(w, 404, "终端不存在")
			return
		}
		s.Stop()
		httpx.WriteJSON(w, 200, s.Info())
	})
	mux.HandleFunc("DELETE /api/terminals/{id}", func(w http.ResponseWriter, r *http.Request) {
		if a.localTerminals(w, r) {
			if err := a.Terminals.Remove(r.PathValue("id")); err != nil {
				httpx.WriteError(w, 409, err.Error())
				return
			}
			httpx.WriteJSON(w, 200, map[string]bool{"removed": true})
		}
	})
	mux.HandleFunc("GET /terminal-stream/{id}", func(w http.ResponseWriter, r *http.Request) {
		if a.localTerminals(w, r) {
			a.Terminals.Stream(w, r)
		}
	})
}

func (a *App) checkTerminalWorktree(path string) error {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return fmt.Errorf("无法确认终端目录占用：%w", err)
	}
	for _, info := range a.Terminals.List() {
		// A task-root terminal can use its project subdirectories, too.
		if info.State == "running" && (platform.SameWorkspacePath(resolved, info.Cwd) || platform.Within(resolved, info.Cwd) || platform.Within(info.Cwd, resolved)) {
			return fmt.Errorf("该目录仍有运行中的终端：%s，请先结束终端", info.Name)
		}
	}
	return nil
}

// Take this before the workspace metadata lock, matching terminal starts.
// Keep it until removal completes so no terminal can start after the check.
func (a *App) reserveWorktree(ctx context.Context, path string) (func(), error) {
	a.terminalWorktreeMu.Lock()
	if err := a.checkTerminalWorktree(path); err != nil {
		a.terminalWorktreeMu.Unlock()
		return nil, err
	}
	release, err := a.Sessions.ReserveWorktree(ctx, path)
	if err != nil {
		a.terminalWorktreeMu.Unlock()
		return nil, err
	}
	return func() { release(); a.terminalWorktreeMu.Unlock() }, nil
}

func (a *App) customTerminalProfiles() ([]terminal.Profile, error) {
	var raw string
	err := a.Workspace.Store.DB.QueryRow(`SELECT value FROM settings WHERE key='terminal_profiles:v1'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return []terminal.Profile{}, nil
	}
	if err != nil {
		return nil, err
	}
	var profiles []terminal.Profile
	err = json.Unmarshal([]byte(raw), &profiles)
	return profiles, err
}

func (a *App) saveTerminalProfileHandler(w http.ResponseWriter, r *http.Request) {
	if !a.localTerminals(w, r) {
		return
	}
	var input terminal.Profile
	if !httpx.DecodeLimit(w, r, &input, 64<<10) {
		return
	}
	if !strings.HasPrefix(input.ID, "custom-") || len(input.ID) > 100 || strings.TrimSpace(input.Name) == "" || len(input.Name) > 200 || strings.TrimSpace(input.Executable) == "" || len(input.Args) > 128 {
		httpx.WriteError(w, 400, "启动配置无效")
		return
	}
	input.Available = false
	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	profiles, err := a.customTerminalProfiles()
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	found := false
	for i := range profiles {
		if profiles[i].ID == input.ID {
			profiles[i] = input
			found = true
			break
		}
	}
	if !found {
		if len(profiles) >= 30 {
			httpx.WriteError(w, 409, "最多保存 30 个自定义启动配置")
			return
		}
		profiles = append(profiles, input)
	}
	raw, err := json.Marshal(profiles)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if _, err = a.Workspace.Store.DB.Exec(`INSERT INTO settings(key,value) VALUES('terminal_profiles:v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(raw)); err != nil {
		httpx.DbError(w, err)
		return
	}
	input.Available = terminal.ProfileAvailable(input)
	httpx.WriteJSON(w, 200, input)
}

func (a *App) localTerminals(w http.ResponseWriter, r *http.Request) bool {
	if a.Workspace.Remote != nil || r.Header.Get("X-Environment-ID") != "" && r.Header.Get("X-Environment-ID") != "local" {
		httpx.WriteError(w, 409, "内置终端目前仅支持本机执行环境")
		return false
	}
	if a.Workspace.Closing.Load() {
		httpx.WriteError(w, 503, "后台正在退出")
		return false
	}
	return true
}

// Resolve the task/member server-side. A client-supplied cwd is never used.
func (a *App) terminalDirectory(taskID, projectID string) (string, error) {
	q, err := a.Workspace.Store.Requirement(taskID)
	if err != nil {
		return "", fmt.Errorf("请先选择有效的任务")
	}
	if q.State == "archived" {
		return "", fmt.Errorf("任务已归档，请先恢复任务")
	}
	path := q.Path
	if projectID != "" {
		path = ""
		for _, m := range q.Members {
			if m.ProjectID == projectID && m.State == "ready" {
				path = m.Path
				break
			}
		}
	} else if !q.HasWorkspace {
		path = ""
	}
	if path == "" {
		return "", fmt.Errorf("所选任务工作目录不可用")
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return "", fmt.Errorf("工作目录不存在：%w", err)
	}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("工作目录不可用")
	}
	return path, nil
}

func (a *App) createTerminalHandler(w http.ResponseWriter, r *http.Request) {
	if !a.localTerminals(w, r) {
		return
	}
	var input terminal.Start
	if !httpx.Decode(w, r, &input) {
		return
	}
	a.terminalWorktreeMu.RLock()
	defer a.terminalWorktreeMu.RUnlock()
	a.Workspace.Mu.Lock()
	defer a.Workspace.Mu.Unlock()
	path, err := a.terminalDirectory(input.TaskID, input.ProjectID)
	if err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	input.Cwd = path
	s, err := a.Terminals.Start(input)
	if err != nil {
		httpx.WriteError(w, 400, err.Error())
		return
	}
	httpx.WriteJSON(w, 201, s.Info())
}
