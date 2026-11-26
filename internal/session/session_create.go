package session

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"worktree-hub/internal/apitypes"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

type CreateSessionInput = apitypes.CreateSessionInput

var (
	errCreationUncertain = errors.New("上次创建结果未确认，为避免重复创建请先刷新对话列表检查")
	errCreationMismatch  = errors.New("创建标识已用于其他消息或工作目录")
)

func creationFingerprint(in CreateSessionInput) string {
	raw, _ := json.Marshal(in)
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}

func (a *Service) createdSessionID(ctx context.Context, key, fingerprint string) (string, error) {
	id, previous, err := a.Execution.Store.CreationReceipt(ctx, key)
	if err != nil {
		return "", err
	}
	if previous != "" && previous != fingerprint {
		return "", errCreationMismatch
	}
	if id == "" {
		return "", errCreationUncertain
	}
	return id, nil
}

func (a *Service) NewSessionHandler(w http.ResponseWriter, r *http.Request) {
	var input CreateSessionInput
	if !httpx.DecodeLimit(w, r, &input, chatRequestLimit) {
		return
	}
	logger := httpx.RequestLogger(r.Context()).With("creation_request_id", input.RequestID, "provider", model.NormalizeProvider(input.Provider))
	result, err := a.CreateSession(r.Context(), input)
	if err != nil {
		var failure *conversationError
		if errors.As(err, &failure) {
			logger.Warn("Conversation creation failed", "code", failure.code, "status", failure.status)
		}
		writeConversationError(w, err)
		return
	}
	logger.Info("Conversation creation accepted", "session_id", result.SessionID, "status", result.Status)
	a.WriteCreatedSession(w, result.SessionID, result.Status)
}

func (a *Service) WriteCreatedSession(w http.ResponseWriter, session string, status int) {
	s, err := a.Execution.Store.Session(session)
	if err != nil {
		httpx.WriteError(w, 409, "已创建的对话记录不可用，请刷新后检查")
		return
	}
	s.Available = true
	chat := ChatState{Status: "idle", Entries: []HistoryEntry{}, Approvals: []ChatApproval{}}
	if run := a.ChatFor(session); run != nil {
		chat = run.snapshot()
	}
	httpx.WriteJSON(w, status, map[string]any{"session": s, "chat": chat})
}
