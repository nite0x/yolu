import { uiText } from "../i18n";
import { createDraftPersistence } from "./draft-persistence";
import { readLocalDraft, type DraftRecord } from "./drafts";
import { assistantReplyID } from "./assistant-messages";

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
  activities?: AssistantActivity[];
  plans?: AssistantPlan[];
}
export interface AssistantResource {
  kind: "project" | "workspace" | "conversation";
  id: string;
  environment_id: string;
  name: string;
  path?: string;
}
export interface AssistantContext {
  environment_id: string;
  workspace_id?: string;
  project_id?: string;
}
export interface AssistantOptions {
  getContext?: () => AssistantContext;
  contextLabel?: () => string;
  clearContext?: () => void;
  openResource?: (resource: AssistantResource) => void | Promise<void>;
}
export interface AssistantActivity {
  id: number;
  run_id: string;
  capability: string;
  status: string;
  result: {
    resources?: AssistantResource[];
    choices?: AssistantResource[];
    data?: unknown;
    errors?: {environment_id?: string; error?: string; message?: string}[];
    refreshed_at?: string | number;
    next_cursor?: string | number;
    message?: string;
    error?: string | {code?: string; message: string; details?: string[]};
  };
  error_code?: string;
  created_at: number;
}
export interface AssistantPlan {
  id: string;
  conversation_id: string;
  run_id: string;
  revision: number;
  digest: string;
  environment_id: string;
  capability: string;
  arguments: Record<string, unknown>;
  review: Record<string, unknown>;
  status: string;
  steps: {id: string; label: string; status: string; result?: unknown; error?: string}[];
  resources: AssistantResource[];
  error_code?: string;
  error?: string;
  created_at: number;
  updated_at: number;
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
  private pending?: { request_id: string; text: string; context?: AssistantContext };
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
    activities: [] as AssistantActivity[],
    plans: [] as AssistantPlan[],
    deciding: {} as Record<string, boolean>,
    decisionErrors: {} as Record<string, string>,
    navigating: "",
  };
  opening = true;
  private persistence;
  constructor(
    readonly id: string,
    readonly request: AssistantRequest,
    readonly readOnly = false,
    public options: AssistantOptions = {},
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
      const query = new URLSearchParams();
      if (earlier) query.set("before", String(this.state.before));
      for (const plan of this.state.plans) {
        if (["running", "cancelling"].includes(plan.status)) query.append("plan_id", plan.id);
      }
      const page = await this.request<AssistantSnapshot>(
        this.base() + (query.size ? `?${query}` : ""),
      );
      if (!this.connected || generation !== this.generation) return;
      const messages = new Map(
        this.state.messages.map((message) => [message.id, message]),
      );
      page.messages.forEach((message) => messages.set(message.id, message));
      const anchor = messages.get(Number(this.reading.anchor));
      if (anchor?.role === "assistant" && anchor.run_id)
        this.reading.anchor = assistantReplyID(anchor.run_id);
      const activities = new Map(this.state.activities.map((activity) => [activity.id, activity]));
      page.activities?.forEach((activity) => activities.set(activity.id, activity));
      const plans = new Map(this.state.plans.map((plan) => [plan.id, plan]));
      page.plans?.forEach((plan) => plans.set(plan.id, plan));
      this.update({
        ...page,
        activities: [...activities.values()],
        plans: [...plans.values()],
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
          this.busy || this.state.plans.some((plan) => ["running", "cancelling"].includes(plan.status)) ? 700 : 4000,
        );
    }
  }
  clearContext = () => {
    if (this.readOnly || this.state.submitting || !this.options.clearContext) return;
    this.options.clearContext();
    // Clearing is an explicit payload change. Ordinary retries keep their receipt.
    this.pending = undefined;
    this.update({ error: "" });
    this.persistence.changed();
  };
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
        : { request_id: crypto.randomUUID(), text, context: this.options.getContext?.() };
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
  async decide(planID: string, decision: "approve" | "cancel", reviewed?: Pick<AssistantPlan, "revision" | "digest">) {
    const plan = this.state.plans.find((item) => item.id === planID);
    if (this.readOnly || !plan || this.state.deciding[planID]) return false;
    if (reviewed && (reviewed.revision !== plan.revision || reviewed.digest !== plan.digest)) {
      this.update({decisionErrors: {...this.state.decisionErrors, [planID]: uiText("计划已更新，请重新查看后确认。")}});
      return false;
    }
    if (decision === "approve" && plan.status !== "pending") return false;
    if (decision === "cancel" && !["pending", "running"].includes(plan.status)) return false;
    return this.planRequest(plan, "/decision", {
      decision,
      revision: plan.revision,
      digest: plan.digest,
      request_id: `decision-${plan.id}-${plan.revision}-${decision}`,
    });
  }
  async reconcile(planID: string) {
    const plan = this.state.plans.find((item) => item.id === planID);
    if (this.readOnly || !plan || this.state.deciding[planID]) return false;
    return this.planRequest(plan, "/reconcile", {});
  }
  private async planRequest(plan: AssistantPlan, path: string, body: object) {
    this.generation++;
    clearTimeout(this.timer);
    this.update({
      deciding: {...this.state.deciding, [plan.id]: true},
      decisionErrors: {...this.state.decisionErrors, [plan.id]: ""},
    });
    try {
      const updated = await this.request<AssistantPlan>(
        this.base() + "/plans/" + encodeURIComponent(plan.id) + path,
        {method: "POST", body: JSON.stringify(body)},
      );
      this.update({plans: this.state.plans.map((item) => item.id === updated.id ? updated : item)});
      return true;
    } catch (error) {
      this.update({decisionErrors: {...this.state.decisionErrors, [plan.id]: (error as Error).message}});
      return false;
    } finally {
      this.update({deciding: {...this.state.deciding, [plan.id]: false}});
      if (this.connected) void this.refresh();
    }
  }
  async openResource(resource: AssistantResource) {
    if (this.state.navigating || !this.options.openResource) return;
    this.update({navigating: resource.kind + ":" + resource.id, error: ""});
    try {
      const current = await this.request<AssistantResource>(
        `/api/assistant/resources/${encodeURIComponent(resource.kind)}/${encodeURIComponent(resource.id)}?environment_id=${encodeURIComponent(resource.environment_id)}`,
      );
      if (current.kind !== resource.kind || current.id !== resource.id || current.environment_id !== resource.environment_id)
        throw new Error(uiText("资源信息已变化，请重新查询后打开。"));
      if (!(await this.flush())) return;
      await this.options.openResource(current);
    } catch (error) {
      this.update({error: (error as Error).message});
    } finally {
      this.update({navigating: ""});
    }
  }
  chooseResource(resource: AssistantResource) {
    if (this.readOnly || this.busy || this.state.submitting) return;
    this.setDraft([this.state.draft, uiText("选择 {0}（环境 {1}，标识 {2}）", resource.name, resource.environment_id, resource.id)].filter(Boolean).join("\n"));
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
