package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/assistant"
	"worktree-hub/internal/model"
	"worktree-hub/internal/project"
	"worktree-hub/internal/store"
	"worktree-hub/internal/task"
)

func assistantTestJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func assistantTestDecode[T any](t *testing.T, value any) T {
	t.Helper()
	var decoded T
	if err := json.Unmarshal(assistantTestJSON(t, value), &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

type assistantTestPage struct {
	Resources []assistant.Resource `json:"resources"`
	Choices   []assistant.Resource `json:"choices"`
	Errors    []struct {
		EnvironmentID string `json:"environment_id"`
		Code          string `json:"code"`
	} `json:"errors"`
	NextCursor string `json:"next_cursor"`
	Total      int    `json:"total"`
}

func assistantTestHub(a, remote *App) {
	a.environments = &environmentHub{
		local:   a,
		entries: []Environment{{ID: "remote", Name: "Other environment"}, {ID: "offline", Name: "Unavailable environment"}},
		apps:    map[string]*App{"remote": remote},
	}
}

func assistantTestError(t *testing.T, err error, code string) {
	t.Helper()
	var issue *assistant.CapabilityError
	if !errors.As(err, &issue) || issue.Code != code {
		t.Fatalf("error %v, want capability code %s", err, code)
	}
}

func TestAssistantCapabilitiesPageAmbiguousNamesAndRetainPartialEnvironmentResults(t *testing.T) {
	a := testApp(t)
	remote := testApp(t)
	assistantTestHub(a, remote)
	localID := register(t, a, "Shared", repo(t, "local-shared", "main"))
	remoteID := register(t, remote, "Shared", repo(t, "remote-shared", "main"))
	for _, name := range []string{"Other one", "Other two", "Other three"} {
		register(t, a, name, repo(t, strings.ReplaceAll(name, " ", "-"), "main"))
	}

	value, err := a.assistantList(context.Background(), "project", json.RawMessage(`{"environment_id":"all","query":"Shared","limit":1}`))
	if err != nil {
		t.Fatal(err)
	}
	first := assistantTestDecode[assistantTestPage](t, value)
	if first.Total != 2 || len(first.Resources) != 1 || len(first.Choices) != 1 || first.NextCursor == "" {
		t.Fatalf("ambiguous query was not bounded and paged: %+v", first)
	}
	if first.Resources[0].ID != localID || first.Resources[0].EnvironmentID != "local" {
		t.Fatalf("local resource was lost: %+v", first.Resources)
	}
	if len(first.Errors) != 1 || first.Errors[0].EnvironmentID != "offline" || first.Errors[0].Code != "environment_unavailable" {
		t.Fatalf("partial environment failure missing: %+v", first.Errors)
	}
	value, err = a.assistantList(context.Background(), "project", assistantTestJSON(t, map[string]any{"environment_id": "all", "query": "Shared", "limit": 1, "cursor": first.NextCursor}))
	if err != nil {
		t.Fatal(err)
	}
	second := assistantTestDecode[assistantTestPage](t, value)
	if len(second.Resources) != 1 || second.Resources[0].ID != remoteID || second.Resources[0].EnvironmentID != "remote" || second.NextCursor != "" {
		t.Fatalf("second environment page: %+v", second)
	}
	value, err = a.assistantList(context.Background(), "project", json.RawMessage(`{"limit":2}`))
	if err != nil {
		t.Fatal(err)
	}
	page := assistantTestDecode[assistantTestPage](t, value)
	if len(page.Resources) != 2 || page.Total != 4 || len(page.Choices) != 0 || page.NextCursor == "" {
		t.Fatalf("local query ignored page bounds: %+v", page)
	}
}

func TestAssistantCapabilitiesValidateEnvironmentScopedTargetsAndContext(t *testing.T) {
	a := testApp(t)
	remote := testApp(t)
	assistantTestHub(a, remote)
	localID := register(t, a, "Local", repo(t, "local", "main"))
	remoteID := register(t, remote, "Remote", repo(t, "remote", "main"))
	q, err := a.Tasks.CreateWorkspace(context.Background(), task.CreateRequirement{Name: "Context", Slug: "context", Members: []task.MemberSelection{{ProjectID: localID, Mode: "project"}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Workspace.Store.SaveSession(model.Session{ID: "native-conversation", Name: "Existing native session", Cwd: q.Members[0].Path, Source: "codex"}); err != nil {
		t.Fatal(err)
	}

	for _, target := range []assistantQuery{
		{Kind: "project", EnvironmentID: "remote", ID: localID},
		{Kind: "project", EnvironmentID: "local", ID: remoteID},
		{Kind: "workspace", EnvironmentID: "remote", ID: q.ID},
		{Kind: "conversation", EnvironmentID: "remote", ID: "native-conversation"},
	} {
		resource, err := a.assistantTarget(context.Background(), target)
		assistantTestError(t, err, "resource_not_found")
		if resource.ID != "" {
			t.Fatalf("forged environment returned resource: %+v", resource)
		}
	}
	_, err = a.assistantTarget(context.Background(), assistantQuery{Kind: "project", EnvironmentID: "unknown", ID: localID})
	assistantTestError(t, err, "environment_unavailable")
	_, err = a.assistantTarget(context.Background(), assistantQuery{Kind: "shell", EnvironmentID: "local", ID: localID})
	assistantTestError(t, err, "invalid_target")

	value, err := a.assistantContext(context.Background(), assistantTestJSON(t, assistant.Selection{EnvironmentID: "local", ProjectID: localID, WorkspaceID: q.ID}))
	if err != nil {
		t.Fatal(err)
	}
	selection := assistantTestDecode[struct {
		Selection assistant.Selection  `json:"selection"`
		Root      string               `json:"root"`
		Resources []assistant.Resource `json:"resources"`
	}](t, value)
	if selection.Root != a.Workspace.Root || selection.Selection.ProjectID != localID || len(selection.Resources) != 2 {
		t.Fatalf("selected context: %+v", selection)
	}
	_, err = a.assistantContext(context.Background(), assistantTestJSON(t, assistant.Selection{EnvironmentID: "remote", ProjectID: localID}))
	assistantTestError(t, err, "resource_not_found")
	if code, body := call(t, a, "GET", "/api/assistant/resources/project/"+localID+"?environment_id=local", nil); code != http.StatusOK {
		t.Fatalf("validated resource route: %d %s", code, body)
	}
	if code, body := call(t, a, "GET", "/api/assistant/resources/project/"+remoteID+"?environment_id=local", nil); code != http.StatusNotFound {
		t.Fatalf("resource route accepted forged environment: %d %s", code, body)
	}
	resource, err := a.assistantTarget(context.Background(), assistantQuery{Kind: "conversation", ID: "native-conversation"})
	if err != nil || resource.Kind != "conversation" || resource.EnvironmentID != "local" || resource.Path != q.Members[0].Path {
		t.Fatalf("native conversation target: %+v %v", resource, err)
	}
}

func TestAssistantGitSummaryOmitsCredentialsAndPagesWorktrees(t *testing.T) {
	a := testApp(t)
	path := repo(t, "git-summary", "main")
	id := register(t, a, "Git summary", path)
	testGit(t, path, "remote", "add", "origin", "https://credential-user:very-secret-password@example.invalid/repo.git?access_token=private-token")
	testGit(t, path, "update-ref", "refs/remotes/origin/main", "HEAD")
	testGit(t, path, "branch", "--set-upstream-to=origin/main", "main")
	external := filepath.Join(t.TempDir(), "external-worktree")
	testGit(t, path, "worktree", "add", "-b", "other", "--", external, "main")
	value, err := a.assistantGit(context.Background(), assistantTestJSON(t, map[string]any{"id": id, "limit": 1}))
	if err != nil {
		t.Fatal(err)
	}
	raw := string(assistantTestJSON(t, value))
	for _, secret := range []string{"credential-user", "very-secret-password", "private-token", "access_token", "https://"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("Git summary leaked remote credential or URL %q", secret)
		}
	}
	first := assistantTestDecode[assistantTestGitPage](t, value)
	if len(first.Resources) != 1 || len(first.Data.Worktrees) != 1 || first.Data.NextCursor == "" || first.Data.RefreshedAt <= 0 {
		t.Fatalf("Git query pagination/freshness: %+v", first)
	}
	value, err = a.assistantGit(context.Background(), assistantTestJSON(t, map[string]any{"id": id, "limit": 1, "cursor": first.Data.NextCursor}))
	if err != nil {
		t.Fatal(err)
	}
	second := assistantTestDecode[assistantTestGitPage](t, value)
	if len(second.Data.Worktrees) != 1 || second.Data.Worktrees[0].Path == first.Data.Worktrees[0].Path || second.Data.NextCursor != "" {
		t.Fatalf("second Git page: %+v", second)
	}
}

type assistantTestGitPage = struct {
	Resources []assistant.Resource `json:"resources"`
	Data      struct {
		Worktrees   []model.Worktree `json:"worktrees"`
		NextCursor  string           `json:"next_cursor"`
		RefreshedAt int64            `json:"refreshed_at"`
	} `json:"data"`
}

func assistantTestMutation(t *testing.T, a *App, name string, args any) (assistant.Capability, json.RawMessage) {
	t.Helper()
	registry := assistant.NewRegistry()
	if err := a.registerAssistantMutations(registry); err != nil {
		t.Fatal(err)
	}
	capability, canonical, err := registry.Validate(name, assistantTestJSON(t, args))
	if err != nil {
		t.Fatal(err)
	}
	review, err := capability.Review(context.Background(), canonical)
	if err != nil {
		t.Fatal(err)
	}
	return capability, assistantTestJSON(t, review)
}

func TestAssistantReviewedOperationsUseRealDomainServicesAndStableResources(t *testing.T) {
	a := testApp(t)
	path := repo(t, "reviewed-registration", "main")
	registration, raw := assistantTestMutation(t, a, "project_register", map[string]any{"environment_id": "local", "name": "Registered by assistant", "path": path})
	var envelope assistantReview
	if err := json.Unmarshal(raw, &envelope); err != nil || envelope.EnvironmentID != "local" || len(envelope.Operation) == 0 {
		t.Fatalf("invalid execution review envelope: %+v %v", envelope, err)
	}
	var registrationReview project.RegistrationReview
	if err := json.Unmarshal(envelope.Operation, &registrationReview); err != nil {
		t.Fatal(err)
	}
	if registrationReview.Project.ID == "" || registrationReview.Project.Path != path {
		t.Fatalf("review lacks stable canonical identity: %+v", registrationReview)
	}
	if _, found, err := registration.Reconcile(context.Background(), raw); err != nil || found {
		t.Fatalf("review had side effects: %v %v", found, err)
	}
	result, err := registration.Execute(context.Background(), raw)
	if err != nil || result.Status != "succeeded" || len(result.Resources) != 1 || result.Resources[0].ID != registrationReview.Project.ID {
		t.Fatalf("registration execution: %+v %v", result, err)
	}
	firstID := result.Resources[0].ID
	if repeated, err := registration.Execute(context.Background(), raw); err != nil || repeated.Resources[0].ID != firstID {
		t.Fatalf("registration replay: %+v %v", repeated, err)
	}
	if reconciled, found, err := registration.Reconcile(context.Background(), raw); err != nil || !found || reconciled.Resources[0].ID != firstID {
		t.Fatalf("registration recovery: %+v %v %v", reconciled, found, err)
	}

	secondID := register(t, a, "Second", repo(t, "second", "main"))
	creation, raw := assistantTestMutation(t, a, "workspace_create", map[string]any{"environment_id": "local", "name": "Payment module", "slug": "payment-module", "project_ids": []string{firstID, secondID}})
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	var workspaceReview task.WorkspaceReview
	if err := json.Unmarshal(envelope.Operation, &workspaceReview); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(workspaceReview.Requirement.Path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("creation review wrote filesystem: %v", err)
	}
	result, err = creation.Execute(context.Background(), raw)
	if err != nil || result.Status != "succeeded" || len(result.Resources) != 1 {
		t.Fatalf("workspace execution: %+v %v", result, err)
	}
	q := assistantTestDecode[model.Requirement](t, result.Data)
	if q.ID != workspaceReview.Requirement.ID || q.State != "ready" || len(q.Members) != 2 {
		t.Fatalf("workspace result: %+v", q)
	}
	if reconciled, found, err := creation.Reconcile(context.Background(), raw); err != nil || !found || reconciled.Resources[0].ID != q.ID {
		t.Fatalf("workspace recovery: %+v %v %v", reconciled, found, err)
	}
	if repeated, err := creation.Execute(context.Background(), raw); err != nil || repeated.Resources[0].ID != q.ID {
		t.Fatalf("workspace replay: %+v %v", repeated, err)
	}

	thirdID := register(t, a, "Third", repo(t, "third", "main"))
	attachment, raw := assistantTestMutation(t, a, "workspace_attach_project", map[string]any{"environment_id": "local", "workspace_id": q.ID, "members": []task.MemberSelection{{ProjectID: thirdID, Mode: "project"}}})
	result, err = attachment.Execute(context.Background(), raw)
	if err != nil || result.Status != "succeeded" {
		t.Fatalf("attachment execution: %+v %v", result, err)
	}
	attached := assistantTestDecode[model.Requirement](t, result.Data)
	if attached.ID != q.ID || len(attached.Members) != 3 {
		t.Fatalf("attachment resource identity: %+v", attached)
	}
	if reconciled, found, err := attachment.Reconcile(context.Background(), raw); err != nil || !found || reconciled.Resources[0].ID != q.ID {
		t.Fatalf("attachment recovery: %+v %v %v", reconciled, found, err)
	}
}

func TestAssistantReviewedOperationRejectsStaleSourceAndReadOnlyEnvironment(t *testing.T) {
	a := testApp(t)
	path := repo(t, "stale-source", "main")
	id := register(t, a, "Source", path)
	creation, raw := assistantTestMutation(t, a, "workspace_create", map[string]any{"environment_id": "local", "name": "Stale source", "slug": "assistant-stale", "project_ids": []string{id}})
	if err := os.WriteFile(filepath.Join(path, "changed.txt"), []byte("new source commit"), 0644); err != nil {
		t.Fatal(err)
	}
	testGit(t, path, "add", ".")
	testGit(t, path, "commit", "-m", "Advance source after assistant review")
	result, err := creation.Execute(context.Background(), raw)
	assistantTestError(t, err, "stale_plan")
	if len(result.Resources) != 0 {
		t.Fatalf("stale source returned created resources: %+v", result)
	}
	if _, err := os.Stat(filepath.Join(a.Workspace.Root, "assistant-stale")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale plan materialized workspace: %v", err)
	}
	a.Workspace.ReadOnlySessions = true
	_, err = creation.Execute(context.Background(), raw)
	assistantTestError(t, err, "permission_denied")
	_, err = creation.Review(context.Background(), json.RawMessage(`{"environment_id":"local","name":"Read only","project_ids":[]}`))
	assistantTestError(t, err, "permission_denied")
}

func TestAssistantReviewedOperationTreatsRemovedBranchAsStale(t *testing.T) {
	a := testApp(t)
	path := repo(t, "removed-branch", "main")
	id := register(t, a, "Existing branch", path)
	testGit(t, path, "branch", "selected")
	creation, raw := assistantTestMutation(t, a, "workspace_create", map[string]any{
		"environment_id": "local", "name": "Removed source", "slug": "removed-source",
		"members": []task.MemberSelection{{ProjectID: id, Mode: "existing", Branch: "selected"}},
	})
	testGit(t, path, "branch", "-D", "selected")
	_, err := creation.Execute(context.Background(), raw)
	assistantTestError(t, err, "stale_plan")
	if _, err := os.Stat(filepath.Join(a.Workspace.Root, "removed-source")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("stale branch created workspace: %v", err)
	}
}

func TestAssistantRemoteOperationKeepsStopServiceResponsive(t *testing.T) {
	a := testApp(t)
	remote := testApp(t)
	assistantTestHub(a, remote)
	a.shutdown = func() {}
	a.environments.mu.Lock()
	response := httptest.NewRecorder()
	finished := make(chan struct{})
	go func() {
		a.stopServiceHandler(response, httptest.NewRequest(http.MethodPost, "/api/service/stop", nil))
		close(finished)
	}()
	select {
	case <-finished:
		a.environments.mu.Unlock()
	case <-time.After(time.Second):
		a.environments.mu.Unlock()
		<-finished
		t.Fatal("stop request waited for an active remote operation instead of returning busy")
	}
	if response.Code != http.StatusConflict || a.Workspace.Closing.Load() {
		t.Fatalf("stop interrupted a busy environment: %d %s", response.Code, response.Body.String())
	}
}

// Bind the fixture plan using the same immutable protocol fields checked by the
// approval endpoint, so this test exercises normal worker registration/cancel.
func assistantTestPlanDigest(t *testing.T, p store.AssistantPlan) string {
	t.Helper()
	raw := assistantTestJSON(t, struct {
		ID           string
		Conversation string
		Environment  string
		Revision     int
		Capability   string
		Arguments    json.RawMessage
		Review       json.RawMessage
	}{p.ID, p.ConversationID, p.EnvironmentID, p.Revision, p.Capability, p.Arguments, p.Review})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func TestAssistantEnvironmentShutdownCancelsRemotePlanBeforeClosingApps(t *testing.T) {
	a := testApp(t)
	remote := testApp(t)
	assistantTestHub(a, remote)
	registry := assistant.NewRegistry()
	started, cancelled := make(chan struct{}), make(chan struct{})
	if err := registry.Register(assistant.Capability{
		Name: "test_remote_write", Description: "Exercise a cancellable remote operation", Mutation: true, InputSchema: assistantSchema(map[string]any{}),
		Review: func(context.Context, json.RawMessage) (any, error) { return map[string]any{}, nil },
		Execute: func(ctx context.Context, _ json.RawMessage) (assistant.ExecutionResult, error) {
			err := a.withAssistantEnvironment(ctx, "remote", false, func(ctx context.Context, _ *App) error {
				close(started)
				<-ctx.Done()
				close(cancelled)
				return ctx.Err()
			})
			return assistant.ExecutionResult{}, err
		},
	}); err != nil {
		t.Fatal(err)
	}
	a.Assistant.Configure(registry, func() bool { return false })
	if err := a.Workspace.Store.CreateAssistant("shutdown-conversation"); err != nil {
		t.Fatal(err)
	}
	p := store.AssistantPlan{
		ID: "shutdown-plan", ConversationID: "shutdown-conversation", RunID: "fixture", Revision: 1,
		Capability: "test_remote_write", EnvironmentID: "remote", Arguments: json.RawMessage(`{}`), Review: json.RawMessage(`{}`),
		Status: "pending", Steps: []store.AssistantStep{{ID: "execute", Label: "Remote operation", Status: "pending"}}, Resources: []store.AssistantResource{},
	}
	p.Digest = assistantTestPlanDigest(t, p)
	if err := a.Workspace.Store.CreateAssistantPlan(p); err != nil {
		t.Fatal(err)
	}
	code, body := call(t, a, "POST", "/api/assistant/conversations/shutdown-conversation/plans/shutdown-plan/decision", map[string]any{
		"request_id": "approve-shutdown", "decision": "approve", "revision": p.Revision, "digest": p.Digest,
	})
	if code != http.StatusAccepted {
		t.Fatalf("start remote plan: %d %s", code, body)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("remote worker did not start")
	}
	closed := make(chan struct{})
	go func() { a.environments.Close(); close(closed) }()
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		// Release the fixture even when testing the previous teardown order.
		a.Assistant.Close()
		<-closed
		t.Fatal("environment teardown waited for a remote plan instead of cancelling it")
	}
	select {
	case <-cancelled:
	default:
		t.Fatal("remote app closed before the assistant plan was cancelled")
	}
	result, err := a.Workspace.Store.AssistantPlan(p.ConversationID, p.ID)
	if err != nil || result.Status != "unknown" || result.ErrorCode != "cancelled" {
		t.Fatalf("cancelled remote plan lost its durable outcome: %+v %v", result, err)
	}
}

func TestAssistantDiscoveryPublishesEnforcedPaginationSchema(t *testing.T) {
	a := testApp(t)
	code, raw := call(t, a, "GET", "/api/assistant/capabilities", nil)
	if code != http.StatusOK {
		t.Fatalf("capability discovery: %d %s", code, raw)
	}
	var capabilities []assistant.Capability
	if err := json.Unmarshal(raw, &capabilities); err != nil {
		t.Fatal(err)
	}
	registry := assistant.NewRegistry()
	for _, capability := range capabilities {
		if capability.Name != "project_list" {
			continue
		}
		capability.Read = func(context.Context, json.RawMessage) (any, error) { return nil, nil }
		if err := registry.Register(capability); err != nil {
			t.Fatal(err)
		}
	}
	for _, input := range []string{`{"limit":0}`, `{"limit":31}`, `{"cursor":"-1"}`, `{"limit":2,"shell":"echo escaped"}`} {
		_, _, err := registry.Validate("project_list", json.RawMessage(input))
		assistantTestError(t, err, "invalid_input")
	}
	if _, _, err := registry.Validate("project_list", json.RawMessage(`{"environment_id":"all","limit":30,"cursor":"15"}`)); err != nil {
		t.Fatal(err)
	}
}

func TestAssistantRemoteProgressReadsWhileMutationHoldsDomainLocks(t *testing.T) {
	a := testApp(t)
	remote := testApp(t)
	assistantTestHub(a, remote)
	projectID := register(t, remote, "Progress", repo(t, "remote-progress", "main"))
	creation, raw := assistantTestMutation(t, a, "workspace_create", map[string]any{
		"environment_id": "remote", "name": "Remote progress", "slug": "remote-progress",
		"members": []task.MemberSelection{{ProjectID: projectID, Mode: "project"}},
	})
	result, err := creation.Execute(context.Background(), raw)
	if err != nil {
		t.Fatal(err)
	}
	workspaceID := result.Resources[0].ID
	started, release := make(chan struct{}), make(chan struct{})
	mutationDone := make(chan error, 1)
	go func() {
		mutationDone <- a.withAssistantEnvironment(context.Background(), "remote", false, func(ctx context.Context, env *App) error {
			unlock, err := env.Projects.LockRepositories(ctx, []string{projectID})
			if err != nil {
				return err
			}
			defer unlock()
			env.Workspace.Mu.Lock()
			defer env.Workspace.Mu.Unlock()
			if _, err := env.Workspace.Store.DB.Exec(`UPDATE requirements SET state='creating' WHERE id=?; UPDATE members SET state='creating' WHERE requirement_id=?`, workspaceID, workspaceID); err != nil {
				return err
			}
			close(started)
			<-release
			_, err = env.Workspace.Store.DB.Exec(`UPDATE requirements SET state='ready' WHERE id=?; UPDATE members SET state='ready' WHERE requirement_id=?`, workspaceID, workspaceID)
			return err
		})
	}()
	select {
	case <-started:
	case err := <-mutationDone:
		t.Fatalf("mutation did not acquire its domain locks: %v", err)
	case <-time.After(2 * time.Second):
		close(release)
		<-mutationDone
		t.Fatal("remote mutation did not start")
	}
	type progressResult struct {
		result assistant.ExecutionResult
		found  bool
		err    error
	}
	progressDone := make(chan progressResult, 1)
	go func() {
		result, found, err := creation.Progress(context.Background(), raw)
		progressDone <- progressResult{result, found, err}
	}()
	var progress progressResult
	select {
	case progress = <-progressDone:
	case <-time.After(2 * time.Second):
		close(release)
		<-mutationDone
		<-progressDone
		t.Fatal("remote progress was serialized behind the active mutation")
	}
	close(release)
	if err := <-mutationDone; err != nil {
		t.Fatal(err)
	}
	if progress.err != nil || !progress.found || len(progress.result.Steps) != 1 || progress.result.Steps[0].Status != "running" {
		t.Fatalf("live member progress missing: %+v %v %v", progress.result, progress.found, progress.err)
	}
	if len(a.assistantEnvironmentIDs()) != 3 {
		t.Fatal("progress callback retained the hub mutex")
	}
}

func TestAssistantEnvironmentLeaseProtectsStoreThroughReconnectAndClose(t *testing.T) {
	for _, environmentID := range []string{"local", "remote"} {
		t.Run(environmentID, func(t *testing.T) {
			a := testApp(t)
			target := a
			if environmentID == "remote" {
				target = testApp(t)
				assistantTestHub(a, target)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			started := make(chan struct{})
			callbackDone := make(chan error, 1)
			storeUsable := make(chan error, 1)
			go func() {
				callbackDone <- a.withAssistantEnvironment(ctx, environmentID, false, func(ctx context.Context, env *App) error {
					close(started)
					<-ctx.Done()
					// Teardown must preserve the leased store until this callback exits.
					storeUsable <- env.Workspace.Store.DB.PingContext(context.Background())
					return ctx.Err()
				})
			}()
			select {
			case <-started:
			case <-time.After(2 * time.Second):
				t.Fatal("capability callback did not acquire a lease")
			}
			if environmentID == "remote" {
				request := httptest.NewRequest(http.MethodPost, "/api/environments/remote/reconnect", nil)
				request.SetPathValue("environment", "remote")
				response := httptest.NewRecorder()
				a.environments.reconnectHandler(response, request)
				if response.Code != http.StatusConflict || target.Workspace.Closing.Load() {
					t.Fatalf("reconnect disposed a leased environment: %d %s", response.Code, response.Body.String())
				}
			}
			closeDone := make(chan error, 1)
			go func() { closeDone <- target.Close() }()
			deadline := time.Now().Add(2 * time.Second)
			for !target.Workspace.Closing.Load() && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			if !target.Workspace.Closing.Load() {
				cancel()
				t.Fatal("environment close did not start")
			}
			if err := target.Workspace.Store.DB.PingContext(context.Background()); err != nil {
				cancel()
				t.Fatalf("close disposed leased store: %v", err)
			}
			_, err := a.assistantContext(context.Background(), assistantTestJSON(t, assistant.Selection{EnvironmentID: environmentID}))
			assistantTestError(t, err, "environment_unavailable")
			select {
			case err := <-closeDone:
				cancel()
				t.Fatalf("close returned before the capability lease ended: %v", err)
			default:
			}
			cancel()
			if err := <-storeUsable; err != nil {
				t.Fatalf("cancelled callback lost access before releasing its lease: %v", err)
			}
			if err := <-callbackDone; !errors.Is(err, context.Canceled) {
				t.Fatalf("callback cancellation: %v", err)
			}
			select {
			case err := <-closeDone:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("environment close did not finish after lease cancellation")
			}
			if err := target.Workspace.Store.DB.PingContext(context.Background()); err == nil {
				t.Fatal("environment store remained open after close")
			}
		})
	}
}
