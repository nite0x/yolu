package terminal

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

func terminateTree(process *os.Process) {
	pid := process.Pid
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "taskkill.exe", "/PID", strconv.Itoa(pid), "/T", "/F")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Run()
	_ = process.Kill()
}
