package session

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
)

type fakeSessionClient struct {
	request func(string, map[string]any) (any, error)
}

func (c *fakeSessionClient) Close() {}
func (c *fakeSessionClient) Call(method string, params any, out any) error {
	value, err := c.request(method, params.(map[string]any))
	if err != nil {
		return err
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}

func fakeSessions(a *App, sessions map[string]codex.Session) {
	a.openSessions = func(context.Context) (codex.SessionClient, error) {
		return &fakeSessionClient{request: func(method string, p map[string]any) (any, error) {
			if method == "thread/read" {
				if p["includeTurns"] != false {
					return nil, fmt.Errorf("must not read transcripts")
				}
				s, ok := sessions[p["threadId"].(string)]
				if !ok {
					return nil, fmt.Errorf("session not found")
				}
				return map[string]any{"thread": s}, nil
			}
			if method != "thread/list" {
				return nil, fmt.Errorf("unexpected method %s", method)
			}
			page := codex.SessionPage{Data: []codex.Session{}}
			for _, s := range sessions {
				if paths, ok := p["cwd"].([]string); ok {
					matches := false
					for _, path := range paths {
						if s.Cwd == path {
							matches = true
						}
					}
					if !matches {
						continue
					}
				}
				page.Data = append(page.Data, s)
			}
			return page, nil
		}}, nil
	}
}

func getProjectSessions(t *testing.T, a *App, id string) []model.Session {
	t.Helper()
	code, raw := call(t, a, "GET", "/api/sessions?project_id="+id, nil)
	if code != 200 {
		t.Fatalf("sessions %d: %s", code, raw)
	}
	var result struct {
		Sessions []model.Session `json:"sessions"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result.Sessions
}

func TestSessionListIncludesCurrentChatActivityWithoutPersistingIt(t *testing.T) {
	a, q, _, _ := chatFixture(t)
	fakeSessions(a, map[string]codex.Session{"session": {ID: "session", Cwd: q.Path}})
	run := &ChatRun{state: ChatState{ID: "run", Status: "running", Busy: true, TurnID: "turn"}}
	a.chats["session"] = run
	// Remove the synthetic run before fixture cleanup tries to stop it.
	defer delete(a.chats, "session")
	for _, status := range []string{"running", "waiting", "stopping"} {
		run.mu.Lock()
		run.state.Status = status
		run.mu.Unlock()
		got := getProjectSessions(t, a, q.ProjectID)
		if len(got) != 1 || got[0].ChatStatus != status || got[0].CompletedRun != "" {
			t.Fatalf("active session: %+v", got)
		}
	}
	run.mu.Lock()
	run.state.Busy, run.state.Status = false, "completed"
	run.mu.Unlock()
	got := getProjectSessions(t, a, q.ProjectID)
	if got[0].ChatStatus != "" || got[0].CompletedRun != "run" {
		t.Fatalf("completed session: %+v", got)
	}
	stored, err := a.Execution.Store.Sessions()
	if err != nil || stored[0].ChatStatus != "" || stored[0].CompletedRun != "" {
		t.Fatalf("runtime activity persisted: %+v, %v", stored, err)
	}
	a.openSessions = func(context.Context) (codex.SessionClient, error) { return nil, fmt.Errorf("offline") }
	got = getProjectSessions(t, a, q.ProjectID)
	if got[0].CompletedRun != "run" {
		t.Fatalf("runtime activity lost on metadata failure: %+v", got)
	}
}

func TestSessionActivityTracksManagedTerminalStatus(t *testing.T) {
	b := &terminalBridge{session: "terminal", connected: true, bound: true}
	a := &Service{bridges: map[string]*terminalBridge{"bridge": b}}
	for _, step := range []struct{ event, want string }{
		{`{"method":"turn/started","params":{"threadId":"terminal"}}`, "running"},
		{`{"method":"thread/status/changed","params":{"threadId":"terminal","status":{"type":"active","activeFlags":["waitingOnUserInput"]}}}`, "waiting"},
		{`{"method":"turn/completed","params":{"threadId":"terminal"}}`, ""},
	} {
		b.observe([]byte(step.event))
		s := model.Session{ID: "terminal"}
		a.decorateSessionActivity(&s)
		if s.ChatStatus != step.want {
			t.Fatalf("status = %q, want %q", s.ChatStatus, step.want)
		}
	}
}

func TestSessionPaginationAndPickerSearch(t *testing.T) {
	a := testApp(t)
	p := register(t, a, "Repo", repo(t, "repo", "master"))
	q := newTestDirectory(t, a, p, "pages")
	requests := 0
	a.openSessions = func(context.Context) (codex.SessionClient, error) {
		return &fakeSessionClient{request: func(method string, params map[string]any) (any, error) {
			if method != "thread/list" {
				return nil, fmt.Errorf("unexpected read")
			}
			if !reflect.DeepEqual(params["sourceKinds"], []string{"cli", "vscode", "appServer"}) {
				t.Fatal(params)
			}
			if params["cwd"] == nil {
				if params["cursor"] != "opaque" || params["searchTerm"] != "test title" {
					t.Fatal(params)
				}
				return codex.SessionPage{Data: []codex.Session{{ID: "picker", Preview: strings.Repeat("x", 500), Cwd: "/tmp"}}}, nil
			}
			requests++
			if params["cursor"] == nil {
				next := "page2"
				return codex.SessionPage{Data: []codex.Session{{ID: "one", Cwd: q.Path}}, NextCursor: &next}, nil
			}
			return codex.SessionPage{Data: []codex.Session{{ID: "two", Cwd: q.Path}, {ID: "foreign", Cwd: q.Path + "-other"}}}, nil
		}}, nil
	}
	if got := getProjectSessions(t, a, q.ProjectID); len(got) != 2 || requests != 2 {
		t.Fatalf("pagination %+v %d", got, requests)
	}
	code, raw := call(t, a, "GET", "/api/codex/sessions?cursor=opaque&search=test%20title", nil)
	if code != 200 || strings.Contains(string(raw), strings.Repeat("x", 161)) {
		t.Fatalf("picker %d %s", code, raw)
	}
}

func TestSessionErrorsAreVisibleAndDoNotLaunch(t *testing.T) {
	a := testApp(t)
	p := register(t, a, "Repo", repo(t, "repo", "master"))
	q := newTestDirectory(t, a, p, "errors")
	a.openSessions = func(context.Context) (codex.SessionClient, error) { return nil, fmt.Errorf("Codex unavailable") }
	if code, raw := call(t, a, "GET", "/api/codex/sessions", nil); code != 503 || !strings.Contains(string(raw), "Codex unavailable") {
		t.Fatalf("%d %s", code, raw)
	}
	if err := a.SaveSession(codex.Session{ID: "cached", Cwd: q.Path, Name: "Saved session"}, "manual"); err != nil {
		t.Fatal(err)
	}
	if code, raw := call(t, a, "GET", "/api/sessions?project_id="+q.ProjectID, nil); code != 200 || !strings.Contains(string(raw), "Codex unavailable") || !strings.Contains(string(raw), "Saved session") || !strings.Contains(string(raw), `"available":false`) {
		t.Fatalf("%d %s", code, raw)
	}
	if code, _ := call(t, a, "GET", "/api/sessions?project_id=missing", nil); code != 404 {
		t.Fatal(code)
	}
}

// Optional compatibility smoke check against the installed CLI. This only
// lists and reads saved records; it never resumes a session or starts an agent turn.
func TestInstalledCodexSessionProtocol(t *testing.T) {
	if os.Getenv("WORKTREE_HUB_TEST_INSTALLED_CODEX") != "1" {
		t.Skip("opt-in installed CLI compatibility check")
	}
	c, err := codex.OpenSessionClient(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	page, err := sessionList(c, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Data) > 0 {
		s, err := readSession(c, page.Data[0].ID)
		if err != nil || s.ID != page.Data[0].ID || !filepath.IsAbs(s.Cwd) {
			t.Fatalf("metadata read failed: %v", err)
		}
		if _, err := readSessionHistory(c, s, ""); err != nil {
			t.Fatalf("saved history read failed: %v", err)
		}
	}
	page, err = sessionList(c, map[string]any{"cwd": []string{filepath.Join(t.TempDir(), "no-sessions")}})
	if err != nil || len(page.Data) != 0 {
		t.Fatalf("directory filter failed: %v", err)
	}
}
