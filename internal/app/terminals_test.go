package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/project"
	"worktree-hub/internal/terminal"
	"worktree-hub/internal/testutil"
)

func TestCleanupProtectsEmbeddedTerminalsAndRechecksOldPreview(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix shell integration")
	}
	// Exercise Git-only cleanup without reading the installed Codex's sessions.
	t.Setenv("PATH", "/usr/bin:/bin")
	a := testApp(t)
	p := register(t, a, "Repo", repo(t, "repo", "main"))
	tree := createWorktree(t, a, p, "terminal-cleanup")
	endpoint := "/api/projects/" + p + "/worktree"
	path := tree.Path
	review := func() project.CleanupCandidate {
		t.Helper()
		code, raw := call(t, a, "GET", endpoint+"?path="+url.QueryEscape(path), nil)
		var result project.CleanupCandidate
		if code != 200 || json.Unmarshal(raw, &result) != nil {
			t.Fatalf("review %d %s", code, raw)
		}
		return result
	}
	preview := review()
	if !preview.Cleanable {
		t.Fatalf("initially not cleanable: %+v", preview)
	}
	code, raw := call(t, a, "POST", "/api/terminals", map[string]any{"project_id": p, "cwd": path, "profile_id": "custom", "executable": "/bin/sh", "args": []string{"-i"}})
	var info terminal.Info
	if code != 201 || json.Unmarshal(raw, &info) != nil {
		t.Fatalf("start %d %s", code, raw)
	}
	if current := review(); current.Cleanable || !strings.Contains(strings.Join(current.Reasons, " "), "运行中的终端") {
		t.Fatalf("active terminal not shown in review: %+v", current)
	}
	input := map[string]string{"path": path, "fingerprint": preview.Fingerprint}
	if code, raw := call(t, a, "DELETE", endpoint, input); code != 409 || !strings.Contains(string(raw), "运行中的终端") {
		t.Fatalf("old preview bypassed terminal guard: %d %s", code, raw)
	}
	if _, err := os.Stat(filepath.Join(path, ".git")); err != nil {
		t.Fatal("active worktree was removed", err)
	}
	if code, raw := call(t, a, "DELETE", "/api/terminals/"+info.ID, nil); code != 200 {
		t.Fatalf("remove %d %s", code, raw)
	}
	if current := review(); !current.Cleanable || current.Fingerprint != preview.Fingerprint {
		t.Fatalf("exited terminal still affects cleanup: %+v", current)
	}
	if code, raw := call(t, a, "DELETE", endpoint, input); code != 200 {
		t.Fatalf("cleanup %d %s", code, raw)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("worktree retained after terminal exit", err)
	}
}

func TestTerminalStartWaitsForDirectoryRemovalReservation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix shell integration")
	}
	a := testApp(t)
	p := register(t, a, "Repo", repo(t, "repo", "main"))
	q := createWorktree(t, a, p, "terminal-start-guard")
	// Simulate cleanup holding its reservation while it removes the directory.
	a.terminalWorktreeMu.Lock()
	locked := true
	defer func() {
		if locked {
			a.terminalWorktreeMu.Unlock()
		}
	}()
	done := make(chan int, 1)
	go func() {
		code, _ := call(t, a, "POST", "/api/terminals", map[string]any{"project_id": p, "cwd": q.Path, "profile_id": "custom", "executable": "/bin/sh"})
		done <- code
	}()
	select {
	case code := <-done:
		t.Fatalf("terminal started during removal: %d", code)
	case <-time.After(30 * time.Millisecond):
	}
	if err := os.RemoveAll(q.Path); err != nil {
		t.Fatal(err)
	}
	a.terminalWorktreeMu.Unlock()
	locked = false
	select {
	case code := <-done:
		if code != 409 {
			t.Fatalf("started after directory disappeared: %d", code)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("terminal start did not resume after reservation release")
	}
}

func TestTerminalDirectoryAndAuthenticatedLifecycle(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix shell integration")
	}
	a := testApp(t)
	p := register(t, a, "terminal", repo(t, "terminal", "master"))
	q := createWorktree(t, a, p, "terminal-directory")
	for _, body := range []map[string]any{
		{"project_id": "missing", "profile_id": "shell"},
		{"project_id": p, "profile_id": "shell", "cwd": t.TempDir()},
		{"project_id": p, "profile_id": "custom", "executable": "./relative"},
		{"session_id": "missing", "binding_id": "missing", "profile_id": "shell"},
	} {
		if code, _ := call(t, a, "POST", "/api/terminals", body); code < 400 {
			t.Fatalf("invalid directory accepted: %+v", body)
		}
	}
	code, raw := call(t, a, "POST", "/api/terminals", map[string]any{"project_id": p, "cwd": q.Path, "profile_id": "shell"})
	if code != 201 {
		t.Fatalf("start %d %s", code, raw)
	}
	var info terminal.Info
	if err := json.Unmarshal(raw, &info); err != nil {
		t.Fatal(err)
	}
	if info.Cwd != q.Path {
		t.Fatalf("incorrect project directory %s", info.Cwd)
	}
	code, raw = testutil.Call(t, a, "POST", "/api/terminals/"+info.ID+"/ticket", nil)
	if code != 200 || !strings.Contains(string(raw), "ticket") {
		t.Fatalf("ticket %d %s", code, raw)
	}
	r := httptest.NewRequest("POST", "http://localhost:4317/api/terminals", strings.NewReader(`{}`))
	w := httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatal("missing CSRF accepted")
	}
	r = httptest.NewRequest("GET", "http://localhost:4317/api/terminal-profiles", nil)
	r.Header.Set("X-CSRF-Token", a.token)
	r.Header.Set("X-Environment-ID", "another-environment")
	w = httptest.NewRecorder()
	a.handler().ServeHTTP(w, r)
	if w.Code != 409 {
		t.Fatalf("nonlocal environment accepted %d", w.Code)
	}
	code, raw = testutil.Call(t, a, "POST", "/api/terminals/"+info.ID+"/stop", nil)
	if code != 200 {
		t.Fatalf("stop %d %s", code, raw)
	}
	code, _ = testutil.Call(t, a, "DELETE", "/api/terminals/"+info.ID, nil)
	if code != 200 {
		t.Fatal("delete failed")
	}
}

func TestTerminalProfilesPersistWithoutEnvironmentSecrets(t *testing.T) {
	a := testApp(t)
	profile := map[string]any{"id": "custom-demo", "name": "Demo Agent", "executable": "/not-installed/agent", "args": []string{"--interactive"}}
	code, raw := testutil.Call(t, a, "POST", "/api/terminal-profiles", profile)
	if code != 200 {
		t.Fatalf("save %d %s", code, raw)
	}
	profile["env"] = map[string]string{"SECRET": "must-not-persist"}
	code, _ = testutil.Call(t, a, "POST", "/api/terminal-profiles", profile)
	if code != 400 {
		t.Fatal("environment secrets accepted for persistence")
	}
	code, raw = testutil.Call(t, a, "GET", "/api/terminal-profiles", nil)
	if code != 200 || !strings.Contains(string(raw), "custom-demo") || strings.Contains(string(raw), "must-not-persist") {
		t.Fatalf("profiles %d %s", code, raw)
	}
	// Another App reads the same data directory: settings do not depend on a browser origin/port.
	b, err := openApp(a.Execution.DataDir, a.Execution.Root)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	profiles, err := b.customTerminalProfiles()
	if err != nil || len(profiles) != 1 || profiles[0].Name != "Demo Agent" {
		t.Fatalf("restored profiles: %+v %v", profiles, err)
	}
}
