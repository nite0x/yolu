package assistant

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"worktree-hub/internal/httpx"
	"worktree-hub/internal/model"
	"worktree-hub/internal/store"
)

type Selection struct {
	EnvironmentID string `json:"environment_id,omitempty"`
	WorkspaceID   string `json:"workspace_id,omitempty"`
	ProjectID     string `json:"project_id,omitempty"`
}

type selectionContextKey struct{}
type runContextKey struct{}

func SelectionFromContext(ctx context.Context) Selection {
	selection, _ := ctx.Value(selectionContextKey{}).(Selection)
	return selection
}

// Configure binds application-owned services without introducing reverse package dependencies.
func (s *Service) Configure(registry *Registry, readOnly func() bool) error {
	s.registry, s.readOnly = registry, readOnly
	return registry.Register(Capability{Name: "assistant_plan_status", Description: "Read this assistant conversation's recent proposed and approved plans, actual resource outcomes and interruption state. Query before referring to a previous action's outcome.", InputSchema: map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}, Read: func(ctx context.Context, _ json.RawMessage) (any, error) {
		run, ok := ctx.Value(runContextKey{}).(store.AssistantRun)
		if !ok {
			return nil, &CapabilityError{Code: "permission_denied", Message: "当前请求缺少助手会话身份。"}
		}
		plans, err := s.store.AssistantPlans(run.ConversationID)
		if err != nil {
			return nil, err
		}
		summaries := []map[string]any{}
		resources := []Resource{}
		seen := map[string]bool{}
		for _, p := range plans[:min(len(plans), 15)] {
			summaries = append(summaries, map[string]any{"id": p.ID, "capability": p.Capability, "status": p.Status, "resources": p.Resources, "error": p.Error, "error_code": p.ErrorCode})
			for _, resource := range p.Resources {
				key := resource.EnvironmentID + "\x00" + resource.Kind + "\x00" + resource.ID
				if !seen[key] {
					seen[key] = true
					resources = append(resources, resource)
				}
			}
		}
		return map[string]any{"data": summaries, "resources": resources}, nil
	}})
}

func (s *Service) isReadOnly() bool { return s.readOnly != nil && s.readOnly() }

func domainError(err error) *CapabilityError {
	var e *CapabilityError
	if errors.As(err, &e) {
		return e
	}
	return &CapabilityError{Code: "operation_failed", Message: "应用操作失败，请刷新资源并检查当前状态。"}
}

func (s *Service) invoke(ctx context.Context, run store.AssistantRun, name string, args json.RawMessage) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	c, canonical, err := s.registry.Validate(name, args)
	var result any
	if err == nil && c.Mutation {
		if s.isReadOnly() {
			err = &CapabilityError{Code: "permission_denied", Message: "当前应用处于只读模式。"}
		} else {
			result, err = s.propose(ctx, run, c, canonical)
		}
	} else if err == nil {
		result, err = c.Read(ctx, canonical)
		if err == nil {
			result = withFreshness(result)
		}
	}
	status := "completed"
	if err != nil {
		status = "failed"
		result = map[string]any{"error": domainError(err)}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	activityResult := compactToolResult(result)
	encoded, encodeErr := json.Marshal(activityResult)
	if encodeErr != nil {
		return nil, encodeErr
	}
	if len(encoded) > maxToolBytes {
		result = map[string]any{"error": &CapabilityError{Code: "result_too_large", Message: "结果过多，请缩小查询范围或减少每页数量。"}}
		activityResult = result
		status = "failed"
	}
	if saveErr := s.store.AddAssistantActivity(run.ConversationID, run.ID, name, status, activityResult); saveErr != nil {
		return nil, saveErr
	}
	return result, nil
}

func compactToolResult(result any) any {
	if p, ok := result.(store.AssistantPlan); ok {
		var review struct {
			Operation struct {
				Requirement model.Requirement `json:"requirement"`
				Project     model.Project     `json:"project"`
				Added       []model.Member    `json:"added"`
			} `json:"operation"`
		}
		_ = json.Unmarshal(p.Review, &review)
		target := review.Operation.Requirement
		return map[string]any{"plan_id": p.ID, "revision": p.Revision, "status": p.Status, "capability": p.Capability, "environment_id": p.EnvironmentID, "review_summary": map[string]any{"workspace_name": target.Name, "workspace_path": target.Path, "project_name": review.Operation.Project.Name, "project_path": review.Operation.Project.Path, "project_count": len(target.Members), "added_project_count": len(review.Operation.Added)}, "message": "请在应用中审核计划并确认后执行。"}
	}
	return result
}

func (s *Service) propose(ctx context.Context, run store.AssistantRun, c Capability, args json.RawMessage) (store.AssistantPlan, error) {
	var p store.AssistantPlan
	review, err := c.Review(ctx, args)
	if err != nil {
		return p, err
	}
	if err := ctx.Err(); err != nil {
		return p, err
	}
	raw, err := json.Marshal(review)
	if err != nil {
		return p, err
	}
	var target struct {
		EnvironmentID string `json:"environment_id"`
	}
	if err := json.Unmarshal(args, &target); err != nil {
		return p, err
	}
	if target.EnvironmentID == "" {
		target.EnvironmentID = "local"
	}
	stamp := time.Now().UnixMilli()
	steps := []store.AssistantStep{{ID: "execute", Label: c.Name, Status: "pending"}}
	var members struct {
		Operation struct {
			Requirement struct {
				Members []model.Member `json:"members"`
			} `json:"requirement"`
			Added []model.Member `json:"added"`
		} `json:"operation"`
	}
	if json.Unmarshal(raw, &members) == nil {
		selected := members.Operation.Requirement.Members
		if members.Operation.Added != nil {
			selected = members.Operation.Added
		}
		for _, m := range selected {
			steps = append(steps, store.AssistantStep{ID: m.ProjectID, Label: m.ProjectName, Status: "pending"})
		}
	}
	p = store.AssistantPlan{ID: model.NewID(), ConversationID: run.ConversationID, RunID: run.ID, Revision: 1, EnvironmentID: target.EnvironmentID, Capability: c.Name, Arguments: args, Review: raw, Status: "pending", Steps: steps, Resources: []Resource{}, CreatedAt: stamp, UpdatedAt: stamp}
	p.Digest = planDigest(p)
	if err := ctx.Err(); err != nil {
		return p, err
	}
	return p, s.store.CreateAssistantPlan(p)
}

func planDigest(p store.AssistantPlan) string {
	raw, _ := json.Marshal(struct {
		ID           string
		Conversation string
		Environment  string
		Revision     int
		Capability   string
		Arguments    json.RawMessage
		Review       json.RawMessage
	}{p.ID, p.ConversationID, p.EnvironmentID, p.Revision, p.Capability, p.Arguments, p.Review})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func (s *Service) capabilities(w http.ResponseWriter, r *http.Request) {
	if s.registry == nil {
		httpx.WriteJSON(w, 200, []Capability{})
		return
	}
	httpx.WriteJSON(w, 200, s.registry.Definitions())
}

func (s *Service) resource(w http.ResponseWriter, r *http.Request) {
	if s.registry == nil {
		httpx.WriteError(w, 404, "应用能力尚未连接")
		return
	}
	raw, _ := json.Marshal(map[string]string{"kind": r.PathValue("kind"), "id": r.PathValue("resource"), "environment_id": r.URL.Query().Get("environment_id")})
	c, canonical, err := s.registry.Validate("app_navigate", raw)
	if err == nil {
		var result any
		result, err = c.Read(r.Context(), canonical)
		if err == nil {
			httpx.WriteJSON(w, 200, result)
			return
		}
	}
	httpx.WriteError(w, 404, domainError(err).Message)
}

func (s *Service) decision(w http.ResponseWriter, r *http.Request) {
	if s.registry == nil || s.isReadOnly() {
		httpx.WriteError(w, 403, "当前应用无法执行助手操作")
		return
	}
	var input struct {
		Decision  string `json:"decision"`
		Revision  int    `json:"revision"`
		Digest    string `json:"digest"`
		RequestID string `json:"request_id"`
	}
	if !httpx.Decode(w, r, &input) {
		return
	}
	if !validID(input.RequestID) || input.Revision < 1 || len(input.Digest) != 64 || (input.Decision != "approve" && input.Decision != "cancel") {
		httpx.WriteError(w, 400, "操作确认参数无效")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closing {
		httpx.WriteError(w, 503, "后台正在退出")
		return
	}
	conversation, id := r.PathValue("conversation"), r.PathValue("plan")
	before, err := s.store.AssistantPlan(conversation, id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, 404, "操作计划不存在")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if planDigest(before) != before.Digest {
		httpx.WriteError(w, 409, "操作计划内容已变化，请重新生成计划")
		return
	}
	if input.Decision == "approve" && before.Status == "pending" && len(s.plans) >= 4 {
		httpx.WriteError(w, 429, "助手正在执行多个操作，请稍后重试")
		return
	}
	bound, _ := json.Marshal([]any{id, input.Revision, input.Digest, input.Decision})
	sum := sha256.Sum256(bound)
	p, changed, err := s.store.DecideAssistantPlan(conversation, id, input.RequestID, hex.EncodeToString(sum[:]), input.Decision, input.Digest, input.Revision)
	if errors.Is(err, store.ErrAssistantConflict) {
		httpx.WriteError(w, 409, "计划已处理或确认内容不匹配，请刷新并检查当前结果")
		return
	}
	if err != nil {
		httpx.DbError(w, err)
		return
	}
	if changed && input.Decision == "approve" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		s.plans[id] = cancel
		s.workers.Add(1)
		go s.executePlan(ctx, cancel, p)
	}
	if changed && input.Decision == "cancel" {
		if cancel := s.plans[id]; cancel != nil {
			cancel()
		}
	}
	httpx.WriteJSON(w, 202, p)
}

func (s *Service) executePlan(ctx context.Context, cancel context.CancelFunc, p store.AssistantPlan) {
	p.Steps = append([]store.AssistantStep(nil), p.Steps...)
	defer s.workers.Done()
	defer cancel()
	c, ok := s.registry.capabilities[p.Capability]
	var result ExecutionResult
	var err error
	stopProgress := func() {}
	if ok && c.Progress != nil {
		stopProgress = s.trackPlanProgress(ctx, p, c)
	}
	if ctx.Err() != nil {
		err = ctx.Err()
	} else if !ok || !c.Mutation || s.isReadOnly() {
		err = &CapabilityError{Code: "permission_denied", Message: "当前应用无法执行已确认的操作。"}
	} else {
		result, err = c.Execute(ctx, p.Review)
	}
	stopProgress()
	// Reconcile after failure/cancellation because a domain operation may have
	// persisted resources before reporting an interrupted filesystem preparation.
	if err != nil && ok && c.Reconcile != nil {
		recoveryCtx, end := context.WithTimeout(context.Background(), 15*time.Second)
		known, found, recoveryErr := c.Reconcile(recoveryCtx, p.Review)
		end()
		if recoveryErr == nil && found {
			result = known
			err = nil
		}
	}
	p.Status = "succeeded"
	if result.Status != "" {
		p.Status = result.Status
	}
	p.Resources = result.Resources
	if p.Resources == nil {
		p.Resources = []Resource{}
	}
	if err != nil {
		e := domainError(err)
		p.Status, p.ErrorCode, p.Error = "failed", e.Code, e.Message
		if len(e.Details) > 0 {
			p.Error += "\n" + strings.Join(e.Details, "\n")
		}
		if e.Code == "operation_failed" {
			p.Status = "unknown"
		}
		if e.Code == "stale_plan" {
			p.Status = "conflict"
		}
		if errors.Is(ctx.Err(), context.Canceled) {
			p.Status, p.ErrorCode, p.Error = "unknown", "cancelled", "操作已停止，请核对实际资源状态后继续。"
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			p.Status, p.ErrorCode, p.Error = "unknown", "timeout", "执行超时，请核对实际资源状态后继续。"
		}
	}
	if len(p.Steps) > 0 {
		if len(result.Steps) > 0 {
			p.Steps = append(p.Steps[:1], result.Steps...)
		}
		p.Steps[0].Status = p.Status
		p.Steps[0].Error = p.Error
		p.Steps[0].Result, _ = json.Marshal(result.Data)
		for i := 1; i < len(p.Steps); i++ {
			if p.Steps[i].Status == "pending" || p.Steps[i].Status == "running" {
				p.Steps[i].Status = p.Status
			}
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.store.UpdateAssistantPlan(p); err != nil {
		log.Printf("assistant plan persistence failed: %v", err)
	}
	delete(s.plans, p.ID)
}

// Domain member rows are the authoritative progress source. Persist their
// observed states while Git preparation runs, so reconnects retain the journal.
func (s *Service) trackPlanProgress(ctx context.Context, p store.AssistantPlan, c Capability) func() {
	p.Steps = append([]store.AssistantStep(nil), p.Steps...)
	progressCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(300 * time.Millisecond)
		defer ticker.Stop()
		previous := ""
		for {
			select {
			case <-progressCtx.Done():
				return
			case <-ticker.C:
				result, found, err := c.Progress(progressCtx, p.Review)
				if err != nil || !found || progressCtx.Err() != nil {
					continue
				}
				p.Resources = result.Resources
				if len(p.Steps) > 0 && len(result.Steps) > 0 {
					p.Steps = append(p.Steps[:1], result.Steps...)
				}
				raw, _ := json.Marshal(p)
				if string(raw) == previous {
					continue
				}
				s.mu.Lock()
				current, err := s.store.AssistantPlan(p.ConversationID, p.ID)
				if err == nil && current.Status == "running" {
					err = s.store.UpdateAssistantPlan(p)
				}
				s.mu.Unlock()
				if err != nil {
					log.Printf("assistant progress persistence failed: %v", err)
				} else {
					previous = string(raw)
				}
			}
		}
	}()
	return func() { cancel(); <-done }
}

func (s *Service) reconcile(w http.ResponseWriter, r *http.Request) {
	if s.registry == nil {
		httpx.WriteError(w, 404, "应用能力尚未连接")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.store.AssistantPlan(r.PathValue("conversation"), r.PathValue("plan"))
	if err != nil {
		httpx.WriteError(w, 404, "操作计划不存在")
		return
	}
	if p.Status != "unknown" {
		httpx.WriteJSON(w, 200, p)
		return
	}
	c, ok := s.registry.capabilities[p.Capability]
	if !ok || c.Reconcile == nil {
		httpx.WriteError(w, 409, "请打开实际工作区核对执行结果")
		return
	}
	ctx, end := context.WithTimeout(r.Context(), 15*time.Second)
	defer end()
	result, found, err := c.Reconcile(ctx, p.Review)
	if err != nil {
		httpx.WriteError(w, 409, domainError(err).Message)
		return
	}
	if found {
		p.Status, p.Error, p.ErrorCode, p.Resources = result.Status, "", "", result.Resources
		if p.Status == "" {
			p.Status = "succeeded"
		}
		if len(p.Steps) > 0 {
			if len(result.Steps) > 0 {
				p.Steps = append(p.Steps[:1], result.Steps...)
			}
			p.Steps[0].Status = p.Status
			p.Steps[0].Result, _ = json.Marshal(result.Data)
			p.Steps[0].Error = ""
		}
		if err := s.store.UpdateAssistantPlan(p); err != nil {
			httpx.DbError(w, err)
			return
		}
	}
	httpx.WriteJSON(w, 200, p)
}
