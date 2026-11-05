package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWorkspaceTabsPersistAcrossOriginsAndKeepConversationScopesSeparate(t *testing.T) {
	a := testApp(t)
	input := map[string]any{
		"selected": "second",
		"tabs": []any{
			map[string]any{"id": "first", "snapshot": map[string]any{"route": "/sessions", "environment": "local", "conversation": map[string]any{"scope": map[string]string{"kind": "task", "id": "same-task"}, "selected": "front"}}},
			map[string]any{"id": "second", "snapshot": map[string]any{"route": "/sessions", "environment": "local", "conversation": map[string]any{"scope": map[string]string{"kind": "task", "id": "same-task"}, "selected": "back"}}},
		},
	}
	if code, raw := call(t, a, "PUT", "/api/workspace-tabs", input); code != http.StatusOK {
		t.Fatalf("save tabs: %d %s", code, raw)
	}
	r := httptest.NewRequest("GET", "http://localhost:58923/api/workspace-tabs", nil)
	r.Header.Set("X-CSRF-Token", a.token)
	r.Header.Set("X-Environment-ID", "wsl-offline")
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	var got workspaceTabs
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || !got.Initialized || got.Selected != "second" || len(got.Tabs) != 2 {
		t.Fatalf("restore on another origin: %d %s", w.Code, w.Body.String())
	}
	if bytes.Equal(got.Tabs[0].Snapshot, got.Tabs[1].Snapshot) {
		t.Fatal("distinct conversations were collapsed")
	}
	for _, body := range []string{
		`{"selected":"missing","tabs":[{"id":"first","snapshot":{}}]}`,
		`{"selected":"first","tabs":[{"id":"first","snapshot":{}},{"id":"first","snapshot":{}}]}`,
		`{"selected":"first","tabs":[{"id":"first","snapshot":null}]}`,
	} {
		r := httptest.NewRequest("PUT", "http://localhost:4317/api/workspace-tabs", bytes.NewBufferString(body))
		r.Header.Set("X-CSRF-Token", a.token)
		w := httptest.NewRecorder()
		a.handler().ServeHTTP(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("invalid state accepted: %d %s", w.Code, body)
		}
	}
	r = httptest.NewRequest("PUT", "http://localhost:4317/api/workspace-tabs", bytes.NewBufferString(`{"selected":"","tabs":[]}`))
	w = httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("unauthenticated write accepted: %d", w.Code)
	}
}

func TestWorkspaceSplitLayoutPersistsAndRejectsInvalidPanes(t *testing.T) {
	a := testApp(t)
	input := map[string]any{
		"selected": "b",
		"tabs": []any{
			map[string]any{"id": "a", "snapshot": map[string]string{"route": "/sessions"}},
			map[string]any{"id": "b", "snapshot": map[string]string{"route": "/sessions"}},
			map[string]any{"id": "c", "snapshot": map[string]string{"route": "/sessions"}},
		},
		"layout": map[string]any{"columns": 3, "panes": []string{"a", "b", "c"}, "widths": []float64{0.8, 1.2, 1}},
	}
	if code, raw := call(t, a, "PUT", "/api/workspace-tabs", input); code != http.StatusOK {
		t.Fatalf("save split: %d %s", code, raw)
	}
	code, raw := call(t, a, "GET", "/api/workspace-tabs", nil)
	var got workspaceTabs
	if code != http.StatusOK || json.Unmarshal(raw, &got) != nil || got.Layout == nil || got.Layout.Columns != 3 || len(got.Layout.Panes) != 3 || got.Layout.Panes[1] != "b" || got.Layout.Widths[1] != 1.2 {
		t.Fatalf("restore split: %d %s", code, raw)
	}
	for _, layout := range []map[string]any{
		{"columns": 4, "panes": []string{"a", "b", "c"}, "widths": []float64{1, 1, 1}},
		{"columns": 2, "panes": []string{"a", "a"}, "widths": []float64{1, 1}},
		{"columns": 2, "panes": []string{"b", "missing"}, "widths": []float64{1, 1}},
		{"columns": 2, "panes": []string{"a", "c"}, "widths": []float64{1, 1}},
		{"columns": 2, "panes": []string{"a", "b"}, "widths": []float64{0, 1}},
		{"columns": 2, "panes": []string{"a", "b"}, "widths": []float64{1}},
	} {
		input["layout"] = layout
		if code, raw := call(t, a, "PUT", "/api/workspace-tabs", input); code != http.StatusBadRequest {
			t.Fatalf("invalid layout accepted: %+v: %d %s", layout, code, raw)
		}
	}
	// Rejected writes must leave the last valid layout intact.
	_, raw = call(t, a, "GET", "/api/workspace-tabs", nil)
	if json.Unmarshal(raw, &got) != nil || got.Layout.Columns != 3 {
		t.Fatalf("invalid write changed stored split: %s", raw)
	}
}

func TestWorkspaceSplitTabGroupsPersistAndRejectUnassignedOrRepeatedPages(t *testing.T) {
	a := testApp(t)
	input := map[string]any{
		"selected": "b",
		"tabs": []any{
			map[string]any{"id": "a", "snapshot": map[string]string{"route": "/sessions"}},
			map[string]any{"id": "b", "snapshot": map[string]string{"route": "/projects"}},
			map[string]any{"id": "c", "snapshot": map[string]string{"route": "/requirements"}},
		},
		"layout": map[string]any{"columns": 2, "panes": []string{"a", "b"}, "widths": []float64{1, 1}, "groups": [][]string{{"a", "c"}, {"b"}}},
	}
	if code, raw := call(t, a, "PUT", "/api/workspace-tabs", input); code != http.StatusOK {
		t.Fatalf("save groups: %d %s", code, raw)
	}
	code, raw := call(t, a, "GET", "/api/workspace-tabs", nil)
	var got workspaceTabs
	if code != http.StatusOK || json.Unmarshal(raw, &got) != nil || got.Layout == nil || len(got.Layout.Groups) != 2 || len(got.Layout.Groups[0]) != 2 || got.Layout.Groups[0][1] != "c" {
		t.Fatalf("restore groups: %d %s", code, raw)
	}
	for _, groups := range [][][]string{
		{{"a"}, {"b"}},
		{{"a", "c"}, {"b", "c"}},
		{{"a", "c", "missing"}, {"b"}},
		{{"a", "b", "c"}},
		{{"b", "c"}, {"a"}},
		{{"a", "b", "c"}, {}},
	} {
		input["layout"].(map[string]any)["groups"] = groups
		if code, raw := call(t, a, "PUT", "/api/workspace-tabs", input); code != http.StatusBadRequest {
			t.Fatalf("invalid groups accepted: %+v: %d %s", groups, code, raw)
		}
	}
	_, raw = call(t, a, "GET", "/api/workspace-tabs", nil)
	if json.Unmarshal(raw, &got) != nil || len(got.Layout.Groups[0]) != 2 {
		t.Fatalf("invalid write changed groups: %s", raw)
	}
}

func TestWorkspaceConversationGroupPreservesCrossTaskAndEnvironmentSnapshots(t *testing.T) {
	a := testApp(t)
	input := map[string]any{
		"selected": "group", "tabs": []any{map[string]any{"id": "group", "snapshot": map[string]any{
			"route": "/sessions", "environment": "local", "title": "Frontend", "conversation": map[string]any{"scope": map[string]string{"kind": "task", "id": "task-a"}, "selected": "session-a"},
			"parallel": map[string]any{"panes": []any{map[string]any{"route": "/sessions", "environment": "remote", "context": "Task B", "conversation": map[string]any{"scope": map[string]string{"kind": "task", "id": "task-b", "environment": "remote"}, "selected": "[\"remote\",\"session-b\"]"}}}, "widths": []float64{1, 1.5}},
		}}},
	}
	if code, raw := call(t, a, "PUT", "/api/workspace-tabs", input); code != http.StatusOK {
		t.Fatalf("save group: %d %s", code, raw)
	}
	code, raw := call(t, a, "GET", "/api/workspace-tabs", nil)
	var got workspaceTabs
	if code != http.StatusOK || json.Unmarshal(raw, &got) != nil || len(got.Tabs) != 1 {
		t.Fatalf("restore group: %d %s", code, raw)
	}
	var snapshot struct {
		Parallel struct {
			Panes []struct {
				Environment  string
				Context      string
				Conversation struct {
					Selected string
					Scope    struct{ ID string }
				}
			}
			Widths []float64
		}
	}
	if err := json.Unmarshal(got.Tabs[0].Snapshot, &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Parallel.Panes) != 1 || snapshot.Parallel.Panes[0].Environment != "remote" || snapshot.Parallel.Panes[0].Conversation.Scope.ID != "task-b" || snapshot.Parallel.Widths[1] != 1.5 {
		t.Fatalf("group changed: %s", raw)
	}
}
