package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestDiagnosticsProcess(t *testing.T) {
	if os.Getenv("WORK_HUB_DIAGNOSTIC_PROCESS") != "1" {
		return
	}
	args := os.Args
	for len(args) > 0 && args[0] != "--" {
		args = args[1:]
	}
	if len(args) == 0 {
		os.Exit(2)
	}
	if args[1] == "--version" {
		switch os.Getenv("WORK_HUB_DIAGNOSTIC_MODE") {
		case "slow":
			time.Sleep(time.Minute)
		case "broken":
			fmt.Fprintln(os.Stderr, "config rejected: api_key=sk-private123 access_token=private456")
			os.Exit(1)
		}
		fmt.Println("codex-cli test-version")
	} else if strings.Join(args[1:], " ") == "app-server daemon version" {
		if raw := os.Getenv("WORK_HUB_DIAGNOSTIC_DAEMON"); raw != "" {
			fmt.Println(raw)
		} else {
			fmt.Println(`{"status":"stopped"}`)
		}
	} else {
		os.Exit(3) // No starts, restarts, updates, logins or model turns permitted.
	}
	os.Exit(0)
}

func diagnosticCommand(t *testing.T, calls *[][]string) func(context.Context, ...string) *exec.Cmd {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("WORK_HUB_DIAGNOSTIC_PROCESS", "1")
	return func(ctx context.Context, args ...string) *exec.Cmd {
		*calls = append(*calls, args)
		return exec.CommandContext(ctx, executable, append([]string{"-test.run=^TestDiagnosticsProcess$", "--"}, args...)...)
	}
}

type diagnosticSessions struct {
	calls   []string
	account string
	err     error
	closed  bool
}

func (c *diagnosticSessions) Close() { c.closed = true }
func (c *diagnosticSessions) Call(method string, params any, result any) error {
	c.calls = append(c.calls, method)
	if c.err != nil {
		return c.err
	}
	switch method {
	case "thread/list":
		if !reflect.DeepEqual(params, map[string]any{"limit": 1}) {
			return errors.New("unbounded query")
		}
		return json.Unmarshal([]byte(`{"data":[]}`), result)
	case "account/read":
		if !reflect.DeepEqual(params, map[string]any{"refreshToken": false}) {
			return errors.New("must not refresh credentials")
		}
		return json.Unmarshal([]byte(c.account), result)
	default:
		return fmt.Errorf("unexpected mutation or query %s", method)
	}
}

func diagnosticCheck(t *testing.T, r Diagnostics, id string) DiagnosticCheck {
	t.Helper()
	for _, check := range r.Checks {
		if check.ID == id {
			return check
		}
	}
	t.Fatalf("missing check %s: %+v", id, r)
	return DiagnosticCheck{}
}

func TestDiagnosticsDistinguishesAuthAndNeverStartsDaemon(t *testing.T) {
	for _, tc := range []struct{ name, account, want string }{
		{"signed in", `{"account":{"type":"chatgpt","email":"private@example.com","accessToken":"private-token"},"requiresOpenaiAuth":true}`, "ok"},
		{"signed out", `{"account":null,"requiresOpenaiAuth":true}`, "error"},
		{"custom provider", `{"account":null,"requiresOpenaiAuth":false}`, "ok"},
		{"unknown protocol", `{}`, "warning"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var commands [][]string
			client := &diagnosticSessions{account: tc.account}
			report := diagnose(context.Background(), func(context.Context) (SessionClient, error) { return client, nil }, diagnosticCommand(t, &commands))
			if diagnosticCheck(t, report, "cli").Status != "ok" || diagnosticCheck(t, report, "sessions").Status != "ok" || diagnosticCheck(t, report, "auth").Status != tc.want || diagnosticCheck(t, report, "daemon").Status != "warning" {
				t.Fatalf("wrong diagnosis: %+v", report)
			}
			if !client.closed || !reflect.DeepEqual(client.calls, []string{"thread/list", "account/read"}) || !reflect.DeepEqual(commands, [][]string{{"--version"}, {"app-server", "daemon", "version"}}) {
				t.Fatal("unexpected lifecycle", client, commands)
			}
			raw, _ := json.Marshal(report)
			if strings.Contains(string(raw), "private") {
				t.Fatal("account identity or credentials leaked", string(raw))
			}
		})
	}
}

func TestDiagnosticsKeepsMetadataFailureAndStillChecksDaemon(t *testing.T) {
	var commands [][]string
	client := &diagnosticSessions{err: errors.New("metadata unavailable: access_token=private456")}
	report := diagnose(context.Background(), func(context.Context) (SessionClient, error) { return client, nil }, diagnosticCommand(t, &commands))
	if report.Status != "error" || !client.closed || diagnosticCheck(t, report, "sessions").Status != "error" || diagnosticCheck(t, report, "auth").Status != "skipped" || diagnosticCheck(t, report, "daemon").Status != "warning" {
		t.Fatal(report)
	}
	if message := diagnosticCheck(t, report, "sessions").Message; !strings.Contains(message, "metadata unavailable") || strings.Contains(message, "private456") {
		t.Fatal(message)
	}
}

func TestDiagnosticsMissingBrokenAndTimedOutCLI(t *testing.T) {
	for _, mode := range []string{"missing", "broken", "slow"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("WORK_HUB_DIAGNOSTIC_MODE", mode)
			var commands [][]string
			command := diagnosticCommand(t, &commands)
			ctx := context.Background()
			if mode == "missing" {
				command = func(ctx context.Context, args ...string) *exec.Cmd {
					return exec.CommandContext(ctx, filepath.Join(t.TempDir(), "codex-missing"), args...)
				}
			} else if mode == "slow" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 100*time.Millisecond)
				defer cancel()
			}
			start := time.Now()
			report := diagnose(ctx, func(context.Context) (SessionClient, error) {
				t.Fatal("metadata called without working CLI")
				return nil, nil
			}, command)
			if report.Status != "error" || diagnosticCheck(t, report, "cli").Status != "error" || diagnosticCheck(t, report, "daemon").Status != "skipped" || time.Since(start) > 3*time.Second {
				t.Fatal(report)
			}
			if message := diagnosticCheck(t, report, "cli").Message; strings.Contains(message, "private") || mode == "broken" && !strings.Contains(message, "config rejected") {
				t.Fatal(message)
			}
		})
	}
}

func TestDiagnosticsRejectsInvalidDaemonResponses(t *testing.T) {
	for _, raw := range []string{`not-json`, `{}`, `{"status":"running"}`, `{"status":"running","socketPath":"relative.sock"}`, `{"status":"running","socketPath":"/missing/control.sock"}`} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv("WORK_HUB_DIAGNOSTIC_DAEMON", raw)
			var commands [][]string
			report := diagnose(context.Background(), func(context.Context) (SessionClient, error) {
				return &diagnosticSessions{account: `{"requiresOpenaiAuth":false}`}, nil
			}, diagnosticCommand(t, &commands))
			if diagnosticCheck(t, report, "daemon").Status != "error" {
				t.Fatal(report)
			}
		})
	}
}

func TestDiagnosticsConnectsExistingDaemonWithoutLoadingThreads(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix socket transport; native Windows uses the CLI proxy")
	}
	// Keep the socket below Unix path length limits on macOS CI.
	dir, err := os.MkdirTemp("", "wh-diag-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	socket := filepath.Join(dir, "s")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	methods := make(chan string, 8)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			var req struct {
				ID     json.RawMessage `json:"id"`
				Method string          `json:"method"`
			}
			if conn.ReadJSON(&req) != nil {
				return
			}
			methods <- req.Method
			if req.Method == "initialized" {
				continue
			}
			_ = conn.WriteJSON(map[string]any{"id": req.ID, "result": map[string]any{"data": []any{}}})
		}
	})}
	go server.Serve(listener)
	defer server.Close()
	raw, _ := json.Marshal(map[string]string{"status": "running", "socketPath": socket, "appServerVersion": "daemon-test-version"})
	t.Setenv("WORK_HUB_DIAGNOSTIC_DAEMON", string(raw))
	var commands [][]string
	report := diagnose(context.Background(), func(context.Context) (SessionClient, error) {
		return &diagnosticSessions{account: `{"requiresOpenaiAuth":false}`}, nil
	}, diagnosticCommand(t, &commands))
	if report.Status != "ok" || report.DaemonVersion != "daemon-test-version" {
		t.Fatal(report)
	}
	for _, expected := range []string{"initialize", "initialized", "thread/list"} {
		select {
		case method := <-methods:
			if method != expected {
				t.Fatalf("unexpected daemon operation %s", method)
			}
		case <-time.After(time.Second):
			t.Fatalf("missing daemon operation %s", expected)
		}
	}
}

func TestDiagnosticOutputIsBoundedAndRedacted(t *testing.T) {
	var buffer diagnosticBuffer
	input := strings.Repeat("x", 1<<20)
	if n, err := buffer.Write([]byte(input)); err != nil || n != len(input) || len(buffer.b) != 8192 {
		t.Fatal(n, err, len(buffer.b))
	}
	buffer.Write([]byte(input))
	text := diagnosticText(`api_key="private" access_token=private refresh_token:private Authorization: Bearer private sk-private sess-private eyJprivate.payload.signature`)
	if strings.Contains(text, "private") {
		t.Fatal(text)
	}
	if len([]rune(diagnosticText(strings.Repeat("中", 3000)))) > 2001 {
		t.Fatal("unbounded message")
	}
}

func TestInstalledCodexDiagnostics(t *testing.T) {
	if os.Getenv("WORKTREE_HUB_TEST_INSTALLED_CODEX") != "1" {
		t.Skip("opt-in read-only installed CLI diagnostic")
	}
	pool := NewSessionPool()
	defer pool.Close()
	report := Diagnose(context.Background(), pool.Open)
	for _, check := range report.Checks {
		t.Logf("%s: %s: %s", check.Name, check.Status, check.Message)
	}
	if len(report.Checks) != 4 || diagnosticCheck(t, report, "cli").Status != "ok" || diagnosticCheck(t, report, "sessions").Status != "ok" {
		t.Fatal("installed CLI could not complete read-only diagnostics")
	}
}
