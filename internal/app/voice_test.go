package app

import (
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
)

func TestVoiceSignalingRejectsInvalidReadOnlyAndUnauthenticatedRequests(t *testing.T) {
	a := testApp(t)
	for _, sdp := range []string{"", "offer", "v=0\r\nm=video"} {
		if code, _ := call(t, a, "POST", "/api/voice/sessions", map[string]string{"sdp": sdp}); code != http.StatusBadRequest {
			t.Fatalf("invalid offer accepted: %d", code)
		}
	}
	r := httptest.NewRequest("POST", "http://localhost/api/voice/sessions", strings.NewReader(`{"sdp":"v=0\r\nm=audio"}`))
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("unauthenticated offer accepted: %d", w.Code)
	}
	a.Execution.ReadOnlySessions = true
	if code, _ := call(t, a, "POST", "/api/voice/sessions", map[string]string{"sdp": "v=0\r\nm=audio"}); code != http.StatusMethodNotAllowed {
		t.Fatalf("read-only recording accepted: %d", code)
	}
	// Cleanup stays idempotent and available after a mode change.
	for range 2 {
		if code, _ := call(t, a, "DELETE", "/api/voice/sessions/expired", nil); code != http.StatusNoContent {
			t.Fatalf("cleanup failed: %d", code)
		}
	}
}

func TestNativeVoiceRejectsUnauthenticatedAndReadOnlyRequests(t *testing.T) {
	a := testApp(t)
	for _, path := range []string{"/api/voice/native/sessions", "/api/voice/native/sessions/expired/stop"} {
		r := httptest.NewRequest("POST", "http://localhost"+path, nil)
		w := httptest.NewRecorder()
		a.handler().ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("unauthenticated native voice request accepted: %s: %d", path, w.Code)
		}
	}
	if runtime.GOOS != "linux" {
		return
	}
	a.Execution.ReadOnlySessions = true
	if code, _ := call(t, a, "POST", "/api/voice/native/sessions", nil); code != http.StatusMethodNotAllowed {
		t.Fatalf("read-only native recording accepted: %d", code)
	}
}
