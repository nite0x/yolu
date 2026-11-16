package app

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"worktree-hub/internal/terminal"
)

func freeBrowserPort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	return port
}

func browserRequest(t *testing.T, a *App, method, path, body string, cookie *http.Cookie, csrf bool) *http.Response {
	t.Helper()
	address := "http://127.0.0.1:" + strconv.Itoa(a.browser.config.Port)
	r, err := http.NewRequest(method, address+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodGet {
		r.Header.Set("Origin", address)
	}
	if path == "/browser-login" {
		r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	} else {
		r.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	if csrf {
		r.Header.Set("X-CSRF-Token", a.token)
	}
	client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	t.Cleanup(client.CloseIdleConnections)
	response, err := client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}

func pairBrowser(t *testing.T, a *App) *http.Cookie {
	t.Helper()
	response := browserRequest(t, a, "POST", "/browser-login", url.Values{"code": {a.browser.config.Code}}.Encode(), nil, false)
	if response.StatusCode != http.StatusSeeOther || len(response.Cookies()) != 1 {
		t.Fatalf("pairing failed: %d", response.StatusCode)
	}
	cookie := response.Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("missing browser cookie protections")
	}
	return cookie
}

func TestBrowserAccessAuthenticationAndSharedWorkspace(t *testing.T) {
	a := testApp(t)
	if a.browser.config.Enabled || a.browser.server != nil {
		t.Fatal("new profiles must default to local access")
	}
	port := freeBrowserPort(t)
	if err := a.browser.configure(context.Background(), true, port, false); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/", "/?workspace-page=test", "/chat/assistant.js", "/workspace.html"} {
		if response := browserRequest(t, a, "GET", path, "", nil, false); response.StatusCode != http.StatusSeeOther {
			t.Fatalf("unpaired page %s: %d", path, response.StatusCode)
		}
	}
	for _, path := range []string{"/api/state", "/terminal-stream/example"} {
		if response := browserRequest(t, a, "GET", path, "", nil, true); response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("instance token bypassed pairing for %s: %d", path, response.StatusCode)
		}
	}
	response := browserRequest(t, a, "GET", "/browser-login", "", nil, false)
	// no-referrer causes HTML form POSTs to send Origin: null in Chromium.
	if response.Header.Get("Referrer-Policy") != "same-origin" {
		t.Fatal("login forms must retain a same-origin Origin header")
	}
	page, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || strings.Contains(string(page), a.token) || strings.Contains(string(page), a.browser.config.Code) {
		t.Fatal("login page disclosed application credentials")
	}
	if response := browserRequest(t, a, "POST", "/browser-login", "code=wrong", nil, false); response.StatusCode != 401 {
		t.Fatal("wrong pairing code accepted")
	}
	cookie := pairBrowser(t, a)
	response = browserRequest(t, a, "GET", "/", "", cookie, false)
	page, _ = io.ReadAll(response.Body)
	if response.StatusCode != 200 || !strings.Contains(string(page), a.token) {
		t.Fatal("authenticated browser did not receive the shared application")
	}
	if response := browserRequest(t, a, "GET", "/api/state", "", cookie, false); response.StatusCode != 403 {
		t.Fatal("pairing bypassed CSRF checks")
	}
	response = browserRequest(t, a, "GET", "/api/state", "", cookie, true)
	var state struct {
		Root string `json:"root"`
	}
	if err := json.NewDecoder(response.Body).Decode(&state); err != nil || response.StatusCode != 200 || state.Root != a.Workspace.Root {
		t.Fatalf("browser did not use the host workspace: %d %v", response.StatusCode, err)
	}
	response = browserRequest(t, a, "GET", "/api/settings/browser-access", "", cookie, true)
	var settings struct {
		Code      string `json:"code"`
		CanManage bool   `json:"can_manage"`
	}
	if err := json.NewDecoder(response.Body).Decode(&settings); err != nil || settings.Code != "" || settings.CanManage {
		t.Fatal("remote browser received pairing management credentials")
	}
	for _, path := range []string{"/api/settings/browser-access", "/api/service/stop", "/api/dialogs/directory"} {
		method := "POST"
		if path == "/api/settings/browser-access" {
			method = "PUT"
		}
		if response := browserRequest(t, a, method, path, `{}`, cookie, true); response.StatusCode != 403 {
			t.Fatalf("remote browser reached host control %s: %d", path, response.StatusCode)
		}
	}
	response = browserRequest(t, a, "PUT", "/api/settings/language", `{"language":"en"}`, cookie, true)
	if response.StatusCode != 200 || a.uiLanguage() != "en" {
		t.Fatal("authenticated browser write did not update shared preferences")
	}
	response = browserRequest(t, a, "POST", "/browser-logout", "", cookie, false)
	if response.StatusCode != 303 || len(response.Cookies()) != 1 || response.Cookies()[0].MaxAge != -1 {
		t.Fatal("browser logout did not clear its cookie")
	}
}

func TestBrowserAccessHostOriginAndCookieValidation(t *testing.T) {
	a := testApp(t)
	port := freeBrowserPort(t)
	if err := a.browser.configure(context.Background(), true, port, false); err != nil {
		t.Fatal(err)
	}
	cookie := pairBrowser(t, a)
	handler := a.browser.handler(a.handler())
	address := "http://127.0.0.1:" + strconv.Itoa(port)
	for _, scenario := range []struct {
		name, path, host, origin, code string
		status                         int
	}{
		{"foreign-host", "/", "evil.example:" + strconv.Itoa(port), "", "", 403},
		{"wrong-port", "/", "127.0.0.1:1", "", "", 403},
		{"foreign-login-origin", "/browser-login", "", "http://evil.example", "code=" + a.browser.config.Code, 403},
		{"missing-login-origin", "/browser-login", "", "", "code=" + a.browser.config.Code, 403},
		{"foreign-api-origin", "/api/settings/language", "", "http://evil.example", `{"language":"en"}`, 403},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", address+scenario.path, strings.NewReader(scenario.code))
			if scenario.host != "" {
				r.Host = scenario.host
			}
			r.Header.Set("Origin", scenario.origin)
			r.Header.Set("X-CSRF-Token", a.token)
			r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			r.AddCookie(cookie)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != scenario.status {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
		})
	}
	for _, path := range []string{"/browser-login", "/api/settings/browser-access"} {
		r := httptest.NewRequest("GET", "http://localhost:4317"+path, nil)
		r.Host = "192.168.1.20:4317"
		w := httptest.NewRecorder()
		a.handler().ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("desktop transport accepted a nonlocal host")
		}
	}
	bad := *cookie
	bad.Value += "tampered"
	if response := browserRequest(t, a, "GET", "/api/state", "", &bad, true); response.StatusCode != 401 {
		t.Fatal("tampered cookie accepted")
	}
	expires := strconv.FormatInt(time.Now().Add(-time.Minute).Unix(), 10)
	bad.Value = expires + "." + browserSignature(a.browser.sessionKey, expires)
	if validBrowserSession(&bad, a.browser.sessionKey) {
		t.Fatal("expired cookie accepted")
	}
}

func TestBrowserAccessPersistencePortConflictAndRevocation(t *testing.T) {
	a := testApp(t)
	ctx := context.Background()
	port := freeBrowserPort(t)
	if err := a.browser.configure(ctx, true, port, false); err != nil {
		t.Fatal(err)
	}
	cookie := pairBrowser(t, a)
	oldCode := a.browser.config.Code
	occupied, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	if err := a.browser.configure(ctx, true, occupied.Addr().(*net.TCPAddr).Port, false); err == nil {
		t.Fatal("occupied port accepted")
	}
	if a.browser.config.Port != port {
		t.Fatal("port failure changed active settings")
	}
	if response := browserRequest(t, a, "GET", "/api/state", "", cookie, true); response.StatusCode != 200 {
		t.Fatal("port failure interrupted current access")
	}
	if err := a.browser.configure(ctx, true, port, true); err != nil {
		t.Fatal(err)
	}
	if a.browser.config.Code == oldCode {
		t.Fatal("pairing code was not changed")
	}
	if response := browserRequest(t, a, "GET", "/api/state", "", cookie, true); response.StatusCode != 401 {
		t.Fatal("old browser session survived code rotation")
	}
	data, root, code := a.Workspace.DataDir, a.Workspace.Root, a.browser.config.Code
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := openApp(data, root)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err := reopened.browser.restore(); err != nil {
		t.Fatal(err)
	}
	if reopened.browser.config.Code != code {
		t.Fatal("saved pairing code did not survive restart")
	}
	cookie = pairBrowser(t, reopened)
	if err := reopened.browser.configure(ctx, false, port, false); err != nil {
		t.Fatal(err)
	}
	if reopened.browser.server != nil {
		t.Fatal("disabled listener is still active")
	}
	l, err := net.Listen("tcp4", "0.0.0.0:"+strconv.Itoa(port))
	if err != nil {
		t.Fatalf("disabled listener retained its port: %v", err)
	}
	_ = l.Close()
	if err := reopened.browser.configure(ctx, true, port, false); err != nil {
		t.Fatal(err)
	}
	if response := browserRequest(t, reopened, "GET", "/api/state", "", cookie, true); response.StatusCode != 401 {
		t.Fatal("old browser session survived disable and enable")
	}
}

func TestBrowserAccessSaveFailurePreservesListener(t *testing.T) {
	a := testApp(t)
	port := freeBrowserPort(t)
	if err := a.browser.configure(context.Background(), true, port, false); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(a.Workspace.DataDir, "browser-access.json")
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(file, 0700); err != nil {
		t.Fatal(err)
	}
	if err := a.browser.configure(context.Background(), true, freeBrowserPort(t), true); err == nil {
		t.Fatal("save failure was ignored")
	}
	cookie := pairBrowser(t, a)
	if response := browserRequest(t, a, "GET", "/api/state", "", cookie, true); response.StatusCode != 200 {
		t.Fatal("save failure interrupted active access")
	}
}

func TestBrowserAccessDisableClosesHijackedConnections(t *testing.T) {
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	listener := &browserListener{Listener: l, connections: make(map[*browserConn]struct{})}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_, _, _ = conn.ReadMessage()
	})}
	go server.Serve(listener)
	defer server.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws://"+l.Addr().String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := server.Close(); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := conn.ReadMessage(); err == nil {
		t.Fatal("hijacked connection survived shutdown")
	} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
		t.Fatal("hijacked connection was left open")
	}
}

func TestBrowserAccessTerminalRequiresPairingAndStreamTicket(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix shell integration")
	}
	a := testApp(t)
	project := register(t, a, "Repo", repo(t, "repo", "master"))
	_, task, _ := create(t, a, project, nil, "lan-terminal")
	if err := a.browser.configure(context.Background(), true, freeBrowserPort(t), false); err != nil {
		t.Fatal(err)
	}
	cookie := pairBrowser(t, a)
	body, _ := json.Marshal(map[string]any{"task_id": task.ID, "project_id": project, "profile_id": "custom", "executable": "/bin/sh", "args": []string{"-i"}})
	response := browserRequest(t, a, "POST", "/api/terminals", string(body), cookie, true)
	var info terminal.Info
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil || response.StatusCode != 201 {
		t.Fatalf("create terminal: %d %v", response.StatusCode, err)
	}
	response = browserRequest(t, a, "POST", "/api/terminals/"+info.ID+"/ticket", `{}`, cookie, true)
	var ticket struct {
		Ticket string `json:"ticket"`
	}
	if err := json.NewDecoder(response.Body).Decode(&ticket); err != nil || response.StatusCode != 200 {
		t.Fatalf("issue stream ticket: %d %v", response.StatusCode, err)
	}
	address := "127.0.0.1:" + strconv.Itoa(a.browser.config.Port)
	streamURL := "ws://" + address + "/terminal-stream/" + info.ID
	headers := http.Header{"Origin": {"http://" + address}}
	if conn, response, err := websocket.DefaultDialer.Dial(streamURL, headers); err == nil {
		conn.Close()
		t.Fatal("unpaired browser opened a terminal stream")
	} else if response == nil || response.StatusCode != 401 {
		t.Fatalf("unpaired stream was not rejected: %v", err)
	}
	headers.Set("Cookie", cookie.Name+"="+cookie.Value)
	conn, _, err := websocket.DefaultDialer.Dial(streamURL, headers)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if err := conn.WriteJSON(map[string]any{"ticket": ticket.Ticket}); err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteJSON(map[string]string{"type": "input", "data": "printf 'LAN_TERMINAL_OK\\n'\n"}); err != nil {
		t.Fatal(err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	var output strings.Builder
	for !strings.Contains(output.String(), "LAN_TERMINAL_OK") {
		var message struct {
			Data []byte `json:"data"`
		}
		if err := conn.ReadJSON(&message); err != nil {
			t.Fatalf("terminal output: %v", err)
		}
		output.Write(message.Data)
	}
	if err := a.browser.configure(context.Background(), false, a.browser.config.Port, false); err != nil {
		t.Fatal(err)
	}
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
				t.Fatal("terminal stream survived disabling browser access")
			}
			break
		}
	}
}
