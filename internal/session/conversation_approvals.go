package session

import (
	"context"
	"encoding/json"
	"net/http"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

func (a *Service) ChatApprovalHandler(w http.ResponseWriter, r *http.Request) {
	var input TurnApprovalInput
	if !httpx.Decode(w, r, &input) {
		return
	}
	state, err := a.ApproveTurn(r.Context(), r.PathValue("session"), input)
	if err != nil {
		writeConversationError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, state)
}

func (a *Service) ApproveTurn(ctx context.Context, session string, input TurnApprovalInput) (ChatState, error) {
	releaseControl := a.lockSessionControl(session)
	defer releaseControl()
	run, err := a.currentRun(ctx, session, input.RunID)
	if err != nil {
		return ChatState{}, err
	}
	run.mu.Lock()
	pending, err := run.pendingApprovalLocked(input.ApprovalID)
	run.mu.Unlock()
	if err != nil {
		return ChatState{}, err
	}
	choice, err := approvalChoice(&pending, input.Decision)
	if err != nil {
		return ChatState{}, conversationFailure(400, "", err.Error())
	}
	var grant directoryApproval
	var reply any
	if pending.Kind == "project_access" {
		grant, err = a.prepareDirectoryApproval(ctx, run, pending, choice)
	} else {
		reply, err = nativeApprovalReply(&pending, choice, input)
	}
	if err != nil {
		return ChatState{}, conversationFailure(400, "", err.Error())
	}
	if pending.Kind == "project_access" && choice.Accepts {
		a.directoryStarts.Lock()
		defer a.directoryStarts.Unlock()
		if grant.binding.Access == model.SessionBindingWrite && choice.ID != "accept_shared" && len(a.directoryConflictsLocked(grant.binding.Directory, session)) != 0 {
			return ChatState{}, conversationFailure(400, "", "有其他 Agent 开始修改此目录，请拒绝此请求并选择独立 Worktree 或重新确认共享目录")
		}
	}

	// Completion and stop can win while validating a directory or a form.
	// Revalidate before the persistence and reply that commit the approval.
	run.mu.Lock()
	defer run.mu.Unlock()
	if _, err := run.pendingApprovalLocked(input.ApprovalID); err != nil {
		return ChatState{}, err
	}
	switch {
	case pending.Kind == "project_access":
		if err := a.commitDirectoryApproval(run, pending, choice, grant); err != nil {
			return ChatState{}, conversationFailure(400, "", err.Error())
		}
	default:
		err = run.connection.Reply(pending.rpcID, reply)
	}
	if err != nil {
		return ChatState{}, conversationFailure(503, "approval_unconfirmed", "审批未送达："+err.Error())
	}
	left := []ChatApproval{}
	for _, approval := range run.state.Approvals {
		if approval.ID != pending.ID {
			left = append(left, approval)
		}
	}
	run.state.Approvals = left
	if len(left) == 0 {
		run.state.Status = "running"
	}
	run.publishChangeLocked()
	return run.snapshotLocked(), nil
}

func (run *ChatRun) pendingApprovalLocked(id string) (ChatApproval, error) {
	if !run.state.Busy || run.stopRequested {
		return ChatApproval{}, conversationFailure(409, "stale_approval", "此运行已经结束")
	}
	for _, approval := range run.state.Approvals {
		if approval.ID == id {
			return approval, nil
		}
	}
	return ChatApproval{}, conversationFailure(409, "stale_approval", "此审批已被处理或失效")
}

func nativeApprovalReply(pending *ChatApproval, choice ChatApprovalChoice, input TurnApprovalInput) (any, error) {
	if pending.method == "cursor/ask_question" || pending.method == "cursor/create_plan" {
		return cursorApprovalReply(pending, choice, input.Content)
	}
	switch pending.Kind {
	case "acp_permission":
		if choice.ID == "cancel" {
			return map[string]any{"outcome": map[string]any{"outcome": "cancelled"}}, nil
		}
		return map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": choice.ID}}, nil
	case "elicitation":
		return elicitationReply(pending, choice, input.Content)
	case "permissions":
		permissions := json.RawMessage(`{}`)
		if choice.Accepts {
			var params struct {
				Permissions json.RawMessage `json:"permissions"`
			}
			_ = json.Unmarshal(pending.params, &params)
			permissions = params.Permissions
		}
		scope := "turn"
		if input.Decision == "accept_session" {
			scope = "session"
		}
		return map[string]any{"permissions": permissions, "scope": scope}, nil
	case "questions":
		return questionReply(pending.Questions, input)
	default:
		return map[string]any{"decision": choice.decision}, nil
	}
}
