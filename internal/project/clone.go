package project

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/platform"
	"worktree-hub/internal/workspace"
)

func validCloneSource(source string) bool {
	if source == "" || strings.HasPrefix(source, "-") || strings.ContainsAny(source, "\x00\r\n") {
		return false
	}
	if strings.Contains(source, "://") {
		parsed, err := url.Parse(source)
		if err != nil {
			return false
		}
		switch parsed.Scheme {
		case "https", "http", "ssh", "git":
			return parsed.Host != "" && parsed.Path != ""
		case "file":
			return strings.HasPrefix(parsed.Path, "/")
		}
		return false
	}
	// SCP-style SSH addresses and absolute local repository paths.
	if strings.Contains(source, "::") {
		return false
	}
	return strings.HasPrefix(source, "/") || (len(source) > 2 && source[1] == ':') || (strings.Contains(source, ":") && !strings.ContainsAny(strings.SplitN(source, ":", 2)[0], " /\\"))
}

// CloneProjectHandler reserves a new directory before Git starts. Neither a
// failed clone nor failed registration ever recursively deletes user files.
func (a *Service) CloneProjectHandler(w http.ResponseWriter, r *http.Request) {
	var input struct {
		URL       string `json:"url"`
		Parent    string `json:"parent"`
		Directory string `json:"directory"`
		Name      string `json:"name"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	source := strings.TrimSpace(input.URL)
	if !validCloneSource(source) {
		httpx.WriteError(w, 400, "请输入有效的 HTTPS 或 SSH Git 仓库地址")
		return
	}
	if len([]rune(strings.TrimSpace(input.Name))) > 80 {
		httpx.WriteError(w, 400, "项目名称不能超过 80 字")
		return
	}
	folder := strings.TrimSpace(input.Directory)
	if folder == "" {
		clean := strings.SplitN(strings.SplitN(source, "?", 2)[0], "#", 2)[0]
		folder = strings.TrimSuffix(path.Base(strings.TrimRight(strings.ReplaceAll(clean, "\\", "/"), "/")), ".git")
		// SCP paths may contain only a repository name after the colon.
		if index := strings.LastIndex(folder, ":"); index >= 0 {
			folder = folder[index+1:]
		}
	}
	if folder == "" || folder == "." || folder == ".." || strings.ContainsAny(folder, "/\\:\x00\r\n") || strings.HasSuffix(folder, ".") {
		httpx.WriteError(w, 400, "新文件夹名必须是单个目录名，不能包含路径分隔符")
		return
	}
	a.Workspace.GitActivity.RLock()
	defer a.Workspace.GitActivity.RUnlock()
	if a.Workspace.Closing.Load() {
		httpx.WriteError(w, 409, "后台正在退出")
		return
	}
	parent, err := workspace.Normalize(r.Context(), input.Parent)
	if err != nil {
		httpx.WriteError(w, 400, "请选择已存在的存放目录："+err.Error())
		return
	}
	target := platform.JoinWorkspacePath(parent, folder)
	if err := workspace.Mkdir(r.Context(), target, 0755, false); err != nil {
		if errors.Is(err, os.ErrExist) {
			httpx.WriteError(w, 409, "目标目录已存在，请更换文件夹名，或登记已有仓库")
			return
		}
		// Remote errors do not necessarily retain os.ErrExist identity.
		if _, statErr := workspace.Stat(r.Context(), target, false); statErr == nil {
			httpx.WriteError(w, 409, "目标目录已存在，请更换文件夹名，或登记已有仓库")
			return
		}
		httpx.WriteError(w, 422, "无法创建克隆目录："+err.Error())
		return
	}
	if _, err := a.GitNetwork(r.Context(), parent, "clone", "--", source, target); err != nil {
		// Git normally removes its partial data. Remove only our empty reservation;
		// keep any remaining files for inspection, including after cancellation.
		_ = workspace.Remove(r.Context(), target)
		message := RedactGitOutput(err.Error())
		message = strings.ReplaceAll(message, source, RedactRemote(source))
		httpx.WriteError(w, 422, "克隆失败："+message)
		return
	}
	a.registerProject(w, r, input.Name, target)
}
