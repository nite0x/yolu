import type {CreateSessionInput} from "@/api/contracts"
import type {ChatOptions, SessionTarget, Snapshot} from "./contracts"
import {uiText} from "@/shared/i18n"
import {createHistoryLoader} from "./history-loader"
import {createDraftPersistence} from "./draft-persistence"
import {defaultCapabilities, entryKey, idleChat, isCloudSession, latestEntryFingerprint, mergeEntries, newConversationSettings, normalizeProvider, pendingAsyncQuestion, questionDraftKey, readSnapshots, type AgentProvider, type Approval, type ChatState, type Entry, type HistoryPush, type ProviderCapabilities, type Session, type QuestionDraft} from "../model/messages"
import type {ConversationDefaults} from "../model/settings"
import {draftFiles, draftImages, readLocalDraft, restoreFiles, restoreImages, type DraftRecord} from "./drafts"
import type {TurnSettings, ChatContext, ChatModel} from "../model/messages"
import type {Attachment} from "@assistant-ui/react"
import {validateImages} from "./attachments"
import {reuseValue} from "./state"

export type {ChatOptions, SessionTarget, Snapshot} from "./contracts";
// Existing conversations are shared across every entry point. Only unsent
// drafts are scoped to their creation target.
export const conversationKey = (options: ChatOptions, session: string | null = options.session?.id || null) => {
  const draftTarget = options.draftTarget || options.target;
  return JSON.stringify(session
    ? [options.environment, "session", session]
    : [options.environment, "draft", options.target?.yolu_assistant ? "yolu-assistant" : "", draftTarget?.project_id || "", draftTarget?.cwd || ""]);
};
export class ChatController {
  reading: DraftRecord['reading'] = {top: 0, bottom: true, anchor: "", offset: 0};
  opening = true;
  latestMessage = () => latestEntryFingerprint(mergeEntries(this.snapshot.entries, this.snapshot.chat.entries));
  draftAttachments: readonly Attachment[] = [];
  // Pending answers stay separate from the message draft, including on reopen.
  questionDrafts = new Map<string, Record<string, QuestionDraft>>();
  private resolvedQuestions = new Set<string>();
  question = () => this.snapshot.chat.approvals.find(a => a.kind === "questions" && a.questions?.length)
    || pendingAsyncQuestion(mergeEntries(this.snapshot.entries, this.snapshot.chat.entries), this.resolvedQuestions);
  setQuestionDraft = (key: string, draft: Record<string, QuestionDraft>) => {
    this.questionDrafts.set(key, draft); this.update({}); this.draftChanged();
  };
  private snapshot: Snapshot;
  private viewSnapshot?: Omit<Snapshot, 'draft'>;
  private activitySnapshot?: ChatState;
  private dismissedPredictionTurn?: string;
  private listeners = new Set<() => void>();
  private connected = false;
  private timer?: ReturnType<typeof setInterval>;
  private readAbort?: AbortController;
  private streamAbort?: AbortController;
  private streamRun?: string;
  private polling = false;
  private connectionFailure?: string;
  private historyLoader: ReturnType<typeof createHistoryLoader>;
  private generation = 0;
  private handoffID?: string;
  private submitted?: {id?: string; text: string; attachments: readonly Attachment[]};
  private pending?: SessionTarget & {text: string; images?: string[]; provider?: AgentProvider; request_id: string; settings?: TurnSettings; turn_id?: string};
  private openingApproval = false;
  private defaultsRefreshPending = false;
  private defaultAgentLoaded = false;
  private providerChosen = false;
  private draftExecution?: ChatOptions["draftExecution"];
  private lastCloudEnvironment = "";
  private draftPersistence: ReturnType<typeof createDraftPersistence>;
 private forkRequest?: {id:string;turn:string};
 private pageHide = () => this.persist();
  private defaultsChanged = (event: Event) => {
    const detail = (event as CustomEvent<{environment:string; provider?:AgentProvider}>).detail;
    if (!this.options.readOnly && !this.snapshot.session && detail?.environment === this.options.environment &&
      (!detail.provider || detail.provider === this.snapshot.provider)) {
      this.defaultsRefreshPending = true;
      void this.loadOptions();
    }
  };
  private historyRetryAt = 0;
  private historyPollAt = 0;
  private historyNeedsSync = false;
  private historyRevision = 0;
  private sessionRevision = 0;
  private echoes = new Map<string, {entry: Entry; known: Set<string>; turn?: string; steering: boolean}>();
  private visible = () => typeof document === 'undefined' || !document.hidden && !document.documentElement?.hasAttribute('data-workspace-inactive');
  private visibilityChanged = () => {
    if (!this.connected) return;
    this.streamAbort?.abort(); this.streamAbort = undefined; this.streamRun = undefined; this.historyRetryAt = 0; this.historyPollAt = 0;
    if (this.snapshot.terminal) this.update({terminal: {...this.snapshot.terminal, connected: false}});
    if (this.visible()) {
      if (!this.options.readOnly && !this.snapshot.session) void this.loadOptions();
      if (this.options.readOnly) void this.history(false, true).then(() => this.watchHistory());
      else void Promise.all([this.history(false, true), this.poll()]);
    }
  };
  constructor(public options: ChatOptions) {
    const initialProvider = normalizeProvider(options.session?.provider);
    this.snapshot = {session: options.session, provider: initialProvider, capabilities: defaultCapabilities(initialProvider, isCloudSession(options.session)), entries: [], chat: idleChat(), project: options.target?.project_id || "", draft: "", error: "", historyError: "", loading: false, submitting: false, stopping: false, answering: null, cursor: null, draftRestore: 0, settings: {}, defaults: {}, models: [], modes: [], optionsLoading: false, draftNotice: "", search: "", searching:false, searchError:"", managing:false};
    this.historyLoader = createHistoryLoader({
      request: (path, init) => this.options.request(path, init),
      base: () => this.base(),
      snapshot: () => this.snapshot,
      lifecycle: () => ({connected:this.connected, visible:this.visible(), generation:this.generation, revision:this.historyRevision, sessionRevision:this.sessionRevision, signal:this.readAbort?.signal}),
      readOnly: () => !!this.options.readOnly,
      update: patch => this.update(patch),
      loaded: session => {
        const previousProvider = this.snapshot.provider;
        this.updateSession(session);
        if (previousProvider !== this.snapshot.provider) {
          if (this.snapshot.optionsLoading) this.defaultsRefreshPending = true;
          else if (!this.options.readOnly) void this.loadOptions();
        }
        this.options.loaded?.(session);
      },
      missing: sessionId => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("workhub:conversation-missing", {detail: {sessionId, environment: this.options.environment}}));
        }
      },
      synchronized: () => { this.historyNeedsSync = false; },
    });
    this.draftPersistence = createDraftPersistence({
      request: (path, init) => this.options.request(path, init),
      key: () => conversationKey(this.options, this.snapshot.session?.id || null),
      enabled: () => !!this.options.persistDraft && !this.options.readOnly,
      connected: () => this.connected,
      submitting: () => this.snapshot.submitting,
      capture: () => ({text:this.snapshot.draft, images:draftImages(this.draftAttachments), files:draftFiles(this.draftAttachments), ...(this.snapshot.session ? {} : {provider: this.snapshot.provider, cloudEnvironment: this.snapshot.cloudEnvironment}), settings:this.snapshot.settings, project:this.snapshot.project, reading:this.reading, questions:Object.fromEntries([...this.questionDrafts].filter(([key]) => key.startsWith('["async",')))}),
      restore: record => this.restoreDraft(record),
      notice: draftNotice => this.update({draftNotice}),
    });
    if (options.persistDraft && !options.readOnly) { const saved = readLocalDraft(conversationKey(options)); if (saved) this.draftPersistence.restore(saved); }
  }
  getSnapshot = () => this.snapshot;
  getReadingSnapshot = () => {
    const state = this.getViewSnapshot();
    return {entries: state.entries, liveEntries: state.chat.entries, loading: state.loading, historyError: state.historyError, cursor: state.cursor};
  };
  readingChanged = () => this.draftChanged();
  // Composer text is mirrored and persisted separately from the rendered chat.
  getViewSnapshot = () => {
    if (!this.viewSnapshot) { const {draft, ...view} = this.snapshot; this.viewSnapshot = view; }
    return this.viewSnapshot;
  };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<Snapshot>) {
    if (patch.session?.name && patch.session.name !== this.snapshot.session?.name) this.sessionRevision++;
    const next = {...this.snapshot, ...patch};
    if (this.echoes.size && (patch.entries || patch.chat)) {
      const actual = mergeEntries(next.entries, next.chat.entries).filter(e => !e.id.startsWith("local:"));
      const claimed = new Set<string>();
      for (const [request, echo] of this.echoes) {
        if (!echo.steering && next.chat.id === request && next.chat.turn_id) echo.turn = next.chat.turn_id;
        // Native steering items need not reuse clientUserMessageId. Match a
        // newly observed item in the same turn, reserving explicit request IDs
        // for their own echoes and consuming each item only once.
        const confirmed = actual.find(e => e.kind === "user" && !claimed.has(entryKey(e)) && (e.id === request || !this.echoes.has(e.id) && !!echo.turn && e.turn_id === echo.turn && !echo.known.has(entryKey(e)) && (e.text || "").trim() === (echo.entry.text || "") && (e.images?.length || 0) === (echo.entry.images?.length || 0)));
        if (confirmed) { claimed.add(entryKey(confirmed)); next.entries = next.entries.filter(e => e.id !== echo.entry.id); this.echoes.delete(request); }
      }
      // A later snapshot of the same item cannot acknowledge another send
      // whose text happens to be identical.
      for (const echo of this.echoes.values()) for (const key of claimed) echo.known.add(key);
    }
    const snapshot = reuseValue(this.snapshot, next);
    const force = Object.keys(patch).length === 0;
    if (snapshot === this.snapshot && !force) return;
    this.snapshot = snapshot;
    const {draft, ...view} = snapshot;
    this.viewSnapshot = force ? view : reuseValue(this.getViewSnapshot(), view);
    for (const listener of this.listeners) listener();
  }
  private removeEcho(request: string) {
    const echo = this.echoes.get(request);
    this.echoes.delete(request);
    if (echo) this.update({entries: this.snapshot.entries.filter(e => e.id !== echo.entry.id)});
  }
  private base() { return `/api/sessions/${encodeURIComponent(this.snapshot.session!.id)}`; }
  canSend = () => !this.options.readOnly && !this.snapshot.session?.archived && (!!this.snapshot.session || (this.snapshot.cloudEnvironment === undefined ? !this.snapshot.optionsLoading : !!this.snapshot.cloudEnvironment));
  resume = async () => {
    if (!this.snapshot.session) return;
    const flags: {native_permissions?:boolean; allow_shared?:boolean} = {};
    for (;;) {
      try {
        await this.options.request(`${this.base()}/resume`, {method: "POST",body:JSON.stringify(flags)});
        return;
      } catch (error) {
        const {code,message} = error as {code?:string;message:string};
        const flag = code === "native_permissions_confirmation" ? "native_permissions" : code === "directory_conflict" ? "allow_shared" : undefined;
        if (!flag || flags[flag] || typeof window === "undefined") { this.update({error:message}); return; }
        if (!window.confirm(message)) return;
        flags[flag] = true;
      }
    }
  };
  dismissPrediction = () => {
    this.dismissedPredictionTurn = this.snapshot.chat.turn_id;
    if (this.snapshot.chat.prediction) this.update({chat: {...this.snapshot.chat, prediction: undefined}});
  };
  setDraft = (draft: string) => { if (draft !== this.snapshot.draft) {
    if (draft) this.dismissPrediction();
    this.update({draft}); this.draftChanged();
  } };
  setError = (error: string) => this.update({error});
  updateSession = (session: Session) => {
    if (this.snapshot.session?.id === session.id) {
      const merged = {...this.snapshot.session, ...session, provider: session.provider || this.snapshot.session.provider};
      const provider = normalizeProvider(merged.provider || this.snapshot.provider);
      this.update({session: merged, provider, capabilities: defaultCapabilities(provider, isCloudSession(merged))});
    }
  };
  selectDraftExecution = (execution: NonNullable<ChatOptions["draftExecution"]>, persist = true) => {
    this.setCloudEnvironment(execution === "cloud" ? this.lastCloudEnvironment : undefined, persist);
  };
  setCloudEnvironment = (cloudEnvironment?: string, persist = true) => {
    if (this.snapshot.session || this.snapshot.submitting || this.options.readOnly || this.options.environment !== "local" || this.isYoluAssistant()) return;
    this.draftExecution = cloudEnvironment === undefined ? "local" : "cloud";
    if (cloudEnvironment !== undefined) this.lastCloudEnvironment = cloudEnvironment;
    if (this.snapshot.cloudEnvironment === cloudEnvironment) return;
    this.update({cloudEnvironment, error: ""});
    if (persist) this.draftChanged();
  };
  isCloud = () => isCloudSession(this.snapshot.session) || this.snapshot.cloudEnvironment !== undefined;
  isYoluAssistant = () => !!(this.snapshot.session?.yolu_assistant || !this.snapshot.session && this.options.target?.yolu_assistant);
  setProvider = (provider: AgentProvider) => {
    this.providerChosen = true;
    if (this.snapshot.session || this.snapshot.submitting || this.isYoluAssistant()) return;
    const normalized = normalizeProvider(provider);
    if (normalized === this.snapshot.provider) return;
    if (this.snapshot.optionsLoading) this.defaultsRefreshPending = true;
    this.update({provider: normalized, capabilities: defaultCapabilities(normalized), settings: {}, models: [], modes: [], defaults: {}, error: ""});
    this.draftChanged();
    if (!this.options.readOnly) void this.loadOptions();
  };
  setProject = (project: string) => {this.update({project}); this.draftChanged();};
  setSettings = (settings: TurnSettings) => {this.update({settings});this.draftChanged();};
  attachmentsChanged = () => this.draftChanged();
  connect() {
    this.disconnect(); this.connected = true; this.readAbort = new AbortController();
    this.activitySnapshot = undefined;
    this.opening = true;
    const generation = this.generation;
    const draft = this.options.persistDraft && !this.options.readOnly ? this.loadDraft() : Promise.resolve();
    const opened = () => {
      if (!this.connected || generation !== this.generation) return;
      const latest = this.latestMessage();
      if (latest && this.reading.latest !== undefined && latest !== this.reading.latest) this.reading.bottom = true;
      // Older saved positions have no read marker. Establish their baseline
      // without losing the user's position on the first opening after upgrade.
      if (latest && (this.reading.bottom || this.reading.latest === undefined)) this.reading.latest = latest;
      this.opening = false;
      this.update({});
    };
    if (this.options.persistDraft && !this.options.readOnly && typeof window !== "undefined") window.addEventListener("pagehide", this.pageHide);
    if (typeof document !== 'undefined') document.addEventListener?.("visibilitychange", this.visibilityChanged);
    if (typeof window !== 'undefined') window.addEventListener('workhub:page-visibility', this.visibilityChanged);
    if (typeof window !== 'undefined') window.addEventListener('workhub:conversation-defaults', this.defaultsChanged);
    if (this.options.readOnly) {
      void this.history().then(() => {opened(); return this.watchHistory();});
      this.timer = setInterval(() => {
        if (!this.connected || !this.visible() || !this.snapshot.session) return;
        if ((!this.snapshot.terminal?.connected || this.historyNeedsSync) && Date.now() >= this.historyPollAt) {
          this.historyPollAt = Date.now() + 10000;
          void this.history(false, true);
        }
        void this.watchHistory();
      }, 1000);
      return;
    }
    void Promise.all([draft, this.history(), this.poll()]).then(opened);
    this.timer = setInterval(() => { if (this.connected && this.visible() && this.snapshot.session) void this.poll(); }, 2000);
  }
  disconnect() {
    if (this.connected) this.dismissPrediction();
    if (this.connected) this.persist();
    if (typeof window !== "undefined") window.removeEventListener("pagehide",this.pageHide);
    if (typeof window !== 'undefined') window.removeEventListener('workhub:page-visibility', this.visibilityChanged);
    if (typeof window !== 'undefined') window.removeEventListener('workhub:conversation-defaults', this.defaultsChanged);
    if (typeof document !== "undefined") document.removeEventListener?.("visibilitychange", this.visibilityChanged);
    this.connected = false; this.generation++; clearInterval(this.timer);
    this.readAbort?.abort(); this.streamAbort?.abort(); this.streamAbort = undefined; this.streamRun = undefined;
    this.polling = false; this.historyLoader.reset(); this.update({loading: false});
    this.historyRetryAt = 0; this.historyPollAt = 0;
    if (this.snapshot.terminal) this.update({terminal: {...this.snapshot.terminal, connected: false}});
  }
  async prepareForEviction() {
    const state = this.snapshot;
    if (this.connected || state.submitting || state.answering || state.stopping || state.managing || this.openingApproval || this.pending || this.submitted || this.forkRequest) return false;
    if (this.options.readOnly) return true;
    // Blocking answers are intentionally kept in memory rather than durable drafts.
    if ([...this.questionDrafts.keys()].some(key => !key.startsWith('["async",'))) return false;
    if (!this.options.persistDraft) return !state.draft && !this.draftAttachments.length && !this.questionDrafts.size;
    return this.flushDraft();
  }
  dispose() {
    this.disconnect();
    this.draftPersistence.dispose();
    this.draftAttachments = [];
    this.questionDrafts.clear(); this.resolvedQuestions.clear(); this.echoes.clear();
    this.snapshot = {...this.snapshot, entries: [], chat: idleChat(), draft: ""};
    this.viewSnapshot = undefined; this.activitySnapshot = undefined;
    this.listeners.clear();
  }
  history(older = false, background = false) { return this.historyLoader.load(older, background); }
  private async watchHistory() {
    if (!this.connected || !this.options.readOnly || !this.snapshot.session || this.streamAbort || !this.visible() || Date.now() < this.historyRetryAt) return;
    const generation = this.generation;
    const abort = new AbortController(); this.streamAbort = abort;
    try {
      const response = await this.options.stream(`${this.base()}/history/events`, abort.signal);
      if (!response.headers.get("Content-Type")?.startsWith("text/event-stream")) throw new Error(uiText("服务未返回实时事件流"));
      await readSnapshots<HistoryPush>(response, terminal => {
        if (generation !== this.generation || abort.signal.aborted) return;
        const previous = this.snapshot.terminal;
        if (terminal.connected) {
          if (previous && previous.sync !== terminal.sync) { this.historyNeedsSync = true; this.historyPollAt = 0; }
          this.historyRevision++;
          this.update({terminal: {...terminal, entries: terminal.entries || []}, entries: mergeEntries(this.snapshot.entries, terminal.entries || [])});
        } else this.update({terminal: {...previous, ...terminal, entries: previous?.entries || []}});
      });
    } catch { /* Saved history continues polling while the stream reconnects. */ }
    finally {
      abort.abort();
      if (generation === this.generation && this.streamAbort === abort) {
        this.streamAbort = undefined;
        this.historyRetryAt = Date.now() + 5000;
        this.update({terminal: {...this.snapshot.terminal, connected: false, entries: this.snapshot.terminal?.entries || [], sync: this.snapshot.terminal?.sync || 0}});
      }
    }
  }
  private apply(chat: ChatState) {
    const previous = this.snapshot.chat;
    if (chat.prediction && (chat.prediction.source_turn_id === this.dismissedPredictionTurn || this.snapshot.draft || this.draftAttachments.length)) {
      if (this.snapshot.draft || this.draftAttachments.length) this.dismissedPredictionTurn = chat.prediction.source_turn_id;
      chat = {...chat, prediction: undefined};
    }
    if (!chat.busy && chat.id === this.handoffID) this.handoffID = undefined;
    if (previous.busy && !chat.id && !previous.external && !chat.external) return;
    if (chat.id === previous.id && (chat.revision || 0) < (previous.revision || 0)) return;
    const pendingQuestions = new Set(chat.approvals.filter(a => a.kind === "questions").map(a => JSON.stringify([chat.id, a.id])));
    for (const key of this.questionDrafts.keys()) if (!key.startsWith('["async",') && (!chat.busy || !pendingQuestions.has(key))) this.questionDrafts.delete(key);
    if (chat.session_name && chat.session_name !== previous.session_name && this.snapshot.session) {
      this.update({session: {...this.snapshot.session, name: chat.session_name}});
      this.options.managed?.(this.snapshot.session!, "title");
    }
    if (chat.turn_id && this.submitted?.id === chat.id) this.submitted = undefined;
    if (!chat.busy && !chat.turn_id && this.submitted && this.submitted.id === chat.id) {
      this.removeEcho(chat.id!);
      if (!this.snapshot.draft && !this.draftAttachments.length) {
        this.draftAttachments = this.submitted.attachments;
        this.update({draft: this.submitted.text, draftRestore: this.snapshot.draftRestore + 1});this.draftChanged();
      }
      this.submitted = undefined;
    }
    if (!chat.busy) {
      chat = {...chat, entries: chat.entries.map(e => e.status === "inProgress" ? {...e, status: chat.status === "completed" ? "completed" : "interrupted"} : e)};
      this.update({entries: mergeEntries(this.snapshot.entries, chat.entries), chat});
    } else this.update({chat});
    if (this.snapshot.session && this.activitySnapshot !== this.snapshot.chat) {
      this.activitySnapshot = this.snapshot.chat;
      this.options.activity?.(this.snapshot.session.id, chat);
    }
    if (chat.external || previous.busy && !chat.busy) { if (!chat.prediction_pending) this.streamAbort?.abort(); void this.history(false, true); }
    if ((chat.busy || chat.prediction_pending) && chat.id && !chat.external && this.connected) void this.watch(chat.id);
  }
  async poll() {
    if (this.options.readOnly || !this.snapshot.session || !this.connected || this.polling || !this.visible()) return;
    const generation = this.generation;
    this.polling = true;
    const observedRun = this.snapshot.chat.id;
    try {
      const chat = await this.options.request<ChatState>(`${this.base()}/chat`, {signal: this.readAbort?.signal});
      if (generation === this.generation && (this.snapshot.chat.id === observedRun || chat.id === this.snapshot.chat.id)) {
        this.connectionRecovered();
        this.apply(chat);
      }
    } catch (error) { if (generation === this.generation && !this.readAbort?.signal.aborted) this.connectionFailed(uiText("状态读取失败：") + (error as Error).message); }
    finally { if (generation === this.generation) this.polling = false; }
  }
  private connectionFailed(message: string) {
    const previous = this.connectionFailure;
    this.connectionFailure = message;
    if (!this.snapshot.error || this.snapshot.error === previous) this.update({error: message});
  }
  private connectionRecovered() {
    const previous = this.connectionFailure;
    this.connectionFailure = undefined;
    // A successful metadata read owns only transport errors. Failed sends,
    // approvals and other operation errors keep their separate recovery path.
    if (previous && this.snapshot.error === previous) this.update({error: ""});
  }
  private async watch(id: string) {
    if (this.streamRun === id || !this.visible()) return;
    this.streamAbort?.abort();
    const abort = new AbortController(); this.streamAbort = abort; this.streamRun = id;
    const generation = this.generation;
    try {
      const response = await this.options.stream(`${this.base()}/chat/events?run=${encodeURIComponent(id)}`, abort.signal);
      await readSnapshots(response, chat => { if (generation === this.generation && !abort.signal.aborted) { this.connectionRecovered(); this.apply(chat); } });
    } catch { if (!abort.signal.aborted && generation === this.generation) this.connectionFailed(uiText("实时连接暂时断开，将自动重连，不会重复发送消息。")); }
    finally { if (this.streamAbort === abort) this.streamRun = undefined; }
  }
  send = async (text: string, images: string[] = [], restoreDraftOnError = true, update: SessionTarget = {}) => {
    if (this.options.readOnly || this.snapshot.chat.external && (this.snapshot.chat.busy || this.snapshot.chat.status === "unknown")) return;
    text = text.trim();
    if (this.isCloud() && (images.length || this.draftAttachments.length)) throw new Error(uiText("Codex Cloud 对话目前支持文字消息"));
    const messageText = [text, ...draftFiles(this.draftAttachments).map(f=>f.text)].filter(Boolean).join("\n\n");
    this.dismissPrediction();
    const before = this.snapshot;
    const steering = before.chat.busy;
    if (!messageText && !images.length) return;
    if (before.submitting || (steering && (!before.capabilities.steer || !before.chat.turn_id || !["running","waiting"].includes(before.chat.status))) || before.chat.blocked || !this.canSend()) throw new Error(uiText("当前暂不能发送，草稿已保留，请稍后重试"));
    try { validateImages(images); }
    catch (error) { this.update({error: (error as Error).message}); throw error; }
    const target: SessionTarget = before.session ? {allow_shared:update.allow_shared}
      : before.cloudEnvironment !== undefined ? {cloud_environment:before.cloudEnvironment} : {...this.options.target, ...update};
    const settings = this.isCloud() ? {} : before.settings;
    const createProvider: AgentProvider | undefined = !before.session && !this.isCloud() && before.provider !== "codex" ? before.provider : undefined;
    const samePending = this.pending?.text === messageText && this.pending.project_id === target.project_id && this.pending.cwd === target.cwd && this.pending.cloud_environment === target.cloud_environment && this.pending.yolu_assistant === target.yolu_assistant
      && this.pending.provider === createProvider && this.pending.access === target.access && this.pending.allow_shared === target.allow_shared
      && JSON.stringify(this.pending.bindings) === JSON.stringify(target.bindings)
      && (this.pending.images || []).length === images.length
      && images.every((image, i) => image === this.pending?.images?.[i])
      && this.pending?.turn_id === (steering ? before.chat.turn_id : undefined) && (steering || JSON.stringify(this.pending?.settings || {}) === JSON.stringify(settings));
    const pending = samePending ? this.pending! : {text: messageText, ...(images.length ? {images} : {}), ...(createProvider ? {provider: createProvider} : {}), ...target, request_id: crypto.randomUUID(), settings, ...(steering ? {turn_id:before.chat.turn_id} : {})};
    this.pending = pending;
    const attachments = this.draftAttachments;
    const entry: Entry = {id: `local:${pending.request_id}`, turn_id: `local:${pending.request_id}`, kind: "user", text: messageText, ...(images.length ? {images} : {})};
    this.echoes.set(pending.request_id, {entry, known: new Set(mergeEntries(before.entries, before.chat.entries).map(entryKey)), turn: steering ? before.chat.turn_id : undefined, steering});
    // Preserve the current live turn before appending a steering message.
    this.update({submitting: true, error: "", entries: [...mergeEntries(before.entries, before.chat.entries), entry]});
    this.update({draft: ""}); this.draftChanged();
    try {
      let chat: ChatState;
      if (steering) {
        const result = await this.options.request<{chat:ChatState;accepted:string}>(`${this.base()}/chat/steer`, {method:"POST",body:JSON.stringify({text: messageText,images,request_id:pending.request_id,turn_id:pending.turn_id})});
        if (result.accepted !== pending.request_id) throw new Error(uiText("补充消息未确认，草稿已保留"));
        chat = result.chat;
      } else if (!before.session) {
        const result = await this.options.request<{session: Session; chat: ChatState}>("/api/sessions/new", {method: "POST", body: JSON.stringify(pending satisfies CreateSessionInput)});
        const createdProvider = normalizeProvider(result.session.provider || createProvider);
        const session = {...result.session, provider: result.session.provider || createdProvider};
        this.update({session, provider: createdProvider, capabilities: defaultCapabilities(createdProvider, isCloudSession(session))}); this.options.created(session); chat = result.chat;
      } else {
        chat = await this.options.request<ChatState>(`${this.base()}/chat`, {method: "POST", body: JSON.stringify({text: messageText, ...(images.length ? {images} : {}), request_id: pending.request_id, ...(target.allow_shared ? {allow_shared: true} : {}), ...(Object.keys(settings).length ? {settings} : {})})});
      }
      this.settleAttachments(attachments);
      this.pending = undefined; if (!steering) this.submitted = {id: chat.id, text, attachments}; this.apply(chat); this.draftChanged();
      if (steering && !chat.busy) void this.history();
      if (!before.session) this.clearCreationDraft();
    } catch (error) {
      // Recover an acknowledged turn after a lost POST response. Never resend it.
      if (before.session) {
        try {
          const chat = await this.options.request<ChatState>(`${this.base()}/chat`);
          if ((!steering && chat.id === pending.request_id) || (steering && chat.accepted_inputs?.includes(pending.request_id))) { this.settleAttachments(attachments); this.pending = undefined; if (!steering) this.submitted = {id: chat.id, text, attachments}; this.apply(chat); this.draftChanged();
      if (steering && !chat.busy) void this.history();
      if (!before.session) this.clearCreationDraft(); return; }
        } catch { /* Keep the same idempotency key for an explicit retry. */ }
      }
      this.removeEcho(pending.request_id);
      if (restoreDraftOnError && !this.snapshot.draft) {
        this.update({draft: text}); this.draftChanged();
      }
      this.update({error: (error as Error).message});
      throw error;
    } finally { this.update({submitting: false}); }
  };
  private settleAttachments(attachments:readonly Attachment[]) {
    const sent=new Set(attachments.map(a=>a.id));
    this.draftAttachments=this.draftAttachments.filter(a=>!sent.has(a.id));
  }
  private restoreDraft(record: DraftRecord) {
    this.reading = {...record.reading};
    this.draftAttachments = [...restoreImages(record.images), ...restoreFiles(record.files)];
    for (const [key, draft] of Object.entries(record.questions || {})) {
      if (key.startsWith('["async",') && draft && typeof draft === "object") this.questionDrafts.set(key, draft);
    }
    if (record.provider) this.providerChosen = true;
    const restoredProvider = !this.snapshot.session && !this.isYoluAssistant() && record.provider ? normalizeProvider(record.provider) : this.snapshot.provider;
    const cloudAllowed = !this.snapshot.session && !this.isYoluAssistant() && this.options.environment === "local";
    const savedCloud = typeof record.cloudEnvironment === "string" ? record.cloudEnvironment : undefined;
    if (cloudAllowed && savedCloud !== undefined) this.lastCloudEnvironment = savedCloud;
    const cloudEnvironment = cloudAllowed && (this.draftExecution === "cloud" || this.draftExecution === undefined && savedCloud !== undefined) ? this.lastCloudEnvironment : undefined;
    this.update({draft:record.text,cloudEnvironment,provider:restoredProvider,capabilities:defaultCapabilities(restoredProvider, isCloudSession(this.snapshot.session)),settings:this.snapshot.session ? record.settings : newConversationSettings(record.settings),project:record.project || this.snapshot.project,draftRestore:this.snapshot.draftRestore+1});
  }
  private loadDraft() { return this.draftPersistence.load(); }
  private draftChanged() { this.draftPersistence.changed(); }
  persist = () => this.draftPersistence.persist();
  flushDraft = () => this.draftPersistence.flush();
  private clearCreationDraft() {
    if (!this.options.persistDraft) return;
    const key=conversationKey(this.options,null);
    const empty:DraftRecord={text:"",images:[],settings:{},project:"",reading:{top:0,bottom:true,anchor:"",offset:0},updated:Date.now()+1};
    this.draftPersistence.write(key,empty);
  }
  loadOptions = async () => {
    if(this.snapshot.optionsLoading) return;
    this.defaultsRefreshPending = false;
    this.update({optionsLoading:true});
    if (!this.snapshot.session && !this.defaultAgentLoaded && !this.providerChosen && !this.options.readOnly && !this.isYoluAssistant()) {
      this.defaultAgentLoaded = true;
      try {
        const preferred = await this.options.request<{provider?:AgentProvider}>("/api/settings/default-agent");
        if (!this.providerChosen && !this.snapshot.session) {
          const provider = normalizeProvider(preferred.provider);
          this.update({provider, capabilities:defaultCapabilities(provider)});
        }
      } catch { /* Older backends retain the built-in Codex default. */ }
    }
    const provider = normalizeProvider(this.snapshot.session?.provider || this.snapshot.provider);
    if (isCloudSession(this.snapshot.session)) {
      try { this.update({context:await this.options.request<ChatContext>(this.base()+"/context")}); }
      catch (error) { this.update({error:(error as Error).message}); }
      finally { this.update({optionsLoading:false}); }
      return;
    }
    try {
      const optionsPath = provider !== "codex" ? `/api/agents/chat-options?provider=${provider}` : "/api/codex/chat-options";
      const [catalog,context] = await Promise.all([this.options.readOnly ? Promise.resolve({models:[],modes:[]}) : this.options.request<{models:ChatModel[];modes:string[];defaults?:ConversationDefaults;capabilities?:ProviderCapabilities}>(optionsPath),this.snapshot.session ? this.options.request<ChatContext>(`${this.base()}/context`) : Promise.resolve(undefined)]);
      if (normalizeProvider(this.snapshot.session?.provider || this.snapshot.provider) !== provider) return;
      this.update({models:catalog.models||[],modes:catalog.modes||[],defaults:("defaults" in catalog ? catalog.defaults : undefined)||{},capabilities:("capabilities" in catalog && catalog.capabilities) ? catalog.capabilities : defaultCapabilities(provider),context});
    } catch(error){if (normalizeProvider(this.snapshot.session?.provider || this.snapshot.provider) === provider) this.update({error:(error as Error).message});}
    finally{
      const refresh = this.defaultsRefreshPending;
      this.defaultsRefreshPending = false;
      this.update({optionsLoading:false});
      if (refresh && this.connected) void this.loadOptions();
    }
  };
  setSearch = (search:string) => this.update({search,searchError:""});
  searchAll = async () => {
    if(this.snapshot.searching || !this.snapshot.session) return;
    this.update({searching:true,searchError:""});
    try {while(this.snapshot.cursor && this.connected){const cursor=this.snapshot.cursor;await this.history(true);if(this.snapshot.historyError)throw new Error(this.snapshot.historyError);if(cursor===this.snapshot.cursor)throw new Error(uiText("历史正在加载，请稍后重试"));}}
    catch(error){this.update({searchError:(error as Error).message});}
    finally{this.update({searching:false});}
  };
  manage = async (action:string,name?:string,turn="") => {
    if(!this.snapshot.session || this.snapshot.managing || this.options.readOnly) return;
    this.update({managing:true,error:""});
    if(action==="fork" && this.forkRequest?.turn!==turn)this.forkRequest={id:crypto.randomUUID(),turn};
    try {
      const result=await this.options.request<{session:Session}>(`${this.base()}/manage`,{method:"POST",body:JSON.stringify({action,name,turn_id:turn,request_id:action==="fork"?this.forkRequest?.id:undefined})});
      if(action!=="fork")this.update({session:{...this.snapshot.session,...result.session}});
      else this.forkRequest=undefined;
      this.options.managed?.(result.session,action);
    } catch(error){this.update({error:(error as Error).message});}
    finally{this.update({managing:false});}
  };
  handoff = async () => {
    if (this.options.readOnly) return;
    if (!this.snapshot.chat.can_handoff || this.snapshot.chat.busy || this.snapshot.submitting) return;
    this.handoffID ||= crypto.randomUUID();
    this.update({submitting: true, error: ""});
    try { this.apply(await this.options.request<ChatState>(`${this.base()}/chat/handoff`, {method: "POST", body: JSON.stringify({request_id: this.handoffID})})); }
    catch (error) { this.update({error: (error as Error).message}); }
    finally { this.update({submitting: false}); }
  };
  stop = async () => {
    if (this.snapshot.chat.external) return;
    if (this.options.readOnly) return;
    const {chat, stopping} = this.snapshot;
    if (!chat.busy || !chat.id || stopping) return;
    this.update({stopping: true, error: ""});
    try { this.apply(await this.options.request<ChatState>(`${this.base()}/chat/stop`, {method: "POST", body: JSON.stringify({run_id: chat.id})})); }
    catch (error) { this.update({error: (error as Error).message}); }
    finally { this.update({stopping: false}); }
  };
  openApprovalURL = async (approval: Approval) => {
    if (this.options.readOnly) return;
    const {chat, stopping} = this.snapshot;
    if (this.openingApproval || stopping || !chat.busy || chat.status === "stopping") return;
    this.openingApproval = true;
    this.update({error: ""});
    try { await this.options.request(`${this.base()}/chat/approval/open`, {method: "POST", body: JSON.stringify({run_id: chat.id, approval_id: approval.id})}); }
    catch (error) { this.update({error: (error as Error).message}); }
    finally { this.openingApproval = false; }
  };
  answer = async (approval: Approval, decision: string, answers: Record<string, string[]>, content?: Record<string, unknown>) => {
    if (this.options.readOnly) return;
    const asyncQuestion = approval.delivery === "async";
    if (this.snapshot.answering || this.snapshot.submitting || !asyncQuestion && !this.snapshot.chat.busy) return;
    this.update({answering: approval.id, error: ""});
    try {
      const runID = this.snapshot.chat.id;
      const chat = await this.options.request<ChatState>(this.base() + (asyncQuestion ? "/chat/question" : "/chat/approval"), {method: "POST", body: JSON.stringify(asyncQuestion
        ? {item_id: approval.id, turn_id: approval.turn_id, decision, answers}
        : {run_id: runID, approval_id: approval.id, decision, answers, ...(content === undefined ? {} : {content})})});
      if (asyncQuestion) this.resolvedQuestions.add(JSON.stringify([approval.turn_id, approval.id]));
      this.questionDrafts.delete(questionDraftKey(approval, runID));
      this.apply(chat); this.draftChanged();
      if (asyncQuestion) { this.persist(); void this.history(); }
    }
    catch (error) { this.update({error: (error as Error).message}); }
    finally { this.update({answering: null}); }
  };
}
