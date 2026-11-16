// Package assistant owns application-local management conversations independently
// of native directory-scoped coding sessions.
package assistant

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/store"
)

type activeRun struct {
	id     string
	cancel context.CancelFunc
}
type Service struct {
	store    *store.Store
	provider Provider
	mu       sync.Mutex
	active   map[string]activeRun
	closing  bool
	workers  sync.WaitGroup
}

func New(db *store.Store, cwd string) *Service {
	return &Service{store: db, provider: codexProvider(cwd, codex.OpenLive), active: map[string]activeRun{}}
}
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/assistant/conversations", s.list)
	mux.HandleFunc("POST /api/assistant/conversations", s.create)
	mux.HandleFunc("GET /api/assistant/conversations/{conversation}", s.snapshot)
	mux.HandleFunc("POST /api/assistant/conversations/{conversation}/runs", s.send)
	mux.HandleFunc("POST /api/assistant/conversations/{conversation}/stop", s.stop)
}
func (s *Service) Close() {
	s.mu.Lock()
	s.closing = true
	for _, run := range s.active {
		run.cancel()
	}
	s.mu.Unlock()
	s.workers.Wait()
}
func validID(id string) bool {
	if len(id) < 1 || len(id) > 100 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	records, err := s.store.AssistantConversations()
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, records)
}
func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID string `json:"id"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	if !validID(input.ID) {
		httpx.WriteError(w, 400, "助手会话标识无效")
		return
	}
	if err := s.store.CreateAssistant(input.ID); err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 201, map[string]string{"id": input.ID, "kind": "yolu", "environment_id": "local"})
}
func (s *Service) snapshot(w http.ResponseWriter, r *http.Request) {
	before, err := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	if r.URL.Query().Get("before") == "" {
		before = 0
		err = nil
	}
	if err != nil || before < 0 {
		httpx.WriteError(w, 400, "助手历史游标无效")
		return
	}
	messages, err := s.store.AssistantMessages(r.PathValue("conversation"), before, 51)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "助手会话不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	cursor := int64(0)
	if len(messages) > 50 {
		messages = messages[1:]
		cursor = messages[0].ID
	}
	run, err := s.store.LatestAssistantRun(r.PathValue("conversation"))
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"messages": messages, "run": run, "before": cursor})
}
func (s *Service) send(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID   string `json:"request_id"`
		Text string `json:"text"`
	}
	if !httpx.DecodeLimit(w, r, &input, 400000) {
		return
	}
	input.Text = strings.TrimSpace(input.Text)
	if !validID(input.ID) || input.Text == "" || len(input.Text) > 64000 {
		httpx.WriteError(w, 400, "请输入消息（最多 64000 字节）并提供发送标识")
		return
	}
	conversation := r.PathValue("conversation")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		httpx.WriteError(w, 503, "后台正在退出，请稍后重新打开应用")
		return
	}
	// Confirm durable retries even when the global concurrency limit is reached.
	old, err := s.store.AssistantRun(conversation, input.ID)
	if err == nil {
		if old.Input != input.Text {
			httpx.WriteError(w, 409, "助手发送标识已用于另一条消息")
			return
		}
		httpx.WriteJSON(w, 200, old)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		httpx.DbError(w, err)
		return
	}
	if len(s.active) >= 4 {
		httpx.WriteError(w, 429, "助手正在处理多个会话，请稍后重试")
		return
	}
	if _, err := s.store.AssistantMessages(conversation, 0, 1); errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "助手会话不存在")
		return
	} else if err != nil {
		httpx.DbError(w, err)
		return
	}
	run, created, err := s.store.BeginAssistantRun(conversation, input.ID, input.Text)
	if errors.Is(err, store.ErrAssistantConflict) {
		httpx.WriteError(w, 409, "助手会话正在运行，请等待完成或停止后再发送")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if created {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		s.active[conversation] = activeRun{id: input.ID, cancel: cancel}
		s.workers.Add(1)
		go s.drive(ctx, cancel, run)
	}
	httpx.WriteJSON(w, 202, run)
}
func (s *Service) drive(ctx context.Context, cancel context.CancelFunc, run store.AssistantRun) {
	defer s.workers.Done()
	defer cancel()
	messages, err := s.store.AssistantMessages(run.ConversationID, 0, 100)
	output := ""
	if err == nil {
		output, err = s.provider(ctx, messages)
	}
	status, code := "completed", ""
	if err != nil {
		status, code = "failed", "codex_unavailable"
		if errors.Is(ctx.Err(), context.Canceled) {
			status, code = "interrupted", "cancelled"
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			code = "timeout"
		}
	}
	// Only stable error codes cross the API or enter transcripts. Provider errors
	// can contain local configuration values and must not be echoed to the client.
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.store.FinishAssistantRun(run.ConversationID, run.ID, status, code, output); err != nil {
		log.Printf("assistant result persistence failed: %v", err)
	}
	delete(s.active, run.ConversationID)
}
func (s *Service) stop(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID string `json:"run_id"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.store.AssistantRun(r.PathValue("conversation"), input.ID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "助手运行不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if active, ok := s.active[run.ConversationID]; ok && active.id == run.ID {
		active.cancel()
	}
	httpx.WriteJSON(w, 200, run)
}
