package project

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

type CleanupCandidate struct {
	ProjectID   string   `json:"project_id"`
	ProjectName string   `json:"project_name"`
	Path        string   `json:"path"`
	Branch      string   `json:"branch"`
	Head        string   `json:"head"`
	Dirty       int      `json:"dirty"`
	Unpushed    int      `json:"unpushed"`
	Ignored     bool     `json:"ignored"`
	Reasons     []string `json:"reasons"`
	Cleanable   bool     `json:"cleanable"`
	Fingerprint string   `json:"fingerprint"`
}

func (a *Service) inspectCleanup(ctx context.Context, p model.Project, path string) CleanupCandidate {
	v := CleanupCandidate{ProjectID: p.ID, ProjectName: p.Name, Path: path, Reasons: []string{}}
	if path == "" || platform.SameWorkspacePath(path, p.Path) {
		v.Reasons = append(v.Reasons, "请选择附属 Worktree。")
	}
	t, err := selectedWorktree(ctx, p, path)
	if err != nil {
		v.Reasons = append(v.Reasons, err.Error())
	} else {
		v.Path = t.Path
		bindings, err := a.Execution.Store.BindingsWithinDirectory(t.Path)
		if err != nil {
			v.Reasons = append(v.Reasons, "无法核实目录的对话关联")
		} else if len(bindings) > 0 {
			v.Reasons = append(v.Reasons, "仍有对话关联此目录，请先解除关联")
		}
		v.Branch, v.Head, v.Dirty, v.Unpushed = t.Branch, t.Head, t.Dirty, t.SyncAhead
		if t.Locked {
			v.Reasons = append(v.Reasons, "Worktree 已锁定")
		}
		if t.Detached {
			v.Reasons = append(v.Reasons, "游离 HEAD，请先为提交保留分支")
		}
		if t.Dirty > 0 {
			v.Reasons = append(v.Reasons, fmt.Sprintf("有 %d 项未提交修改或未跟踪文件", t.Dirty))
		}
		if t.Operation != "" {
			v.Reasons = append(v.Reasons, "有未完成的 Git 操作："+t.Operation)
		}
		if st, e := execution.Stat(ctx, platform.JoinWorkspacePath(t.Path, ".git"), false); e != nil || !st.Mode().IsRegular() {
			v.Reasons = append(v.Reasons, "不是可清理的附属 Worktree")
		}
		if resolved, e := execution.Eval(ctx, t.Path); e != nil || !platform.SameWorkspacePath(t.Path, resolved) {
			v.Reasons = append(v.Reasons, "目录真实路径已变化")
		}
		ignored, e := execution.Git(ctx, t.Path, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z")
		v.Ignored = ignored != ""
		if e != nil {
			v.Reasons = append(v.Reasons, "无法检查忽略文件")
		} else if v.Ignored {
			v.Reasons = append(v.Reasons, "存在忽略文件，请先在终端检查并移走需要保留的内容")
		}
		if t.Upstream != "" {
			if !t.SyncAvailable {
				v.Reasons = append(v.Reasons, "无法比较上游，请先获取远端确认提交")
			}
			if t.SyncAhead > 0 {
				v.Reasons = append(v.Reasons, fmt.Sprintf("有 %d 个待推送提交", t.SyncAhead))
			}
		} else {
			// With no upstream, allow only commits reachable from another retained
			// baseline or a remote reference. The branch itself is always retained.
			published, e := execution.Git(ctx, t.Path, "for-each-ref", "--format=%(refname)", "--contains", t.Head, "refs/remotes")
			if e != nil {
				v.Reasons = append(v.Reasons, "无法检查提交保留状态")
			} else if strings.TrimSpace(published) == "" {
				base := execution.DefaultBranchSource(ctx, t.Path)
				_, e := execution.Git(ctx, t.Path, "merge-base", "--is-ancestor", t.Head, base)
				if base == "HEAD" || base == "refs/heads/"+t.Branch || e != nil {
					v.Reasons = append(v.Reasons, "没有上游，且提交尚未包含在其他保留基线中")
				}
			}
		}
	}
	if a.CheckWorktreeIdle != nil {
		if err := a.CheckWorktreeIdle(v.Path); err != nil {
			v.Reasons = append(v.Reasons, err.Error())
		}
	}
	v.Cleanable = len(v.Reasons) == 0
	raw, _ := json.Marshal([]any{p.CommonDir, v})
	v.Fingerprint = fmt.Sprintf("%x", sha256.Sum256(raw))
	return v
}

func (a *Service) WorktreeReviewHandler(w http.ResponseWriter, r *http.Request) {
	p, err := a.RegisteredProject(r.Context(), r.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "项目不存在")
		return
	}
	if err != nil {
		httpx.WriteError(w, 422, err.Error())
		return
	}
	unlock := a.lockGit(p.CommonDir)
	defer unlock()
	httpx.WriteJSON(w, 200, a.inspectCleanup(r.Context(), p, r.URL.Query().Get("path")))
}

func (a *Service) CleanupWorktreeHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Path        string `json:"path"`
		Fingerprint string `json:"fingerprint"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if in.Path == "" || in.Fingerprint == "" {
		httpx.WriteError(w, 400, "请先检查并选择具体目录")
		return
	}
	a.Execution.GitActivity.RLock()
	defer a.Execution.GitActivity.RUnlock()
	if a.Execution.Closing.Load() {
		httpx.WriteError(w, 503, "后台正在退出")
		return
	}
	p, err := a.RegisteredProject(r.Context(), r.PathValue("id"))
	if err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	unlock := a.lockGit(p.CommonDir)
	defer unlock()
	selected, err := selectedWorktree(r.Context(), p, in.Path)
	if err != nil {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	in.Path = selected.Path
	if a.ReserveWorktree != nil {
		release, err := a.ReserveWorktree(r.Context(), in.Path)
		if err != nil {
			httpx.WriteError(w, 409, err.Error())
			return
		}
		defer release()
	}
	a.Execution.Mu.Lock()
	defer a.Execution.Mu.Unlock()
	v := a.inspectCleanup(r.Context(), p, in.Path)
	if !v.Cleanable {
		httpx.WriteJSON(w, 409, map[string]any{"error": "目录当前不能清理", "details": v.Reasons})
		return
	}
	if v.Fingerprint != in.Fingerprint {
		httpx.WriteError(w, 409, "检查结果已过期，请重新检查后选择目录")
		return
	}
	// No --force, branch deletion, recursive filesystem deletion or prune.
	if _, err := execution.GitOperation(r.Context(), p.Path, "worktree", "remove", "--", in.Path); err != nil {
		httpx.WriteError(w, 409, "清理未完成，现场已保留："+RedactGitOutput(err.Error()))
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "已清理 Worktree 目录，分支和对话记录保留"})
}
