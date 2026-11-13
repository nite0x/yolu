package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDaemonProcess(t *testing.T) {
	if os.Getenv("WORK_HUB_DAEMON_PROCESS") != "1" {
		return
	}
	stage := strings.ToUpper(os.Args[len(os.Args)-1])
	if detail := os.Getenv("WORK_HUB_DAEMON_" + stage + "_ERROR"); detail != "" {
		fmt.Fprintln(os.Stderr, detail)
		os.Exit(1)
	}
	fmt.Println(os.Getenv("WORK_HUB_DAEMON_" + stage))
	os.Exit(0)
}

func daemonCommand(t *testing.T, calls *[][]string) func(context.Context, ...string) *exec.Cmd {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("WORK_HUB_DAEMON_PROCESS", "1")
	var startup context.Context
	return func(ctx context.Context, args ...string) *exec.Cmd {
		*calls = append(*calls, args)
		budget := 20 * time.Second
		if args[len(args)-1] == "start" {
			startup = ctx
		} else {
			budget = 10 * time.Second
			if startup.Err() != context.Canceled || ctx.Err() != nil {
				t.Fatal("fallback must have an independent context")
			}
		}
		deadline, ok := ctx.Deadline()
		if remaining := time.Until(deadline); !ok || remaining < budget-time.Second || remaining > budget {
			t.Fatalf("wrong %s budget: %s", args[len(args)-1], remaining)
		}
		return exec.CommandContext(ctx, executable, append([]string{"-test.run=^TestDaemonProcess$", "--"}, args...)...)
	}
}

func TestDaemonSocketPathReusesStartAndFallsBackForOlderCLIs(t *testing.T) {
	socket := filepath.Join(t.TempDir(), "control.sock")
	valid, err := json.Marshal(map[string]string{"socketPath": socket})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, start string
		fallback    bool
	}{
		{"start returns address", string(valid), false},
		{"empty start output", "", true},
		{"legacy start output", "daemon started", true},
		{"start omits address", `{}`, true},
		{"start returns relative address", `{"socketPath":"relative.sock"}`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("WORK_HUB_DAEMON_START", tc.start)
			t.Setenv("WORK_HUB_DAEMON_VERSION", string(valid))
			var calls [][]string
			got, err := daemonSocketPath(context.Background(), daemonCommand(t, &calls))
			if err != nil || got != socket {
				t.Fatal(got, err)
			}
			want := [][]string{{"app-server", "daemon", "start"}}
			if tc.fallback {
				want = append(want, []string{"app-server", "daemon", "version"})
			}
			if !reflect.DeepEqual(calls, want) {
				t.Fatal(calls)
			}
		})
	}
}

func TestDaemonSocketPathReportsStageAndRedactsCLIError(t *testing.T) {
	for _, tc := range []struct {
		name, startError, versionError, version, want string
		calls                                         int
	}{
		{"start failure", "startup rejected api_key=sk-private123", "", "", "启动 Codex 共享后台失败（daemon start）", 1},
		{"version failure", "", "address unavailable access_token=private456", "", "读取 Codex 共享后台地址失败（daemon version）", 2},
		{"invalid version JSON", "", "", "not-json", "无法解析 daemon version 输出", 2},
		{"missing address", "", "", `{}`, "未返回可用的共享套接字路径", 2},
		{"relative address", "", "", `{"socketPath":"relative.sock"}`, "未返回可用的共享套接字路径", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("WORK_HUB_DAEMON_START", "")
			t.Setenv("WORK_HUB_DAEMON_START_ERROR", tc.startError)
			t.Setenv("WORK_HUB_DAEMON_VERSION_ERROR", tc.versionError)
			t.Setenv("WORK_HUB_DAEMON_VERSION", tc.version)
			var calls [][]string
			_, err := daemonSocketPath(context.Background(), daemonCommand(t, &calls))
			if err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), "private") || len(calls) != tc.calls {
				t.Fatal(err, calls)
			}
			if tc.startError != "" && !strings.Contains(err.Error(), "startup rejected") || tc.versionError != "" && !strings.Contains(err.Error(), "address unavailable") {
				t.Fatal("CLI error detail was lost", err)
			}
		})
	}
}

func TestDaemonSocketPathRespectsCancellationAtEachStage(t *testing.T) {
	for _, stage := range []string{"start", "version"} {
		t.Run(stage, func(t *testing.T) {
			t.Setenv("WORK_HUB_DAEMON_START", "")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var calls [][]string
			command := daemonCommand(t, &calls)
			_, err := daemonSocketPath(ctx, func(ctx context.Context, args ...string) *exec.Cmd {
				cmd := command(ctx, args...)
				if args[len(args)-1] == stage {
					cancel()
				}
				return cmd
			})
			if !errors.Is(err, context.Canceled) || !strings.Contains(err.Error(), "daemon "+stage) {
				t.Fatal(err)
			}
		})
	}
}

func TestDialDaemonSocketReportsConnectionStage(t *testing.T) {
	file := filepath.Join(t.TempDir(), "regular-file")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	for _, socket := range []string{"relative.sock", filepath.Join(t.TempDir(), "missing.sock"), file} {
		conn, err := dialDaemonSocket(context.Background(), socket)
		if conn != nil || err == nil || !strings.Contains(err.Error(), "连接 Codex 共享套接字失败") {
			t.Fatal(conn, err)
		}
	}
}
