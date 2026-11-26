package session

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"worktree-hub/internal/httpx"
)

const (
	chatFrameInterval   = 100 * time.Millisecond
	chatStreamHeartbeat = 15 * time.Second
	chatWriteTimeout    = 5 * time.Second
)

type chatFrame struct {
	revision  uint64
	data      []byte
	streaming bool
	retryAt   time.Time
}

func (a *Service) chatFrame(ctx context.Context, run *ChatRun) (*chatFrame, <-chan struct{}, error) {
	// A run shares one immutable encoding across panes. Never hold its state
	// mutex for database reads, media processing, encoding or socket writes.
	run.frameMu.Lock()
	defer run.frameMu.Unlock()
	run.mu.Lock()
	if run.changed == nil {
		run.changed = make(chan struct{})
	}
	changed := run.changed
	previous := run.frame
	if previous != nil && previous.revision == run.state.Revision &&
		(previous.retryAt.IsZero() || time.Now().Before(previous.retryAt)) {
		run.mu.Unlock()
		return previous, changed, nil
	}
	state := run.snapshotLocked()
	run.mu.Unlock()
	retryMedia := a.prepareHistoryMedia(run.session, state.Entries)
	if err := a.decorateAsyncQuestions(ctx, run.session, state.Entries); err != nil {
		return nil, changed, err
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return nil, changed, err
	}
	frame := &chatFrame{
		revision: state.Revision, data: raw, streaming: state.Busy || state.PredictionPending,
	}
	if retryMedia {
		frame.retryAt = time.Now().Add(time.Second)
	}
	run.frame = frame
	return frame, changed, nil
}

func (a *Service) ChatEventsHandler(w http.ResponseWriter, r *http.Request) {
	run, err := a.currentRun(r.Context(), r.PathValue("session"), r.URL.Query().Get("run"))
	if err != nil {
		writeConversationError(w, err)
		return
	}
	if _, ok := w.(http.Flusher); !ok {
		httpx.WriteError(w, 500, "浏览器连接不支持实时输出")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	controller := http.NewResponseController(w)
	write := func(format string, args ...any) bool {
		_ = controller.SetWriteDeadline(time.Now().Add(chatWriteTimeout))
		if _, err := fmt.Fprintf(w, format, args...); err != nil {
			return false
		}
		return controller.Flush() == nil
	}
	defer func() { _ = controller.SetWriteDeadline(time.Time{}) }()
	heartbeat := time.NewTicker(chatStreamHeartbeat)
	defer heartbeat.Stop()
	timer := time.NewTimer(time.Hour)
	timer.Stop()
	defer timer.Stop()

	var last *chatFrame
	var lastSent time.Time
	for r.Context().Err() == nil {
		frame, changed, err := a.chatFrame(r.Context(), run)
		if err != nil {
			return
		}
		if frame != last && (last == nil || !bytes.Equal(frame.data, last.data)) {
			if !write("data: %s\n\n", frame.data) {
				return
			}
			lastSent = time.Now()
		}
		last = frame
		if !frame.streaming {
			return
		}

		var retry <-chan time.Time
		if !frame.retryAt.IsZero() {
			timer.Reset(time.Until(frame.retryAt))
			retry = timer.C
		}
		select {
		case <-r.Context().Done():
			return
		case <-a.streamShutdown:
			return
		case <-changed:
		case <-retry:
		case <-heartbeat.C:
			if !write(": keepalive\n\n") {
				return
			}
		}
		timer.Stop()
		if delay := chatFrameInterval - time.Since(lastSent); delay > 0 {
			timer.Reset(delay)
			select {
			case <-timer.C:
			case <-r.Context().Done():
				return
			case <-a.streamShutdown:
				return
			}
		}
	}
}

// Account for the dominant retained display payload and room for an encoded
// frame. The count limit separately bounds fixed per-run bookkeeping.
func (run *ChatRun) retainedBytesLocked() int {
	size := 2048 + len(run.state.Error) + len(run.state.Notice) + len(run.state.SessionName)
	for _, entry := range run.state.Entries {
		size += 512 + len(entry.ID) + len(entry.TurnID) + len(entry.Text) + len(entry.Command) + len(entry.Cwd)
		if entry.Output != nil {
			size += len(*entry.Output)
		}
		for _, image := range entry.Images {
			size += len(image)
		}
		for _, file := range entry.FileChanges {
			size += 64 + len(file.Path)
		}
		for _, action := range entry.CommandActions {
			size += 64 + len(action.Path) + len(action.Type)
		}
		for _, source := range entry.LocalImagePaths {
			size += 64 + len(source)
		}
		for _, question := range entry.Questions {
			size += 128 + len(question.Question) + len(question.Header)
			for _, choice := range question.Options {
				size += 32 + len(choice.Label) + len(choice.Description)
			}
		}
	}
	for path, snapshot := range run.baseline {
		size += len(path) + snapshot.retainedBytes()
	}
	for path, snapshot := range run.finalSnapshots {
		size += len(path) + snapshot.retainedBytes()
	}
	return 2 * size
}
