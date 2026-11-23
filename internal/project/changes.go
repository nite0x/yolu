package project

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
)

type ChangedFile struct {
	Path      string `json:"path"`
	Previous  string `json:"previous,omitempty"`
	Index     string `json:"index"`
	Working   string `json:"working"`
	Untracked bool   `json:"untracked"`
}

func changedFiles(raw string) []ChangedFile {
	out := []ChangedFile{}
	fields := strings.Split(raw, "\x00")
	for i := 0; i < len(fields); i++ {
		v := fields[i]
		if len(v) < 4 {
			continue
		}
		f := ChangedFile{Path: v[3:], Index: v[:1], Working: v[1:2], Untracked: v[:2] == "??"}
		if strings.ContainsAny(v[:2], "RC") && i+1 < len(fields) {
			i++
			f.Previous = fields[i]
		}
		out = append(out, f)
	}
	return out
}

func (a *Service) ChangesHandler(w http.ResponseWriter, r *http.Request) {
	p, err := a.RegisteredProject(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	unlock := a.lockGit(p.CommonDir)
	defer unlock()
	t, err := selectedWorktree(r.Context(), p, r.URL.Query().Get("path"))
	if err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	file := r.URL.Query().Get("file")
	if file == "" {
		files, err := ReadDirectoryChanges(r.Context(), t.Path)
		if err != nil {
			httpx.WriteError(w, 409, err.Error())
			return
		}
		httpx.WriteJSON(w, 200, map[string]any{"files": files, "branch": t.Branch, "head": t.Head})
		return
	}
	preview, err := ReadDirectoryDiff(r.Context(), t.Path, file, r.URL.Query().Get("mode"))
	if err != nil {
		status := http.StatusConflict
		var unreadable filePreviewError
		if errors.As(err, &unreadable) {
			status = http.StatusUnprocessableEntity
		}
		httpx.WriteError(w, status, err.Error())
		return
	}
	httpx.WriteJSON(w, 200, preview)
}

func ReadDirectoryChanges(ctx context.Context, directory string) ([]ChangedFile, error) {
	raw, err := execution.Git(ctx, directory, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return nil, err
	}
	return changedFiles(raw), nil
}

func ReadDirectoryDiff(ctx context.Context, directory, file, mode string) (any, error) {
	if file == "" {
		return nil, fmt.Errorf("请选择要查看的文件")
	}
	if mode != "" && mode != "working" && mode != "index" {
		return nil, fmt.Errorf("请选择工作目录或暂存区")
	}
	files, err := ReadDirectoryChanges(ctx, directory)
	if err != nil {
		return nil, err
	}
	var selected *ChangedFile
	for i := range files {
		if files[i].Path == file {
			selected = &files[i]
			break
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("文件改动已变化，请刷新列表")
	}
	return readChangedFilePreview(ctx, directory, *selected, mode)
}

type filePreviewError struct{ error }

func readChangedFilePreview(ctx context.Context, directory string, selected ChangedFile, mode string) (any, error) {
	file := selected.Path
	if selected.Untracked {
		preview, err := execution.BrowseWorkspace(ctx, directory, file, true)
		if err != nil {
			return nil, filePreviewError{fmt.Errorf("无法预览文件：%w", err)}
		}
		return preview, nil
	}
	args := []string{"--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color"}
	if mode == "index" {
		args = append(args, "--cached")
	}
	args = append(args, "--", file)
	if selected.Previous != "" {
		args = append(args, selected.Previous)
	}
	result, err := execution.RunGitPreview(ctx, directory, args...)
	if err != nil {
		return nil, err
	}
	format := "patch"
	if result.Text == "" {
		result.Text = "此区域没有文本差异。可切换工作目录／暂存区查看。"
		format = "text"
	}
	if mode != "index" && strings.Contains(result.Text, "Binary files ") {
		if content, err := execution.BrowseWorkspace(ctx, directory, file, true); err == nil && content.(execution.FilePreview).Format == "image" {
			return content, nil
		}
	}
	return map[string]any{"text": result.Text, "truncated": result.Truncated, "format": format, "name": file}, nil
}
