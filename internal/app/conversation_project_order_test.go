package app

import (
	"encoding/json"
	"html"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConversationProjectOrderBootstrapsAcrossPorts(t *testing.T) {
	a := testApp(t)
	order := []string{`["local","project","second"]`, `["remote","project","<first>"]`}
	if code, body := call(t, a, "PUT", "/api/settings/conversation-project-order", map[string][]string{"order": order}); code != http.StatusOK {
		t.Fatalf("save project order: %d %s", code, body)
	}
	page := httptest.NewRecorder()
	a.assetsHandler().ServeHTTP(page, httptest.NewRequest("GET", "http://localhost:58923/?app-page=shared-navigation", nil))
	value, _ := json.Marshal(order)
	attribute := `name="conversation-project-order" content="` + html.EscapeString(string(value)) + `"`
	if !strings.Contains(page.Body.String(), attribute) {
		t.Fatal("navigation bootstrap is missing the escaped saved order")
	}
}
