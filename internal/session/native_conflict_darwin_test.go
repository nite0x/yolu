package session

import (
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"

	"worktree-hub/internal/workspace"
)

func TestDarwinProcessArgsPreservesBoundariesAndExcludesEnvironment(t *testing.T) {
	want := []string{"/tools/codex", "resume", "session", "--cd", "/workspace/含 空格", ""}
	raw := make([]byte, 4)
	binary.LittleEndian.PutUint32(raw, uint32(len(want)))
	raw = append(raw, []byte("/tools/codex\x00\x00\x00")...)
	for _, arg := range want {
		raw = append(raw, []byte(arg)...)
		raw = append(raw, 0)
	}
	raw = append(raw, []byte("IGNORED=/another/session\x00")...)
	got, err := darwinProcessArgs(raw)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("argument boundaries changed: %v", err)
	}
	for _, invalid := range [][]byte{nil, {1, 0, 0, 0}, {255, 255, 255, 255, 0}, raw[:len(raw)-len("IGNORED=/another/session\x00")-1]} {
		if _, err := darwinProcessArgs(invalid); err == nil || workspace.IsSessionConflict(err) {
			t.Fatal("accepted truncated or invalid arguments")
		}
	}
}

func TestDarwinNativeProcessInspection(t *testing.T) {
	if os.Getenv("WORK_HUB_TEST_NATIVE_PROCESS") != "1" {
		t.Skip("opt-in local process inspection")
	}
	raw, err := unix.SysctlRaw("kern.procargs2", os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	args, err := darwinProcessArgs(raw)
	if err != nil || !reflect.DeepEqual(args, os.Args) {
		t.Fatalf("cannot recover own argv: %v", err)
	}
	cwd, err := darwinProcessCwd(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	want, _ := os.Getwd()
	if cwd != want {
		t.Fatal("cannot recover own working directory")
	}
	if _, err := unix.SysctlKinfoProcSlice("kern.proc.uid", os.Getuid()); err != nil {
		t.Fatal(err)
	}
	if darwinProcessExited(os.Getpid()) {
		t.Fatal("live process was classified as exited")
	}
}

func TestDarwinCodexTerminalConflict(t *testing.T) {
	if os.Getenv("WORK_HUB_TEST_NATIVE_PROCESS") != "1" {
		t.Skip("opt-in local process inspection")
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	binaryPath := filepath.Join(base, "codex")
	if err := os.WriteFile(binaryPath, data, 0700); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"new", "same", "other", "server", "exited"} {
		cmd := exec.Command(binaryPath)
		if mode == "server" {
			cmd = exec.Command(binaryPath, "app-server")
			cmd.Env = append(os.Environ(), "WORK_HUB_CONFLICT_HELPER=server")
		} else {
			if mode != "new" {
				cmd = exec.Command(binaryPath, "resume", mode)
			}
			cmd.Env = append(os.Environ(), "WORK_HUB_CONFLICT_HELPER=terminal")
		}
		cmd.Dir = base
		stdin, err := cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		func() {
			defer func() { stdin.Close(); cmd.Process.Kill(); cmd.Wait() }()
			var ready [1]byte
			if _, err := stdout.Read(ready[:]); err != nil {
				t.Fatal(err)
			}
			if mode == "exited" {
				stdin.Close()
				deadline := time.Now().Add(3 * time.Second)
				for {
					processes, err := unix.SysctlKinfoProcSlice("kern.proc.pid", cmd.Process.Pid)
					if err != nil {
						t.Fatal(err)
					}
					if len(processes) == 0 || processes[0].Proc.P_stat == darwinZombie {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("helper did not exit")
					}
					time.Sleep(5 * time.Millisecond)
				}
				if !darwinProcessExited(cmd.Process.Pid) {
					t.Fatal("exited helper was classified as live")
				}
			}
			err := nativeTerminalConflict("same", base)
			if mode == "same" && (!workspace.IsSessionConflict(err) || !strings.Contains(err.Error(), "此会话")) || mode != "same" && err != nil {
				t.Fatalf("wrong terminal ownership result (mode=%s): %v", mode, err)
			}
		}()
	}
}

func init() {
	// Use a copied test binary as a fake Codex process. It only waits on stdin;
	// no real Codex process, model request, terminal or user session is touched.
	if os.Getenv("WORK_HUB_CONFLICT_HELPER") != "" {
		os.Stdout.Write([]byte("1"))
		var input [1]byte
		os.Stdin.Read(input[:])
		os.Exit(0)
	}
}
