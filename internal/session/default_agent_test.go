package session

import (
	"net/http"
	"strings"
	"testing"
)

func TestDefaultAgentPersistsIndependentlyOfProviderPreferences(t *testing.T) {
	a := testApp(t)
	endpoint := "/api/settings/default-agent"
	if code, raw := call(t, a, http.MethodGet, endpoint, nil); code != 200 || !strings.Contains(string(raw), `"provider":"codex"`) {
		t.Fatalf("initial default: %d %s", code, raw)
	}
	if code, raw := call(t, a, http.MethodPut, endpoint, map[string]string{"provider": "agy"}); code != 200 {
		t.Fatalf("save: %d %s", code, raw)
	}
	restored := New(a.Execution)
	t.Cleanup(restored.Close)
	if code, raw := call(t, &App{Service: restored, Projects: a.Projects, token: a.token}, http.MethodGet, endpoint, nil); code != 200 || !strings.Contains(string(raw), `"provider":"agy"`) {
		t.Fatalf("restored default: %d %s", code, raw)
	}
	for _, provider := range []string{"", "unknown"} {
		if code, raw := call(t, a, http.MethodPut, endpoint, map[string]string{"provider": provider}); code != 400 {
			t.Fatalf("invalid default accepted: %d %s", code, raw)
		}
	}
	other := testApp(t)
	if code, raw := call(t, other, http.MethodGet, endpoint, nil); code != 200 || !strings.Contains(string(raw), `"provider":"codex"`) {
		t.Fatalf("default leaked to another environment: %d %s", code, raw)
	}
	var count int
	if err := a.Execution.Store.DB.QueryRow(`SELECT count(*) FROM settings WHERE key LIKE 'conversation_defaults:%'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("default agent changed provider preferences: %d %v", count, err)
	}
}
