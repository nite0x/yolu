package session

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"worktree-hub/internal/model"
	"worktree-hub/internal/platform"
)

// WorkspaceCodexLaunch binds the first message and execution settings to the
// workspace creation review. Directory ownership is checked again at launch.
type WorkspaceCodexLaunch struct {
	Instruction           string       `json:"first_instruction"`
	Cwd                   string       `json:"cwd"`
	AdditionalDirectories []string     `json:"additional_directories"`
	Settings              TurnSettings `json:"settings"`
}

func (a *Service) ReviewWorkspaceCodexLaunch(ctx context.Context, q model.Workspace, instruction string) (WorkspaceCodexLaunch, error) {
	review := WorkspaceCodexLaunch{Instruction: strings.TrimSpace(instruction), AdditionalDirectories: []string{}}
	if review.Instruction == "" || len(review.Instruction) > 64000 {
		return review, fmt.Errorf("请输入 Codex 首条指令（最多 64000 字节）")
	}
	for _, m := range q.Members {
		if m.ProjectID == q.PrimaryProjectID {
			review.Cwd = m.Path
		}
	}
	if review.Cwd == "" {
		return review, fmt.Errorf("请选择用于启动 Codex 的主项目")
	}
	for _, m := range q.Members {
		if !platform.SameWorkspacePath(m.Path, review.Cwd) {
			review.AdditionalDirectories = append(review.AdditionalDirectories, m.Path)
		}
	}
	review.AdditionalDirectories = uniqueDirectories(review.AdditionalDirectories)
	defaults, err := a.conversationPreferences(ctx)
	review.Settings = newConversationSettings(TurnSettings{}, defaults)
	return review, err
}

func (launch WorkspaceCodexLaunch) input(workspaceID string) newSessionInput {
	return newSessionInput{
		Text: launch.Instruction, WorkspaceID: workspaceID, Cwd: launch.Cwd,
		AdditionalDirectories: &launch.AdditionalDirectories, Settings: launch.Settings,
		Provider: model.ProviderCodex, RequestID: "assistant-codex-" + workspaceID,
	}
}

// WorkspaceCodexOutcome records what is known about the native handoff.
type WorkspaceCodexOutcome struct {
	Session   model.Session
	Accepted  bool
	Uncertain bool
}

// ObserveWorkspaceCodexLaunch reads persisted evidence without sending to Codex.
func (a *Service) ObserveWorkspaceCodexLaunch(ctx context.Context, workspaceID string, launch WorkspaceCodexLaunch) (WorkspaceCodexOutcome, error) {
	input := launch.input(workspaceID)
	fingerprint := input.fingerprint()
	id, err := a.createdSessionID(ctx, input.RequestID, fingerprint)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return WorkspaceCodexOutcome{}, nil
	case errors.Is(err, errCreationUncertain):
		return WorkspaceCodexOutcome{Uncertain: true}, nil
	case err != nil:
		return WorkspaceCodexOutcome{}, err
	}
	out := WorkspaceCodexOutcome{Uncertain: true}
	out.Session, err = a.Execution.Store.Session(id)
	if err != nil {
		return out, err
	}
	err = a.Execution.Store.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM conversation_input_requests WHERE session_id=? AND request_id=? AND fingerprint=? AND status='accepted')`, id, input.RequestID, fingerprint).Scan(&out.Accepted)
	out.Uncertain = !out.Accepted
	return out, err
}

// StartWorkspaceCodex waits for the first turn receipt and leaves the accepted
// turn running under the normal native conversation lifecycle.
func (a *Service) StartWorkspaceCodex(ctx context.Context, workspaceID string, launch WorkspaceCodexLaunch) error {
	defer a.invalidateSessionCatalog()
	input := launch.input(workspaceID)
	key, fingerprint := input.RequestID, input.fingerprint()
	unlock := a.lockControl("create:" + key)
	defer unlock()
	if a.Execution.ReadOnlySessions || a.Execution.Closing.Load() {
		return errors.New("目标环境当前无法执行写入操作。")
	}
	if _, err := a.createdSessionID(ctx, key, fingerprint); !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	execution, err := a.resolveCreation(ctx, SessionTarget{
		WorkspaceID: workspaceID, Cwd: input.Cwd, AdditionalDirectories: input.AdditionalDirectories,
		requireReady: true,
	})
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	run, _, err := a.startCodexSession(ctx, key, fingerprint, input, execution, true)
	if err != nil {
		return err
	}
	select {
	case <-run.started:
		return nil
	case <-run.finished:
		// The receipt stays authoritative if Codex completed very quickly.
		return nil
	case <-ctx.Done():
		select {
		case <-run.started:
			return nil
		default:
			run.cancel()
			return ctx.Err()
		}
	}
}
