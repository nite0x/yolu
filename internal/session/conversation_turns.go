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

	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
)

type StartTurnInput struct {
	Text        string       `json:"text"`
	RequestID   string       `json:"request_id"`
	Images      []string     `json:"images"`
	Settings    TurnSettings `json:"settings"`
	AllowShared bool         `json:"allow_shared"`
}

type turnPrompt struct {
	text        string
	images      []string
	receipt     string
	fingerprint string
}

func newTurnPrompt(input StartTurnInput) turnPrompt {
	raw, _ := json.Marshal(input)
	return turnPrompt{
		text: input.Text, images: input.Images,
		receipt:     "turn-start:" + input.RequestID,
		fingerprint: fmt.Sprintf("%x", sha256.Sum256(raw)),
	}
}

func (a *Service) checkTurnReceipt(ctx context.Context, session string, prompt turnPrompt) error {
	fingerprint, status, err := a.Execution.Store.InputReceipt(ctx, session, prompt.receipt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil
	case err != nil:
		return conversationStorageFailure(err)
	case fingerprint != prompt.fingerprint:
		return conversationFailure(409, "input_mismatch", "发送标识已用于其他消息")
	case status == "accepted":
		return conversationFailure(409, "input_already_accepted", "消息已发送，请刷新历史查看")
	default:
		return conversationFailure(409, "input_uncertain", "消息的投递结果未确认，请查看历史后再操作，不会自动重复投递")
	}
}

func (a *Service) reserveTurnReceipt(ctx context.Context, session string, prompt turnPrompt) error {
	if prompt.receipt == "" {
		return nil // First turns and async answers already have a durable receipt.
	}
	return a.Execution.Store.ReserveInput(ctx, session, prompt.receipt, prompt.fingerprint)
}

func (a *Service) StartTurn(ctx context.Context, session string, input StartTurnInput) (ChatState, int, error) {
	releaseControl := a.lockSessionControl(session)
	defer releaseControl()
	if err := validateChatImages(input.Images); err != nil {
		return ChatState{}, 0, conversationFailure(400, "", err.Error())
	}
	input.Text = strings.TrimSpace(input.Text)
	if (input.Text == "" && len(input.Images) == 0) || len(input.Text) > 64000 || len(input.RequestID) > 100 || input.RequestID == "" {
		return ChatState{}, 0, conversationFailure(400, "", "请输入消息或添加图片（文字最多 64000 字节）并提供发送标识")
	}
	record, err := a.resolveSession(ctx, session)
	if err != nil {
		return ChatState{}, 0, err
	}
	if previous := a.ChatFor(record.ID); previous != nil {
		snapshot := previous.snapshot()
		if snapshot.ID == input.RequestID {
			return snapshot, 200, nil
		}
		if snapshot.Busy {
			return ChatState{}, 0, runAdmissionFailure(errChatBusy)
		}
	}
	var prompt turnPrompt
	if record.Provider != model.ProviderCodexCloud {
		prompt = newTurnPrompt(input)
		if err := a.checkTurnReceipt(ctx, record.ID, prompt); err != nil {
			return ChatState{}, 0, err
		}
	}
	if model.NormalizeProvider(record.Provider) == model.ProviderCodex {
		if external, ok := a.externalActivity(ctx, record.ID); ok && (external.Status == "running" || external.Status == "waiting") && !a.ChatBusy(record.ID) {
			return ChatState{}, 0, conversationFailure(409, "", "此对话仍在原生 Codex 中运行，请在原窗口继续或等待完成")
		}
	}
	if record.Archived {
		return ChatState{}, 0, conversationFailure(409, "", "请先恢复已归档对话")
	}
	if err := input.Settings.Validate(); err != nil {
		return ChatState{}, 0, conversationFailure(400, "", err.Error())
	}
	if model.IsACPProvider(model.NormalizeProvider(record.Provider)) && input.Settings.ServiceTier != "" {
		return ChatState{}, 0, conversationFailure(400, "", "所选对话引擎不支持设置响应速度")
	}
	if record.Provider == model.ProviderCodexCloud {
		state, err := a.startCloudTurn(ctx, record, input.RequestID, input.Text, input.Images)
		return state, http.StatusAccepted, err
	}
	planCtx := execution.WithClient(ctx, a.Execution.Remote)
	plan, err := a.savedSessionPlan(planCtx, record, input.AllowShared)
	if err != nil {
		return ChatState{}, 0, conversationFailure(409, "", err.Error())
	}
	if err := validateProviderBindings(record.Provider, plan); err != nil {
		return ChatState{}, 0, conversationFailure(409, "", err.Error())
	}
	releaseDirectories, err := a.reserveDirectories("session:"+record.ID, record.ID, plan)
	if err != nil {
		return ChatState{}, 0, err
	}
	defer releaseDirectories()
	runCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	run := &ChatRun{provider: model.NormalizeProvider(record.Provider), session: record.ID, cwd: plan.Cwd, cancel: cancel, finished: make(chan struct{}), state: ChatState{ID: input.RequestID, Status: "starting", Busy: true, Entries: []HistoryEntry{}, Approvals: []ChatApproval{}}}
	run.settings = input.Settings
	run.writeRoots = writableRoots(plan)
	run.directoryRoots = uniqueDirectories(append([]string{plan.Cwd}, plan.AdditionalDirectories...))
	run.managedBindings = plan.ManagedBindings
	if err := a.publishRun(run); err != nil {
		cancel()
		return ChatState{}, 0, runAdmissionFailure(err)
	}
	if model.IsACPProvider(run.provider) {
		go a.driveACPTurn(runCtx, run, plan, nil, prompt)
	} else {
		go a.driveCodexTurn(runCtx, run, plan, nil, prompt)
	}
	return run.snapshot(), 202, nil
}
