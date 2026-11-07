package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAppearancePersistsAcrossPortsEnvironmentsAndPageKinds(t *testing.T) {
	a := testApp(t)
	if a.uiColorTheme() != "mint" {
		t.Fatal("installations without a saved choice should use the Yolu mint palette")
	}
	for _, theme := range []string{"classic", "light", "dark", "system", "mint"} {
		if code, raw := call(t, a, "PUT", "/api/settings/appearance", map[string]string{"color_theme": theme}); code != http.StatusOK {
			t.Fatalf("save appearance: %d %s", code, raw)
		}
		r := httptest.NewRequest("GET", "http://localhost:58923/api/settings/appearance", nil)
		r.Header.Set("X-CSRF-Token", a.token)
		r.Header.Set("X-Environment-ID", "wsl-offline")
		w := httptest.NewRecorder()
		a.handler().ServeHTTP(w, r)
		var got map[string]string
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || got["color_theme"] != theme {
			t.Fatalf("restore global appearance: %d %s", w.Code, w.Body.String())
		}
		for _, url := range []string{"/", "/?workspace-tab=task", "/?workspace-tab=terminal&workspace-terminal=1"} {
			page := httptest.NewRecorder()
			a.assetsHandler().ServeHTTP(page, httptest.NewRequest("GET", "http://localhost"+url, nil))
			body := page.Body.String()
			if !strings.Contains(body, `name="ui-color-theme" content="`+theme+`"`) || !strings.Contains(body, `/core/appearance.js`) || !strings.Contains(body, `/core/appearance.css`) {
				t.Fatalf("missing saved appearance bootstrap for %s", url)
			}
		}
	}
}

func TestAppearanceRejectsInvalidAndUnauthenticatedChanges(t *testing.T) {
	a := testApp(t)
	for _, theme := range []string{"midnight", "", "Dark", `mint"><script>`} {
		if code, _ := call(t, a, "PUT", "/api/settings/appearance", map[string]string{"color_theme": theme}); code != http.StatusBadRequest {
			t.Fatalf("accepted unsupported appearance %q: %d", theme, code)
		}
	}
	r := httptest.NewRequest("PUT", "http://localhost/api/settings/appearance", bytes.NewBufferString(`{"color_theme":"classic"}`))
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code == http.StatusOK || a.uiColorTheme() != "mint" {
		t.Fatal("unauthenticated request changed the saved appearance")
	}
}
