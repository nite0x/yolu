package session

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommandActionDescriptionsExcludeUnrecognizedPayloads(t *testing.T) {
	var item codexHistoryItem
	raw := `{"type":"commandExecution","command":"cat a.go","commandActions":[{"type":"read","path":"a.go","query":"SECRET"},{"type":"other","path":"SECRET"}],"arguments":{"token":"SECRET"}}`
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		t.Fatal(err)
	}
	entry, ok := visibleHistoryEntry(codexHistoryEntry{Item: item})
	if !ok || len(entry.CommandActions) != 1 || entry.CommandActions[0].Path != "a.go" {
		t.Fatal(entry)
	}
	wire, _ := json.Marshal(entry)
	if strings.Contains(string(wire), "SECRET") {
		t.Fatal("unexpected tool payload forwarded")
	}
}

func TestViewedImageHistoryUsesSessionScopedPreview(t *testing.T) {
	a, _, _, _ := chatFixture(t)
	path := filepath.Join(t.TempDir(), "preview.png")
	raw, err := base64.StdEncoding.DecodeString(generatedPNG)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	entry, ok := visibleHistoryEntry(codexHistoryEntry{Item: codexHistoryItem{ID: "view", Type: "imageView", Path: path}})
	if !ok || entry.ActivityType != "imageView" || len(entry.Images) != 1 || len(entry.LocalImagePaths) != 1 {
		t.Fatal(entry)
	}
	entries := []HistoryEntry{entry}
	a.prepareHistoryMedia("session", entries)
	ref := entries[0].LocalImages[path]
	if ref == "" {
		t.Fatal("missing scoped reference")
	}
	code, body := call(t, a, "GET", "/api/sessions/session/image?ref="+url.QueryEscape(ref), nil)
	if code != 200 || !strings.Contains(string(body), generatedPNG) {
		t.Fatalf("preview failed: %d %s", code, body)
	}
	if code, _ := call(t, a, "GET", "/api/sessions/session/image?ref="+url.QueryEscape(ref+"tampered"), nil); code != 403 {
		t.Fatal("forged image reference accepted", code)
	}
}
