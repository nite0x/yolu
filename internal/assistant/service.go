// Package assistant owns application-local management conversations independently
// of native directory-scoped coding sessions.
package assistant

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/store"
)

type activeRun struct {
	id     string
	cancel context.CancelFunc
}

type runOptions struct {
	Selection
	model.AssistantSettings
}

type settingsContextKey struct{}

func settingsFromContext(ctx context.Context) model.AssistantSettings {
	settings, _ := ctx.Value(settingsContextKey{}).(model.AssistantSettings)
	return settings
}

type Service struct {
	store    *store.Store
	provider Provider
	mu       sync.Mutex
	active   map[string]activeRun
	closing  bool
	workers  sync.WaitGroup
	registry *Registry
	readOnly func() bool
	plans    map[string]context.CancelFunc
}

func New(db *store.Store, cwd string) *Service {
	return &Service{store: db, provider: codexProvider(cwd, codex.OpenLive), active: map[string]activeRun{}, plans: map[string]context.CancelFunc{}}
}
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/assistant/conversations", s.list)
	mux.HandleFunc("POST /api/assistant/conversations", s.create)
	mux.HandleFunc("GET /api/assistant/conversations/{conversation}", s.snapshot)
	mux.HandleFunc("POST /api/assistant/conversations/{conversation}/runs", s.send)
	mux.HandleFunc("POST /api/assistant/conversations/{conversation}/stop", s.stop)
	mux.HandleFunc("GET /api/assistant/capabilities", s.capabilities)
	mux.HandleFunc("GET /api/assistant/resources/{kind}/{resource}", s.resource)
	mux.HandleFunc("POST /api/assistant/conversations/{conversation}/plans/{plan}/decision", s.decision)
	mux.HandleFunc("POST /api/assistant/conversations/{conversation}/plans/{plan}/reconcile", s.reconcile)
}
func (s *Service) Close() {
	s.mu.Lock()
	s.closing = true
	for _, run := range s.active {
		run.cancel()
	}
	for _, cancel := range s.plans {
		cancel()
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
	runs := make([]string, 0, len(messages))
	for _, message := range messages {
		if len(runs) == 0 || runs[len(runs)-1] != message.RunID {
			runs = append(runs, message.RunID)
		}
	}
	planIDs := r.URL.Query()["plan_id"]
	if len(planIDs) > 100 {
		httpx.WriteError(w, 400, "请求的计划过多")
		return
	}
	plans, err := s.store.AssistantPlansForSnapshot(r.PathValue("conversation"), runs, planIDs)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	activities, err := s.store.AssistantActivities(r.PathValue("conversation"), runs...)
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	httpx.WriteJSON(w, 200, map[string]any{"messages": messages, "run": run, "before": cursor, "plans": plans, "activities": activities})
}
func (s *Service) send(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ID       string                  `json:"request_id"`
		Text     string                  `json:"text"`
		Context  Selection               `json:"context"`
		Settings model.AssistantSettings `json:"settings"`
	}
	if !httpx.DecodeLimit(w, r, &input, 400000) {
		return
	}
	input.Text = strings.TrimSpace(input.Text)
	if !validID(input.ID) || input.Text == "" || len(input.Text) > 64000 {
		httpx.WriteError(w, 400, "请输入消息（最多 64000 字节）并提供发送标识")
		return
	}
	if err := input.Settings.Validate(); err != nil {
		httpx.WriteError(w, 400, err.Error())
		return
	}
	conversation := r.PathValue("conversation")
	options, _ := json.Marshal(runOptions{Selection: input.Context, AssistantSettings: input.Settings})
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		httpx.WriteError(w, 503, "后台正在退出，请稍后重新打开应用")
		return
	}
	// Confirm durable retries even when the global concurrency limit is reached.
	old, err := s.store.AssistantRun(conversation, input.ID)
	if err == nil {
		previous, contextErr := s.store.AssistantRunContext(conversation, input.ID)
		if contextErr != nil {
			httpx.DbError(w, contextErr)
			return
		}
		if old.Input != input.Text || string(previous) != string(options) {
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
	// Selection is a hint. Resource and environment checks belong to tool calls,
	// so a stale selection cannot prevent unrelated application queries.
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
	run, created, err := s.store.BeginAssistantRun(conversation, input.ID, input.Text, options)
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
		var raw json.RawMessage
		raw, err = s.store.AssistantRunContext(run.ConversationID, run.ID)
		var options runOptions
		if err == nil {
			err = json.Unmarshal(raw, &options)
		}
		if err == nil {
			ctx = context.WithValue(ctx, settingsContextKey{}, options.AssistantSettings)
			if s.registry != nil {
				ctx = context.WithValue(ctx, selectionContextKey{}, options.Selection)
				ctx = context.WithValue(ctx, runContextKey{}, run)
				onlyQueries := s.isReadOnly() || options.Permission == model.AssistantQueryOnly
				ctx = WithTools(ctx, s.registry.Tools(onlyQueries), func(toolCtx context.Context, name string, args json.RawMessage) (any, error) {
					result, err := s.invoke(toolCtx, run, name, args)
					return compactToolResult(result), err
				})
			}
		}
	}
	if err == nil {
		output, err = s.provider(ctx, messages)
	}
	status, code := "completed", ""
	if err != nil {
		status, code = "failed", "codex_unavailable"
		if errors.Is(err, errAssistantModelUnavailable) {
			code = "model_unavailable"
		}
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
