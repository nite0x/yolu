package session

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

// The directory has already been validated against the registered repository.
func mergeConflictPrompt(ctx context.Context, directory, mergeHead string) (string, error) {
	state, err := execution.ReadGitState(ctx, directory)
	if err != nil {
		return "", err
	}
	if state.Operation != "merge" || mergeHead == "" || state.MergeHead != mergeHead {
		return "", fmt.Errorf("合并状态已变化，请刷新后重新打开 AI")
	}
	return fmt.Sprintf("请完成当前 Git 合并。\n工作目录：%s\n目标分支：%s\n目标 HEAD：%s\n待合入 MERGE_HEAD：%s\n当前未解决冲突文件：\n%s\n\n先读取适用的 AGENTS.md，再核实 git status、HEAD 和 MERGE_HEAD。如果合并目标已变化或已不存在，请停止并说明。理解双方改动意图后解决全部冲突，保留双方需要的功能，按项目要求运行必要检查，仅暂存此次合并涉及的文件并完成合并提交。不要切换分支、重置或丢弃其他修改，不要推送。遇到无法判断的业务选择时向用户询问，完成后报告合并结果与验证情况。", directory, state.Branch, state.Head, state.MergeHead, strings.Join(state.Conflicts, "\n")), nil
}

// MergeAIHandler keeps terminal assistance available when in-app runs are disabled.
func (a *Service) MergeAIHandler(w http.ResponseWriter, r *http.Request) {
	if !a.Execution.ReadOnlySessions {
		httpx.WriteError(w, 409, "请在对话中启动合并处理")
		return
	}
	var input struct {
		ProjectID string `json:"project_id"`
		Cwd       string `json:"cwd"`
		MergeHead string `json:"merge_head"`
		RequestID string `json:"request_id"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	if input.ProjectID == "" || input.Cwd == "" || input.MergeHead == "" || input.RequestID == "" || len(input.RequestID) > 80 {
		httpx.WriteError(w, 400, "请选择有待处理合并的项目目录并提供启动标识")
		return
	}
	key := "merge-terminal:" + input.RequestID
	release := a.lockControl(key)
	defer release()
	fingerprint := fmt.Sprintf("%x", sha256.Sum256([]byte(input.ProjectID+"\x00"+input.Cwd+"\x00"+input.MergeHead)))
	id, err := a.createdSessionID(r.Context(), key, fingerprint)
	if err == nil && id == "launched" {
		httpx.WriteJSON(w, 200, map[string]string{"message": "已打开合并处理终端"})
		return
	}
	if errors.Is(err, errCreationMismatch) || errors.Is(err, errCreationUncertain) {
		httpx.WriteError(w, 409, err.Error())
		return
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.DbError(w, err)
		return
	}
	ctx := execution.WithClient(r.Context(), a.Execution.Remote)
	binding, err := a.inspectBinding(ctx, bindingInput{ProjectID: input.ProjectID, Directory: input.Cwd, Access: model.SessionBindingWrite}, false)
	if err != nil {
		writeBindingError(w, err)
		return
	}
	prompt, err := mergeConflictPrompt(ctx, binding.Directory, input.MergeHead)
	if err != nil {
		writeBindingError(w, err)
		return
	}
	if err := a.Execution.Store.ReserveCreation(r.Context(), key, fingerprint); err != nil {
		httpx.DbError(w, err)
		return
	}
	plan := model.LaunchPlan{Title: "Codex · 合并冲突", Cwd: binding.Directory, Args: []string{"--cd", binding.Directory, prompt}}
	plan.Command = platform.DisplayCommand("codex", plan.Args, platform.NativeWindows() && a.Execution.Remote == nil)
	if err := a.Execution.LaunchSimpleTerminal(plan); err != nil {
		httpx.WriteJSON(w, 503, map[string]string{"error": err.Error(), "command": plan.Command})
		return
	}
	if err := a.Execution.Store.CompleteCreation(context.WithoutCancel(r.Context()), key, "launched"); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, map[string]string{"message": "已在所选工作目录打开合并处理终端"})
}
