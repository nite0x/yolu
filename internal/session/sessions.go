package session

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

// Runtime activity is deliberately not persisted with session associations.
func (a *Service) decorateSessionActivity(s *model.Session) {
	if run := a.ChatFor(s.ID); run != nil {
		run.mu.Lock()
		if run.state.Busy {
			s.ChatStatus = run.state.Status
		} else if run.state.TurnID != "" {
			s.CompletedRun = run.state.ID
		}
		run.mu.Unlock()
	}
	if s.ChatStatus == "" {
		if bridge := a.BridgeFor(s.ID); bridge != nil {
			bridge.mu.Lock()
			if bridge.active {
				s.ChatStatus = "running"
				if bridge.waiting {
					s.ChatStatus = "waiting"
				}
			}
			bridge.mu.Unlock()
		}
	}
}

func sessionName(s codex.Session) string {
	name := strings.TrimSpace(s.Name)
	// Store only a compact title, never the full conversation preview.
	return string([]rune(name)[:min(160, len([]rune(name)))])
}

func sessionList(c codex.SessionClient, params map[string]any) (codex.SessionPage, error) {
	params["sourceKinds"] = []string{"cli", "vscode", "appServer"}
	params["sortKey"] = "updated_at"
	params["limit"] = 50
	var page codex.SessionPage
	err := c.Call("thread/list", params, &page)
	if page.Data == nil {
		page.Data = []codex.Session{}
	}
	return page, err
}

func readSession(c codex.SessionClient, id string) (codex.Session, error) {
	var response struct {
		Thread codex.Session `json:"thread"`
	}
	err := c.Call("thread/read", map[string]any{"threadId": id, "includeTurns": false}, &response)
	if err == nil && (response.Thread.ID != id || response.Thread.Cwd == "") {
		err = fmt.Errorf("对话元数据不完整，无法继续")
	}
	return response.Thread, err
}

// SaveSession indexes provider metadata independently of directory associations.
func (a *Service) SaveSession(s codex.Session, source string, observedAt ...int64) error {
	return a.Execution.Store.SaveSession(model.Session{ID: s.ID, Name: sessionName(s), Cwd: s.Cwd, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, Source: source}, observedAt...)
}

func (a *Service) CodexSessionsHandler(w http.ResponseWriter, r *http.Request) {
	c, err := a.openSessions(r.Context())
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	defer c.Close()
	params := map[string]any{}
	if cursor := r.URL.Query().Get("cursor"); cursor != "" {
		params["cursor"] = cursor
	}
	if search := strings.TrimSpace(r.URL.Query().Get("search")); search != "" {
		params["searchTerm"] = search
	}
	page, err := sessionList(c, params)
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	// The picker needs titles and paths; do not send full previews to the browser.
	for i := range page.Data {
		page.Data[i].Name = sessionName(page.Data[i])
		page.Data[i].Preview = ""
		page.Data[i].Path = ""
	}
	httpx.WriteJSON(w, 200, page)
}

func (a *Service) SessionsHandler(w http.ResponseWriter, r *http.Request) {
	scope, err := a.queryScope(r)
	if err != nil {
		status := 400
		if errors.Is(err, sql.ErrNoRows) {
			status = 404
		}
		httpx.WriteError(w, status, err.Error())
		return
	}
	titleObservedAt := time.Now().UnixNano()
	archived := r.URL.Query().Get("archived") == "true"
	cached, err := a.cachedScope(scope)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	respond := func(sessions []model.Session, cause error) {
		result := map[string]any{"sessions": sessions}
		if cause != nil {
			result["error"] = cause.Error()
		}
		httpx.WriteJSON(w, 200, result)
	}
	failure := func(cause error) {
		filtered := cached[:0]
		for _, s := range cached {
			if s.Archived == archived {
				a.decorateSessionActivity(&s)
				filtered = append(filtered, s)
			}
		}
		cached = filtered
		respond(cached, cause)
	}
	found := map[string]codex.Session{}
	agyFound := map[string]model.Session{}
	var codexErr error
	found, codexErr = a.sessionCatalog(r.Context(), scope, archived, r.URL.Query().Get("refresh") == "1")
	var agyErr error
	agyFound, agyErr = a.scanAgyCatalog(r.Context(), scope, archived)
	if codexErr != nil && len(agyFound) == 0 && (agyErr != nil || !hasProviderSessions(cached, model.ProviderAgy)) {
		failure(codexErr)
		return
	}
	var c codex.SessionClient
	defer func() {
		if c != nil {
			c.Close()
		}
	}()
	// Cached/missing records and explicit project associations are revalidated by ID.
	for _, s := range cached {
		if s.Archived != archived {
			continue
		}
		if model.NormalizeProvider(s.Provider) == model.ProviderAgy {
			continue
		}
		if _, ok := found[s.ID]; ok {
			continue
		}
		if codexErr != nil {
			continue
		}
		if c == nil {
			c, err = a.openSessions(r.Context())
			if err != nil {
				if len(agyFound) == 0 && !hasProviderSessions(cached, model.ProviderAgy) {
					failure(err)
					return
				}
				codexErr = err
				continue
			}
		}
		current, readErr := readSession(c, s.ID)
		if readErr == nil {
			found[s.ID] = current
			if err := a.SaveSession(current, s.Source, titleObservedAt); err != nil {
				httpx.DbError(w, err)
				return
			}
		}
	}
	sessions, err := a.cachedScope(scope)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	filtered := sessions[:0]
	for _, s := range sessions {
		if s.Archived == archived {
			filtered = append(filtered, s)
		}
	}
	sessions = filtered
	for i := range sessions {
		if model.NormalizeProvider(sessions[i].Provider) == model.ProviderAgy {
			_, listed := agyFound[sessions[i].ID]
			sessions[i].Available = listed || archived || a.ChatFor(sessions[i].ID) != nil || sessions[i].Source == "workbench"
			if !sessions[i].Available {
				sessions[i].Error = "对话暂不可读取，请刷新重试"
			}
			a.decorateSessionActivity(&sessions[i])
			continue
		}
		_, sessions[i].Available = found[sessions[i].ID]
		if !sessions[i].Available {
			sessions[i].Error = "对话暂不可读取，请刷新重试"
		}
		if native, exists := found[sessions[i].ID]; exists {
			activity := a.sessionActivity(r.Context(), native)
			if activity.Status == "running" || activity.Status == "waiting" {
				sessions[i].ChatStatus = activity.Status
			}
		}
		a.decorateSessionActivity(&sessions[i])
	}
	respond(sessions, nil)
}

func hasProviderSessions(sessions []model.Session, provider string) bool {
	for _, s := range sessions {
		if model.NormalizeProvider(s.Provider) == provider {
			return true
		}
	}
	return false
}

func (a *Service) ResumeSessionHandler(w http.ResponseWriter, r *http.Request) {
	releaseControl := a.lockSessionControl(r.PathValue("session"))
	defer releaseControl()
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	if a.ChatBusy(r.PathValue("session")) {
		httpx.WriteError(w, 409, "此对话正在页面运行，请先停止或等待完成，再打开终端继续")
		return
	}
	record, ok := a.requestSession(w, r)
	if !ok {
		return
	}
	id := record.ID
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	p, err := a.savedSessionPlan(ctx, record, false)
	if err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	var input struct {
		NativePermissions bool `json:"native_permissions"`
		AllowShared       bool `json:"allow_shared"`
	}
	if r.Body != nil && r.ContentLength != 0 && !httpx.Decode(w, r, &input) {
		return
	}
	if p.ManagedBindings && !input.NativePermissions {
		httpx.WriteJSON(w, 409, map[string]any{
			"error": "原生终端会使用 Agent 自身的权限设置。请确认后打开，或在应用内按已关联权限继续。",
			"code":  "native_permissions_confirmation",
		})
		return
	}
	if p.ManagedBindings {
		for _, binding := range p.Bindings {
			if binding.Access == model.SessionBindingRead {
				dirs := p.AdditionalDirectories[:0]
				for _, dir := range p.AdditionalDirectories {
					if !platform.SameWorkspacePath(dir, binding.Directory) {
						dirs = append(dirs, dir)
					}
				}
				p.AdditionalDirectories = dirs
			}
		}
	}
	p.AllowShared = input.AllowShared
	launchScope := p
	launchScope.ManagedBindings = false
	releaseDirectories, conflicts := a.reserveDirectories("terminal:"+id, id, launchScope)
	if releaseDirectories == nil {
		writeBindingConflict(w, conflicts)
		return
	}
	defer releaseDirectories()
	if model.NormalizeProvider(record.Provider) == model.ProviderAgy {
		if !platform.AbsoluteWorkspacePath(record.Cwd) {
			httpx.WriteError(w, 409, "对话工作目录不是绝对路径")
			return
		}
		if info, err := execution.Stat(ctx, record.Cwd, true); err != nil || !info.IsDir() {
			httpx.WriteError(w, 409, "对话原工作目录不可用，请恢复目录后重试")
			return
		}
		dirs := append([]string{}, p.AdditionalDirectories...)
		p.Tool = "agy"
		p.Cwd = record.Cwd
		p.Session = id
		p.AdditionalDirectories = []string{}
		p.Args = []string{"--conversation", id}
		for _, dir := range dirs {
			if !platform.SameWorkspacePath(dir, p.Cwd) {
				p.AdditionalDirectories = append(p.AdditionalDirectories, dir)
				p.Args = append(p.Args, "--add-dir", dir)
			}
		}
		p.Command = platform.DisplayCommand("agy", p.Args, a.Execution.Remote == nil && platform.NativeWindows())
		p.Title = "Antigravity · " + record.Name
		if err := a.Execution.LaunchSimpleTerminal(p); err != nil {
			httpx.WriteJSON(w, 503, map[string]string{"error": err.Error(), "command": p.Command})
			return
		}
		httpx.WriteJSON(w, 200, map[string]string{"message": "已向终端发送 Antigravity 启动请求，请在终端中继续对话", "command": p.Command})
		return
	}
	c, err := a.openSessions(r.Context())
	if err != nil {
		httpx.WriteError(w, 503, err.Error())
		return
	}
	s, err := readSession(c, id)
	c.Close()
	if err != nil {
		httpx.WriteError(w, 409, "对话暂不可继续："+err.Error())
		return
	}
	if !platform.AbsoluteWorkspacePath(s.Cwd) {
		httpx.WriteError(w, 409, "对话工作目录不是绝对路径")
		return
	}
	if info, err := execution.Stat(ctx, s.Cwd, true); err != nil || !info.IsDir() {
		httpx.WriteError(w, 409, "对话原工作目录不可用，请恢复目录后重试")
		return
	}
	dirs := append([]string{}, p.AdditionalDirectories...)
	if err := a.SaveSession(s, "codex"); err != nil {
		httpx.DbError(w, err)
		return
	}
	if !platform.SameWorkspacePath(p.Cwd, s.Cwd) && !p.ManagedBindings {
		p.Cwd = s.Cwd
	}
	p.Session = id
	if err := a.LaunchConflict(id, p.Cwd); err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	p.AdditionalDirectories = []string{}
	p.Args = []string{"resume", id, "--cd", p.Cwd}
	for _, dir := range dirs {
		if !platform.SameWorkspacePath(dir, p.Cwd) {
			p.AdditionalDirectories = append(p.AdditionalDirectories, dir)
			p.Args = append(p.Args, "--add-dir", dir)
		}
	}
	p.Command = platform.DisplayCommand("codex", p.Args, a.Execution.ReadOnlySessions && a.Execution.Remote == nil && platform.NativeWindows())
	p.Title = "Codex · " + sessionName(s)
	a.LaunchCodexPlan(w, p)
}
