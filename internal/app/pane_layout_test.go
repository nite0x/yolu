package app

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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

func TestPaneLayoutNormalizesContextAndPreservesMetadata(t *testing.T) {
	a := testApp(t)
	for _, tc := range []struct{ query, body, want string }{
		{"", "   ", "default"},
		{"", " default ", "default"},
		{"?context=workspace-main", "", "workspace-main"},
		{"?context=workspace-main", "   ", "workspace-main"},
		{"?context=%20workspace-main%20", " workspace-main ", "workspace-main"},
	} {
		t.Run(tc.query+"/"+tc.body, func(t *testing.T) {
			payload := map[string]any{"version": 1, "context": tc.body, "layout": map[string]any{"activePaneId": "saved-pane"}, "conversations": map[string]any{"c1": map[string]any{"title": "Saved title"}}}
			if code, body := call(t, a, "PUT", "/api/settings/pane-layout"+tc.query, payload); code != http.StatusOK {
				t.Fatalf("save: %d %s", code, body)
			}
			raw, err := a.Execution.Store.Setting(context.Background(), paneLayoutKeyPrefix+tc.want)
			if err != nil {
				t.Fatal(err)
			}
			var saved map[string]any
			if err := json.Unmarshal([]byte(raw), &saved); err != nil {
				t.Fatal(err)
			}
			if saved["context"] != tc.want || saved["conversations"] == nil {
				t.Fatalf("unexpected saved record: %s", raw)
			}
		})
	}
}

func TestPaneLayoutRepairsLegacyContextOnRead(t *testing.T) {
	a := testApp(t)
	for _, ctx := range []string{"default", "workspace-main"} {
		raw := `{"version":1,"context":"   ","layout":{"activePaneId":"saved-pane"},"conversations":{"c1":{"title":"Saved title"}}}`
		if err := a.Execution.Store.SaveSetting(context.Background(), paneLayoutKeyPrefix+ctx, raw); err != nil {
			t.Fatal(err)
		}
		code, body := call(t, a, "GET", "/api/settings/pane-layout?context="+ctx, nil)
		var saved map[string]any
		if code != http.StatusOK {
			t.Fatalf("get: %d %s", code, body)
		}
		if err := json.Unmarshal([]byte(body), &saved); err != nil {
			t.Fatal(err)
		}
		if saved["context"] != ctx || saved["conversations"] == nil {
			t.Fatalf("unexpected restored record: %s", body)
		}
	}
}

func TestPaneLayoutRejectsStaleWritesAndSupportsLegacyRecords(t *testing.T) {
	a := testApp(t)
	for _, tc := range []struct {
		timestamp *int
		id, want  string
	}{
		{nil, "legacy-one", "legacy-one"},
		{nil, "legacy-two", "legacy-two"},
		{new(102), "latest", "latest"},
		{new(101), "old", "latest"},
		{new(102), "duplicate-time", "latest"},
		{nil, "late-legacy", "latest"},
		{new(103), "newer", "newer"},
	} {
		payload := map[string]any{"version": 1, "context": "default", "layout": map[string]any{"activePaneId": tc.id}}
		if tc.timestamp != nil {
			payload["updatedAt"] = *tc.timestamp
		}
		if code, body := call(t, a, "PUT", "/api/settings/pane-layout", payload); code != http.StatusOK {
			t.Fatalf("save: %d %s", code, body)
		}
		_, body := call(t, a, "GET", "/api/settings/pane-layout", nil)
		var saved struct {
			Layout struct {
				ActivePaneID string `json:"activePaneId"`
			} `json:"layout"`
		}
		if err := json.Unmarshal([]byte(body), &saved); err != nil {
			t.Fatal(err)
		}
		if saved.Layout.ActivePaneID != tc.want {
			t.Fatalf("after %s: got %s, want %s", tc.id, saved.Layout.ActivePaneID, tc.want)
		}
	}
}

func TestPaneLayoutConcurrentWritesKeepNewestTimestamp(t *testing.T) {
	a := testApp(t)
	const count = 24
	var wg sync.WaitGroup
	start := make(chan struct{})
	for timestamp := 1; timestamp <= count; timestamp++ {
		wg.Go(func() {
			<-start
			body := fmt.Sprintf(`{"version":1,"context":"default","updatedAt":%d,"layout":{"activePaneId":"pane-%d"}}`, timestamp, timestamp)
			request := httptest.NewRequest(http.MethodPut, "/api/settings/pane-layout", strings.NewReader(body))
			response := httptest.NewRecorder()
			a.paneLayoutHandler(response, request)
			if response.Code != http.StatusOK {
				t.Errorf("save %d: %d %s", timestamp, response.Code, response.Body.String())
			}
		})
	}
	close(start)
	wg.Wait()
	_, body := call(t, a, "GET", "/api/settings/pane-layout", nil)
	var saved struct {
		UpdatedAt int `json:"updatedAt"`
	}
	if err := json.Unmarshal([]byte(body), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.UpdatedAt != count {
		t.Fatalf("got timestamp %d, want %d", saved.UpdatedAt, count)
	}
}
