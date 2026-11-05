package session

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"runtime"
	"testing"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/workspace"
)

func TestCodexDiagnosticsIsAvailableWithoutCLIAndInReadOnlyMode(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	a := testApp(t)
	a.Workspace.ReadOnlySessions = true
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "http://localhost:4317/api/settings/codex", nil)
	r.Header.Set("X-CSRF-Token", a.token)
	a.handler().ServeHTTP(w, r)
	var report codex.Diagnostics
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &report) != nil || report.Status != "error" || len(report.Checks) != 4 || report.Platform != runtime.GOOS || report.Checks[0].ID != "cli" || report.Checks[0].Status != "error" {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("diagnostics may be cached")
	}
}

func TestCodexDiagnosticsRemoteHelperProcess(t *testing.T) {
	if os.Getenv("WORK_HUB_DIAGNOSTIC_REMOTE") != "1" {
		return
	}
	_ = workspace.RunAgent(os.Stdin, os.Stdout, workspace.AgentHooks{})
	os.Exit(0)
}

func TestCodexDiagnosticsUsesRemoteHelperEnvironment(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("WORK_HUB_DIAGNOSTIC_REMOTE", "1")
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestCodexDiagnosticsRemoteHelperProcess$")
	cmd.Env = append(os.Environ(), "USER=remote-codex-user", "USERNAME=remote-codex-user", "CODEX_HOME=/remote/codex-home", "WSL_DISTRO_NAME=Test-WSL")
	client, err := workspace.StartClient(cmd)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	a := testApp(t)
	a.Workspace.Remote = client
	w := httptest.NewRecorder()
	a.CodexDiagnosticsHandler(w, httptest.NewRequest("GET", "/api/settings/codex", nil))
	var report codex.Diagnostics
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &report) != nil || report.User != "remote-codex-user" || report.CodexHome != "/remote/codex-home" || report.Status != "error" {
		t.Fatalf("host environment used for remote diagnostics: %d %s", w.Code, w.Body.String())
	}
}
