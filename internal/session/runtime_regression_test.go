package session

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
	"worktree-hub/internal/store"
)

func TestChatEventsBroadcastDerivedStateAndReleaseViewers(t *testing.T) {
	a := testApp(t)
	if err := a.Execution.Store.SaveSession(model.Session{ID: "session", Cwd: t.TempDir()}); err != nil {
		t.Fatal(err)
	}
	runCtx, finish := context.WithCancel(context.Background())
	run := &ChatRun{session: "session", cancel: finish, finished: make(chan struct{}), state: ChatState{
		ID: "display", Busy: true, Entries: []HistoryEntry{{ID: "item", TurnID: "turn", Delivery: "async", Questions: []ChatQuestion{{ID: "question"}}}},
	}}
	if err := a.publishRun(run); err != nil {
		t.Fatal(err)
	}
	defer a.finishRun(run)
	viewCtx, leave := context.WithCancel(context.Background())
	defer leave()
	one, oneDone := startStream(a, viewCtx)
	two, twoDone := startStream(a, context.Background())
	check := func(frames <-chan string, text string) {
		t.Helper()
		select {
		case frame := <-frames:
			if !strings.Contains(frame, text) {
				t.Fatalf("expected %q in %s", text, frame)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("viewer missed update")
		}
	}
	check(one, "data: ")
	check(two, "data: ")
	frame1, _, err := a.chatFrame(viewCtx, run)
	if err != nil {
		t.Fatal(err)
	}
	frame2, _, err := a.chatFrame(viewCtx, run)
	if err != nil || frame2 != frame1 {
		t.Fatal("stable snapshots did not share their encoding", err)
	}
	if err := a.Execution.Store.SaveAsyncAnswer(viewCtx, "session", store.AsyncQuestionKey{Item: "item", Turn: "turn"}, "answer", "fingerprint", "skipped"); err != nil {
		t.Fatal(err)
	}
	a.asyncAnswersChanged("session")
	check(one, `"question_status":"skipped"`)
	check(two, `"question_status":"skipped"`)
	leave()
	select {
	case <-oneDone:
	case <-time.After(time.Second):
		t.Fatal("disconnected observer stayed active")
	}
	if runCtx.Err() != nil {
		t.Fatal("disconnect cancelled an accepted turn")
	}
	run.change(func(s *ChatState) { s.Busy, s.Status = false, "completed" })
	check(two, `"status":"completed"`)
	select {
	case <-twoDone:
	case <-time.After(time.Second):
		t.Fatal("terminal frame did not close stream")
	}
}

type delayedStartClient struct {
	*fakeLiveClient
	sent chan struct{}
	ack  chan struct{}
}

func (c *delayedStartClient) Call(ctx context.Context, method string, params any, out any) error {
	if method == "turn/start" {
		close(c.sent)
		select {
		case <-c.ack:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return c.fakeLiveClient.Call(ctx, method, params, out)
}

func TestStopWhileCodexStartIsUnacknowledged(t *testing.T) {
	a, _, fixture, _ := chatFixture(t)
	client := &delayedStartClient{fakeLiveClient: fixture, sent: make(chan struct{}), ack: make(chan struct{})}
	a.openLive = func(context.Context) (codex.LiveClient, error) { return client, nil }
	ctx := context.Background()
	if _, status, err := a.StartTurn(ctx, "session", StartTurnInput{Text: "test", RequestID: "request"}); err != nil || status != 202 {
		t.Fatalf("start: status=%d err=%v", status, err)
	}
	select {
	case <-client.sent:
	case <-time.After(5 * time.Second):
		t.Fatal("no provider start")
	}
	state, err := a.StopTurn(ctx, "session", "request")
	if err != nil || state.Status != "stopping" || state.TurnID != "" {
		t.Fatalf("stop while starting: %+v %v", state, err)
	}
	close(client.ack)
	state = awaitChat(t, a, func(s ChatState) bool { return !s.Busy })
	if state.TurnID != "turn" || state.Status != "interrupted" {
		t.Fatalf("stop was not delivered to confirmed turn: %+v", state)
	}
	client.mu.Lock()
	defer client.mu.Unlock()
	interrupts := 0
	for _, method := range client.methods {
		if method == "turn/interrupt" {
			interrupts++
		}
	}
	if interrupts != 1 {
		t.Fatalf("interrupts=%d, want 1", interrupts)
	}
}

func TestChatShutdownTracksReplacedWorkersAndRejectsNewRuns(t *testing.T) {
	a := testApp(t)
	var workers sync.WaitGroup
	create := func(id string) *ChatRun {
		ctx, cancel := context.WithCancel(context.Background())
		run := &ChatRun{session: "session", provider: model.ProviderCodexCloud, cancel: cancel, finished: make(chan struct{}), state: ChatState{ID: id}}
		if err := a.publishRun(run); err != nil {
			t.Fatal(err)
		}
		workers.Go(func() { <-ctx.Done(); a.finishRun(run) })
		return run
	}
	previous, current := create("first"), create("second")
	a.CloseChats()
	workers.Wait()
	for _, run := range []*ChatRun{previous, current} {
		select {
		case <-run.finished:
		default:
			t.Fatal("worker still running after close")
		}
	}
	if err := a.publishRun(&ChatRun{session: "new"}); !errors.Is(err, errChatClosing) {
		t.Fatalf("accepted after close: %v", err)
	}
}

func TestCompletedRunsHaveBoundedRetention(t *testing.T) {
	runtime := chatRuntime{chats: map[string]*ChatRun{}}
	for i := 0; i < finishedChatLimit+5; i++ {
		id, _ := json.Marshal(i)
		run := &ChatRun{session: string(id), cancel: func() {}, finished: make(chan struct{})}
		if err := runtime.publishRun(run); err != nil {
			t.Fatal(err)
		}
		runtime.finishRun(run)
	}
	if len(runtime.chats) != finishedChatLimit || runtime.ChatFor("0") != nil || runtime.ChatFor("5") == nil {
		t.Fatal("completed-run retention failed")
	}
}
