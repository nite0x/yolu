package app

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestAssistantPendingSendContextSurvivesDraftAPI(t *testing.T) {
	a := testApp(t)
	handler := a.handler()
	path := "/api/conversation-drafts?key=" + url.QueryEscape(`["local","yolu","draft-context"]`)
	call := func(method string, value any) *httptest.ResponseRecorder {
		body := ""
		if value != nil {
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			body = string(raw)
		}
		r := httptest.NewRequest(method, "http://localhost:4317"+path, strings.NewReader(body))
		r.Header.Set("X-CSRF-Token", a.token)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	selection := map[string]string{"environment_id": "local", "project_id": "original-project", "workspace_id": "original-workspace"}
	settings := map[string]string{"model": "fixture-model", "permission": "query"}
	draft := map[string]any{"text": "Prepare work", "images": []any{}, "settings": map[string]any{}, "reading": map[string]any{"top": 0, "bottom": true, "anchor": "", "offset": 0}, "updated": 100, "project": "", "assistant_settings": settings,
		"assistant_request": map[string]any{"request_id": "same-request", "text": "Prepare work", "context": selection, "settings": settings}}
	if w := call("POST", draft); w.Code != 200 {
		t.Fatalf("save context draft: %d %s", w.Code, w.Body.String())
	}
	w := call("GET", nil)
	var saved struct {
		AssistantSettings map[string]string `json:"assistant_settings"`
		AssistantRequest  struct {
			ID       string            `json:"request_id"`
			Context  map[string]string `json:"context"`
			Settings map[string]string `json:"settings"`
		} `json:"assistant_request"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.AssistantRequest.ID != "same-request" || saved.AssistantRequest.Context["project_id"] != "original-project" || saved.AssistantRequest.Context["workspace_id"] != "original-workspace" {
		t.Fatalf("pending send context changed: %s", w.Body.String())
	}
	if saved.AssistantSettings["model"] != "fixture-model" || saved.AssistantSettings["permission"] != "query" ||
		saved.AssistantRequest.Settings["model"] != "fixture-model" || saved.AssistantRequest.Settings["permission"] != "query" {
		t.Fatalf("assistant settings changed: %s", w.Body.String())
	}
	selection["project_id"] = strings.Repeat("x", 201)
	if w := call("POST", draft); w.Code != 400 {
		t.Fatalf("oversized context accepted: %d", w.Code)
	}
	delete(draft["assistant_request"].(map[string]any), "context")
	draft["updated"] = 101
	if w := call("POST", draft); w.Code != 200 {
		t.Fatalf("legacy assistant draft rejected: %d %s", w.Code, w.Body.String())
	}
}
