import { uiText } from "../i18n";
import { createDraftPersistence } from "./draft-persistence";
import { readLocalDraft, type DraftRecord } from "./drafts";

export type AssistantRequest = <T>(
  path: string,
  options?: RequestInit,
) => Promise<T>;
export interface AssistantMessage {
  id: number;
  run_id: string;
  role: "user" | "assistant";
  text: string;
}
export interface AssistantRun {
  id: string;
  status: string;
  error_code: string;
}
export interface AssistantSnapshot {
  messages: AssistantMessage[];
  run: AssistantRun | null;
  before: number;
}
export interface AssistantConversation {
  updated_at?: number;
  id: string;
  title: string;
  environment_id: "local";
  kind: "yolu";
}

export class GlobalAssistantController {
  private listeners = new Set<() => void>();
  private connected = false;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: { request_id: string; text: string };
  reading: DraftRecord["reading"] = {
    top: 0,
    bottom: true,
    anchor: "",
    offset: 0,
  };
  private state = {
    messages: [] as AssistantMessage[],
    run: null as AssistantRun | null,
    before: 0,
    draft: "",
    loading: true,
    submitting: false,
    error: "",
    loadError: "",
    historyError: "",
    notice: "",
    restored: false,
  };
  opening = true;
  private persistence;
  constructor(
    readonly id: string,
    readonly request: AssistantRequest,
    readonly readOnly = false,
  ) {
    const key = JSON.stringify(["local", "yolu", id]);
    this.persistence = createDraftPersistence({
      request,
      key: () => key,
      enabled: () => !this.readOnly && this.state.restored,
      connected: () => this.connected,
      submitting: () => this.state.submitting,
      capture: () => ({
        assistant_request: this.pending,
        text: this.state.draft,
        images: [],
        settings: {},
        project: "",
        reading: this.reading,
      }),
      restore: (record) => {
        this.pending = record.assistant_request;
        this.reading = record.reading;
        this.update({ draft: record.text });
      },
      notice: (notice) => this.update({ notice }),
    });
    const cached = readLocalDraft(key);
    if (cached) this.persistence.restore(cached);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  getReadingSnapshot = () => ({
    entries: this.state.messages,
    loading: this.state.loading,
    historyError: this.state.historyError || this.state.loadError,
    cursor: this.state.before,
  });
  latestMessage = () => {
    const message = this.state.messages.at(-1);
    return message ? `${message.id}:${message.text.length}` : "";
  };
  readingChanged = () => this.persistence.changed();
  private update(update: Partial<typeof this.state>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach((listener) => listener());
  }
  get busy() {
    return this.state.run?.status === "running";
  }
  private base() {
    return `/api/assistant/conversations/${encodeURIComponent(this.id)}`;
  }
  setDraft = (draft: string) => {
    if (draft === this.state.draft) return;
    this.update({ draft });
    this.persistence.changed();
  };
  flush = () => this.persistence.flush();
  async connect() {
    this.connected = true;
    this.opening = true;
    await this.persistence.load();
    if (!this.connected) return;
    this.update({ restored: true });
    await this.refresh();
    if (this.connected) {
      this.opening = false;
      this.update({});
    }
  }
  disconnect() {
    this.connected = false;
    this.generation++;
    clearTimeout(this.timer);
    void this.flush();
  }
  async refresh(earlier = false) {
    const generation = ++this.generation;
    clearTimeout(this.timer);
    if (earlier) this.update({ loading: true });
    try {
      const page = await this.request<AssistantSnapshot>(
        this.base() + (earlier ? `?before=${this.state.before}` : ""),
      );
      if (!this.connected || generation !== this.generation) return;
      const messages = new Map(
        this.state.messages.map((message) => [message.id, message]),
      );
      page.messages.forEach((message) => messages.set(message.id, message));
      this.update({
        ...page,
        messages: [...messages.values()].sort((a, b) => a.id - b.id),
        before:
          earlier || !this.state.messages.length
            ? page.before
            : this.state.before,
        loading: false,
        loadError: "",
        historyError: earlier ? "" : this.state.historyError,
      });
      if (this.pending && page.run?.id === this.pending.request_id) {
        if (this.state.draft.trim() === this.pending.text) this.setDraft("");
        this.pending = undefined;
        this.update({ error: "" });
        void this.flush();
      }
    } catch (error) {
      if (this.connected && generation === this.generation)
        this.update(
          earlier
            ? { loading: false, historyError: (error as Error).message }
            : { loading: false, loadError: (error as Error).message },
        );
    } finally {
      if (this.connected && generation === this.generation)
        this.timer = setTimeout(
          () => void this.refresh(),
          this.busy ? 700 : 4000,
        );
    }
  }
  async send() {
    const text = this.state.draft.trim();
    if (
      this.readOnly ||
      !text ||
      this.busy ||
      this.state.submitting ||
      !this.state.restored
    )
      return false;
    this.pending =
      this.pending?.text === text
        ? this.pending
        : { request_id: crypto.randomUUID(), text };
    this.update({ submitting: true, error: "" });
    // Invalidate older history requests before accepting a new run snapshot.
    this.generation++;
    clearTimeout(this.timer);
    try {
      if (!(await this.flush()))
        throw new Error(uiText("发送前无法保存草稿，请检查连接后重试。"));
      const run = await this.request<AssistantRun>(this.base() + "/runs", {
        method: "POST",
        body: JSON.stringify(this.pending),
      });
      this.pending = undefined;
      this.update({ run });
      if (this.state.draft.trim() === text) this.setDraft("");
      await this.flush();
      return true;
    } catch (error) {
      this.update({ error: (error as Error).message });
      await this.refresh();
      return !this.pending;
    } finally {
      this.update({ submitting: false });
      if (this.connected) void this.refresh();
    }
  }
  async stop() {
    if (!this.state.run) return;
    try {
      await this.request(this.base() + "/stop", {
        method: "POST",
        body: JSON.stringify({ run_id: this.state.run.id }),
      });
    } catch (error) {
      this.update({ error: (error as Error).message });
    }
    if (this.connected) void this.refresh();
  }
}

export function assistantRunError(code?: string) {
  switch (code) {
    case "codex_unavailable":
      return uiText(
        "无法完成 Codex 请求。请在本机终端运行 codex login，检查 Codex 模型配置及网络，然后重新发送消息。",
      );
    case "timeout":
      return uiText("助手请求超时，消息已保存。请检查网络后重新发送。");
    case "interrupted":
      return uiText("上次助手运行被中断，消息已保留。请检查历史后重新发送。");
    case "cancelled":
      return uiText("助手运行已停止，消息已保留。");
    default:
      return "";
  }
}
