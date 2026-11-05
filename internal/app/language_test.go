package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLanguagePreferencePersistsAcrossPortsAndEnvironmentSelection(t *testing.T) {
	a := testApp(t)
	for _, choice := range []string{"system", "en", "zh-CN"} {
		if code, raw := call(t, a, "PUT", "/api/settings/language", map[string]string{"language": choice}); code != http.StatusOK {
			t.Fatalf("save language: %d %s", code, raw)
		}
		r := httptest.NewRequest("GET", "http://localhost:58923/api/settings/language", nil)
		r.Header.Set("X-CSRF-Token", a.token)
		r.Header.Set("X-Environment-ID", "wsl-offline")
		w := httptest.NewRecorder()
		a.handler().ServeHTTP(w, r)
		var got map[string]string
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || got["language"] != choice {
			t.Fatalf("restore preference: %d %s", w.Code, w.Body.String())
		}
		page := httptest.NewRecorder()
		a.assetsHandler().ServeHTTP(page, httptest.NewRequest("GET", "http://localhost/", nil))
		if !strings.Contains(page.Body.String(), `name="ui-language" content="`+choice+`"`) {
			t.Fatalf("missing bootstrap language %s", choice)
		}
	}
}

func TestLanguageRejectsInvalidAndUnauthenticatedChanges(t *testing.T) {
	a := testApp(t)
	for _, choice := range []string{"de", "", "en\"><script>"} {
		if code, _ := call(t, a, "PUT", "/api/settings/language", map[string]string{"language": choice}); code != http.StatusBadRequest {
			t.Fatalf("accepted unsupported language %q: %d", choice, code)
		}
	}
	r := httptest.NewRequest("PUT", "http://localhost/api/settings/language", bytes.NewBufferString(`{"language":"en"}`))
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code == http.StatusOK {
		t.Fatal("accepted unauthenticated preference change")
	}
	if got := a.uiLanguage(); got != "system" {
		t.Fatalf("invalid request changed preference: %s", got)
	}
}
