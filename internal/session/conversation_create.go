package session

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
)

type CreationResult struct {
	SessionID string
	Status    int
}

func creationProviderFailure(status int, err error) error {
	if status == 500 {
		return conversationStorageFailure(err)
	}
	return &conversationError{status: status, code: "provider_error", cause: err}
}
func creationReceiptCode(err error) string {
	if errors.Is(err, errCreationMismatch) {
		return "creation_mismatch"
	}
	return "creation_uncertain"
}

// CreateSession coordinates validation, durable receipts, directory reservations
// and provider startup without an HTTP request or response writer. Once a provider
// mutation starts, disconnecting the caller must not lose its creation receipt.
func (a *Service) CreateSession(ctx context.Context, input CreateSessionInput) (CreationResult, error) {
	defer a.invalidateSessionCatalog()
	if !model.SupportedProvider(input.Provider) {
		return CreationResult{}, conversationFailure(400, "", "不支持的对话引擎")
	}
	provider := model.NormalizeProvider(input.Provider)
	if input.YoluAssistant {
		if provider != model.ProviderCodex || input.CloudEnvironment != "" || input.Purpose != "" || input.Settings.Permission == "full" {
			return CreationResult{}, conversationFailure(400, "", "Yolu 助手需要本机 Codex 和受管目录权限")
		}
		if len(a.AssistantMCP) == 0 || a.Execution.Remote != nil {
			return CreationResult{}, conversationFailure(503, "", "当前执行环境无法启动 Yolu 助手")
		}
	}
	if err := validateChatImages(input.Images); err != nil {
		return CreationResult{}, conversationFailure(400, "", err.Error())
	}
	input.Text = strings.TrimSpace(input.Text)
	if err := input.Settings.Validate(); err != nil {
		return CreationResult{}, conversationFailure(400, "", err.Error())
	}
	if model.IsACPProvider(provider) && input.Settings.ServiceTier != "" {
		return CreationResult{}, conversationFailure(400, "", "所选对话引擎不支持设置响应速度")
	}
	if (input.Text == "" && len(input.Images) == 0 && input.Purpose != "merge_conflict") || len(input.Text) > 64000 || input.RequestID == "" || len(input.RequestID) > 100 || (input.Purpose != "" && input.Purpose != "merge_conflict") {
		return CreationResult{}, conversationFailure(400, "", "请输入第一条消息或添加图片（文字最多 64000 字节）并提供创建标识")
	}
	// Persist the idempotency key before making any remote mutation. An uncertain
	// creation is never retried implicitly, including after a service restart.
	key := input.RequestID
	releaseControl := a.lockControl("create:" + key)
	defer releaseControl()
	fingerprint := creationFingerprint(input)
	existing, err := a.createdSessionID(ctx, key, fingerprint)
	if err == nil {
		return CreationResult{SessionID: existing, Status: 200}, nil
	}
	if errors.Is(err, errCreationUncertain) || errors.Is(err, errCreationMismatch) {
		return CreationResult{}, conversationFailure(409, creationReceiptCode(err), err.Error())
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CreationResult{}, conversationStorageFailure(err)
	}
	if input.CloudEnvironment != "" {
		startup, finish, err := a.beginCreation(ctx)
		if err != nil {
			return CreationResult{}, runAdmissionFailure(err)
		}
		defer finish()
		return a.createCloudSession(startup, key, fingerprint, input, provider)
	}
	defaults, err := a.conversationPreferencesForProvider(ctx, provider)
	if err != nil {
		return CreationResult{}, conversationStorageFailure(err)
	}
	input.Settings = newConversationSettings(input.Settings, defaults)
	if input.YoluAssistant && input.Settings.Permission == "full" {
		input.Settings.Permission = "ask"
	}
	ctx = execution.WithClient(ctx, a.Execution.Remote)
	target, err := a.resolveCreation(ctx, SessionTarget{
		ProjectID: input.Project, Cwd: input.Cwd, Bindings: input.Bindings, Access: input.Access,
		AllowShared: input.AllowShared, Provider: provider,
	}, key)
	if err == nil && input.Purpose == "merge_conflict" {
		if input.Project == "" {
			err = invalidSessionTarget("合并处理需要明确的项目和 Worktree")
		} else {
			input.Text, err = mergeConflictPrompt(ctx, target.plan.Cwd, input.MergeHead)
		}
	}
	if err != nil {
		status := 409
		if errors.Is(err, sql.ErrNoRows) {
			status = 404
		}
		var invalidTarget invalidSessionTarget
		if errors.As(err, &invalidTarget) {
			status = 400
		}
		return CreationResult{}, conversationFailure(status, "", err.Error())
	}
	if err := validateProviderBindings(provider, target.plan); err != nil {
		return CreationResult{}, conversationFailure(409, "unsupported_bindings", err.Error())
	}
	target.plan.YoluAssistant = input.YoluAssistant
	releaseDirectories, err := a.reserveDirectories("create:"+key, "", target.plan)
	if err != nil {
		return CreationResult{}, err
	}
	defer releaseDirectories()
	startup, finish, err := a.beginCreation(ctx)
	if err != nil {
		return CreationResult{}, runAdmissionFailure(err)
	}
	defer finish()
	if model.IsACPProvider(provider) {
		run, status, err := a.startACPSession(startup, provider, key, fingerprint, input, target)
		if err != nil {
			return CreationResult{}, creationProviderFailure(status, err)
		}
		return CreationResult{SessionID: run.session, Status: status}, nil
	}
	run, status, err := a.startCodexSession(startup, key, fingerprint, input, target)
	if err != nil {
		return CreationResult{}, creationProviderFailure(status, err)
	}
	return CreationResult{SessionID: run.session, Status: status}, nil
}
