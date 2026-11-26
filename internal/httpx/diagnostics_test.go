package httpx

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"worktree-hub/internal/apitypes"
)

func TestDiagnosticsPreservesStreamsAndNestedEnvironmentIdentity(t *testing.T) {
	var first string
	inner := Diagnostics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if w.Header().Get("X-Request-ID") != first || RequestLogger(r.Context()) == nil {
			t.Fatal("nested request lost correlation")
		}
		if _, ok := w.(http.Flusher); !ok {
			t.Fatal("SSE flushing was hidden")
		}
		WriteErrorCode(w, 409, "creation_uncertain", "Inspect the list")
	}))
	handler := Diagnostics(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		first = w.Header().Get("X-Request-ID")
		inner.ServeHTTP(w, r)
	}))
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "http://localhost/api/sessions/new", nil)
	r.Header.Set("X-Request-ID", "untrusted")
	handler.ServeHTTP(w, r)
	var payload apitypes.APIErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if first == "" || first == "untrusted" || payload.RequestID != first || payload.Code != "creation_uncertain" {
		t.Fatalf("%s: %+v", first, payload)
	}
}
