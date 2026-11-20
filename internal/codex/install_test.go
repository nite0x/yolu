//go:build darwin || linux

package codex

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func writeTestTool(t *testing.T, path, script string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0700); err != nil {
		t.Fatal(err)
	}
}

func TestInstallationPlanUsesStandaloneOnlyAtItsOwnDestination(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CODEX_HOME", "")
	t.Setenv("CODEX_INSTALL_DIR", "")
	t.Setenv("PATH", t.TempDir())
	plan, _ := installationPlan(context.Background())
	if plan.Action != "install" || plan.Manager != "standalone" {
		t.Fatalf("missing Codex: %+v", plan)
	}
	path := plan.Path
	writeTestTool(t, path, "exit 1")
	if plan, _ := installationPlan(context.Background()); plan.Action != "" || plan.Reason == "" {
		t.Fatalf("unmanaged CLI would be overwritten: %+v", plan)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	installed := filepath.Join(home, ".codex", "packages", "standalone", "releases", "fixture", "bin", "codex")
	writeTestTool(t, installed, "printf 'codex-cli fixture\n'")
	if err := os.Symlink(installed, path); err != nil {
		t.Fatal(err)
	}
	plan, _ = installationPlan(context.Background())
	if plan.Action != "upgrade" || plan.Manager != "standalone" || plan.Path != path {
		t.Fatalf("official installation was not recognized: %+v", plan)
	}
}

func TestInstallerRevalidatesPlanAndVerifiesUpgradedCLI(t *testing.T) {
	home := t.TempDir()
	prefix := filepath.Join(home, "npm with spaces")
	bin := filepath.Join(prefix, "bin")
	t.Setenv("HOME", home)
	t.Setenv("CODEX_HOME", filepath.Join(home, ".codex"))
	t.Setenv("CODEX_INSTALL_DIR", filepath.Join(home, ".local", "bin"))
	t.Setenv("PATH", bin)
	socket, methods := testDaemonSocket(t)
	response, _ := json.Marshal(map[string]string{"socketPath": socket})
	t.Setenv("YOLU_CODEX_TEST_DAEMON", string(response))
	entry := filepath.Join(prefix, "lib", "node_modules", "@openai", "codex", "bin", "codex.js")
	cli := filepath.Join(bin, "codex")
	writeTestTool(t, entry, "printf 'codex-cli old\n'")
	writeTestTool(t, filepath.Join(bin, "npm"), `printf '%s\n' "$@" > "$HOME/args"
/bin/cat > "$YOLU_CODEX_TEST_ENTRY" <<'CODEX'
#!/bin/sh
case "$*" in
  --version) echo codex-cli new ;;
  'app-server daemon start')
    if [ -z "$YOLU_CODEX_TEST_DAEMON" ]; then
      echo 'daemon failed to start' >&2
      exit 1
    fi
    printf '%s\n' "$YOLU_CODEX_TEST_DAEMON" ;;
  *) exit 9 ;;
esac
CODEX
`)
	t.Setenv("YOLU_CODEX_TEST_ENTRY", entry)
	if err := os.Symlink(entry, cli); err != nil {
		t.Fatal(err)
	}
	var installer Installer
	defer installer.Close()
	plan := InstallPlan{Action: "upgrade", Manager: "npm", Path: cli}
	stale := plan
	stale.Path = filepath.Join(home, "other")
	if _, err := installer.Start(stale); err == nil {
		t.Fatal("accepted a stale installation plan")
	}
	run := func() InstallState {
		t.Helper()
		state, err := installer.Start(plan)
		if err != nil || state.Status != "running" {
			t.Fatalf("start: %+v %v", state, err)
		}
		select {
		case <-installer.done:
			return installer.State()
		case <-time.After(5 * time.Second):
			t.Fatal("upgrade did not complete")
			return InstallState{}
		}
	}
	if state := run(); state.Status != "succeeded" || state.Version != "codex-cli new" {
		t.Fatalf("upgrade: %+v", state)
	}
	for _, want := range []string{"initialize", "initialized", "thread/list"} {
		select {
		case got := <-methods:
			if got != want {
				t.Fatalf("daemon operation = %s, want %s", got, want)
			}
		default:
			t.Fatalf("upgrade completed before daemon operation %s", want)
		}
	}
	args, err := os.ReadFile(filepath.Join(home, "args"))
	want := []string{"install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", "@openai/codex@latest"}
	if err != nil || !slices.Equal(strings.Split(strings.TrimSuffix(string(args), "\n"), "\n"), want) {
		t.Fatalf("npm arguments: %q, %v", args, err)
	}

	t.Setenv("YOLU_CODEX_TEST_DAEMON", "")
	if state := run(); state.Status != "failed" || state.Stage != "daemon" || state.Version != "codex-cli new" || !strings.Contains(state.Error, "daemon failed to start") {
		t.Fatalf("daemon failure should retain the verified CLI version: %+v", state)
	}
}
