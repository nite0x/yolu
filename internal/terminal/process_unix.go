//go:build !windows

package terminal

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Interactive shells put foreground jobs into separate process groups. Walk
// descendants as well as killing the PTY leader's group, so Ctrl+Z/background
// jobs are not left behind when the user explicitly ends the terminal.
func terminateTree(process *os.Process) {
	if process.Signal(syscall.Signal(0)) != nil {
		return
	}
	pid := process.Pid
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	raw, _ := exec.CommandContext(ctx, "ps", "-eo", "pid=,ppid=").Output()
	children := map[int][]int{}
	for _, line := range strings.Split(string(raw), "\n") {
		v := strings.Fields(line)
		if len(v) != 2 {
			continue
		}
		child, _ := strconv.Atoi(v[0])
		parent, _ := strconv.Atoi(v[1])
		if child > 1 {
			children[parent] = append(children[parent], child)
		}
	}
	var kill func(int)
	kill = func(parent int) {
		for _, child := range children[parent] {
			kill(child)
			_ = syscall.Kill(child, syscall.SIGKILL)
		}
	}
	kill(pid)
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	_ = syscall.Kill(pid, syscall.SIGKILL)
}
