package codex

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Codex's packaged helper owns native microphone capture and WebRTC. Its
// length-prefixed control protocol carries signaling, never audio or tokens.
type voiceHelper struct {
	cmd     *exec.Cmd
	input   io.WriteCloser
	replies chan json.RawMessage
	mu      sync.Mutex
}

var errVoiceNegotiationTimeout = errors.New("Codex 原生语音网络连接超时，请检查网络后重试")

func openVoiceHelper(ctx context.Context) (*voiceHelper, error) {
	root := os.Getenv("CODEX_HOME")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		root = filepath.Join(home, ".codex")
	}
	var helper, commit string
	for _, kind := range []string{"app-server-daemon", "standalone"} {
		packageDir, err := filepath.EvalSymlinks(filepath.Join(root, "packages", kind, "current"))
		if err != nil {
			continue
		}
		voiceDir := filepath.Join(packageDir, "codex-resources", "voice")
		var manifest struct {
			BuildCommit string `json:"buildCommit"`
		}
		raw, err := os.ReadFile(filepath.Join(voiceDir, "manifest.json"))
		if err != nil || json.Unmarshal(raw, &manifest) != nil || manifest.BuildCommit == "" {
			continue
		}
		candidate := filepath.Join(voiceDir, "bin", "codex-voice-host")
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0 {
			helper, commit = candidate, manifest.BuildCommit
			break
		}
	}
	if helper == "" {
		return nil, errors.New("未找到 Codex 原生语音组件，请更新 Codex 后重试")
	}
	cmd := exec.CommandContext(ctx, helper)
	// Use the package's media libraries and plugins. Retain normal local audio
	// configuration while leaving provider credentials out of the child process.
	for _, key := range []string{"HOME", "XDG_RUNTIME_DIR", "PULSE_SERVER", "PULSE_COOKIE", "PULSE_SOURCE", "PIPEWIRE_REMOTE", "DBUS_SESSION_BUS_ADDRESS", "ALSA_CONFIG_PATH", "ALSA_PLUGIN_DIR", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"} {
		if value, ok := os.LookupEnv(key); ok {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}
	cmd.Env = append(cmd.Env, "GST_PLUGIN_PATH=", "GST_PLUGIN_PATH_1_0=", "GST_PLUGIN_SYSTEM_PATH=", "GST_PLUGIN_SYSTEM_PATH_1_0=", "GST_REGISTRY=/dev/null", "GST_REGISTRY_UPDATE=no", "GST_REGISTRY_FORK=no")
	if os.Getenv("ALSA_PLUGIN_DIR") == "" {
		for _, directory := range []string{"/usr/lib/x86_64-linux-gnu/alsa-lib", "/usr/lib/aarch64-linux-gnu/alsa-lib", "/usr/lib64/alsa-lib", "/usr/lib/alsa-lib"} {
			if info, err := os.Stat(directory); err == nil && info.IsDir() {
				cmd.Env = append(cmd.Env, "ALSA_PLUGIN_DIR="+directory)
				break
			}
		}
	}
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		input.Close()
		return nil, err
	}
	h := &voiceHelper{cmd: cmd, input: input, replies: make(chan json.RawMessage)}
	go func() {
		defer close(h.replies)
		for {
			var size uint32
			if binary.Read(output, binary.BigEndian, &size) != nil || size == 0 || size > 128<<10 {
				return
			}
			raw := make([]byte, size)
			if _, err := io.ReadFull(output, raw); err != nil {
				return
			}
			select {
			case h.replies <- raw:
			case <-ctx.Done():
				return
			}
		}
	}()
	if _, err := h.exchange(ctx, map[string]any{"type": "hello", "protocol": 1, "buildCommit": commit}, "ready"); err != nil {
		h.close()
		return nil, err
	}
	return h, nil
}

func (h *voiceHelper) exchange(ctx context.Context, message map[string]any, expected string) (json.RawMessage, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	raw, err := json.Marshal(message)
	if err != nil || len(raw) > 128<<10 {
		return nil, errors.New("Codex 原生语音控制请求无效")
	}
	frame := binary.BigEndian.AppendUint32(nil, uint32(len(raw)))
	if _, err := h.input.Write(append(frame, raw...)); err != nil {
		return nil, errors.New("Codex 原生语音组件已断开")
	}
	select {
	case raw, ok := <-h.replies:
		var reply struct {
			Type string `json:"type"`
		}
		if ok && json.Unmarshal(raw, &reply) == nil && reply.Type == "transportTimedOut" {
			return nil, errVoiceNegotiationTimeout
		}
		if !ok || reply.Type != expected {
			return nil, fmt.Errorf("Codex 原生语音操作失败（%s）", message["type"])
		}
		return raw, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (h *voiceHelper) close() {
	_ = h.input.Close()
	_ = h.cmd.Process.Kill()
	_ = h.cmd.Wait()
}

type NativeVoiceEvent struct {
	ID    string `json:"id,omitempty"`
	State string `json:"state,omitempty"`
	Text  string `json:"text,omitempty"`
	Error string `json:"error,omitempty"`
}

// DictateNative is used by local desktop webviews without WebRTC support.
func (s *VoiceService) DictateNative(ctx context.Context, send func(NativeVoiceEvent) error) error {
	for attempt := 0; ; attempt++ {
		err := s.dictateNativeOnce(ctx, send)
		if attempt > 0 || !errors.Is(err, errVoiceNegotiationTimeout) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

func (s *VoiceService) dictateNativeOnce(ctx context.Context, send func(NativeVoiceEvent) error) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return errors.New("Codex 语音服务已关闭")
	}
	s.wg.Add(1)
	s.mu.Unlock()
	defer s.wg.Done()
	helperCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	stopClosing := context.AfterFunc(s.ctx, cancel)
	defer stopClosing()
	helper, err := openVoiceHelper(helperCtx)
	if err != nil {
		return err
	}
	defer helper.close()
	startup, endStartup := context.WithTimeout(helperCtx, 40*time.Second)
	defer endStartup()
	if _, err := helper.exchange(startup, map[string]any{"type": "initializeRuntime"}, "runtimeReady"); err != nil {
		return err
	}
	raw, err := helper.exchange(startup, map[string]any{"type": "startTransport"}, "offer")
	if err != nil {
		return err
	}
	var offer struct {
		SDP string `json:"sdp"`
	}
	if err := json.Unmarshal(raw, &offer); err != nil || strings.TrimSpace(offer.SDP) == "" {
		return errors.New("Codex 原生语音组件未返回连接请求")
	}
	events := make(chan Event, 64)
	answer, err := s.start(startup, offer.SDP, events)
	if err != nil {
		return err
	}
	defer s.Stop(answer.ID)
	if _, err := helper.exchange(startup, map[string]any{"type": "applyAnswer", "sdp": answer.SDP}, "transportReady"); err != nil {
		return err
	}
	if _, err := helper.exchange(startup, map[string]any{"type": "openDevices", "selection": map[string]any{"microphone": nil, "speaker": nil, "channel": nil}}, "devicesOpened"); err != nil {
		return err
	}
	controls := func(muted bool) error {
		controlCtx, end := context.WithTimeout(helperCtx, 3*time.Second)
		defer end()
		_, err := helper.exchange(controlCtx, map[string]any{"type": "setAudioControls", "controls": map[string]bool{"microphoneMuted": muted, "speakerSuppressed": true}}, "audioControlsApplied")
		return err
	}
	if err := controls(false); err != nil {
		return err
	}
	s.mu.Lock()
	s.native[answer.ID] = func() error {
		if err := controls(true); err != nil {
			s.Stop(answer.ID)
			return err
		}
		// Allow the final in-flight audio/transcript fragments to arrive after
		// the helper has acknowledged invalidating its capture buffers.
		time.AfterFunc(700*time.Millisecond, func() { s.Stop(answer.ID) })
		return nil
	}
	s.mu.Unlock()
	if err := send(NativeVoiceEvent{ID: answer.ID, State: "listening"}); err != nil {
		return err
	}
	inspect := time.NewTicker(2 * time.Second)
	defer inspect.Stop()
	for {
		select {
		case <-helperCtx.Done():
			return helperCtx.Err()
		case <-inspect.C:
			check, end := context.WithTimeout(helperCtx, 3*time.Second)
			_, err := helper.exchange(check, map[string]any{"type": "inspectAudio"}, "audioState")
			end()
			if err != nil {
				return err
			}
		case event, ok := <-events:
			if !ok {
				return send(NativeVoiceEvent{State: "idle"})
			}
			if event.Method == "thread/realtime/transcript/delta" {
				var value struct {
					Role  string `json:"role"`
					Delta string `json:"delta"`
				}
				if json.Unmarshal(event.Params, &value) == nil && value.Role == "user" && value.Delta != "" {
					if err := send(NativeVoiceEvent{Text: value.Delta}); err != nil {
						return err
					}
				}
			}
			if event.Method == "thread/realtime/error" {
				var value struct {
					Message string `json:"message"`
				}
				_ = json.Unmarshal(event.Params, &value)
				return fmt.Errorf("Codex 语音连接失败：%s", value.Message)
			}
		}
	}
}

func (s *VoiceService) StopNativeInput(id string) error {
	s.mu.Lock()
	stop := s.native[id]
	s.mu.Unlock()
	if stop != nil {
		return stop()
	}
	return nil
}
