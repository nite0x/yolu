package session

import (
	"context"
	"sync"
	"time"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

// chatRuntime owns in-memory turns and their title workers. Connection adapters
// and HTTP handlers use it without owning cancellation or shutdown sequencing.
type chatRuntime struct {
	chatMu       sync.Mutex
	chats        map[string]*ChatRun
	titleRuns    map[*ChatRun]*titleRun
	chatsClosing bool
}
type titleRun struct {
	cancel   context.CancelFunc
	finished chan struct{}
}

func (a *chatRuntime) ChatFor(session string) *ChatRun {
	a.chatMu.Lock()
	defer a.chatMu.Unlock()
	return a.chats[session]
}
func (a *chatRuntime) ChatBusy(session string) bool {
	run := a.ChatFor(session)
	return run != nil && run.snapshot().Busy
}
func (a *chatRuntime) CloseChats() {
	a.chatMu.Lock()
	a.chatsClosing = true
	runs := []*ChatRun{}
	for _, run := range a.chats {
		runs = append(runs, run)
	}
	titles := []*titleRun{}
	for _, title := range a.titleRuns {
		titles = append(titles, title)
	}
	a.chatMu.Unlock()
	for _, title := range titles {
		title.cancel()
	}
	for _, run := range runs {
		if run.snapshot().Busy {
			_ = run.interrupt()
		}
		run.cancel()
	}
	for _, run := range runs {
		select {
		case <-run.finished:
		case <-time.After(3 * time.Second):
		}
	}
	for _, title := range titles {
		select {
		case <-title.finished:
		case <-time.After(3 * time.Second):
		}
	}
}

// Tracing follows the run rather than its SSE viewers. Only identities and
// outcomes are logged; prompts, attachments and provider output stay private.
func traceRun(ctx context.Context, run *ChatRun) func() {
	logger := httpx.RequestLogger(ctx).With("session_id", run.session, "provider", model.NormalizeProvider(run.provider), "run_id", run.snapshot().ID)
	started := time.Now()
	logger.Info("Conversation run started")
	return func() {
		state := run.snapshot()
		logger.Info("Conversation run ended", "turn_id", state.TurnID, "status", state.Status, "duration_ms", time.Since(started).Milliseconds())
	}
}
