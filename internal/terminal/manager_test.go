package terminal

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func testSession(t *testing.T, args ...string) (*Manager, *Session, *httptest.Server) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Unix shell integration")
	}
	m := New()
	t.Cleanup(m.Close)
	s, err := m.Start(Start{Cwd: t.TempDir(), ProfileID: "custom", Executable: "/bin/sh", Args: args})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /terminal-stream/{id}", m.Stream)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return m, s, server
}
func attach(t *testing.T, m *Manager, s *Session, server *httptest.Server, since uint64) *websocket.Conn {
	t.Helper()
	ticket, err := m.Ticket(s.Info().ID)
	if err != nil {
		t.Fatal(err)
	}
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/terminal-stream/"+s.Info().ID, http.Header{"Origin": {server.URL}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close() })
	if err = c.WriteJSON(map[string]any{"ticket": ticket, "since": since}); err != nil {
		t.Fatal(err)
	}
	return c
}

type output struct {
	Type     string `json:"type"`
	Seq      uint64 `json:"seq"`
	Data     []byte `json:"data"`
	ExitCode *int   `json:"exit_code"`
}

func readUntil(t *testing.T, c *websocket.Conn, marker string) (string, uint64) {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	var text strings.Builder
	var seq uint64
	for {
		var event output
		if err := c.ReadJSON(&event); err != nil {
			t.Fatalf("read %q: %v", text.String(), err)
		}
		if event.Type == "output" {
			seq = event.Seq
			text.Write(event.Data)
			if err := c.WriteJSON(map[string]any{"type": "ack", "seq": seq}); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(text.String(), marker) {
				return text.String(), seq
			}
		}
		if event.Type == "exit" {
			t.Fatalf("early exit %q", text.String())
		}
	}
}
func TestPTYInputResizeReconnectAndExit(t *testing.T) {
	m, s, server := testSession(t, "-i")
	c := attach(t, m, s, server, 0)
	if err := c.WriteJSON(map[string]any{"type": "resize", "cols": 91, "rows": 37}); err != nil {
		t.Fatal(err)
	}
	if err := c.WriteJSON(map[string]any{"type": "input", "data": "stty size; printf '\\137\\137READY\\137\\137\\n'\n"}); err != nil {
		t.Fatal(err)
	}
	text, seq := readUntil(t, c, "__READY__")
	if !strings.Contains(text, "37 91") {
		t.Fatalf("resize not applied: %q", text)
	}
	_ = c.Close()
	deadline := time.Now().Add(3 * time.Second)
	for s.Info().Attached && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if err := s.Write([]byte("printf '\\137\\137DETACHED\\137\\137\\n'\n")); err != nil {
		t.Fatal(err)
	}
	c = attach(t, m, s, server, seq)
	text, _ = readUntil(t, c, "__DETACHED__")
	if strings.Contains(text, "__READY__") {
		t.Fatal("replayed already acknowledged output")
	}
	_ = c.WriteJSON(map[string]any{"type": "input", "data": "printf '\\137\\137BUSY\\137\\137\\n'; sleep 30\n"})
	readUntil(t, c, "__BUSY__")
	// The marker is printed before the shell forks sleep. Wait for that child
	// before interrupting, otherwise Ctrl+C can race ahead of its startup.
	deadline = time.Now().Add(3 * time.Second)
	for {
		raw, _ := exec.Command("ps", "-eo", "pid=,ppid=").Output()
		found := false
		for _, line := range strings.Split(string(raw), "\n") {
			var child, parent int
			if _, err := fmt.Sscanf(line, "%d %d", &child, &parent); err == nil && parent == s.cmd.Process.Pid {
				found = true
				break
			}
		}
		if found {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("foreground child did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	_ = c.WriteJSON(map[string]any{"type": "input", "data": "\x03"})
	_ = c.WriteJSON(map[string]any{"type": "input", "data": "printf '\\137\\137INTERRUPTED\\137\\137\\n'\n"})
	readUntil(t, c, "__INTERRUPTED__")
	_ = c.WriteJSON(map[string]any{"type": "input", "data": "exit 7\n"})
	for {
		var event output
		if err := c.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "output" {
			_ = c.WriteJSON(map[string]any{"type": "ack", "seq": event.Seq})
		}
		if event.Type == "exit" {
			if event.ExitCode == nil || *event.ExitCode != 7 {
				t.Fatalf("exit %+v", event)
			}
			break
		}
	}
}
func TestStreamTicketsAndSingleController(t *testing.T) {
	m, s, server := testSession(t)
	c := attach(t, m, s, server, 0)
	_ = c.WriteJSON(map[string]any{"type": "input", "data": "printf '\\137\\137CONNECTED\\137\\137\\n'\n"})
	readUntil(t, c, "__CONNECTED__")
	second := attach(t, m, s, server, 0)
	var event map[string]any
	if err := second.ReadJSON(&event); err != nil {
		t.Fatal(err)
	}
	if event["type"] != "busy" {
		t.Fatalf("second controller %+v", event)
	}
	_, response, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/terminal-stream/"+s.Info().ID, http.Header{"Origin": {"http://evil.example"}})
	if err == nil || response.StatusCode != 403 {
		t.Fatal("foreign Origin accepted")
	}
	key, err := m.Ticket(s.Info().ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.consume(key, "another-terminal"); err == nil {
		t.Fatal("wrong terminal accepted")
	}
	if _, err = m.consume(key, s.Info().ID); err == nil {
		t.Fatal("consumed ticket reused")
	}
	key, _ = m.Ticket(s.Info().ID)
	m.mu.Lock()
	m.tickets[key] = ticket{s.Info().ID, time.Now().Add(-time.Second)}
	m.mu.Unlock()
	if _, err = m.consume(key, s.Info().ID); err == nil {
		t.Fatal("expired ticket accepted")
	}
}
func TestFlowControlBoundsAndStopWithoutAcknowledgement(t *testing.T) {
	m, s, server := testSession(t)
	c := attach(t, m, s, server, 0)
	_ = c.WriteJSON(map[string]any{"type": "input", "data": "yes terminal-flow-control\n"})
	deadline := time.Now().Add(3 * time.Second)
	for {
		s.mu.Lock()
		n := len(s.buffer)
		s.mu.Unlock()
		if n >= flowLimit {
			if n > flowLimit+(16<<10) {
				t.Fatalf("unbounded pending output %d", n)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("producer did not reach flow limit")
		}
		time.Sleep(10 * time.Millisecond)
	}
	s.Stop()
	select {
	case <-s.done:
	case <-time.After(3 * time.Second):
		t.Fatal("stop blocked behind unacknowledged output")
	}
	if s.Info().State != "exited" {
		t.Fatal("process still running")
	}
}
func TestArgumentsAreNotInterpolatedAndOutputIsReplayableAfterExit(t *testing.T) {
	marker := "$(touch SHOULD_NOT_EXIST) ' quoted"
	m, s, server := testSession(t, "-c", "printf '%s\\n' \"$1\"; pwd", "agent", marker)
	select {
	case <-s.done:
	case <-time.After(3 * time.Second):
		t.Fatal("process did not exit")
	}
	c := attach(t, m, s, server, 0)
	var text strings.Builder
	for {
		var event output
		if err := c.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "output" {
			text.Write(event.Data)
			_ = c.WriteJSON(map[string]any{"type": "ack", "seq": event.Seq})
		}
		if event.Type == "exit" {
			break
		}
	}
	if !strings.Contains(text.String(), marker) || !strings.Contains(text.String(), filepath.Base(s.Info().Cwd)) {
		t.Fatalf("incorrect argument/cwd: %q", text.String())
	}
	// Runtime metadata must not expose command/environment credentials.
	raw, _ := json.Marshal(s.Info())
	if strings.Contains(string(raw), marker) {
		t.Fatal(fmt.Sprintf("arguments leaked into metadata: %s", raw))
	}
}
