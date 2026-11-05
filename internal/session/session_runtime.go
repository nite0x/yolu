package session

import (
	"context"
	"sync"
	"time"
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
