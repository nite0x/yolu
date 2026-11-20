package app

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChatInputPreferencePersistsAcrossPagesPortsAndEnvironments(t *testing.T) {
	a := testApp(t)
	if a.uiSendShortcut() != "enter" {
		t.Fatal("installations without a saved preference should use Enter")
	}
	for _, shortcut := range []string{"enter", "ctrlEnter"} {
		if code, raw := call(t, a, "PUT", "/api/settings/chat-input", map[string]string{"send_shortcut": shortcut}); code != http.StatusOK {
			t.Fatalf("save shortcut: %d %s", code, raw)
		}
		r := httptest.NewRequest("GET", "http://localhost:58923/api/settings/chat-input", nil)
		r.Header.Set("X-CSRF-Token", a.token)
		r.Header.Set("X-Environment-ID", "wsl-offline")
		w := httptest.NewRecorder()
		a.handler().ServeHTTP(w, r)
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"send_shortcut":"`+shortcut+`"`) {
			t.Fatalf("restore global shortcut: %d %s", w.Code, w.Body.String())
		}
		for _, url := range []string{"/", "/?workspace-page=workspace"} {
			page := httptest.NewRecorder()
			a.assetsHandler().ServeHTTP(page, httptest.NewRequest("GET", "http://localhost"+url, nil))
			if !strings.Contains(page.Body.String(), `name="ui-send-shortcut" content="`+shortcut+`"`) || !strings.Contains(page.Body.String(), `/core/chat-input.js`) {
				t.Fatalf("missing saved shortcut bootstrap for %s", url)
			}
		}
	}
}

func TestChatInputRejectsInvalidAndUnauthenticatedChanges(t *testing.T) {
	a := testApp(t)
	for _, shortcut := range []string{"", "Enter", "shiftEnter", `enter"><script>`} {
		if code, _ := call(t, a, "PUT", "/api/settings/chat-input", map[string]string{"send_shortcut": shortcut}); code != http.StatusBadRequest {
			t.Fatalf("accepted unsupported shortcut %q: %d", shortcut, code)
		}
	}
	r := httptest.NewRequest("PUT", "http://localhost/api/settings/chat-input", bytes.NewBufferString(`{"send_shortcut":"ctrlEnter"}`))
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code == http.StatusOK || a.uiSendShortcut() != "enter" {
		t.Fatal("unauthenticated request changed the shortcut")
	}
}
