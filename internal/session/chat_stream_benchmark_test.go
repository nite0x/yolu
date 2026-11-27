package session

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"worktree-hub/internal/model"
)

type flushRecorder struct {
	*httptest.ResponseRecorder
	flushed chan string
}

func (w *flushRecorder) Flush() {
	w.ResponseRecorder.Flush()
	select {
	case w.flushed <- w.Body.String():
	default:
	}
}

func startStream(a *App, ctx context.Context) (<-chan string, <-chan struct{}) {
	w := &flushRecorder{ResponseRecorder: httptest.NewRecorder(), flushed: make(chan string, 16)}
	req := httptest.NewRequest(http.MethodGet, "/events?run=display", nil).WithContext(ctx)
	req.SetPathValue("session", "session")
	done := make(chan struct{})
	go func() {
		defer close(done)
		a.ChatEventsHandler(w, req)
	}()
	return w.flushed, done
}

// Run unchanged against the baseline and the current backend. Each iteration
// holds four viewers idle for half a second after their initial frames.
func BenchmarkChatEventsIdle(b *testing.B) {
	root := b.TempDir()
	a, err := openApp(filepath.Join(root, "data"), filepath.Join(root, "worktrees"))
	if err != nil {
		b.Fatal(err)
	}
	defer a.Execution.Close()
	defer a.Close()
	defer delete(a.chats, "session")
	if err := a.Execution.Store.SaveSession(model.Session{ID: "session", Cwd: root}); err != nil {
		b.Fatal(err)
	}
	entries := make([]HistoryEntry, 120)
	for i := range entries {
		entries[i] = HistoryEntry{ID: "item", TurnID: "turn", Kind: "assistant", Status: "completed", Text: strings.Repeat("content ", 64)}
		if i < 20 {
			entries[i].Delivery = "async"
			entries[i].Questions = []ChatQuestion{{ID: "question", Question: "Choose an option"}}
		}
	}
	var waits int64
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		a.chats["session"] = &ChatRun{session: "session", state: ChatState{ID: "display", Busy: true, Entries: entries}}
		before := a.Execution.Store.DB.Stats().WaitCount
		ctx, cancel := context.WithCancel(context.Background())
		var viewers sync.WaitGroup
		for pane := 0; pane < 4; pane++ {
			flushed, done := startStream(a, ctx)
			viewers.Go(func() { <-done })
			select {
			case <-flushed:
			case <-time.After(3 * time.Second):
				cancel()
				viewers.Wait()
				b.Fatal("no initial frame")
			}
		}
		time.Sleep(550 * time.Millisecond)
		cancel()
		viewers.Wait()
		waits += a.Execution.Store.DB.Stats().WaitCount - before
	}
	b.ReportMetric(float64(waits)/float64(b.N), "sqlite-waits/op")
}
