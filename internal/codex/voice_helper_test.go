package codex

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"worktree-hub/internal/platform"
)

// The subprocess fixture implements controls only and never opens audio devices.
func TestVoiceHelperProcess(t *testing.T) {
	if os.Getenv("YOLU_VOICE_HELPER_TEST") != "1" {
		return
	}
	for {
		var size uint32
		if binary.Read(os.Stdin, binary.BigEndian, &size) != nil {
			os.Exit(0)
		}
		if size > 128<<10 {
			os.Exit(2)
		}
		raw := make([]byte, size)
		if _, err := io.ReadFull(os.Stdin, raw); err != nil {
			os.Exit(2)
		}
		var message map[string]any
		if json.Unmarshal(raw, &message) != nil {
			os.Exit(2)
		}
		if path := os.Getenv("ALSA_CONFIG_PATH"); path != "" {
			file, _ := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
			_, _ = fmt.Fprintln(file, string(raw))
			_ = file.Close()
		}
		reply := map[string]any{}
		switch message["type"] {
		case "hello":
			if message["protocol"] != float64(1) || message["buildCommit"] != "fixture" {
				os.Exit(2)
			}
			reply["type"] = "ready"
		case "initializeRuntime":
			reply["type"] = "runtimeReady"
		case "startTransport":
			reply["type"], reply["sdp"] = "offer", "offer"
		case "applyAnswer":
			reply["type"] = "transportReady"
		case "openDevices":
			reply["type"] = "devicesOpened"
		case "setAudioControls":
			reply["type"] = "audioControlsApplied"
		case "inspectAudio":
			reply["type"] = "audioState"
		default:
			os.Exit(2)
		}
		raw, _ = json.Marshal(reply)
		_ = binary.Write(os.Stdout, binary.BigEndian, uint32(len(raw)))
		_, _ = os.Stdout.Write(raw)
	}
}

func voiceHelperFixture(t *testing.T) string {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("native capture fallback is Linux-only")
	}
	root := t.TempDir()
	voice := filepath.Join(root, "packages", "app-server-daemon", "current", "codex-resources", "voice")
	if err := os.MkdirAll(filepath.Join(voice, "bin"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(voice, "manifest.json"), []byte(`{"buildCommit":"fixture"}`), 0600); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nYOLU_VOICE_HELPER_TEST=1 exec " + platform.ShellQuote(executable) + " -test.run=^TestVoiceHelperProcess$\n"
	if err := os.WriteFile(filepath.Join(voice, "bin", "codex-voice-host"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(root, "controls.jsonl")
	t.Setenv("CODEX_HOME", root)
	t.Setenv("ALSA_CONFIG_PATH", log)
	return log
}

func TestNativeVoiceUsesSameBuildHelperAndOnlyUserTranscriptFragments(t *testing.T) {
	log := voiceHelperFixture(t)
	client := newVoiceTestClient()
	client.events <- Event{Method: "thread/realtime/transcript/delta", Params: json.RawMessage(`{"threadId":"voice-thread","role":"user","delta":"pre-start"}`)}
	service := NewVoiceService(t.TempDir(), func(context.Context) (LiveClient, error) { return client, nil })
	defer service.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var observed []NativeVoiceEvent
	err := service.DictateNative(ctx, func(event NativeVoiceEvent) error {
		observed = append(observed, event)
		if event.State == "listening" {
			client.events <- Event{Method: "thread/realtime/transcript/delta", Params: json.RawMessage(`{"threadId":"unrelated-thread","role":"user","delta":"忽略其他会话"}`)}
			client.events <- Event{Method: "thread/realtime/transcript/delta", Params: json.RawMessage(`{"threadId":"voice-thread","role":"user","delta":"语音草稿"}`)}
			client.events <- Event{Method: "thread/realtime/transcript/delta", Params: json.RawMessage(`{"threadId":"voice-thread","role":"assistant","delta":"忽略回答"}`)}
			return service.StopNativeInput(event.ID)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	text := ""
	for _, event := range observed {
		text += event.Text
	}
	if text != "语音草稿" || observed[0].State != "listening" || observed[len(observed)-1].State != "idle" {
		t.Fatalf("incorrect native transcript stream: %+v", observed)
	}
	raw, err := os.ReadFile(log)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"microphoneMuted":false,"speakerSuppressed":true`) || !strings.Contains(string(raw), `"microphoneMuted":true,"speakerSuppressed":true`) {
		t.Fatal("native capture did not acknowledge unmute and stop with playback suppressed")
	}
}

func TestNativeVoiceCancellationReleasesThePackagedProcess(t *testing.T) {
	voiceHelperFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	helper, err := openVoiceHelper(ctx)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	helper.close()
	if helper.cmd.ProcessState == nil {
		t.Fatal("native helper was not reaped")
	}
}
