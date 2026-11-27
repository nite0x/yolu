package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"worktree-hub/internal/acp"
	"worktree-hub/internal/codex"
	"worktree-hub/internal/model"
)

func TestSavedSessionListUsesScopeWithoutStartingProviders(t *testing.T) {
	a := testApp(t)
	cwd, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, session := range []model.Session{
		{ID: "active", Cwd: cwd, Provider: model.ProviderCursor},
		{ID: "archived", Cwd: cwd, Provider: model.ProviderCodex},
		{ID: "other", Cwd: t.TempDir(), Provider: model.ProviderCodex},
		{ID: "cloud", Cwd: cwd, Provider: model.ProviderCodexCloud},
	} {
		if err := a.Execution.Store.SaveSession(session); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.Execution.Store.OrganizeSession("archived", true, true); err != nil {
		t.Fatal(err)
	}
	noCodex := func(context.Context) (codex.SessionClient, error) {
		t.Error("saved list started Codex")
		return nil, fmt.Errorf("offline")
	}
	noACP := func(context.Context, ...string) (acp.Client, acp.InitializeResult, error) {
		t.Error("saved list started an ACP provider")
		return nil, acp.InitializeResult{}, fmt.Errorf("offline")
	}
	a.openSessions, a.openCloudSessions = noCodex, noCodex
	a.openAgy, a.openCursor = noACP, noACP

	for _, tc := range []struct {
		query, id string
	}{
		{"&cwd=" + url.QueryEscape(cwd), "active"},
		{"&archived=true", "archived"},
	} {
		code, raw := call(t, a, "GET", "/api/sessions?cached=1"+tc.query, nil)
		var response struct {
			Sessions []model.Session `json:"sessions"`
		}
		if code != 200 || json.Unmarshal(raw, &response) != nil || len(response.Sessions) != 1 ||
			response.Sessions[0].ID != tc.id || !response.Sessions[0].Available {
			t.Fatalf("saved list %s: %d %s", tc.query, code, raw)
		}
	}
	code, raw := call(t, a, "GET", "/api/sessions?cached=1", nil)
	var response struct {
		Sessions []model.Session `json:"sessions"`
	}
	if code != 200 || json.Unmarshal(raw, &response) != nil || len(response.Sessions) != 2 {
		t.Fatalf("saved local list: %d %s", code, raw)
	}
	for _, session := range response.Sessions {
		if session.Provider == model.ProviderCodexCloud {
			t.Fatalf("saved list exposed an unverified cloud session: %s", raw)
		}
	}
}

func TestCatalogCoalescesPaginationAndReturnsIndependentMaps(t *testing.T) {
	a := testApp(t)
	var opens, lists atomic.Int32
	entered, release := make(chan struct{}), make(chan struct{})
	a.openSessions = func(context.Context) (codex.SessionClient, error) {
		opens.Add(1)
		return &fakeSessionClient{request: func(method string, params map[string]any) (any, error) {
			if method != "thread/list" {
				return nil, fmt.Errorf("unexpected %s", method)
			}
			if lists.Add(1) == 1 {
				close(entered)
				<-release
			}
			return codex.SessionPage{Data: []codex.Session{{ID: "s", Name: "Title", Cwd: "/repo"}}}, nil
		}}, nil
	}
	first := make(chan map[string]codex.Session, 1)
	go func() {
		found, _ := a.sessionCatalog(context.Background(), sessionScope{}, false, false)
		first <- found
	}()
	<-entered
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := a.sessionCatalog(ctx, sessionScope{}, false, false); err == nil {
		t.Fatal("cancelled waiter did not leave")
	}
	second := make(chan map[string]codex.Session, 1)
	go func() {
		found, _ := a.sessionCatalog(context.Background(), sessionScope{}, false, false)
		second <- found
	}()
	close(release)
	one, two := <-first, <-second
	one["injected"] = codex.Session{ID: "injected"}
	if _, ok := two["injected"]; ok {
		t.Fatal("request maps alias shared cache")
	}
	if opens.Load() != 1 || lists.Load() != 1 {
		t.Fatalf("open=%d list=%d", opens.Load(), lists.Load())
	}
	if _, err := a.sessionCatalog(context.Background(), sessionScope{}, false, true); err != nil {
		t.Fatal(err)
	}
	if lists.Load() != 2 {
		t.Fatal("force did not refresh")
	}
	a.invalidateSessionCatalog()
	if _, err := a.sessionCatalog(context.Background(), sessionScope{}, false, false); err != nil {
		t.Fatal(err)
	}
	if lists.Load() != 3 {
		t.Fatal("mutation did not invalidate")
	}
}

func TestWorktreeReservationRejectsLiveChatAndAllowsGitOnlyInstall(t *testing.T) {
	a, q, _, endpoint := chatFixture(t)
	startFakeChat(t, a, endpoint)
	if release, err := a.ReserveWorktree(context.Background(), q.Path); err == nil {
		release()
		t.Fatal("active chat accepted")
	}
	b := testApp(t)
	b.openSessions = func(context.Context) (codex.SessionClient, error) {
		return nil, fmt.Errorf("not installed: %w", exec.ErrNotFound)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	release, err := b.ReserveWorktree(ctx, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if b.controlMu.TryLock() {
		b.controlMu.Unlock()
		t.Fatal("reservation not held")
	}
	release()
	if !b.controlMu.TryLock() {
		t.Fatal("reservation not released")
	}
	b.controlMu.Unlock()
}

func TestWorktreeReservationFindsNativeSessionInSubdirectory(t *testing.T) {
	a := testApp(t)
	root := t.TempDir()
	native := codex.Session{ID: "native-child", Cwd: filepath.Join(root, "src")}
	native.Status.Type = "active"
	fakeSessions(a, map[string]codex.Session{native.ID: native})
	if release, err := a.ReserveWorktree(context.Background(), root); err == nil {
		release()
		t.Fatal("native subdirectory session missed")
	}
	if !a.controlMu.TryLock() {
		t.Fatal("failed reservation leaked lock")
	}
	a.controlMu.Unlock()
}

func TestSessionSearchUsesSavedIndexAndDiscoversTitlesWithoutThreadReads(t *testing.T) {
	a := testApp(t)
	for _, session := range []model.Session{
		{ID: "saved", Name: "Saved archived chat", Cwd: t.TempDir(), Source: "manual"},
		{ID: "agy", Name: "Antigravity chat", Cwd: t.TempDir(), Source: "agy", Provider: model.ProviderAgy},
	} {
		if err := a.Execution.Store.SaveSession(session); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.Execution.Store.OrganizeSession("saved", false, true); err != nil {
		t.Fatal(err)
	}
	a.openSessions = func(context.Context) (codex.SessionClient, error) {
		t.Error("searching the saved index started Codex")
		return nil, fmt.Errorf("offline")
	}
	read := func(query string) (map[string]model.Session, string) {
		t.Helper()
		code, raw := call(t, a, "GET", "/api/sessions/search"+query, nil)
		var response struct {
			Sessions []model.Session `json:"sessions"`
			Error    string          `json:"error"`
		}
		if code != 200 || json.Unmarshal(raw, &response) != nil {
			t.Fatalf("search response: %d %s", code, raw)
		}
		sessions := make(map[string]model.Session, len(response.Sessions))
		for _, session := range response.Sessions {
			sessions[session.ID] = session
		}
		return sessions, response.Error
	}
	if sessions, err := read(""); err != "" || len(sessions) != 2 || !sessions["saved"].Archived || sessions["agy"].Provider != model.ProviderAgy {
		t.Fatalf("saved index: %+v, %s", sessions, err)
	}
	cwd := t.TempDir()
	a.openSessions = func(context.Context) (codex.SessionClient, error) {
		return &fakeSessionClient{request: func(method string, args map[string]any) (any, error) {
			if method != "thread/list" {
				t.Errorf("search discovery made an unexpected %s request", method)
				return nil, fmt.Errorf("unexpected method %s", method)
			}
			id := "active"
			if args["archived"] == true {
				id = "archived"
			}
			return codex.SessionPage{Data: []codex.Session{{ID: id, Cwd: cwd, Name: "Discovered " + id}}}, nil
		}}, nil
	}
	if sessions, err := read("?discover=codex"); err != "" || len(sessions) != 3 || sessions["active"].Name != "Discovered active" || sessions["active"].Archived || !sessions["archived"].Archived || !sessions["saved"].Archived {
		t.Fatalf("discovered index: %+v, %s", sessions, err)
	}
}
