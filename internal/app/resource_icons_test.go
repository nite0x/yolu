package app

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestResourceIconsRetainLegacyAppearanceAndMergeDetailEdits(t *testing.T) {
	a := testApp(t)
	legacy := `{"workspaces":["work"],"directories":["/repo/app"],"icons":{"project:legacy":{"icon":"code","color":"blue"},"workspace:work":{"icon":"rocket","color":"rose"},"directory:/repo/app":{"icon":"code","color":"blue"}}}`
	if _, err := a.Execution.Store.DB.Exec(`INSERT INTO settings(key,value) VALUES(?,?)`, "shortcut_pins:local", legacy); err != nil {
		t.Fatal(err)
	}
	read := func(app *App, environment string) resourceIcons {
		t.Helper()
		code, raw := call(t, app, "GET", "/api/resource-icons?environment="+environment, nil)
		var result resourceIcons
		if code != 200 || json.Unmarshal(raw, &result) != nil {
			t.Fatalf("read icons: %d %s", code, raw)
		}
		return result
	}
	if got := read(a, "local"); got.Icons["project:legacy"].Color != "blue" || len(got.Icons) != 1 {
		t.Fatalf("legacy icons lost: %+v", got)
	}
	for _, id := range []string{"project:app", "project:other"} {
		if code, raw := call(t, a, "PUT", "/api/resource-icons", map[string]any{"id": id, "appearance": resourceIcon{Icon: "bug", Color: "teal"}}); code != 200 {
			t.Fatalf("save: %d %s", code, raw)
		}
	}
	if len(read(a, "local").Icons) != 3 {
		t.Fatal("editing one resource overwrote another")
	}
	dataDir, root := a.Execution.DataDir, a.Execution.Root
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := openApp(dataDir, root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { restarted.Close() })
	if len(read(restarted, "local").Icons) != 3 || len(read(restarted, "remote").Icons) != 0 {
		t.Fatal("icons did not persist or leaked across environments")
	}
	for _, body := range []any{
		map[string]any{"id": "directory:/tmp", "appearance": resourceIcon{Icon: "code", Color: "blue"}},
		map[string]any{"id": "project:app", "appearance": resourceIcon{Icon: "<script>", Color: "blue"}},
		map[string]any{"id": "workspace:work", "appearance": resourceIcon{Icon: "folder", Color: "url(bad)"}},
	} {
		if code, raw := call(t, restarted, "PUT", "/api/resource-icons", body); code != 400 {
			t.Fatalf("invalid appearance accepted: %d %s", code, raw)
		}
	}
	if len(read(restarted, "local").Icons) != 3 {
		t.Fatal("rejected write changed saved icons")
	}
}

func TestResourceIconWritesStayOnHostAndRequireAuthentication(t *testing.T) {
	a := testApp(t)
	if _, err := newEnvironmentHub(a); err != nil {
		t.Fatal(err)
	}
	for _, valid := range []bool{false, true} {
		r := httptest.NewRequest("PUT", "http://localhost:4317/api/resource-icons?environment=offline", bytes.NewBufferString(`{"id":"project:app","appearance":{"icon":"code","color":"blue"}}`))
		r.Header.Set("X-Environment-ID", "offline")
		if valid {
			r.Header.Set("X-CSRF-Token", a.token)
		}
		w := httptest.NewRecorder()
		a.handler().ServeHTTP(w, r)
		want := 403
		if valid {
			want = 200
		}
		if w.Code != want {
			t.Fatalf("host icon write: %d %s", w.Code, w.Body.String())
		}
	}
	for _, url := range []string{"/api/shortcut-pins", "/api/assistant/conversations"} {
		if code, _ := call(t, a, "GET", url, nil); code != 404 {
			t.Fatalf("removed feature still available: %s %d", url, code)
		}
	}
}
