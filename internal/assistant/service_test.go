package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"worktree-hub/internal/store"
)

func testService(t *testing.T, provider Provider) (*Service, http.Handler) {
	t.Helper()
	db, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := New(db, t.TempDir())
	s.provider = provider
	t.Cleanup(func() { s.Close(); db.DB.Close() })
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	return s, mux
}
func request(t *testing.T, h http.Handler, method, path, body string, status int) []byte {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, path, strings.NewReader(body)))
	if w.Code != status {
		t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
	}
	return w.Body.Bytes()
}
func waitRun(t *testing.T, s *Service, id, status string) store.AssistantRun {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		run, err := s.store.AssistantRun("yolu-one", id)
		if err == nil && run.Status == status {
			return run
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("run %s did not reach %s", id, status)
	return store.AssistantRun{}
}
func TestConversationLifecycleAndRequestRecovery(t *testing.T) {
	var calls atomic.Int32
	release := make(chan struct{})
	s, h := testService(t, func(ctx context.Context, messages []store.AssistantMessage) (string, error) {
		calls.Add(1)
		select {
		case <-release:
			return "Plan the frontend and backend workspace.", nil
		case <-ctx.Done():
			return "", ctx.Err()
		}
	})
	request(t, h, "POST", "/api/assistant/conversations", `{"id":"yolu-one"}`, 201)
	request(t, h, "POST", "/api/assistant/conversations", `{"id":"yolu-two"}`, 201)
	request(t, h, "POST", "/api/assistant/conversations", `{"id":"yolu-one"}`, 201)
	base := "/api/assistant/conversations/yolu-one"
	request(t, h, "POST", base+"/runs", `{"request_id":"send-one","text":"Plan my work"}`, 202)
	request(t, h, "POST", base+"/runs", `{"request_id":"send-one","text":"Plan my work"}`, 200)
	request(t, h, "POST", base+"/runs", `{"request_id":"send-one","text":"Changed text"}`, 409)
	request(t, h, "POST", base+"/runs", `{"request_id":"send-two","text":"Concurrent text"}`, 409)
	close(release)
	waitRun(t, s, "send-one", "completed")
	request(t, h, "POST", base+"/runs", `{"request_id":"send-one","text":"Plan my work"}`, 200)
	if calls.Load() != 1 {
		t.Fatalf("provider called %d times", calls.Load())
	}
	var snapshot struct {
		Messages []store.AssistantMessage `json:"messages"`
		Run      store.AssistantRun       `json:"run"`
	}
	json.Unmarshal(request(t, h, "GET", base, "", 200), &snapshot)
	if len(snapshot.Messages) != 2 || snapshot.Run.Status != "completed" {
		t.Fatalf("snapshot %+v", snapshot)
	}
	var conversations []store.AssistantConversation
	json.Unmarshal(request(t, h, "GET", "/api/assistant/conversations", "", 200), &conversations)
	if len(conversations) != 2 || conversations[0].Kind != "yolu" || conversations[0].Environment != "local" {
		t.Fatalf("conversations %+v", conversations)
	}
	var native int
	if err := s.store.DB.QueryRow(`SELECT count(*) FROM sessions`).Scan(&native); err != nil || native != 0 {
		t.Fatalf("native sessions changed: %d %v", native, err)
	}
	request(t, h, "GET", base+"?before=invalid", "", 400)
	request(t, h, "POST", "/api/assistant/conversations/missing/runs", `{"request_id":"send-one","text":"test"}`, 404)
}
func TestProviderFailureIsRedactedAndStopIsDurable(t *testing.T) {
	s, h := testService(t, func(context.Context, []store.AssistantMessage) (string, error) {
		return "", errors.New("sensitive-provider-value")
	})
	request(t, h, "POST", "/api/assistant/conversations", `{"id":"yolu-one"}`, 201)
	base := "/api/assistant/conversations/yolu-one"
	request(t, h, "POST", base+"/runs", `{"request_id":"failed","text":"Hello"}`, 202)
	run := waitRun(t, s, "failed", "failed")
	if run.Error != "codex_unavailable" {
		t.Fatalf("run %+v", run)
	}
	raw := request(t, h, "GET", base, "", 200)
	if strings.Contains(string(raw), "sensitive-provider-value") {
		t.Fatal("provider detail leaked")
	}
	s.provider = func(ctx context.Context, _ []store.AssistantMessage) (string, error) {
		<-ctx.Done()
		return "", ctx.Err()
	}
	request(t, h, "POST", base+"/runs", `{"request_id":"stopped","text":"Next"}`, 202)
	request(t, h, "POST", base+"/stop", `{"run_id":"failed"}`, 200)
	if run, err := s.store.AssistantRun("yolu-one", "stopped"); err != nil || run.Status != "running" {
		t.Fatalf("stale stop affected new run: %+v %v", run, err)
	}
	request(t, h, "POST", base+"/stop", `{"run_id":"stopped"}`, 200)
	if run := waitRun(t, s, "stopped", "interrupted"); run.Error != "cancelled" {
		t.Fatalf("run %+v", run)
	}
}

func TestAssistantCapacityAndShutdown(t *testing.T) {
	s, h := testService(t, func(ctx context.Context, _ []store.AssistantMessage) (string, error) {
		<-ctx.Done()
		return "", ctx.Err()
	})
	for i := 0; i < 5; i++ {
		conversation := fmt.Sprintf("conversation-%d", i)
		request(t, h, "POST", "/api/assistant/conversations", fmt.Sprintf(`{"id":%q}`, conversation), 201)
		expected := 202
		if i == 4 {
			expected = 429
		}
		request(t, h, "POST", "/api/assistant/conversations/"+conversation+"/runs", `{"request_id":"run","text":"Hello"}`, expected)
	}
	s.Close()
	for i := 0; i < 4; i++ {
		run, err := s.store.AssistantRun(fmt.Sprintf("conversation-%d", i), "run")
		if err != nil || run.Status != "interrupted" {
			t.Fatalf("shutdown run %+v %v", run, err)
		}
	}
}

func TestAssistantInputByteLimitAcceptsEscapedJSON(t *testing.T) {
	_, handler := testService(t, func(context.Context, []store.AssistantMessage) (string, error) { return "Ready", nil })
	request(t, handler, "POST", "/api/assistant/conversations", `{"id":"limit"}`, 201)
	for _, length := range []int{64000, 64001} {
		body, err := json.Marshal(map[string]string{"request_id": fmt.Sprint(length), "text": strings.Repeat(`"`, length)})
		if err != nil {
			t.Fatal(err)
		}
		expected := 202
		if length > 64000 {
			expected = 400
		}
		request(t, handler, "POST", "/api/assistant/conversations/limit/runs", string(body), expected)
	}
}

func TestSnapshotIncludesActionsFromOlderTranscriptPages(t *testing.T) {
	s, handler := testService(t, nil)
	request(t, handler, "POST", "/api/assistant/conversations", `{"id":"history"}`, 201)
	for i := 0; i < 105; i++ {
		run := fmt.Sprintf("run-%03d", i)
		if _, _, err := s.store.BeginAssistantRun("history", run, "Request"); err != nil {
			t.Fatal(err)
		}
		if err := s.store.FinishAssistantRun("history", run, "completed", "", "Reply"); err != nil {
			t.Fatal(err)
		}
		plan := store.AssistantPlan{ID: run, ConversationID: "history", RunID: run, Status: "succeeded", CreatedAt: int64(i + 1)}
		if err := s.store.CreateAssistantPlan(plan); err != nil {
			t.Fatal(err)
		}
		if err := s.store.AddAssistantActivity("history", run, "project_list", "completed", map[string]any{}); err != nil {
			t.Fatal(err)
		}
	}
	var snapshot struct {
		Messages   []store.AssistantMessage  `json:"messages"`
		Plans      []store.AssistantPlan     `json:"plans"`
		Activities []store.AssistantActivity `json:"activities"`
	}
	base := "/api/assistant/conversations/history"
	if err := json.Unmarshal(request(t, handler, "GET", base, "", 200), &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Plans) != 100 || len(snapshot.Activities) != 100 {
		t.Fatalf("recent snapshot sizes %d %d", len(snapshot.Plans), len(snapshot.Activities))
	}
	if err := json.Unmarshal(request(t, handler, "GET", base+"?before=3", "", 200), &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Messages) != 2 || snapshot.Messages[0].RunID != "run-000" {
		t.Fatalf("incorrect transcript page %+v", snapshot.Messages)
	}
	if len(snapshot.Plans) != 101 || snapshot.Plans[100].RunID != "run-000" {
		t.Fatalf("older plan missing from transcript page %+v", snapshot.Plans)
	}
	if len(snapshot.Activities) != 101 || snapshot.Activities[100].RunID != "run-000" {
		t.Fatalf("older query missing from transcript page %+v", snapshot.Activities)
	}
}
