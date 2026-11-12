package web

import (
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

func TestTerminalPageUsesScopedStyleNonceAndLocalBundle(t *testing.T) {
	w := httptest.NewRecorder()
	Handler("test-token", false).ServeHTTP(w, httptest.NewRequest("GET", "http://localhost/?workspace-page=terminal&workspace-terminal=1", nil))
	body := w.Body.String()
	match := regexp.MustCompile(`name="style-nonce" content="([^"]+)"`).FindStringSubmatch(body)
	if len(match) != 2 || match[1] == "__STYLE_NONCE__" {
		t.Fatal("missing terminal style nonce")
	}
	csp := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "'nonce-"+match[1]+"'") || strings.Contains(csp, "unsafe-inline") || !strings.Contains(csp, "script-src 'self'") {
		t.Fatalf("unexpected policy: %s", csp)
	}
	if !strings.Contains(body, `src="/ui/terminal.js"`) || !strings.Contains(body, `content="test-token"`) {
		t.Fatal("terminal bundle/token missing")
	}
	ordinary := httptest.NewRecorder()
	Handler("test-token", false).ServeHTTP(ordinary, httptest.NewRequest("GET", "http://localhost/?workspace-page=conversation", nil))
	if strings.Contains(ordinary.Header().Get("Content-Security-Policy"), "nonce-") {
		t.Fatal("terminal style policy leaked into conversation page")
	}
}
