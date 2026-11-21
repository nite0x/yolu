package session

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"worktree-hub/internal/execution"
)

func TestVisualizationPreviewIsScopedToTheConversationAndSandboxed(t *testing.T) {
	home := t.TempDir()
	t.Setenv("CODEX_HOME", home)
	const session = "01a1fbdf-4dfa-7601-9c99-79405b191367"
	const other = "01a1fbdf-4dfa-7601-9c99-79405b191368"
	root := filepath.Join(home, "visualizations", "2026", "11", "21")
	if err := os.MkdirAll(filepath.Join(root, session), 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, session, "settings.html")
	if err := os.WriteFile(path, []byte(`<button id="settings">Settings</button>`), 0600); err != nil {
		t.Fatal(err)
	}
	marker := func(path string) string {
		payload, _ := json.Marshal(map[string]string{"path": path})
		return "visualize" + string(payload) + ""
	}
	service := &Service{Execution: &execution.Service{}}
	entries := []HistoryEntry{
		{Kind: "assistant", Text: marker(path) + "\n" + marker(filepath.Join(root, other, "settings.html"))},
		{Kind: "user", Text: marker(path)},
	}
	service.prepareHistoryMedia(session, entries)
	ref := entries[0].Visualizations[path]
	if ref == "" || len(entries[0].Visualizations) != 1 || len(entries[1].Visualizations) != 0 {
		t.Fatal("unexpected visualization references", entries)
	}
	render := func(id, token, dest string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "/session-visualization/"+id+"?ref="+url.QueryEscape(token), nil)
		r.SetPathValue("session", id)
		r.Header.Set("Sec-Fetch-Dest", dest)
		w := httptest.NewRecorder()
		service.visualizationFrame(w, r)
		return w
	}
	preview := render(session, ref, "iframe")
	if preview.Code != http.StatusOK || !strings.Contains(preview.Body.String(), `<button id="settings">`) {
		t.Fatal("preview body unavailable", preview.Code)
	}
	if csp := preview.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "sandbox allow-scripts") || !strings.Contains(csp, "default-src 'none'") || strings.Contains(csp, "allow-same-origin") {
		t.Fatal("missing frame sandbox", csp)
	}
	for _, rejected := range []*httptest.ResponseRecorder{render(other, ref, "iframe"), render(session, ref+"forged", "iframe"), render(session, ref, "document")} {
		if rejected.Code != http.StatusNotFound || strings.Contains(rejected.Body.String(), `<button id="settings">`) {
			t.Fatal("unexpected preview response", rejected.Code)
		}
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	missing := render(session, ref, "iframe")
	if missing.Code != http.StatusNotFound || !strings.Contains(missing.Body.String(), "unavailable:true") {
		t.Fatal("missing artifact did not return unavailable state", missing.Code)
	}
}
