package app

import (
	"encoding/json"
	"net/http"
	"runtime"
	"strings"
	"time"

	"worktree-hub/internal/codex"
	"worktree-hub/internal/httpx"
)

func (a *App) voiceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/voice/native/sessions", a.nativeVoiceHandler)
	mux.HandleFunc("POST /api/voice/native/sessions/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		if isBrowserRequest(r) || runtime.GOOS != "linux" {
			httpx.WriteError(w, http.StatusForbidden, "请在主机上的 Yolu 中执行此操作")
			return
		}
		if err := a.voice.StopNativeInput(r.PathValue("id")); err != nil {
			httpx.WriteError(w, http.StatusBadGateway, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/voice/sessions", func(w http.ResponseWriter, r *http.Request) {
		if a.Workspace.ReadOnlySessions {
			httpx.WriteError(w, http.StatusMethodNotAllowed, "对话内容仅供查看")
			return
		}
		var input struct {
			SDP string `json:"sdp"`
		}
		if !httpx.DecodeLimit(w, r, &input, 64<<10) {
			return
		}
		if !strings.HasPrefix(input.SDP, "v=0") || !strings.Contains(input.SDP, "m=audio") {
			httpx.WriteError(w, http.StatusBadRequest, "语音连接请求无效，请重试")
			return
		}
		answer, err := a.voice.Start(r.Context(), input.SDP)
		if err != nil {
			httpx.WriteError(w, http.StatusBadGateway, err.Error())
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, answer)
	})
	mux.HandleFunc("DELETE /api/voice/sessions/{id}", func(w http.ResponseWriter, r *http.Request) {
		a.voice.Stop(r.PathValue("id"))
		w.WriteHeader(http.StatusNoContent)
	})
}

func (a *App) nativeVoiceHandler(w http.ResponseWriter, r *http.Request) {
	if isBrowserRequest(r) || runtime.GOOS != "linux" {
		httpx.WriteError(w, http.StatusForbidden, "请在主机上的 Yolu 中执行此操作")
		return
	}
	if a.Workspace.ReadOnlySessions {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "对话内容仅供查看")
		return
	}
	started := false
	send := func(event codex.NativeVoiceEvent) error {
		controller := http.NewResponseController(w)
		_ = controller.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if !started {
			w.Header().Set("Content-Type", "text/event-stream")
			started = true
		}
		raw, _ := json.Marshal(event)
		if _, err := w.Write(append(append([]byte("data: "), raw...), '\n', '\n')); err != nil {
			return err
		}
		return controller.Flush()
	}
	if err := a.voice.DictateNative(r.Context(), send); err != nil && r.Context().Err() == nil {
		if !started {
			httpx.WriteError(w, http.StatusBadGateway, err.Error())
		} else {
			_ = send(codex.NativeVoiceEvent{Error: err.Error()})
		}
	}
}
