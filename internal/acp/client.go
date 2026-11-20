package acp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

const (
	maxFrameBytes = 64 << 20
	maxEventQueue = 65536
)

type Client interface {
	Call(ctx context.Context, method string, params any, result any) error
	Notify(method string, params any) error
	Reply(id json.RawMessage, result any) error
	ReplyError(id json.RawMessage, code int, message string) error
	Events() <-chan Message
	Close()
}

type rpcResponse struct {
	Result json.RawMessage
	Err    error
}

type stdioClient struct {
	cmd     *exec.Cmd
	in      io.WriteCloser
	cancel  context.CancelFunc
	ctx     context.Context
	mu      sync.Mutex
	writeMu sync.Mutex
	seq     int
	pending map[string]chan rpcResponse

	eventMu     sync.Mutex
	eventQueue  []Message
	eventWake   chan struct{}
	eventClosed bool
	events      chan Message
	once        sync.Once
	stderrTail  bytes.Buffer
}

func StartStdio(parent context.Context, cmd *exec.Cmd) (Client, error) {
	ctx, cancel := context.WithCancel(parent)
	in, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		_ = in.Close()
		cancel()
		return nil, err
	}
	c := &stdioClient{
		cmd:       cmd,
		in:        in,
		cancel:    cancel,
		ctx:       ctx,
		pending:   map[string]chan rpcResponse{},
		eventWake: make(chan struct{}, 1),
		events:    make(chan Message, 256),
	}
	if cmd.Stderr == nil {
		cmd.Stderr = &cappedBuffer{buf: &c.stderrTail, mu: &c.mu, limit: 8192}
	}
	if err := cmd.Start(); err != nil {
		_ = in.Close()
		cancel()
		return nil, err
	}
	go func() {
		<-ctx.Done()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}()
	go c.pumpEvents()
	go c.readLoop(out)
	return c, nil
}

func Initialize(ctx context.Context, c Client, info ClientInfo) (InitializeResult, error) {
	var result InitializeResult
	params := map[string]any{
		"protocolVersion":    ProtocolVersion,
		"clientCapabilities": map[string]any{},
		"clientInfo":         info,
	}
	if err := c.Call(ctx, "initialize", params, &result); err != nil {
		return result, err
	}
	return result, nil
}

func (c *stdioClient) Events() <-chan Message { return c.events }

func (c *stdioClient) Close() {
	c.once.Do(func() {
		c.cancel()
		_ = c.in.Close()
		_ = c.cmd.Wait()
	})
}

func (c *stdioClient) write(payload any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	_, err = c.in.Write(raw)
	return err
}

func (c *stdioClient) Notify(method string, params any) error {
	msg := map[string]any{"jsonrpc": "2.0", "method": method}
	if params != nil {
		msg["params"] = params
	}
	return c.write(msg)
}

func (c *stdioClient) Reply(id json.RawMessage, result any) error {
	return c.write(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}

func (c *stdioClient) ReplyError(id json.RawMessage, code int, message string) error {
	return c.write(map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}})
}

func (c *stdioClient) Call(ctx context.Context, method string, params any, result any) error {
	c.mu.Lock()
	c.seq++
	id := c.seq
	key := strconv.Itoa(id)
	ch := make(chan rpcResponse, 1)
	c.pending[key] = ch
	c.mu.Unlock()
	defer func() {
		c.mu.Lock()
		delete(c.pending, key)
		c.mu.Unlock()
	}()
	req := map[string]any{"jsonrpc": "2.0", "id": id, "method": method}
	if params != nil {
		req["params"] = params
	}
	if err := c.write(req); err != nil {
		return err
	}
	select {
	case resp := <-ch:
		if resp.Err != nil {
			return resp.Err
		}
		if result == nil || len(resp.Result) == 0 || string(resp.Result) == "null" {
			return nil
		}
		return json.Unmarshal(resp.Result, result)
	case <-ctx.Done():
		return ctx.Err()
	case <-c.ctx.Done():
		return c.closedError()
	}
}

func (c *stdioClient) closedError() error {
	c.mu.Lock()
	detail := strings.TrimSpace(c.stderrTail.String())
	c.mu.Unlock()
	if detail != "" {
		lines := strings.Split(detail, "\n")
		last := strings.TrimSpace(lines[len(lines)-1])
		if last != "" {
			return fmt.Errorf("ACP 连接已断开：%s", last)
		}
	}
	return errors.New("ACP 连接已断开")
}

func (c *stdioClient) enqueueEvent(msg Message) {
	c.eventMu.Lock()
	if !c.eventClosed {
		if len(c.eventQueue) >= maxEventQueue {
			// Drop oldest notification if an unconsumed stream overflows.
			copy(c.eventQueue, c.eventQueue[1:])
			c.eventQueue[len(c.eventQueue)-1] = msg
		} else {
			c.eventQueue = append(c.eventQueue, msg)
		}
	}
	c.eventMu.Unlock()
	select {
	case c.eventWake <- struct{}{}:
	default:
	}
}

func (c *stdioClient) closeEvents() {
	c.eventMu.Lock()
	c.eventClosed = true
	c.eventMu.Unlock()
	select {
	case c.eventWake <- struct{}{}:
	default:
	}
}

func (c *stdioClient) pumpEvents() {
	defer close(c.events)
	for {
		c.eventMu.Lock()
		if len(c.eventQueue) == 0 {
			done := c.eventClosed
			c.eventMu.Unlock()
			if done {
				return
			}
			<-c.eventWake
			continue
		}
		batch := c.eventQueue
		c.eventQueue = nil
		c.eventMu.Unlock()
		for _, msg := range batch {
			select {
			case c.events <- msg:
			case <-c.ctx.Done():
				return
			}
		}
	}
}

func (c *stdioClient) readLoop(out io.Reader) {
	defer c.closeEvents()
	defer c.failPending()
	defer c.cancel()
	reader := bufio.NewReaderSize(out, 64*1024)
	for {
		raw, err := readJSONLine(reader, maxFrameBytes)
		if err != nil {
			if errors.Is(err, errFrameTooLarge) {
				continue
			}
			return
		}
		raw = bytes.TrimSpace(raw)
		if len(raw) == 0 || raw[0] != '{' {
			continue
		}
		var frame struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  *RPCError       `json:"error"`
		}
		if err := json.Unmarshal(raw, &frame); err != nil {
			continue
		}
		if frame.Method != "" {
			c.enqueueEvent(Message{ID: frame.ID, Method: frame.Method, Params: frame.Params})
			continue
		}
		if len(frame.ID) == 0 {
			continue
		}
		key := idKey(frame.ID)
		c.mu.Lock()
		waiter := c.pending[key]
		c.mu.Unlock()
		if waiter == nil {
			continue
		}
		resp := rpcResponse{Result: frame.Result}
		if frame.Error != nil {
			resp.Err = frame.Error
		}
		select {
		case waiter <- resp:
		default:
		}
	}
}

func (c *stdioClient) failPending() {
	err := c.closedError()
	c.mu.Lock()
	defer c.mu.Unlock()
	for k, ch := range c.pending {
		select {
		case ch <- rpcResponse{Err: err}:
		default:
		}
		delete(c.pending, k)
	}
}

func idKey(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(raw))
}

var errFrameTooLarge = errors.New("ACP frame exceeds limit")

func readJSONLine(reader *bufio.Reader, limit int) ([]byte, error) {
	var line []byte
	oversized := false
	for {
		part, err := reader.ReadSlice('\n')
		if len(line)+len(part) > limit {
			oversized = true
		}
		if !oversized {
			line = append(line, part...)
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if oversized {
			return nil, errFrameTooLarge
		}
		if errors.Is(err, io.EOF) && len(line) > 0 {
			return line, nil
		}
		return line, err
	}
}

type cappedBuffer struct {
	buf   *bytes.Buffer
	mu    *sync.Mutex
	limit int
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.buf.Len()+len(p) > b.limit {
		excess := b.buf.Len() + len(p) - b.limit
		if excess >= b.buf.Len() {
			b.buf.Reset()
		} else {
			b.buf.Next(excess)
		}
		if len(p) > b.limit {
			p = p[len(p)-b.limit:]
		}
	}
	_, _ = b.buf.Write(p)
	return len(p), nil
}
