package app

import (
	"net"
	"sync"
)

// Track the underlying connections so disabling access also disconnects
// hijacked terminal WebSockets, which http.Server.Close does not close.
type browserListener struct {
	net.Listener
	mu          sync.Mutex
	closed      bool
	connections map[*browserConn]struct{}
}

type browserConn struct {
	net.Conn
	listener *browserListener
}

func (l *browserListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	wrapped := &browserConn{Conn: c, listener: l}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closed {
		_ = c.Close()
		return nil, net.ErrClosed
	}
	l.connections[wrapped] = struct{}{}
	return wrapped, nil
}

func (c *browserConn) Close() error {
	err := c.Conn.Close()
	c.listener.mu.Lock()
	delete(c.listener.connections, c)
	c.listener.mu.Unlock()
	return err
}

func (l *browserListener) disconnect() {
	l.mu.Lock()
	connections := make([]*browserConn, 0, len(l.connections))
	for c := range l.connections {
		connections = append(connections, c)
	}
	l.mu.Unlock()
	for _, c := range connections {
		_ = c.Close()
	}
}

func (l *browserListener) Close() error {
	l.mu.Lock()
	l.closed = true
	l.mu.Unlock()
	err := l.Listener.Close()
	l.disconnect()
	return err
}
