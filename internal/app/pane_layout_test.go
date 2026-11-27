package app

import (
	"encoding/json"
	"html"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPaneLayoutPersistsAndBootstrapsInAppShell(t *testing.T) {
	a := testApp(t)
	payload := map[string]any{
		"version": 1,
		"context": "default",
		"layout": map[string]any{
			"version": 1,
			"root": map[string]any{
				"type":      "split",
				"id":        "s1",
				"direction": "horizontal",
				"ratio":     0.45,
				"children": []any{
					map[string]any{"type": "pane", "id": "p1", "content": map[string]any{"type": "conversation", "conversationId": "conv-1"}},
					map[string]any{"type": "pane", "id": "p2", "content": map[string]any{"type": "empty"}},
				},
			},
			"activePaneId": "p2",
		},
	}

	if code, body := call(t, a, "PUT", "/api/settings/pane-layout", payload); code != http.StatusOK {
		t.Fatalf("save pane layout: %d %s", code, body)
	}

	code, body := call(t, a, "GET", "/api/settings/pane-layout", nil)
	if code != http.StatusOK {
		t.Fatalf("get pane layout: %d %s", code, body)
	}
	var loaded map[string]any
	if err := json.Unmarshal([]byte(body), &loaded); err != nil {
		t.Fatalf("decode saved pane layout: %v", err)
	}
	if loaded["context"] != "default" {
		t.Fatalf("unexpected context: %v", loaded["context"])
	}

	// Verify app.html bootstraps the escaped saved layout synchronously.
	page := httptest.NewRecorder()
	a.assetsHandler().ServeHTTP(page, httptest.NewRequest("GET", "http://localhost:58923/", nil))
	if !strings.Contains(page.Body.String(), `name="pane-layout" content="`) {
		t.Fatal("app.html is missing pane-layout bootstrap meta")
	}
	if !strings.Contains(page.Body.String(), html.EscapeString(`"conv-1"`)) {
		t.Fatal("app.html bootstrap is missing saved conversation binding")
	}

	// Reject malformed, null-layout, invalid-context, and mismatched-context payloads.
	if code, _ := call(t, a, "PUT", "/api/settings/pane-layout", map[string]any{"version": 0}); code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid pane layout, got %d", code)
	}
	if code, _ := call(t, a, "PUT", "/api/settings/pane-layout", map[string]any{"version": 1, "context": "default", "layout": nil}); code != http.StatusBadRequest {
		t.Fatalf("expected 400 for null pane layout, got %d", code)
	}
	if code, _ := call(t, a, "PUT", "/api/settings/pane-layout?context=../bad", payload); code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid context query, got %d", code)
	}
	if code, _ := call(t, a, "PUT", "/api/settings/pane-layout?context=other", payload); code != http.StatusBadRequest {
		t.Fatalf("expected 400 for mismatched context query and body, got %d", code)
	}
}
