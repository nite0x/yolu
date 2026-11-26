package session

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

type SteerTurnInput struct {
	Text      string   `json:"text"`
	Images    []string `json:"images"`
	RequestID string   `json:"request_id"`
	TurnID    string   `json:"turn_id"`
}

func (a *Service) ChatSteerHandler(w http.ResponseWriter, r *http.Request) {
	var input SteerTurnInput
	if !httpx.DecodeLimit(w, r, &input, chatRequestLimit) {
		return
	}
	state, err := a.SteerTurn(r.Context(), r.PathValue("session"), input)
	if err != nil {
		writeConversationError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"chat": state, "accepted": input.RequestID})
}

// SteerTurn durably reserves the input before sending to the identified turn.
// Any ambiguous result leaves the receipt pending across restarts.
func (a *Service) SteerTurn(ctx context.Context, session string, input SteerTurnInput) (ChatState, error) {
	releaseControl := a.lockSessionControl(session)
	defer releaseControl()
	input.Text = strings.TrimSpace(input.Text)
	if input.RequestID == "" || len(input.RequestID) > 100 || input.TurnID == "" || len(input.TurnID) > 200 || (input.Text == "" && len(input.Images) == 0) || len(input.Text) > 64000 {
		return ChatState{}, conversationFailure(400, "", "请输入补充消息并提供当前轮次及发送标识")
	}
	if err := validateChatImages(input.Images); err != nil {
		return ChatState{}, conversationFailure(400, "", err.Error())
	}
	record, err := a.resolveSession(ctx, session)
	if err != nil {
		return ChatState{}, err
	}
	if model.IsACPProvider(record.Provider) {
		return ChatState{}, conversationFailure(400, "", model.ProviderName(record.Provider)+" 对话暂不支持运行中补充引导，请等待本轮完成或停止后发送")
	}
	raw, _ := json.Marshal(input)
	fingerprint := fmt.Sprintf("%x", sha256.Sum256(raw))
	previous, status, err := a.Execution.Store.InputReceipt(ctx, record.ID, input.RequestID)
	run := a.ChatFor(record.ID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return ChatState{}, conversationStorageFailure(err)
	}
	if err == nil {
		if previous != fingerprint {
			return ChatState{}, conversationFailure(409, "input_mismatch", "发送标识已用于其他补充消息")
		}
		if status != "accepted" {
			return ChatState{}, conversationFailure(409, "input_uncertain", "补充消息的投递结果未确认，请查看历史后再操作，不会自动重复投递")
		}
		state := ChatState{Status: "idle", Entries: []HistoryEntry{}, Approvals: []ChatApproval{}}
		if run != nil {
			state = run.snapshot()
		}
		return state, nil
	}
	if run == nil {
		return ChatState{}, conversationFailure(409, "", "本轮已结束，请作为下一条消息发送")
	}
	state := run.snapshot()
	if !state.Busy || state.TurnID != input.TurnID || (state.Status != "running" && state.Status != "waiting") {
		return ChatState{}, conversationFailure(409, "", "当前轮次已变化，请刷新状态后发送")
	}
	run.mu.Lock()
	client, _ := run.connection.(codex.LiveClient)
	run.mu.Unlock()
	if client == nil {
		return ChatState{}, conversationFailure(409, "", "对话仍在连接，请稍后发送")
	}
	if err := a.Execution.Store.ReserveInput(ctx, record.ID, input.RequestID, fingerprint); err != nil {
		return ChatState{}, conversationStorageFailure(err)
	}
	if err := steerCodex(ctx, client, record.ID, input.TurnID, input.RequestID, input.Text, input.Images); err != nil {
		return ChatState{}, conversationFailure(409, "input_uncertain", "补充消息未确认，请检查历史后再操作；草稿已保留")
	}
	if err := a.Execution.Store.AcceptInput(context.WithoutCancel(ctx), record.ID, input.RequestID); err != nil {
		return ChatState{}, conversationStorageFailure(err)
	}
	run.change(func(s *ChatState) { s.AcceptedInputs = append(s.AcceptedInputs, input.RequestID) })
	return run.snapshot(), nil
}
