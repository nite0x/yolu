package session

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/workspace"
)

const generatedPNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII="

func TestGeneratedHistoryImagesBecomeScopedLazyReferences(t *testing.T) {
	a, _, _, _ := chatFixture(t)
	var item codexHistoryItem
	if err := json.Unmarshal([]byte(`{"id":"icon","type":"imageGeneration","status":"completed","result":"`+generatedPNG+`"}`), &item); err != nil {
		t.Fatal(err)
	}
	entry, ok := visibleHistoryEntry(codexHistoryEntry{TurnID: "design", Item: item})
	if !ok || entry.Kind != "assistant" || len(entry.Images) != 1 || !strings.HasPrefix(entry.Images[0], "data:image/png;base64,") {
		t.Fatalf("generation not visible: %+v", entry)
	}
	entries := []HistoryEntry{entry}
	a.prepareHistoryMedia("session", entries)
	if entry.Images[0] != "data:image/png;base64,"+generatedPNG {
		t.Fatal("preparing a snapshot mutated the active run")
	}
	image := entries[0].Images[0]
	ref := entries[0].LocalImages[image]
	if ref == "" || strings.Contains(image, generatedPNG) {
		t.Fatal("inline generation was not replaced with an authenticated reference")
	}
	code, raw := call(t, a, "GET", "/api/sessions/session/image?ref="+url.QueryEscape(ref), nil)
	if code != 200 || !strings.Contains(string(raw), generatedPNG) {
		t.Fatalf("image read: %d %s", code, raw)
	}
	if code, _ := call(t, a, "GET", "/api/sessions/session/image?ref="+url.QueryEscape(ref+"tampered"), nil); code != 403 {
		t.Fatal("forged image reference accepted", code)
	}
	first, _ := json.Marshal(entries)
	a.prepareHistoryMedia("session", entries)
	second, _ := json.Marshal(entries)
	if string(first) != string(second) {
		t.Fatal("repeated preparation changed image identity")
	}
	files, err := os.ReadDir(filepath.Join(a.Workspace.DataDir, "history-images"))
	if err != nil || len(files) != 1 {
		t.Fatalf("cache not deduplicated: %d %v", len(files), err)
	}
}

func TestGeneratedImageValidationAndIncompleteGeneration(t *testing.T) {
	for _, value := range []string{generatedPNG, "data:image/png;base64," + generatedPNG} {
		if image, err := historyImageURL(value); err != nil || image != "data:image/png;base64,"+generatedPNG {
			t.Fatalf("valid image rejected: %v", err)
		}
	}
	for _, value := range []string{"", "https://example.com/icon.png", "<svg onload='alert(1)'/>", "data:image/jpeg;base64," + generatedPNG, base64.StdEncoding.EncodeToString([]byte("<html>not image</html>"))} {
		if _, err := historyImageURL(value); err == nil {
			t.Fatal("invalid generation accepted")
		}
	}
	for _, status := range []string{"inProgress", "completed", "failed"} {
		e, ok := visibleHistoryEntry(codexHistoryEntry{Item: codexHistoryItem{ID: "icon", Type: "imageGeneration", Status: status}})
		if !ok || len(e.Images) != 0 || e.Text == "" {
			t.Fatalf("generation status disappeared: %+v", e)
		}
	}
	var tool codexHistoryItem
	if err := json.Unmarshal([]byte(`{"type":"mcpToolCall","result":{"content":[{"type":"text","text":"PRIVATE"}]}}`), &tool); err != nil {
		t.Fatal("non-image results must retain their original shape", err)
	}
}

func TestOversizedHistoryPageRetriesSameCursorWithSmallerLimit(t *testing.T) {
	limits := []int{}
	c := &fakeSessionClient{request: func(method string, params map[string]any) (any, error) {
		if method != "thread/items/list" || params["cursor"] != "unchanged" {
			t.Fatal(method, params)
		}
		limit := params["limit"].(int)
		limits = append(limits, limit)
		if limit > 50 {
			return nil, fmt.Errorf("large frame: %w", codex.ErrSessionMessageTooLarge)
		}
		return map[string]any{"data": []any{map[string]any{"turnId": "t", "item": map[string]any{"id": "a", "type": "agentMessage", "text": "保留记录"}}}, "nextCursor": "older"}, nil
	}}
	history, err := readSessionHistory(c, codex.Session{ID: "thread", HistoryMode: "paginated"}, "unchanged")
	if err != nil || fmt.Sprint(limits) != "[200 100 50]" || len(history.Entries) != 1 || history.NextCursor == nil || *history.NextCursor != "older" {
		t.Fatalf("retry lost history: limits=%v result=%+v err=%v", limits, history, err)
	}
}

// Opt-in read-only regression against a saved thread. Never resume it or start
// a turn; cache and session metadata are written only to disposable test data.
func TestInstalledCodexGeneratedHistory(t *testing.T) {
	id := os.Getenv("WORKTREE_HUB_TEST_HISTORY_ID")
	if id == "" {
		t.Skip("opt-in saved image-generation history")
	}
	c, err := codex.OpenSessionClient(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	s, err := readSession(c, id)
	if err != nil {
		t.Fatal(err)
	}
	history, err := readSessionHistory(c, s, "")
	if err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(history)
	environment, err := workspace.Open(t.TempDir(), t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer environment.Close()
	a := New(environment, nil)
	if err := a.SaveSession("", s, "codex"); err != nil {
		t.Fatal(err)
	}
	a.prepareHistoryMedia(id, history.Entries)
	after, _ := json.Marshal(history)
	mux := http.NewServeMux()
	a.RegisterRoutes(mux)
	images := 0
	for _, entry := range history.Entries {
		if entry.Tool != "生成图片" {
			continue
		}
		for _, image := range entry.Images {
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, httptest.NewRequest("GET", "/api/sessions/"+id+"/image?ref="+url.QueryEscape(entry.LocalImages[image]), nil))
			if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), "data:image/png;base64,") {
				t.Fatalf("generated image could not load: status=%d", recorder.Code)
			}
			images++
		}
	}
	if images == 0 || len(after) >= len(before)/10 {
		t.Fatalf("history not compacted: images=%d before=%d after=%d", images, len(before), len(after))
	}
	t.Logf("Saved history loaded: entries=%d generated_images=%d inline_bytes=%d lazy_reference_bytes=%d", len(history.Entries), images, len(before), len(after))
}
