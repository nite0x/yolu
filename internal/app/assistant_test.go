package app

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAssistantAuthenticationAndLocalStorageRouting(t *testing.T) {
	app := testApp(t)
	handler := app.handler()
	call := func(method, path, body, token, origin, environment string) int {
		request := httptest.NewRequest(method, "http://localhost:4317"+path, strings.NewReader(body))
		request.Header.Set("X-CSRF-Token", token)
		request.Header.Set("Origin", origin)
		request.Header.Set("X-Environment-ID", environment)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response.Code
	}
	for _, tc := range []struct {
		token, origin string
		status        int
	}{
		{"", "", 403}, {app.token, "http://other.invalid", 403}, {app.token, "http://localhost:4317", 200},
	} {
		if status := call("GET", "/api/assistant/conversations", "", tc.token, tc.origin, "local"); status != tc.status {
			t.Fatalf("auth %d, want %d", status, tc.status)
		}
	}
	// Unknown selected environments cannot redirect global history away from local storage.
	if status := call("POST", "/api/assistant/conversations", `{"id":"local-assistant"}`, app.token, "", "offline-environment"); status != 201 {
		t.Fatalf("local assistant routing: %d", status)
	}
	app.Execution.ReadOnlySessions = true
	if status := call("GET", "/api/assistant/conversations/local-assistant", "", app.token, "", "local"); status != 200 {
		t.Fatalf("read-only history: %d", status)
	}
	if status := call("POST", "/api/assistant/conversations", `{"id":"blocked"}`, app.token, "", "local"); status != 405 {
		t.Fatalf("read-only create: %d", status)
	}
	if status := call("POST", "/api/assistant/conversations/local-assistant/runs", `{"request_id":"blocked","text":"test"}`, app.token, "", "local"); status != 405 {
		t.Fatalf("read-only send: %d", status)
	}
}
