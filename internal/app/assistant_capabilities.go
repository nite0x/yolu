package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"worktree-hub/internal/assistant"
	"worktree-hub/internal/execution"
	"worktree-hub/internal/model"
	"worktree-hub/internal/project"
	"worktree-hub/internal/session"
	"worktree-hub/internal/store"
	"worktree-hub/internal/workspace"
)

func assistantString() map[string]any { return map[string]any{"type": "string", "maxLength": 4096} }
func assistantSchema(properties map[string]any, required ...string) map[string]any {
	schema := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}
func assistantFailure(code, message string) error {
	return &assistant.CapabilityError{Code: code, Message: message}
}

func (a *App) withAssistantEnvironment(ctx context.Context, id string, connect bool, call func(context.Context, *App) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if a.Execution.Closing.Load() {
		return assistantFailure("environment_unavailable", "执行环境正在退出，请稍后重新打开应用。")
	}
	if id == "" || id == "local" {
		a.assistantUse.RLock()
		defer a.assistantUse.RUnlock()
		if a.Execution.Closing.Load() {
			return assistantFailure("environment_unavailable", "执行环境正在退出，请稍后重新打开应用。")
		}
		return call(ctx, a)
	}
	h := a.environments
	if h == nil {
		return assistantFailure("environment_unavailable", "执行环境不存在，请重新选择。")
	}
	h.mu.Lock()
	if h.local.Execution.Closing.Load() {
		h.mu.Unlock()
		return assistantFailure("environment_unavailable", "执行环境正在退出，请稍后重新打开应用。")
	}
	var entry *Environment
	for i := range h.entries {
		if h.entries[i].ID == id {
			entry = &h.entries[i]
			break
		}
	}
	if entry == nil {
		h.mu.Unlock()
		return assistantFailure("environment_unavailable", "执行环境不存在，请重新选择。")
	}
	env := h.apps[id]
	if env == nil && connect {
		var err error
		env, err = h.connectLocked(*entry)
		if err != nil {
			h.mu.Unlock()
			return assistantFailure("environment_unavailable", "执行环境暂时无法连接，请在设置中检查连接。")
		}
	}
	if env == nil {
		h.mu.Unlock()
		return assistantFailure("environment_unavailable", "执行环境尚未连接，当前结果不包含该环境。")
	}
	// Capture a lifetime lease while the hub still owns this app. Never wait
	// for teardown with the hub mutex held: active callbacks can query the hub.
	if env.Execution.Closing.Load() || !env.assistantUse.TryRLock() {
		h.mu.Unlock()
		return assistantFailure("environment_unavailable", "执行环境正在退出，请稍后重新连接。")
	}
	h.mu.Unlock()
	defer env.assistantUse.RUnlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if env.Execution.Closing.Load() {
		return assistantFailure("environment_unavailable", "执行环境正在退出，请稍后重新连接。")
	}
	if env.Execution.Remote != nil {
		select {
		case <-env.Execution.Remote.Done():
			return assistantFailure("environment_unavailable", "执行环境已断开，请重新连接。")
		default:
			ctx = execution.WithClient(ctx, env.Execution.Remote)
		}
	}
	return call(ctx, env)
}

func (a *App) assistantEnvironmentIDs() []string {
	ids := []string{"local"}
	if h := a.environments; h != nil {
		h.mu.Lock()
		for _, entry := range h.entries {
			ids = append(ids, entry.ID)
		}
		h.mu.Unlock()
	}
	sort.Strings(ids)
	return ids
}

type assistantQuery struct {
	EnvironmentID string `json:"environment_id"`
	ID            string `json:"id"`
	Query         string `json:"query"`
	Cursor        string `json:"cursor"`
	Limit         int    `json:"limit"`
	Kind          string `json:"kind"`
}

func (q assistantQuery) page(total int) (start, end int, next string) {
	start, _ = strconv.Atoi(q.Cursor)
	start = min(start, total)
	limit := q.Limit
	if limit == 0 {
		limit = 15
	}
	end = min(start+limit, total)
	if end < total {
		next = strconv.Itoa(end)
	}
	return
}

func assistantResource(kind, env, id, name, path string) assistant.Resource {
	return assistant.Resource{Kind: kind, EnvironmentID: env, ID: id, Name: name, Path: path}
}

func (a *App) assistantTarget(ctx context.Context, q assistantQuery) (assistant.Resource, error) {
	var resource assistant.Resource
	if q.EnvironmentID == "" {
		q.EnvironmentID = "local"
	}
	err := a.withAssistantEnvironment(ctx, q.EnvironmentID, true, func(ctx context.Context, env *App) error {
		switch q.Kind {
		case "project":
			projects, err := env.Execution.Store.ProjectMap()
			if err != nil {
				return err
			}
			p, exists := projects[q.ID]
			if !exists {
				return sql.ErrNoRows
			}
			resource = assistantResource(q.Kind, q.EnvironmentID, p.ID, p.Name, p.Path)
		case "workspace":
			w, err := env.Execution.Store.Workspace(q.ID)
			if err != nil {
				return err
			}
			resource = assistantResource(q.Kind, q.EnvironmentID, w.ID, w.Name, w.Path)
		case "conversation":
			s, err := env.Execution.Store.Session(q.ID)
			if err != nil {
				return err
			}
			resource = assistantResource(q.Kind, q.EnvironmentID, s.ID, s.Name, s.Cwd)
		default:
			return assistantFailure("invalid_target", "请选择工作区、项目或已有对话。")
		}
		return nil
	})
	if errors.Is(err, sql.ErrNoRows) {
		err = assistantFailure("resource_not_found", "目标资源不存在，请重新查询后选择。")
	}
	return resource, err
}

func (a *App) assistantContext(ctx context.Context, raw json.RawMessage) (any, error) {
	selection := assistant.SelectionFromContext(ctx)
	if string(raw) != "{}" {
		if err := json.Unmarshal(raw, &selection); err != nil {
			return nil, err
		}
	}
	if selection.EnvironmentID == "" {
		selection.EnvironmentID = "local"
	}
	resources := []assistant.Resource{}
	for _, target := range []assistantQuery{{Kind: "project", ID: selection.ProjectID, EnvironmentID: selection.EnvironmentID}, {Kind: "workspace", ID: selection.WorkspaceID, EnvironmentID: selection.EnvironmentID}} {
		if target.ID == "" {
			continue
		}
		resource, err := a.assistantTarget(ctx, target)
		if err != nil {
			return nil, err
		}
		resources = append(resources, resource)
	}
	var root string
	err := a.withAssistantEnvironment(ctx, selection.EnvironmentID, true, func(_ context.Context, env *App) error { root = env.Execution.Root; return nil })
	return map[string]any{"selection": selection, "root": root, "resources": resources, "environments": a.assistantEnvironmentIDs()}, err
}

func querySchema() map[string]any {
	return assistantSchema(map[string]any{"environment_id": assistantString(), "query": assistantString(), "cursor": map[string]any{"type": "string", "pattern": "^[0-9]{0,9}$"}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 30}})
}

func (a *App) assistantList(ctx context.Context, kind string, raw json.RawMessage) (any, error) {
	var q assistantQuery
	if err := json.Unmarshal(raw, &q); err != nil {
		return nil, err
	}
	if q.EnvironmentID == "" {
		q.EnvironmentID = "local"
	}
	ids := []string{q.EnvironmentID}
	if q.EnvironmentID == "all" {
		ids = a.assistantEnvironmentIDs()
	}
	resources := []assistant.Resource{}
	items := []any{}
	problems := []map[string]string{}
	needle := strings.ToLower(q.Query)
	for _, id := range ids {
		err := a.withAssistantEnvironment(ctx, id, q.EnvironmentID != "all", func(queryCtx context.Context, env *App) error {
			appendItem := func(r assistant.Resource, data any) {
				if needle == "" || strings.Contains(strings.ToLower(r.Name+" "+r.ID+" "+r.Path), needle) {
					resources = append(resources, r)
					items = append(items, data)
				}
			}
			switch kind {
			case "project":
				projects, err := env.Execution.Store.Projects()
				if err != nil {
					return err
				}
				for _, p := range projects {
					appendItem(assistantResource(kind, id, p.ID, p.Name, p.Path), map[string]any{"id": p.ID, "name": p.Name, "path": p.Path, "environment_id": id})
				}
			case "workspace":
				workspaces, err := env.Execution.Store.Workspaces()
				if err != nil {
					return err
				}
				for _, w := range workspaces {
					appendItem(assistantResource(kind, id, w.ID, w.Name, w.Path), map[string]any{"id": w.ID, "name": w.Name, "path": w.Path, "state": w.State, "project_count": len(w.Members), "environment_id": id})
				}
			case "conversation":
				if err := env.Sessions.RefreshConversationCatalog(queryCtx); err != nil {
					problems = append(problems, map[string]string{"environment_id": id, "code": "catalog_unavailable", "message": "对话发现暂时失败，当前结果使用已保存的索引，请检查记录的同步时间。"})
				}
				sessions, err := env.Execution.Store.Sessions()
				if err != nil {
					return err
				}
				for _, s := range sessions {
					appendItem(assistantResource(kind, id, s.ID, s.Name, s.Cwd), map[string]any{"id": s.ID, "name": s.Name, "cwd": s.Cwd, "updated_at": s.UpdatedAt, "last_synced_at": s.LastSyncedAt, "archived": s.Archived, "environment_id": id})
				}
			}
			return nil
		})
		if err != nil {
			problems = append(problems, map[string]string{"environment_id": id, "code": "environment_unavailable", "message": "该环境的资源读取失败，请检查连接后重试。"})
		}
	}
	start, end, next := q.page(len(resources))
	choices := []assistant.Resource{}
	if q.Query != "" && len(resources) > 1 {
		choices = resources[start:end]
	}
	return map[string]any{"resources": resources[start:end], "data": items[start:end], "choices": choices, "errors": problems, "next_cursor": next, "total": len(resources)}, nil
}

func (a *App) assistantScanProjects(ctx context.Context, raw json.RawMessage) (any, error) {
	var input struct {
		assistantQuery
		Path string `json:"path"`
	}
	if err := json.Unmarshal(raw, &input); err != nil {
		return nil, err
	}
	var result map[string]any
	err := a.withAssistantEnvironment(ctx, input.EnvironmentID, true, func(ctx context.Context, env *App) error {
		scan, err := env.Projects.ScanProjects(ctx, input.Path)
		if err != nil {
			return assistantOperationError(err, false)
		}
		matches := []execution.DiscoveredRepository{}
		needle := strings.ToLower(input.Query)
		for _, repo := range scan.Repositories {
			if strings.Contains(strings.ToLower(repo.Name+" "+repo.Path), needle) {
				matches = append(matches, repo)
			}
		}
		start, end, next := input.page(len(matches))
		result = map[string]any{"data": matches[start:end], "total": len(matches), "next_cursor": next, "truncated": scan.Truncated, "warning_count": len(scan.Warnings)}
		return nil
	})
	return result, err
}

func (a *App) assistantDetail(ctx context.Context, kind string, raw json.RawMessage) (any, error) {
	var q assistantQuery
	if err := json.Unmarshal(raw, &q); err != nil {
		return nil, err
	}
	q.Kind = kind
	resource, err := a.assistantTarget(ctx, q)
	if err != nil {
		return nil, err
	}
	var data any
	err = a.withAssistantEnvironment(ctx, resource.EnvironmentID, true, func(ctx context.Context, env *App) error {
		var err error
		if kind == "workspace" {
			data, err = env.Execution.Store.Workspace(q.ID)
		} else {
			data, err = env.Projects.RegisteredProject(ctx, q.ID)
		}
		return err
	})
	return map[string]any{"resources": []assistant.Resource{resource}, "data": data}, err
}

func (a *App) assistantGit(ctx context.Context, raw json.RawMessage) (any, error) {
	var q assistantQuery
	if err := json.Unmarshal(raw, &q); err != nil {
		return nil, err
	}
	q.Kind = "project"
	resource, err := a.assistantTarget(ctx, q)
	if err != nil {
		return nil, err
	}
	var data any
	err = a.withAssistantEnvironment(ctx, resource.EnvironmentID, true, func(ctx context.Context, env *App) error {
		release, err := env.Projects.LockRepositories(ctx, []string{q.ID})
		if err != nil {
			return err
		}
		defer release()
		p, err := env.Projects.RegisteredProject(ctx, q.ID)
		if err != nil {
			return err
		}
		view, err := project.InspectGit(ctx, p)
		if err != nil {
			return assistantFailure("git_unavailable", "无法读取项目 Git 状态，请打开项目检查仓库。")
		}
		start, end, next := q.page(len(view.Project.Worktrees))
		// Remote URLs may contain credentials. Return bounded branch/worktree
		// summaries and omit remotes/configuration from assistant context.
		data = map[string]any{"project_id": p.ID, "worktrees": view.Project.Worktrees[start:end], "branches": view.Branches[:min(len(view.Branches), 50)], "branch_total": len(view.Branches), "next_cursor": next, "refreshed_at": time.Now().UnixMilli()}
		return nil
	})
	return map[string]any{"resources": []assistant.Resource{resource}, "data": data}, err
}

func (a *App) configureAssistant() error {
	r := assistant.NewRegistry()
	add := func(name, description string, schema map[string]any, read func(context.Context, json.RawMessage) (any, error)) error {
		return r.Register(assistant.Capability{Name: name, Description: description, InputSchema: schema, Read: read})
	}
	contextSchema := assistantSchema(map[string]any{"environment_id": assistantString(), "workspace_id": assistantString(), "project_id": assistantString()})
	if err := add("app_get_context", "Read the user-selected environment, workspace and project, plus known execution environments. Omitted arguments use this run's saved selection.", contextSchema, a.assistantContext); err != nil {
		return err
	}
	if err := add("environment_list", "List registered execution environment IDs. Query resources with environment_id=all for partial success across environments.", assistantSchema(map[string]any{}), func(context.Context, json.RawMessage) (any, error) { return a.assistantEnvironmentIDs(), nil }); err != nil {
		return err
	}
	for _, kind := range []string{"project", "workspace", "conversation"} {
		if err := add(kind+"_list", "Find registered "+kind+" resources by name, path or ID. Use query (text), cursor (string returned by a previous page), limit (integer 1–30) and environment_id (local, all or a known environment). Show choices for ambiguous names.", querySchema(), func(ctx context.Context, raw json.RawMessage) (any, error) { return a.assistantList(ctx, kind, raw) }); err != nil {
			return err
		}
	}
	scanProperties := querySchema()["properties"].(map[string]any)
	scanProperties["path"] = assistantString()
	if err := add("project_scan", "Discover Git repositories under a user-specified absolute directory or ~/path in one execution environment. If a directory name alone is ambiguous, ask for the path. Filter by query (name or path), page with cursor and limit (1–30). A project_id identifies a registered repository. For other matches, propose project_register with the returned name and path, then use approved project IDs for workspace_create. Truncated scans or warnings can omit repositories.", assistantSchema(scanProperties, "environment_id", "path"), a.assistantScanProjects); err != nil {
		return err
	}
	idSchema := assistantSchema(map[string]any{"environment_id": assistantString(), "id": assistantString()}, "id")
	for _, kind := range []string{"project", "workspace"} {
		if err := add(kind+"_get", "Read the details of an exact "+kind+" ID in its owning execution environment.", idSchema, func(ctx context.Context, raw json.RawMessage) (any, error) { return a.assistantDetail(ctx, kind, raw) }); err != nil {
			return err
		}
	}
	gitProperties := querySchema()["properties"].(map[string]any)
	gitProperties["id"] = assistantString()
	for _, name := range []string{"git_status", "git_worktree_list"} {
		if err := add(name, "Inspect fresh Git worktrees and branch summaries for a registered project ID. Page worktrees with cursor and limit.", assistantSchema(gitProperties, "id"), a.assistantGit); err != nil {
			return err
		}
	}
	navigate := func(ctx context.Context, raw json.RawMessage) (any, error) {
		var q assistantQuery
		if err := json.Unmarshal(raw, &q); err != nil {
			return nil, err
		}
		return a.assistantTarget(ctx, q)
	}
	if err := add("app_navigate", "Validate a typed target and offer an application-owned button to open its owning environment. Navigation happens when the user clicks the resource.", assistantSchema(map[string]any{"environment_id": assistantString(), "kind": map[string]any{"type": "string", "enum": []string{"project", "workspace", "conversation"}}, "id": assistantString()}, "kind", "id"), navigate); err != nil {
		return err
	}
	if err := add("conversation_open", "Validate an existing native coding conversation and offer its application-owned open button.", idSchema, func(ctx context.Context, raw json.RawMessage) (any, error) {
		var q assistantQuery
		if err := json.Unmarshal(raw, &q); err != nil {
			return nil, err
		}
		q.Kind = "conversation"
		return a.assistantTarget(ctx, q)
	}); err != nil {
		return err
	}
	if err := a.registerAssistantMutations(r); err != nil {
		return err
	}
	return a.Assistant.Configure(r, func() bool { return a.Execution.ReadOnlySessions || a.Execution.Closing.Load() })
}

type assistantReview struct {
	EnvironmentID string          `json:"environment_id"`
	Operation     json.RawMessage `json:"operation"`
}

func reviewedOperation(environment string, operation any) (assistantReview, error) {
	if environment == "" {
		environment = "local"
	}
	raw, err := json.Marshal(operation)
	return assistantReview{EnvironmentID: environment, Operation: raw}, err
}

func assistantOperationError(err error, executing bool) error {
	if err == nil {
		return nil
	}
	var workspaceErr *workspace.OperationError
	var projectErr *project.OperationError
	status, message := 0, ""
	var details []string
	if errors.As(err, &workspaceErr) {
		status, message = workspaceErr.Status, workspaceErr.Message
		details = workspaceErr.Details
	}
	if errors.As(err, &projectErr) {
		status, message = projectErr.Status, projectErr.Message
		details = projectErr.Details
	}
	if status != 0 {
		code := "invalid_input"
		if executing && (status == 400 || status == 404 || status == 409 || status == 422) {
			return &assistant.CapabilityError{Code: "stale_plan", Message: message, Details: details}
		}
		if status == 409 {
			code = "resource_conflict"
			if executing {
				code = "stale_plan"
			}
		}
		if status == 404 {
			code = "resource_not_found"
		}
		return &assistant.CapabilityError{Code: code, Message: message, Details: details}
	}
	var capabilityErr *assistant.CapabilityError
	if errors.As(err, &capabilityErr) {
		return err
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return assistantFailure("operation_failed", "应用操作未完成，请检查已记录的资源状态。")
}

func workspaceExecution(env string, q model.Workspace) assistant.ExecutionResult {
	status := "succeeded"
	if q.State != "ready" || q.ContextWarning != "" {
		status = "partial"
	}
	steps := []store.AssistantStep{}
	for _, m := range q.Members {
		state := m.State
		if state == "ready" {
			state = "succeeded"
		}
		if state == "creating" {
			state = "running"
		}
		steps = append(steps, store.AssistantStep{ID: m.ProjectID, Label: m.ProjectName, Status: state, Error: m.Error})
	}
	return assistant.ExecutionResult{Status: status, Data: q, Resources: []assistant.Resource{assistantResource("workspace", env, q.ID, q.Name, q.Path)}, Steps: steps}
}

func attachmentExecution(env string, q model.Workspace, added []model.Member) assistant.ExecutionResult {
	result := workspaceExecution(env, q)
	selected := map[string]bool{}
	for _, member := range added {
		selected[member.ProjectID] = true
	}
	steps := []store.AssistantStep{}
	for _, step := range result.Steps {
		if selected[step.ID] {
			steps = append(steps, step)
		}
	}
	result.Steps = steps
	return result
}

func (a *App) registerAssistantMutations(r *assistant.Registry) error {
	member := assistantSchema(map[string]any{"project_id": assistantString(), "mode": map[string]any{"type": "string", "enum": []string{"new", "existing", "project", "worktree"}}, "source": assistantString(), "branch": assistantString(), "path": assistantString()}, "project_id", "mode")
	properties := map[string]any{"environment_id": assistantString(), "name": assistantString(), "slug": assistantString(), "description": map[string]any{"type": "string", "maxLength": 20000}, "branch": assistantString(), "primary_project_id": assistantString(), "project_ids": map[string]any{"type": "array", "items": assistantString(), "maxItems": 30}, "members": map[string]any{"type": "array", "items": member, "maxItems": 30}}
	for _, name := range []string{"project_register", "workspace_create", "workspace_attach_project"} {
		schema := assistantSchema(properties, "environment_id", "name")
		if name == "workspace_create" {
			fields := make(map[string]any, len(properties)+1)
			for key, value := range properties {
				fields[key] = value
			}
			fields["first_instruction"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 64000, "description": "The first Codex message. Include it when the user specifies concrete work to carry out in the new workspace. Omit it when the user only wants to prepare the workspace or asks to defer execution."}
			schema = assistantSchema(fields, "environment_id", "name")
		}
		if name == "project_register" {
			schema = assistantSchema(map[string]any{"environment_id": assistantString(), "name": assistantString(), "path": assistantString()}, "environment_id", "path")
		}
		if name == "workspace_attach_project" {
			schema = assistantSchema(map[string]any{"environment_id": assistantString(), "workspace_id": assistantString(), "project_ids": properties["project_ids"], "members": properties["members"]}, "environment_id", "workspace_id")
		}
		c := assistant.Capability{Name: name, Mutation: true, Description: "Prepare a reviewable " + strings.ReplaceAll(name, "_", " ") + " plan using resolved execution-side paths, commits and member modes. This only proposes a plan. Execution requires the user's UI approval. Use registered resource IDs and ask about ambiguous targets.", InputSchema: schema}
		if name == "workspace_create" {
			c.Description += " An optional first_instruction adds a reviewed Codex launch after all participating working directories are ready. Use it for concrete work requested by the user. A workspace name or description alone does not start Codex."
		}
		c.Review = func(ctx context.Context, raw json.RawMessage) (any, error) {
			var input struct {
				EnvironmentID string `json:"environment_id"`
				Name          string `json:"name"`
				Path          string `json:"path"`
				WorkspaceID   string `json:"workspace_id"`
			}
			if err := json.Unmarshal(raw, &input); err != nil {
				return nil, err
			}
			var review assistantReview
			err := a.withAssistantEnvironment(ctx, input.EnvironmentID, true, func(ctx context.Context, env *App) error {
				if env.Execution.ReadOnlySessions {
					return assistantFailure("permission_denied", "目标环境处于只读模式。")
				}
				var operation any
				var err error
				switch name {
				case "project_register":
					operation, err = env.Projects.ReviewRegistration(ctx, input.Name, input.Path)
				case "workspace_create":
					var in struct {
						workspace.CreateWorkspaceInput
						FirstInstruction string `json:"first_instruction"`
					}
					if err := json.Unmarshal(raw, &in); err != nil {
						return err
					}
					var reviewed assistantWorkspaceReview
					reviewed.WorkspaceReview, err = env.Workspaces.ReviewWorkspace(ctx, in.CreateWorkspaceInput)
					if err == nil && in.FirstInstruction != "" {
						launch, launchErr := env.Sessions.ReviewWorkspaceCodexLaunch(ctx, reviewed.Workspace, in.FirstInstruction)
						if launchErr != nil {
							return assistantFailure("invalid_input", "无法准备 Codex 启动，请检查首条指令和对话默认设置。")
						}
						reviewed.Codex = &launch
					}
					operation = reviewed
				case "workspace_attach_project":
					var in workspace.AttachProjectsInput
					_ = json.Unmarshal(raw, &in)
					operation, err = env.Workspaces.ReviewAttachProjects(ctx, input.WorkspaceID, in)
				}
				if err != nil {
					return assistantOperationError(err, false)
				}
				review, err = reviewedOperation(input.EnvironmentID, operation)
				return err
			})
			return review, err
		}
		c.Execute = func(ctx context.Context, raw json.RawMessage) (assistant.ExecutionResult, error) {
			return a.executeAssistantOperation(ctx, name, raw, false)
		}
		c.Reconcile = func(ctx context.Context, raw json.RawMessage) (assistant.ExecutionResult, bool, error) {
			result, err := a.executeAssistantOperation(ctx, name, raw, true)
			return result, len(result.Resources) > 0, err
		}
		if name != "project_register" {
			c.Progress = func(ctx context.Context, raw json.RawMessage) (assistant.ExecutionResult, bool, error) {
				var review assistantReview
				if err := json.Unmarshal(raw, &review); err != nil {
					return assistant.ExecutionResult{}, false, err
				}
				var operation struct {
					Workspace model.Workspace               `json:"workspace"`
					Added     []model.Member                `json:"added"`
					Codex     *session.WorkspaceCodexLaunch `json:"codex"`
				}
				if err := json.Unmarshal(review.Operation, &operation); err != nil {
					return assistant.ExecutionResult{}, false, err
				}
				var result assistant.ExecutionResult
				err := a.withAssistantEnvironment(ctx, review.EnvironmentID, false, func(_ context.Context, env *App) error {
					q, err := env.Execution.Store.Workspace(operation.Workspace.ID)
					if err != nil {
						return err
					}
					result = workspaceExecution(review.EnvironmentID, q)
					if operation.Codex != nil {
						step := store.AssistantStep{ID: "codex", Label: "conversation.start_codex", Status: "pending"}
						if q.State == "ready" {
							step.Status = "running"
						}
						result.Steps = append(result.Steps, step)
					}
					if name == "workspace_attach_project" {
						result = attachmentExecution(review.EnvironmentID, q, operation.Added)
					}
					return nil
				})
				return result, len(result.Resources) > 0, err
			}
		}
		if err := r.Register(c); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) executeAssistantOperation(ctx context.Context, name string, raw json.RawMessage, reconcile bool) (assistant.ExecutionResult, error) {
	var review assistantReview
	var result assistant.ExecutionResult
	if err := json.Unmarshal(raw, &review); err != nil {
		return result, err
	}
	err := a.withAssistantEnvironment(ctx, review.EnvironmentID, true, func(ctx context.Context, env *App) error {
		if !reconcile && (env.Execution.ReadOnlySessions || env.Execution.Closing.Load()) {
			return assistantFailure("permission_denied", "目标环境当前无法执行写入操作。")
		}
		var err error
		switch name {
		case "project_register":
			var input project.RegistrationReview
			if err := json.Unmarshal(review.Operation, &input); err != nil {
				return err
			}
			var p model.Project
			found := true
			if reconcile {
				p, found, err = env.Projects.ReconcileRegistration(ctx, input)
			} else {
				p, err = env.Projects.ExecuteRegistration(ctx, input)
			}
			if err == nil && found {
				result = assistant.ExecutionResult{Status: "succeeded", Data: p, Resources: []assistant.Resource{assistantResource("project", review.EnvironmentID, p.ID, p.Name, p.Path)}}
			}
		case "workspace_create":
			var input assistantWorkspaceReview
			if err := json.Unmarshal(review.Operation, &input); err != nil {
				return err
			}
			var q model.Workspace
			found := true
			if reconcile {
				q, found, err = env.Workspaces.ReconcileWorkspace(ctx, input.WorkspaceReview)
			} else {
				q, err = env.Workspaces.ExecuteWorkspace(ctx, input.WorkspaceReview)
			}
			if err == nil && found {
				result = workspaceExecution(review.EnvironmentID, q)
				if input.Codex != nil {
					err = env.executeAssistantCodexLaunch(ctx, review.EnvironmentID, q, *input.Codex, reconcile, &result)
				}
			}
		case "workspace_attach_project":
			var input workspace.AttachmentReview
			if err := json.Unmarshal(review.Operation, &input); err != nil {
				return err
			}
			var q model.Workspace
			found := true
			if reconcile {
				q, found, err = env.Workspaces.ReconcileAttachProjects(ctx, input)
			} else {
				q, err = env.Workspaces.ExecuteAttachProjects(ctx, input)
			}
			if err == nil && found {
				result = attachmentExecution(review.EnvironmentID, q, input.Added)
			}
		default:
			return fmt.Errorf("unknown assistant operation")
		}
		if err == nil && !reconcile {
			env.Projects.InvalidateState()
		}
		return assistantOperationError(err, !reconcile)
	})
	return result, err
}
