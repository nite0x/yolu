package session

import (
	"context"
	"errors"
	"sync"
	"time"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
)

// chatRuntime owns in-memory turns and their title workers. Connection adapters
// and HTTP handlers use it without owning cancellation or shutdown sequencing.
type chatRuntime struct {
	chatMu         sync.Mutex
	chats          map[string]*ChatRun
	active         map[*ChatRun]struct{}
	completed      []completedRun
	completedBytes int
	titleRuns      map[*ChatRun]*backgroundTask
	startups       map[*backgroundTask]struct{}
	chatsClosing   bool
	streamShutdown chan struct{}
}
type backgroundTask struct {
	cancel   context.CancelFunc
	finished chan struct{}
}

var errChatClosing = errors.New("后台正在退出")
var errChatBusy = errors.New("该对话正在运行，请等待完成或停止后再发送")

const (
	finishedChatTTL     = 10 * time.Minute
	finishedChatLimit   = 64
	finishedChatBudget  = 32 << 20
	chatShutdownTimeout = 3 * time.Second
)

type completedRun struct {
	run   *ChatRun
	at    time.Time
	bytes int
}

func (a *chatRuntime) ChatFor(session string) *ChatRun {
	a.chatMu.Lock()
	defer a.chatMu.Unlock()
	a.pruneCompletedLocked(time.Now())
	return a.chats[session]
}

func (a *chatRuntime) ChatBusy(session string) bool {
	run := a.ChatFor(session)
	if run == nil {
		return false
	}
	run.mu.Lock()
	defer run.mu.Unlock()
	return run.state.Busy
}

// publishRun admits every driver through one gate. Replaced runs can still
// be releasing a connection or collecting a prediction and remain in active.
func (a *chatRuntime) publishRun(run *ChatRun) error {
	a.chatMu.Lock()
	defer a.chatMu.Unlock()
	if a.chatsClosing {
		return errChatClosing
	}
	if old := a.chats[run.session]; old != nil {
		old.mu.Lock()
		busy, prediction := old.state.Busy, old.state.PredictionPending
		old.mu.Unlock()
		if busy {
			return errChatBusy
		}
		a.forgetCompletedLocked(old)
		if _, stillActive := a.active[old]; stillActive || prediction {
			old.cancel()
		}
	}
	if a.active == nil {
		a.active = make(map[*ChatRun]struct{})
	}
	a.active[run] = struct{}{}
	a.chats[run.session] = run
	return nil
}

func (a *chatRuntime) forgetCompletedLocked(run *ChatRun) {
	for i, entry := range a.completed {
		if entry.run == run {
			a.completedBytes -= entry.bytes
			copy(a.completed[i:], a.completed[i+1:])
			a.completed[len(a.completed)-1] = completedRun{}
			a.completed = a.completed[:len(a.completed)-1]
			return
		}
	}
}

func (a *chatRuntime) pruneCompletedLocked(now time.Time) {
	n := 0
	for n < len(a.completed) && (len(a.completed)-n > finishedChatLimit || now.Sub(a.completed[n].at) > finishedChatTTL || a.completedBytes > finishedChatBudget) {
		entry := a.completed[n]
		a.completedBytes -= entry.bytes
		run := entry.run
		if a.chats[run.session] == run {
			delete(a.chats, run.session)
		}
		n++
	}
	clear(a.completed[:n])
	a.completed = a.completed[n:]
}

// Drivers call this after their protocol cleanup. The registry lock makes
// removing a worker and signalling its completion one shutdown-visible step.
func (a *chatRuntime) finishRun(run *ChatRun) {
	run.cancel()
	run.mu.Lock()
	run.connection = nil
	run.cloudInterrupt = nil
	bytes := run.retainedBytesLocked()
	run.mu.Unlock()
	a.chatMu.Lock()
	defer a.chatMu.Unlock()
	delete(a.active, run)
	if a.chats[run.session] == run {
		now := time.Now()
		a.completed = append(a.completed, completedRun{run: run, at: now, bytes: bytes})
		a.completedBytes += bytes
		a.pruneCompletedLocked(now)
	}
	close(run.finished)
}

// beginCreation owns the provider startup after local validation. HTTP
// cancellation ends validation, while shutdown ends untransferred startup.
func (a *chatRuntime) beginCreation(ctx context.Context) (context.Context, func(), error) {
	a.chatMu.Lock()
	defer a.chatMu.Unlock()
	if a.chatsClosing {
		return nil, nil, errChatClosing
	}
	if a.startups == nil {
		a.startups = make(map[*backgroundTask]struct{})
	}
	startCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 90*time.Second)
	startup := &backgroundTask{cancel: cancel, finished: make(chan struct{})}
	a.startups[startup] = struct{}{}
	return startCtx, func() {
		cancel()
		a.chatMu.Lock()
		defer a.chatMu.Unlock()
		delete(a.startups, startup)
		close(startup.finished)
	}, nil
}

func (a *chatRuntime) CloseChats() {
	a.chatMu.Lock()
	if !a.chatsClosing && a.streamShutdown != nil {
		close(a.streamShutdown)
	}
	a.chatsClosing = true
	runs := make([]*ChatRun, 0, len(a.active))
	for run := range a.active {
		runs = append(runs, run)
	}
	titles := make([]*backgroundTask, 0, len(a.titleRuns)+len(a.startups))
	for _, title := range a.titleRuns {
		titles = append(titles, title)
	}
	for startup := range a.startups {
		titles = append(titles, startup)
	}
	a.chatMu.Unlock()

	deadline, cancel := context.WithTimeout(context.Background(), chatShutdownTimeout)
	defer cancel()
	for _, title := range titles {
		title.cancel()
	}
	for _, run := range runs {
		// Cloud work belongs to the remote service. Closing Yolu detaches
		// its observer without interrupting a remote turn.
		if run.provider == model.ProviderCodexCloud {
			run.cancel()
			continue
		}
		go func() {
			defer run.cancel()
			interrupt, end := context.WithTimeout(deadline, time.Second)
			defer end()
			if started, queued := run.beginStop(); started && !queued {
				_ = run.interruptContext(interrupt)
			}
		}()
	}
	defer func() {
		for _, run := range runs {
			run.cancel()
		}
	}()
	for _, run := range runs {
		select {
		case <-run.finished:
		case <-deadline.Done():
			return
		}
	}
	for _, title := range titles {
		select {
		case <-title.finished:
		case <-deadline.Done():
			return
		}
	}
}

func (run *ChatRun) beginStop() (started, queued bool) {
	run.mu.Lock()
	defer run.mu.Unlock()
	if !run.state.Busy || run.stopRequested {
		return false, false
	}
	run.stopRequested = true
	run.state.Status = "stopping"
	run.publishChangeLocked()
	return true, run.turnSubmitting
}

func (run *ChatRun) restoreAfterStopFailure() {
	run.change(func(s *ChatState) {
		run.stopRequested = false
		if s.Busy && s.Status == "stopping" {
			s.Status = "running"
			if len(s.Approvals) > 0 {
				s.Status = "waiting"
			}
		}
	})
}

func (run *ChatRun) fail(message string) {
	run.change(func(s *ChatState) {
		s.Status, s.Error = "failed", message
		if run.stopRequested {
			s.Status, s.Error = "interrupted", ""
		}
	})
}

func (run *ChatRun) finishLocalTurn() {
	run.change(func(s *ChatState) {
		s.Busy = false
		s.Retrying = ""
		s.Approvals = []ChatApproval{}
		switch s.Status {
		case "starting", "running", "waiting", "stopping":
			if run.stopRequested {
				s.Status, s.Error = "interrupted", ""
				return
			}
			s.Status = "failed"
			if s.Error == "" {
				s.Error = "对话连接已结束，请检查已保存的进展后重试"
			}
		}
	})
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
