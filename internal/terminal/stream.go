package terminal

import (
	"net/http"
	"net/url"
	"time"

	"github.com/gorilla/websocket"
)

// Stream lives outside /api: browser WebSockets cannot send the API's CSRF
// header. It requires an exact Origin and a short-lived, single-use ticket
// issued by an authenticated POST. No PTY is touched before authentication.
func (m *Manager) Stream(w http.ResponseWriter, r *http.Request) {
	origin, err := url.Parse(r.Header.Get("Origin"))
	if err != nil || origin.Host != r.Host || origin.Scheme != "http" {
		http.Error(w, "拒绝跨站终端连接", http.StatusForbidden)
		return
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }, ReadBufferSize: 4096, WriteBufferSize: 4096}
	c, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()
	c.SetReadLimit(64 << 10)
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	var auth struct {
		Ticket string `json:"ticket"`
		Since  uint64 `json:"since"`
	}
	if c.ReadJSON(&auth) != nil {
		return
	}
	s, err := m.consume(auth.Ticket, r.PathValue("id"))
	if err != nil {
		_ = c.WriteJSON(map[string]any{"type": "error", "message": err.Error()})
		return
	}
	s.mu.Lock()
	if s.attached {
		s.mu.Unlock()
		_ = c.WriteJSON(map[string]any{"type": "busy", "message": "终端已在其他视图打开，请先关闭原视图"})
		return
	}
	cursor := auth.Since
	gap := cursor < s.base || cursor > s.end
	if gap {
		cursor = s.base
	}
	s.attached = true
	s.ack = cursor
	s.signal()
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.attached = false; s.signal(); s.mu.Unlock() }()
	_ = c.SetReadDeadline(time.Now().Add(45 * time.Second))
	c.SetPongHandler(func(string) error { return c.SetReadDeadline(time.Now().Add(45 * time.Second)) })
	write := func(v any) error { _ = c.SetWriteDeadline(time.Now().Add(5 * time.Second)); return c.WriteJSON(v) }
	if gap {
		if write(map[string]any{"type": "gap", "seq": cursor, "message": "部分终端输出已超出缓存，当前画面可能不完整。可让程序重新绘制，或重新启动终端。"}) != nil {
			return
		}
	}
	disconnected := make(chan struct{})
	var sent uint64 = cursor
	go func() {
		defer close(disconnected)
		defer c.Close()
		for {
			var msg struct {
				Type string `json:"type"`
				Data string `json:"data"`
				Seq  uint64 `json:"seq"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if c.ReadJSON(&msg) != nil {
				return
			}
			_ = c.SetReadDeadline(time.Now().Add(45 * time.Second))
			switch msg.Type {
			case "input":
				if s.Write([]byte(msg.Data)) != nil {
					return
				}
			case "resize":
				if s.Resize(msg.Cols, msg.Rows) != nil {
					return
				}
			case "ack":
				s.mu.Lock()
				if msg.Seq >= s.ack && msg.Seq <= sent {
					s.ack = msg.Seq
					s.signal()
				}
				s.mu.Unlock()
			default:
				return
			}
		}
	}()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		s.mu.Lock()
		if cursor < s.base {
			cursor = s.base
			s.ack = cursor
			s.mu.Unlock()
			if write(map[string]any{"type": "gap", "seq": cursor, "message": "部分终端输出已超出缓存，请让程序重新绘制。"}) != nil {
				return
			}
			continue
		}
		if cursor < s.end && cursor-s.ack < flowLimit {
			n := min(uint64(16<<10), s.end-cursor)
			data := append([]byte(nil), s.buffer[cursor-s.base:cursor-s.base+n]...)
			cursor += n
			sent = cursor
			s.mu.Unlock()
			if write(map[string]any{"type": "output", "seq": cursor, "data": data}) != nil {
				return
			}
			continue
		}
		finished := s.info.State == "exited" && cursor == s.end
		info := s.info
		changed := s.changed
		s.mu.Unlock()
		if finished {
			_ = write(map[string]any{"type": "exit", "exit_code": info.ExitCode})
			return
		}
		select {
		case <-changed:
		case <-disconnected:
			return
		case <-ping.C:
			if c.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
				return
			}
		}
	}
}
