package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"worktree-hub/internal/codex"
)

type nativeDefaultsClient struct{ *fakeLiveClient }

func (c *nativeDefaultsClient) Call(ctx context.Context, method string, params, out any) error {
	if err := c.fakeLiveClient.Call(ctx, method, params, out); err != nil {
		return err
	}
	if method == "thread/start" {
		raw, _ := json.Marshal(map[string]any{"model": "provider-native", "reasoningEffort": "low", "approvalPolicy": "untrusted", "approvalsReviewer": "user", "sandbox": map[string]any{"type": "readOnly"}, "thread": map[string]any{"id": c.sessionID(), "cwd": c.cwd}})
		return json.Unmarshal(raw, out)
	}
	return nil
}

func TestNewConversationInheritsNativeModelEffortAndPermissions(t *testing.T) {
	a, q, base, _ := chatFixture(t)
	a.openLive = func(context.Context) (codex.LiveClient, error) { return &nativeDefaultsClient{base}, nil }
	if code, raw := call(t, a, "POST", "/api/requirements/"+q.ID+"/sessions/new", map[string]string{"text": "Use the environment configuration", "request_id": "native-defaults"}); code != 202 {
		t.Fatalf("%d %s", code, raw)
	}
	state := awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
	base.mu.Lock()
	defer base.mu.Unlock()
	start, turn := base.threadParams["thread/start"], base.startParams
	for _, key := range []string{"model", "sandbox", "approvalPolicy", "approvalsReviewer"} {
		if _, ok := start[key]; ok {
			t.Errorf("thread/start overrides %s: %v", key, start)
		}
	}
	if _, ok := start["config"].(map[string]any)["model_reasoning_effort"]; ok {
		t.Error("overrode native effort", start)
	}
	for _, key := range []string{"model", "effort", "sandboxPolicy", "approvalPolicy", "approvalsReviewer"} {
		if _, ok := turn[key]; ok {
			t.Errorf("turn/start overrides %s: %v", key, turn)
		}
	}
	if state.Context == nil || state.Context.Model != "provider-native" || state.Context.Effort != "low" || state.Context.ApprovalPolicy != "untrusted" || state.Context.Sandbox.(map[string]any)["type"] != "readOnly" {
		t.Fatal("native context lost", state.Context)
	}
}

func preferencesCatalog(a *App) {
	a.openSessions = func(context.Context) (codex.SessionClient, error) {
		return &fakeSessionClient{request: func(method string, _ map[string]any) (any, error) {
			return map[string]any{"data": []any{map[string]any{"model": "gpt-6.1-sol"}, map[string]any{"model": "model"}}}, nil
		}}, nil
	}
}

func TestConversationPreferencesPersistValidateAndResetOffline(t *testing.T) {
	a := testApp(t)
	preferencesCatalog(a)
	endpoint := "/api/settings/conversation-defaults"
	desired := map[string]string{"model": "model", "permission": "ask"}
	if code, raw := call(t, a, "PUT", endpoint, desired); code != 200 {
		t.Fatalf("%d %s", code, raw)
	}
	restored := New(a.Workspace, a.Tasks)
	t.Cleanup(restored.Close)
	got, err := restored.conversationPreferences(context.Background())
	if err != nil || got.Model != "model" || got.Permission != "ask" {
		t.Fatal(got, err)
	}
	other := testApp(t)
	if got, err := other.conversationPreferences(context.Background()); err != nil || got != (conversationPreferences{}) {
		t.Fatal("preferences leaked to another environment", got, err)
	}
	for _, bad := range []map[string]string{{"model": "missing"}, {"permission": "unsafe"}, {"model": strings.Repeat("m", 201)}} {
		if code, raw := call(t, a, "PUT", endpoint, bad); code != 400 {
			t.Fatalf("invalid preferences accepted: %d %s", code, raw)
		}
	}
	a.openSessions = func(context.Context) (codex.SessionClient, error) { return nil, fmt.Errorf("CLI offline") }
	code, raw := call(t, a, "GET", endpoint, nil)
	if code != 200 || !strings.Contains(string(raw), `"models_error"`) || !strings.Contains(string(raw), `"permission":"ask"`) {
		t.Fatalf("offline preferences unavailable: %d %s", code, raw)
	}
	if code, raw := call(t, a, "PUT", endpoint, map[string]string{}); code != 200 {
		t.Fatalf("offline reset failed: %d %s", code, raw)
	}
	if got, err := a.conversationPreferences(context.Background()); err != nil || got != (conversationPreferences{}) {
		t.Fatal(got, err)
	}
	req := httptest.NewRequest(http.MethodPut, endpoint, strings.NewReader(`{"permission":"full"}`))
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, req)
	if w.Code == http.StatusOK {
		t.Fatal("unauthenticated preference write accepted")
	}
}

func TestNewConversationPreferencesPreserveExplicitChoices(t *testing.T) {
	defaults := conversationPreferences{Model: "gpt-6.1-sol", Permission: "full"}
	custom := TurnSettings{Model: "model", Effort: "high", Permission: "ask", Mode: "plan"}
	if got := newConversationSettings(custom, defaults); got != custom {
		t.Fatal(got)
	}
	for _, explicit := range []bool{false, true} {
		t.Run(fmt.Sprintf("explicit-%t", explicit), func(t *testing.T) {
			a, q, base, _ := chatFixture(t)
			preferencesCatalog(a)
			if code, raw := call(t, a, "PUT", "/api/settings/conversation-defaults", defaults); code != 200 {
				t.Fatalf("%d %s", code, raw)
			}
			c := &controlsLive{fakeLiveClient: base}
			a.openLive = func(context.Context) (codex.LiveClient, error) { return c, nil }
			body := map[string]any{"text": "Check preferences", "request_id": "stored-defaults"}
			if explicit {
				body["settings"] = TurnSettings{Model: "model", Permission: "ask", Effort: "high"}
			}
			if code, raw := call(t, a, "POST", "/api/requirements/"+q.ID+"/sessions/new", body); code != 202 {
				t.Fatalf("%d %s", code, raw)
			}
			state := awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
			base.mu.Lock()
			defer base.mu.Unlock()
			start, turn := base.threadParams["thread/start"], base.startParams
			if explicit {
				if start["model"] != "model" || start["approvalPolicy"] != "on-request" || turn["effort"] != "high" {
					t.Fatal(start, turn)
				}
			} else {
				if start["model"] != "gpt-6.1-sol" || start["sandbox"] != "danger-full-access" || turn["effort"] != "medium" || state.Context.Sandbox.(map[string]any)["type"] != "dangerFullAccess" {
					t.Fatal(start, turn, state.Context)
				}
			}
		})
	}
}

func TestConversationDefaultsNeverOverrideExistingSession(t *testing.T) {
	a, _, base, endpoint := chatFixture(t)
	if _, err := a.Workspace.Store.DB.Exec(`INSERT INTO settings(key,value) VALUES('conversation_defaults:v1','{"model":"missing","permission":"full"}')`); err != nil {
		t.Fatal(err)
	}
	startFakeChat(t, a, endpoint)
	base.mu.Lock()
	defer base.mu.Unlock()
	for _, key := range []string{"model", "approvalPolicy", "approvalsReviewer"} {
		if _, ok := base.startParams[key]; ok {
			t.Errorf("existing session overridden: %s", key)
		}
	}
}

func TestUnavailableDefaultModelDoesNotLeaveCreationReceipt(t *testing.T) {
	a, q, base, _ := chatFixture(t)
	if _, err := a.Workspace.Store.DB.Exec(`INSERT INTO settings(key,value) VALUES('conversation_defaults:v1','{"model":"missing"}')`); err != nil {
		t.Fatal(err)
	}
	endpoint := "/api/requirements/" + q.ID + "/sessions/new"
	body := map[string]string{"text": "Check unavailable model", "request_id": "missing-model"}
	if code, raw := call(t, a, "POST", endpoint, body); code != 400 {
		t.Fatalf("%d %s", code, raw)
	}
	var count int
	if err := a.Workspace.Store.DB.QueryRow(`SELECT count(*) FROM conversation_create_requests`).Scan(&count); err != nil || count != 0 {
		t.Fatal("creation receipt persisted before validation", count, err)
	}
	base.mu.Lock()
	_, started := base.threadParams["thread/start"]
	base.mu.Unlock()
	if started {
		t.Fatal("created a thread with an unavailable default")
	}
	if _, err := a.Workspace.Store.DB.Exec(`DELETE FROM settings WHERE key='conversation_defaults:v1'`); err != nil {
		t.Fatal(err)
	}
	if code, raw := call(t, a, "POST", endpoint, body); code != 202 {
		t.Fatalf("retry after resetting defaults failed: %d %s", code, raw)
	}
	awaitChat(t, a, func(s ChatState) bool { return s.Status == "running" })
}
