package session

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

type projectAccessApproval struct {
	ProjectID string `json:"project_id,omitempty"`
	Directory string `json:"directory"`
	Access    string `json:"access"`
	Reason    string `json:"reason,omitempty"`
}

type nativePermissionEntry struct {
	Path struct {
		Type string `json:"type"`
		Path string `json:"path"`
	} `json:"path"`
	Access string `json:"access"`
}

func nativeDirectoryRequest(raw json.RawMessage) (projectAccessApproval, error) {
	var request struct {
		Reason      string `json:"reason"`
		Permissions struct {
			Network    json.RawMessage `json:"network"`
			FileSystem struct {
				Read    []string                `json:"read"`
				Write   []string                `json:"write"`
				Entries []nativePermissionEntry `json:"entries"`
			} `json:"fileSystem"`
		} `json:"permissions"`
	}
	if json.Unmarshal(raw, &request) != nil {
		return projectAccessApproval{}, fmt.Errorf("目录授权申请无效")
	}
	p := request.Permissions
	if len(p.Network) > 0 && string(p.Network) != "null" {
		var network struct {
			Enabled *bool `json:"enabled"`
		}
		if json.Unmarshal(p.Network, &network) != nil || network.Enabled == nil || *network.Enabled {
			return projectAccessApproval{}, fmt.Errorf("目录授权只支持文件系统路径")
		}
	}
	dirs := map[string]string{}
	for _, path := range p.FileSystem.Read {
		dirs[path] = model.SessionBindingRead
	}
	for _, path := range p.FileSystem.Write {
		dirs[path] = model.SessionBindingWrite
	}
	for _, entry := range p.FileSystem.Entries {
		if entry.Path.Type != "path" || (entry.Access != "read" && entry.Access != "write") {
			return projectAccessApproval{}, fmt.Errorf("请使用实际目录路径申请读或写权限")
		}
		if dirs[entry.Path.Path] != "write" {
			dirs[entry.Path.Path] = entry.Access
		}
	}
	if len(dirs) != 1 {
		return projectAccessApproval{}, fmt.Errorf("请逐个申请目录权限")
	}
	for path, access := range dirs {
		return projectAccessApproval{Directory: path, Access: access, Reason: boundedChatText(request.Reason)}, nil
	}
	return projectAccessApproval{}, fmt.Errorf("目录授权申请无效")
}

func nativeDirectoryGrant(path, access string) map[string]any {
	permissions := map[string]any{}
	if path != "" {
		permissions["fileSystem"] = map[string]any{access: []string{path}}
	}
	return map[string]any{"permissions": permissions, "scope": "turn"}
}

func (a *Service) handleDirectoryPermission(ctx context.Context, run *ChatRun, event codex.Event) bool {
	if !run.managedBindings {
		return false
	}
	switch event.Method {
	case "serverRequest/resolved":
		var p struct {
			ThreadID string          `json:"threadId"`
			RemoteID json.RawMessage `json:"requestId"`
		}
		if json.Unmarshal(event.Params, &p) == nil && p.ThreadID == run.session {
			run.mu.Lock()
			if pending, ok := run.pendingDirectoryGrants[string(p.RemoteID)]; ok {
				if run.configured == nil {
					run.configured = map[string]configuredDirectory{}
				}
				run.configured[pending.Directory] = configuredDirectory{id: pending.ID, access: pending.Access, updatedAt: pending.UpdatedAt}
				delete(run.pendingDirectoryGrants, string(p.RemoteID))
			}
			run.mu.Unlock()
		}
		return false
	case "item/permissions/requestApproval", "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
	default:
		return false
	}
	var header struct {
		ThreadID string `json:"threadId"`
		TurnID   string `json:"turnId"`
	}
	state := run.snapshot()
	if len(event.ID) == 0 || json.Unmarshal(event.Params, &header) != nil || header.ThreadID != run.session || header.TurnID != state.TurnID {
		return false
	}
	if event.Method != "item/permissions/requestApproval" {
		_ = run.client.Reply(event.ID, map[string]any{"decision": "decline"})
		run.change(func(state *ChatState) {
			state.Notice = "已拒绝跳过对话目录权限的操作。Agent 可单独申请其他目录。"
		})
		return true
	}
	deny := func(reason string) bool {
		_ = run.client.Reply(event.ID, nativeDirectoryGrant("", ""))
		run.change(func(state *ChatState) { state.Notice = reason })
		return true
	}
	request, err := nativeDirectoryRequest(event.Params)
	if err != nil {
		return deny(err.Error())
	}
	fileCtx, cancel := context.WithTimeout(execution.WithClient(ctx, a.Execution.Remote), 5*time.Second)
	defer cancel()
	dir, err := canonicalDirectory(fileCtx, request.Directory)
	if err != nil {
		return deny(err.Error())
	}
	request.Directory = dir
	registered, err := a.Execution.Store.Projects()
	if err != nil {
		return deny("无法检查登记的项目")
	}
	if gitCommon, err := execution.Git(fileCtx, dir, "rev-parse", "--path-format=absolute", "--git-common-dir"); err == nil {
		if gitCommon, err = execution.Eval(fileCtx, strings.TrimSpace(gitCommon)); err == nil {
			for _, p := range registered {
				if !platform.SameWorkspacePath(p.CommonDir, gitCommon) {
					continue
				}
				if _, err := a.inspectBinding(fileCtx, bindingInput{ProjectID: p.ID, Directory: dir, Access: request.Access}, false); err == nil {
					request.ProjectID = p.ID
				}
				break
			}
		}
	}
	input := bindingInput{SessionID: run.session, ProjectID: request.ProjectID, Directory: dir, Access: request.Access}
	v, err := a.inspectBinding(fileCtx, input, false)
	if err != nil {
		return deny(err.Error())
	}
	bindings, err := a.Execution.Store.SessionBindings(run.session)
	if err != nil {
		return deny(err.Error())
	}
	next := []model.SessionProjectBinding{v.SessionProjectBinding}
	for _, b := range bindings {
		if platform.SameWorkspacePath(b.Directory, dir) {
			v.ID, v.Role = b.ID, b.Role
			if b.Access == model.SessionBindingWrite || b.Access == request.Access {
				run.mu.Lock()
				configured := run.configured[dir].access
				run.mu.Unlock()
				if configured == model.SessionBindingWrite || configured == request.Access {
					_ = run.client.Reply(event.ID, nativeDirectoryGrant(dir, request.Access))
					return true
				}
			}
			continue
		}
		next = append(next, b)
	}
	if err := validateBindingSet(next); err != nil {
		return deny(err.Error())
	}
	choices := []ChatApprovalChoice{{ID: "decline", Label: "拒绝"}, {ID: "accept", Label: "允许关联", Accepts: true}}
	details := []string{request.Reason, v.ProjectName, dir}
	if v.Branch != "" {
		details = append(details, "分支 "+v.Branch)
	}
	if request.Access == model.SessionBindingWrite {
		details = append(details, "允许修改")
		if len(a.directoryConflicts(dir, run.session)) != 0 {
			details = append(details, "已有 Agent 正在修改重叠目录。可拒绝并使用独立 Worktree。")
			choices[1] = ChatApprovalChoice{ID: "accept_shared", Label: "允许共享目录", Accepts: true}
		}
	} else {
		details = append(details, "仅作为参考")
	}
	approval := ChatApproval{
		ID: model.NewID(), Kind: "project_access", Title: "允许 Agent 访问此目录？",
		Details: strings.TrimSpace(strings.Join(details, "\n")), Choices: choices, CanAccept: true,
		ProjectAccess: &request, directoryBinding: &v.SessionProjectBinding,
		rpcID: event.ID, method: event.Method,
	}
	run.change(func(state *ChatState) {
		state.Approvals = append(state.Approvals, approval)
		state.Status = "waiting"
	})
	return true
}

// Called with the session cleanup gate, directory start mutex, and run mutex
// held. Persist only the verified association presented in this approval.
func (a *Service) approveDirectory(ctx context.Context, run *ChatRun, pending ChatApproval, choice ChatApprovalChoice) error {
	if !choice.Accepts {
		return run.client.Reply(pending.rpcID, nativeDirectoryGrant("", ""))
	}
	if pending.directoryBinding == nil {
		return fmt.Errorf("此目录授权已失效")
	}
	binding := *pending.directoryBinding
	current, err := a.validateStoredBinding(execution.WithClient(ctx, a.Execution.Remote), binding, false)
	if err != nil {
		return err
	}
	if binding.Access == model.SessionBindingWrite && len(a.directoryConflictsLocked(binding.Directory, run.session)) != 0 && choice.ID != "accept_shared" {
		return fmt.Errorf("有其他 Agent 开始修改此目录，请拒绝此请求并选择独立 Worktree 或重新确认共享目录")
	}
	if binding.Branch != current.Branch {
		return fmt.Errorf("当前分支已变化，请拒绝此申请并重新核对目录")
	}
	bindings, err := a.Execution.Store.SessionBindings(run.session)
	if err != nil {
		return err
	}
	for _, b := range bindings {
		if platform.SameWorkspacePath(binding.Directory, b.Directory) {
			binding.ID = b.ID
			break
		}
	}
	binding, err = a.Execution.Store.BindSessionDirectory(binding)
	if err != nil {
		return err
	}
	if _, exists := run.baseline[binding.Directory]; !exists {
		snapshotCtx, cancel := context.WithTimeout(execution.WithClient(ctx, a.Execution.Remote), 2*time.Second)
		baseline := collectDirectorySnapshot(snapshotCtx, binding.Directory)
		cancel()
		if run.baseline == nil {
			run.baseline = map[string]fileSnapshot{}
		}
		run.baseline[binding.Directory] = baseline
	}
	if err = run.client.Reply(pending.rpcID, nativeDirectoryGrant(binding.Directory, binding.Access)); err != nil {
		return err
	}
	run.directoryRoots = uniqueDirectories(append(run.directoryRoots, binding.Directory))
	if binding.Access == model.SessionBindingWrite {
		run.writeRoots = uniqueDirectories(append(run.writeRoots, binding.Directory))
	}
	if run.pendingDirectoryGrants == nil {
		run.pendingDirectoryGrants = map[string]model.SessionProjectBinding{}
	}
	run.pendingDirectoryGrants[string(pending.rpcID)] = binding
	return nil
}
