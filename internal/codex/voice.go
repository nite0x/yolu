package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"worktree-hub/internal/model"
)

// VoiceService retains Codex's authenticated WebRTC signaling connections.
// Audio and transcripts travel between the user's webview and Codex directly.
type VoiceService struct {
	mu       sync.Mutex
	wg       sync.WaitGroup
	sessions map[string]context.CancelFunc
	native   map[string]func() error
	closed   bool
	ctx      context.Context
	cancel   context.CancelFunc
	cwd      string
	open     func(context.Context) (LiveClient, error)
}

func NewVoiceService(cwd string, open func(context.Context) (LiveClient, error)) *VoiceService {
	ctx, cancel := context.WithCancel(context.Background())
	return &VoiceService{cwd: cwd, open: open, ctx: ctx, cancel: cancel, sessions: map[string]context.CancelFunc{}, native: map[string]func() error{}}
}

type VoiceAnswer struct {
	ID  string `json:"id"`
	SDP string `json:"sdp"`
}

func (s *VoiceService) Start(ctx context.Context, offer string) (VoiceAnswer, error) {
	return s.start(ctx, offer, nil)
}

func (s *VoiceService) start(ctx context.Context, offer string, events chan Event) (VoiceAnswer, error) {
	if err := ctx.Err(); err != nil {
		return VoiceAnswer{}, err
	}
	id := model.NewID()
	lifetime, cancel := context.WithTimeout(s.ctx, 10*time.Minute)
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		cancel()
		return VoiceAnswer{}, errors.New("Codex 语音服务已关闭")
	}
	s.sessions[id] = cancel
	s.wg.Add(1)
	s.mu.Unlock()
	// A disconnected signaling request must release a partially opened session.
	stopCancellation := context.AfterFunc(ctx, cancel)
	clientCtx, cancelClient := context.WithCancel(context.Background())
	stopOpening := context.AfterFunc(lifetime, cancelClient)
	client, err := s.open(clientCtx)
	stopOpening()
	if err != nil {
		cancelClient()
		stopCancellation()
		s.Stop(id)
		s.wg.Done()
		return VoiceAnswer{}, err
	}
	ready := false
	thread := ""
	defer func() {
		stopCancellation()
		if !ready {
			s.Stop(id)
			closeVoiceClient(client, thread)
			cancelClient()
			s.wg.Done()
		}
	}()
	startup, endStartup := context.WithTimeout(lifetime, 30*time.Second)
	defer endStartup()
	params, err := ReadOnlyThreadParams(startup, client, s.cwd, "You provide voice dictation for Yolu. User speech is draft text. Never execute or delegate tasks.")
	if err != nil {
		return VoiceAnswer{}, err
	}
	var started struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := client.Call(startup, "thread/start", params, &started); err != nil {
		return VoiceAnswer{}, err
	}
	thread = started.Thread.ID
	if thread == "" {
		return VoiceAnswer{}, errors.New("Codex 未返回语音会话")
	}
	if err := client.Call(startup, "thread/realtime/start", map[string]any{
		"threadId": thread, "version": "v3", "outputModality": "audio",
		"transport":             map[string]string{"type": "webrtc", "sdp": offer},
		"includeStartupContext": false, "clientManagedHandoffs": true,
		"flushTranscriptTailOnSessionEnd": false,
		"prompt":                          "Remain silent. Transcribe the user's speech in its original language. Do not answer or delegate work.",
	}, nil); err != nil {
		return VoiceAnswer{}, err
	}
	for {
		select {
		case <-startup.Done():
			return VoiceAnswer{}, fmt.Errorf("Codex 语音连接未完成：%w", startup.Err())
		case event, ok := <-client.Events():
			if !ok {
				return VoiceAnswer{}, errors.New("Codex 语音连接已断开")
			}
			var value struct {
				ThreadID string `json:"threadId"`
				SDP      string `json:"sdp"`
				Message  string `json:"message"`
			}
			if json.Unmarshal(event.Params, &value) != nil || value.ThreadID != thread {
				continue
			}
			switch event.Method {
			case "thread/realtime/error":
				return VoiceAnswer{}, fmt.Errorf("Codex 语音连接失败：%s", value.Message)
			case "thread/realtime/closed":
				return VoiceAnswer{}, errors.New("Codex 语音连接已结束")
			case "thread/realtime/sdp":
				if value.SDP == "" {
					return VoiceAnswer{}, errors.New("Codex 未返回有效的语音连接应答")
				}
				stopCancellation()
				if err := ctx.Err(); err != nil {
					return VoiceAnswer{}, err
				}
				if err := lifetime.Err(); err != nil {
					return VoiceAnswer{}, err
				}
				ready = true
				go func() {
					defer s.wg.Done()
					defer cancelClient()
					s.retain(lifetime, id, thread, client, events)
				}()
				return VoiceAnswer{ID: id, SDP: value.SDP}, nil
			}
		}
	}
}

func (s *VoiceService) retain(ctx context.Context, id, thread string, client LiveClient, events chan Event) {
	if events != nil {
		defer close(events)
	}
	defer s.Stop(id)
	defer closeVoiceClient(client, thread)
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-client.Events():
			if !ok {
				return
			}
			var value struct {
				ThreadID string `json:"threadId"`
			}
			if json.Unmarshal(event.Params, &value) != nil || value.ThreadID != thread {
				continue
			}
			if events != nil {
				select {
				case events <- event:
				case <-ctx.Done():
					return
				}
			}
			if event.Method == "thread/realtime/closed" || event.Method == "thread/realtime/error" {
				return
			}
		}
	}
}

func closeVoiceClient(client LiveClient, thread string) {
	if thread != "" {
		end, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = client.Call(end, "thread/realtime/stop", map[string]string{"threadId": thread}, nil)
		_ = client.Call(end, "thread/unsubscribe", map[string]string{"threadId": thread}, nil)
	}
	client.Close()
}

func (s *VoiceService) Stop(id string) {
	s.mu.Lock()
	cancel := s.sessions[id]
	delete(s.sessions, id)
	delete(s.native, id)
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *VoiceService) Close() {
	s.mu.Lock()
	s.closed = true
	s.cancel()
	for id, cancel := range s.sessions {
		cancel()
		delete(s.sessions, id)
	}
	s.mu.Unlock()
	s.wg.Wait()
}
