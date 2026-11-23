package session

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

func (a *Service) SessionExternalLinkHandler(w http.ResponseWriter, r *http.Request) {
	if _, ok := a.requestSession(w, r); !ok {
		return
	}
	var input struct {
		URL string `json:"url"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	u, err := url.Parse(input.URL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || len(input.URL) > 8192 {
		httpx.WriteError(w, 400, "网页链接无效")
		return
	}
	if err := a.openExternal(u.String()); err != nil {
		httpx.WriteError(w, 503, "无法打开浏览器："+err.Error())
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "已在浏览器打开链接"})
}

func (a *Service) SessionFileHandler(w http.ResponseWriter, r *http.Request) {
	record, ok := a.requestSession(w, r)
	if !ok {
		return
	}
	line := 1
	if raw := r.URL.Query().Get("line"); raw != "" {
		var err error
		line, err = strconv.Atoi(raw)
		if err != nil || line < 1 || line > 10000000 {
			httpx.WriteError(w, 400, "文件行号无效")
			return
		}
	}
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	file, err := execution.ReadFilePreview(ctx, r.URL.Query().Get("path"), a.fileRoots(ctx, record))
	if err != nil {
		httpx.WriteError(w, 400, err.Error())
		return
	}
	if file.Format == "image" {
		httpx.WriteJSON(w, 200, file)
		return
	}
	lines := strings.Split(strings.ReplaceAll(file.Text, "\r\n", "\n"), "\n")
	total := len(lines)
	selected := min(line, total)
	start := max(0, selected-201)
	end := min(total, start+401)
	httpx.WriteJSON(w, 200, map[string]any{"path": file.Path, "lines": lines[start:end], "start_line": start + 1, "total_lines": total, "line": selected, "requested_line": line})
}

// Directory browsing stays inside saved roots. An explicit absolute file
// reference previews just that file without granting access to its directory.
func (a *Service) SessionFilesHandler(w http.ResponseWriter, r *http.Request) {
	record, ok := a.requestSession(w, r)
	if !ok {
		return
	}
	if file := r.URL.Query().Get("file"); platform.AbsoluteWorkspacePath(file) {
		ctx := execution.WithClient(r.Context(), a.Execution.Remote)
		result, err := execution.ReadFilePreview(ctx, file, a.fileRoots(ctx, record))
		if err != nil {
			httpx.WriteError(w, 422, err.Error())
			return
		}
		httpx.WriteJSON(w, 200, result)
		return
	}
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	roots := a.fileRoots(ctx, record)
	root := r.URL.Query().Get("path")
	if root == "" && len(roots) > 0 {
		root = roots[0]
	}
	allowed := false
	for _, candidate := range roots {
		if platform.SameWorkspacePath(root, candidate) {
			root = candidate
			allowed = true
			break
		}
	}
	if !allowed {
		httpx.WriteError(w, 400, "只能浏览此对话的工作目录及附加目录")
		return
	}
	relative, file := r.URL.Query().Get("dir"), r.URL.Query().Has("file")
	if file {
		relative = r.URL.Query().Get("file")
	}
	result, err := execution.BrowseWorkspace(ctx, root, relative, file)
	if err != nil {
		httpx.WriteError(w, 422, err.Error())
		return
	}
	httpx.WriteJSON(w, 200, result)
}

func (a *Service) fileRoots(ctx context.Context, record model.Session) []string {
	managed, err := a.Execution.Store.SessionBindingsManaged(record.ID)
	if err != nil {
		return nil
	}
	if !managed {
		return append([]string{record.Cwd}, record.AdditionalDirectories...)
	}
	dirs := []string{}
	bindings, err := a.Execution.Store.SessionBindings(record.ID)
	if err != nil {
		return dirs
	}
	for _, binding := range bindings {
		if current, err := a.validateStoredBinding(ctx, binding, false); err == nil {
			dirs = append(dirs, current.Directory)
		}
	}
	return dirs
}
