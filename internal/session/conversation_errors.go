package session

import (
	"errors"
	"net/http"

	"worktree-hub/internal/httpx"
)

type conversationError struct {
	status   int
	code     string
	cause    error
	conflict *directoryWriteConflict
}

func (e *conversationError) Error() string { return e.cause.Error() }
func (e *conversationError) Unwrap() error { return e.cause }
func conversationFailure(status int, code, message string) error {
	return &conversationError{status: status, code: code, cause: errors.New(message)}
}
func conversationStorageFailure(err error) error {
	return &conversationError{status: 500, code: "storage_error", cause: err}
}
func directoryConflictFailure(conflict *directoryWriteConflict) error {
	return &conversationError{status: 409, code: "directory_conflict", cause: errors.New(directoryConflictMessage), conflict: conflict}
}

func runAdmissionFailure(err error) error {
	if errors.Is(err, errChatClosing) {
		return conversationFailure(503, "shutting_down", err.Error())
	}
	return conversationFailure(409, "run_busy", err.Error())
}

func writeRunAdmissionError(w http.ResponseWriter, err error) {
	writeConversationError(w, runAdmissionFailure(err))
}

func writeConversationError(w http.ResponseWriter, err error) {
	var failure *conversationError
	switch {
	case !errors.As(err, &failure):
		httpx.DbError(w, err)
	case failure.conflict != nil:
		writeBindingConflict(w, failure.conflict)
	case failure.status == 500:
		httpx.DbError(w, failure.cause)
	default:
		httpx.WriteErrorCode(w, failure.status, failure.code, failure.Error())
	}
}
