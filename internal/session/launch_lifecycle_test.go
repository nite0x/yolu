package session

import (
	"net/http/httptest"
	"reflect"
	"runtime"
	"testing"

	"worktree-hub/internal/model"
)

func TestNativeLaunchRetainsAdditionalDirectoriesWithoutManagedRelay(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("native terminal launch is used outside Linux")
	}
	a := testApp(t)
	cwd, extra := t.TempDir(), t.TempDir()
	want := model.LaunchPlan{Cwd: cwd, Args: []string{"--cd", cwd, "--add-dir", extra}, AdditionalDirectories: []string{extra}}
	var got model.LaunchPlan
	a.Execution.Launch = func(p model.LaunchPlan, _ func()) error { got = p; return nil }
	w := httptest.NewRecorder()
	a.LaunchCodexPlan(w, want)
	if w.Code != 200 {
		t.Fatalf("launch: %d %s", w.Code, w.Body.String())
	}
	if got.Cwd != want.Cwd || !reflect.DeepEqual(got.Args, want.Args) || !reflect.DeepEqual(got.AdditionalDirectories, want.AdditionalDirectories) || len(a.bridges) != 0 {
		t.Fatalf("native launch changed directory access: %+v", got)
	}
}

func TestManagedLaunchFailureIsScopedToItsSessionService(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("managed terminals use Linux Unix sockets")
	}
	a := testApp(t)
	var failures []func()
	a.Execution.Launch = func(_ model.LaunchPlan, failed func()) error {
		failures = append(failures, failed)
		return nil
	}
	firstDir, secondDir := t.TempDir(), t.TempDir()
	first := httptest.NewRecorder()
	a.LaunchCodexPlan(first, model.LaunchPlan{Cwd: firstDir, Session: "first-session", Args: []string{"--cd", firstDir}})
	other := New(a.Execution)
	defer other.Close()
	second := httptest.NewRecorder()
	other.LaunchCodexPlan(second, model.LaunchPlan{Cwd: secondDir, Session: "second-session", Args: []string{"--cd", secondDir}})
	if first.Code != 200 || second.Code != 200 || len(failures) != 2 || failures[0] == nil || failures[1] == nil {
		t.Fatalf("launches: %d %d callbacks=%d", first.Code, second.Code, len(failures))
	}
	one, two := a.TerminalOwner("first-session", firstDir), other.TerminalOwner("second-session", secondDir)
	if one == nil || two == nil {
		t.Fatal("missing terminal reservations")
	}
	failures[0]()
	one.mu.Lock()
	firstRevoked := one.revoked
	one.mu.Unlock()
	two.mu.Lock()
	secondRevoked := two.revoked
	two.mu.Unlock()
	if !firstRevoked || secondRevoked {
		t.Fatal("failure released another service's reservation")
	}
	failures[1]()
	two.mu.Lock()
	secondRevoked = two.revoked
	two.mu.Unlock()
	if !secondRevoked {
		t.Fatal("second launch did not release its own reservation")
	}
}
