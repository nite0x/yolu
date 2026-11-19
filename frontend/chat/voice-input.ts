import {uiText} from "../i18n";
import {readSnapshots} from "./model";

export type VoiceInputState = "idle" | "connecting" | "listening" | "finishing";

interface VoiceInputCallbacks {
  state: (state: VoiceInputState) => void;
  transcript: (text: string) => void;
  error: (message: string) => void;
}

// Codex owns authentication and session creation. The browser owns audio capture
// and consumes only input transcripts from the authenticated WebRTC session.
export class CodexVoiceInput {
  private abort = new AbortController();
  private stream?: MediaStream;
  private connection?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private id = "";
  private closed = false;
  private finishing = false;
  private native = false;
  private received = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private callbacks: VoiceInputCallbacks) {}

  async start() {
    this.callbacks.state("connecting");
    try {
      if (typeof RTCPeerConnection === "undefined" && document.documentElement.getAttribute("data-workhub-platform") === "linux") {
        await this.startNative();
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
        throw new Error(uiText("当前环境无法访问麦克风，请使用支持 WebRTC 的浏览器，并通过 localhost 或 HTTPS 打开 Yolu。"));
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
      });
      if (this.closed) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      this.timer = setTimeout(() => this.fail(uiText("Codex 语音连接超时，请重试。")), 35000);
      const connection = this.connection = new RTCPeerConnection();
      for (const track of stream.getTracks()) {
        track.enabled = false;
        connection.addTrack(track, stream);
        track.addEventListener("ended", () => { if (!this.closed && !this.finishing) this.stop(); });
      }
      connection.onconnectionstatechange = () => {
        if (!this.closed && connection.connectionState === "failed") {
          this.fail(uiText("语音连接已断开，请重试。已识别的文字保留在草稿中。"));
        }
      };
      const channel = this.channel = connection.createDataChannel("oai-events");
      channel.onmessage = event => this.message(event.data);
      channel.onclose = () => {
        if (!this.closed) this.fail(uiText("语音连接已断开，请重试。已识别的文字保留在草稿中。"));
      };
      await connection.setLocalDescription(await connection.createOffer());
      await this.gatherCandidates(connection);
      if (this.closed) return;
      const response = await fetch("/api/voice/sessions", {
        method: "POST", headers: this.headers(), signal: this.abort.signal,
        body: JSON.stringify({sdp: connection.localDescription?.sdp}),
      });
      const answer: {id?: string; sdp?: string; error?: string} = await response.json();
      if (!response.ok) throw new Error(uiText("无法启动 Codex 语音：{0}", uiText(answer.error || response.statusText)));
      this.id = answer.id || "";
      if (this.closed) {
        this.releaseServer();
        return;
      }
      if (!this.id || !answer.sdp) throw new Error(uiText("Codex 未返回有效的语音连接应答"));
      await connection.setRemoteDescription({type: "answer", sdp: answer.sdp});
    } catch (error) {
      if (this.closed) return;
      const name = (error as Error).name;
      const message = name === "NotAllowedError" || name === "SecurityError"
        ? uiText("请允许 Yolu 使用麦克风，然后重试。")
        : name === "NotFoundError"
          ? uiText("未找到麦克风，请连接麦克风后重试。")
          : (error as Error).message || uiText("无法启动语音输入，请重试。");
      this.fail(message);
    }
  }

  stop() {
    if (this.closed || this.finishing) return;
    if (this.native && this.id) {
      this.finishing = true;
      this.callbacks.state("finishing");
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.fail(uiText("听写已停止，最后一段转写未确认完成，请检查草稿。")), 15000);
      void fetch("/api/voice/native/sessions/" + encodeURIComponent(this.id) + "/stop", {method: "POST", headers: this.headers()})
        .then(response => {if (!response.ok) throw new Error(uiText("无法停止 Codex 语音，请重试。"));})
        .catch(error => {if (!this.closed) this.fail((error as Error).message);});
      return;
    }
    if (this.channel?.readyState !== "open") {
      this.cancel();
      return;
    }
    this.finishing = true;
    this.callbacks.state("finishing");
    this.stream?.getTracks().forEach(track => track.stop());
    clearTimeout(this.timer);
    // Keep receiving the final fragments until Codex acknowledges session close.
    this.timer = setTimeout(() => this.fail(uiText("听写已停止，最后一段转写未确认完成，请检查草稿。")), 15000);
    try {
      this.channel.send(JSON.stringify({type: "session.close"}));
    } catch {
      this.fail(uiText("语音连接已断开，请重试。已识别的文字保留在草稿中。"));
    }
  }

  cancel() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.abort.abort();
    this.stream?.getTracks().forEach(track => track.stop());
    this.channel?.close();
    this.connection?.close();
    this.releaseServer();
    this.callbacks.state("idle");
  }

  private message(data: unknown) {
    if (this.closed || typeof data !== "string") return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    switch (event.type) {
      case "session.started":
        if (this.finishing) return;
        clearTimeout(this.timer);
        this.stream?.getTracks().forEach(track => { track.enabled = true; });
        this.callbacks.state("listening");
        break;
      case "input_transcript.added": {
        const item = event.item;
        if (typeof item?.id !== "string" || typeof item.text !== "string" || this.received.has(item.id)) return;
        this.received.add(item.id);
        this.callbacks.transcript(item.text);
        break;
      }
      case "session.closed":
        this.cancel();
        break;
      case "error":
        this.fail(uiText("Codex 语音识别失败：{0}", event.error?.message || uiText("请重试")));
        break;
    }
  }

  private fail(message: string) {
    this.callbacks.error(message);
    this.cancel();
  }

  private async startNative() {
    this.native = true;
    this.timer = setTimeout(() => this.fail(uiText("Codex 语音连接超时，请重试。")), 90000);
    const response = await fetch("/api/voice/native/sessions", {method: "POST", headers: this.headers(), signal: this.abort.signal});
    if (!response.ok) {
      const result = await response.json();
      throw new Error(uiText("无法启动 Codex 语音：{0}", uiText(result.error || response.statusText)));
    }
    await readSnapshots<{id?: string; state?: string; text?: string; error?: string}>(response, event => {
      if (this.closed) return;
      if (event.id) this.id = event.id;
      if (event.state === "listening") {
        clearTimeout(this.timer);
        this.callbacks.state("listening");
      }
      if (event.text) this.callbacks.transcript(event.text);
      if (event.error) this.fail(uiText("Codex 语音识别失败：{0}", uiText(event.error)));
      if (event.state === "idle") this.cancel();
    });
    if (!this.closed) this.fail(uiText("语音连接已断开，请重试。已识别的文字保留在草稿中。"));
  }

  private headers() {
    return {"Content-Type": "application/json", "X-CSRF-Token": document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""};
  }

  private releaseServer() {
    if (!this.id) return;
    const id = this.id;
    this.id = "";
    void fetch("/api/voice/sessions/" + encodeURIComponent(id), {
      method: "DELETE", headers: this.headers(), keepalive: true,
    }).catch(() => {});
  }

  private gatherCandidates(connection: RTCPeerConnection) {
    if (connection.iceGatheringState === "complete") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        connection.removeEventListener("icegatheringstatechange", changed);
        this.abort.signal.removeEventListener("abort", aborted);
      };
      const changed = () => {
        if (connection.iceGatheringState !== "complete") return;
        cleanup();
        resolve();
      };
      const aborted = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error(uiText("无法建立语音网络连接，请检查网络后重试。"))); }, 8000);
      connection.addEventListener("icegatheringstatechange", changed);
      this.abort.signal.addEventListener("abort", aborted, {once: true});
      if (this.abort.signal.aborted) aborted();
      else changed();
    });
  }
}
