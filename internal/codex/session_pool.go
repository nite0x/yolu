package codex

import (
	"context"
	"fmt"
	"sync"
	"time"

	"worktree-hub/internal/platform"
)

// SessionPool shares one metadata app-server across HTTP requests. Leases have
// independent deadlines; closing a lease never stops another request or turn.
// Interactive turns still use their separate shared-daemon connections.
type SessionPool struct {
	mu      sync.Mutex
	wire    *liveWire
	closed  bool
	retryAt time.Time
	delay   time.Duration
	lastErr error
}

func NewSessionPool() *SessionPool { return &SessionPool{} }

func (p *SessionPool) Open(ctx context.Context) (SessionClient, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil, fmt.Errorf("Codex 会话查询已关闭")
	}
	if p.wire != nil && p.wire.ctx.Err() != nil {
		p.wire.Close()
		p.wire = nil
		p.failed(fmt.Errorf("Codex 会话连接已断开"))
	}
	if p.wire == nil {
		if time.Now().Before(p.retryAt) {
			return nil, p.lastErr
		}
		// A request deadline bounds initialization without tying the retained
		// child to that request after initialization succeeds.
		processCtx, cancel := context.WithCancel(context.Background())
		stop := context.AfterFunc(ctx, cancel)
		cmd := Command(processCtx, "app-server")
		platform.HideCommand(cmd)
		client, err := StartWire(processCtx, cmd)
		stop()
		if err != nil || ctx.Err() != nil {
			cancel()
			if client != nil {
				client.Close()
			}
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			p.failed(err)
			return nil, err
		}
		p.wire = client.(*liveWire)
		p.delay = 0
		// Metadata callers do not subscribe to events. Drain unsolicited
		// notifications so a retained process never blocks its response reader.
		go func() {
			defer cancel()
			for range client.Events() {
			}
		}()
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	return &sessionLease{wire: p.wire, ctx: ctx, cancel: cancel}, nil
}

func (p *SessionPool) failed(err error) {
	if p.delay == 0 {
		p.delay = 5 * time.Second
	} else {
		p.delay = min(p.delay*2, time.Minute)
	}
	p.lastErr, p.retryAt = err, time.Now().Add(p.delay)
}

func (p *SessionPool) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	if p.wire != nil {
		p.wire.Close()
		p.wire = nil
	}
}

type sessionLease struct {
	wire   *liveWire
	ctx    context.Context
	cancel context.CancelFunc
}

func (c *sessionLease) Call(method string, params any, result any) error {
	if err := c.ctx.Err(); err != nil {
		return err
	}
	return c.wire.Call(c.ctx, method, params, result)
}

func (c *sessionLease) Close() { c.cancel() }
