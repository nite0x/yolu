import {uiText} from "@/shared/i18n"
import {ConversationHeader, ConversationPaneButtons, ConversationWorkingContext} from "@/shared/ui/conversation-surface"
import {useChatState} from "../runtime/use-chat-state"
import {memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from "react"
import {ExportedMessageRepository, MessageNotSentError, type ThreadMessage} from "@assistant-ui/react"
import {ChevronDownIcon, PlusIcon, TerminalIcon} from "lucide-react"
import {ConversationPanel, ConversationFeedback, ConversationOccupied, ConversationNotice, ConversationRunIndicator, useConversationRuntime} from "./conversation-panel"
import {TooltipIconButton} from "../components/assistant-ui/elements/tooltip-icon-button"
import {Alert, AlertDescription} from "@/shared/ui/primitives/alert"
import {Button} from "@/shared/ui/primitives/button"
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/shared/ui/primitives/card"
import {Label} from "@/shared/ui/primitives/label"
import {Input} from "@/shared/ui/primitives/input"
import {NativeSelect, NativeSelectOption} from "@/shared/ui/primitives/native-select"
import {ChatController} from "../runtime/controller"
import {useChatReading} from "../runtime/use-chat-reading"
import {cleanText, convertEntries, mergeEntries, questionDraftKey, type Approval} from "../model/messages"
import {readElicitation} from "../model/approval"
import {ApprovalActions, ElicitationFields} from "./approval-fields"
import {ChatControls, ChatSearch, ChatSessionMenu, ChatStatus} from "./controls"
import {ChatMediaProvider, ChatMessageText, ChatUserImage} from "./media"
import {ChatAttachmentAdapter} from "../runtime/attachments"
import {conversationContext, isGeneralConversationDirectory} from "@/entities/conversations/context"
import {ChatToolFallback, ChatChangeSummary, ChatChangePathsProvider} from "./file-changes"
import {QuestionComposer} from "./questions"
import {ChatUserText} from "./user-message"
import {sendShortcut} from "@/shared/hooks/use-send-shortcut"
import {draftTitle} from "../model/draft-title"
import {useSessionDirectories} from "./session-directories"
import {ChatToolGroup} from "./tool-activity"

function ConversationDraftTitle({controller}: {controller: ChatController}) {
  const preview = useChatState(controller, state => draftTitle(state.draft));
  const title = preview ? uiText("草稿：{0}", preview) : uiText("新建对话");
  return <span title={title}>{title}</span>;
}

function OccupiedConversation({controller, send}: {controller: ChatController; send: () => void}) {
  const state = useChatState(controller, s => ({managing:s.managing, submitting:s.submitting, session:s.session, capabilities:s.capabilities, chat:s.chat}));
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true); controller.setError("");
    try {
      await controller.poll();
      const latest = controller.getSnapshot();
      if (!latest.chat.blocked && !latest.chat.busy && latest.chat.status !== "unknown" && latest.draft.trim()) send();
    } finally {setRetrying(false);}
  };
  return <ConversationOccupied description={uiText("请先在那边关闭会话，才能在这里继续。")}
    retrying={retrying || state.submitting} forking={state.managing}
    canRetry={!state.chat.busy} canFork={!!state.capabilities.fork && !state.chat.busy && !state.submitting && !state.session?.archived}
    onRetry={() => void retry()} onFork={() => void controller.manage("fork")} />;
}

function ParallelPaneControls() {
  const read = () => ({split:document.documentElement.hasAttribute("data-workspace-pane"),zoomed:document.documentElement.hasAttribute("data-workspace-zoomed"),canZoom:document.documentElement.hasAttribute("data-workspace-can-zoom")})
  const [layout,setLayout] = useState(read)
  useEffect(() => {
    const update = () => setLayout(read())
    window.addEventListener("workhub:parallel-layout",update)
    return () => window.removeEventListener("workhub:parallel-layout",update)
  }, [])
  if (!layout.split) return null
  const command = (detail: string) => window.dispatchEvent(new CustomEvent("workhub:parallel-command",{detail}))
  return <ConversationPaneButtons {...layout} command={command} />
}

const chatComponents = {Text: ChatMessageText, UserText: ChatUserText, UserImage: ChatUserImage, ToolFallback: ChatToolFallback, ToolGroup: ChatToolGroup, AssistantMessageEnd: ChatChangeSummary};

// The workspace owns this stable button and its file-panel controller. Move it
// into the active chat toolbar, returning it before the React slot unmounts.
function ChatFileToggle() {
  const slot = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const button = document.getElementById("toggleConversationFiles");
    const original = button?.parentElement;
    if (!button || !original || !slot.current) return;
    slot.current.append(button);
    return () => {original.append(button);};
  }, []);
  return <span ref={slot} className="chat-file-toggle-slot" />;
}

function ConversationCreationSetup({children}: {children?: React.ReactNode}) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const setup = document.getElementById("sessionCreationSetup");
    const mount = setup?.parentElement;
    if (!setup || !mount || !slot.current) return;
    slot.current.append(setup);
    return () => {mount.append(setup);};
  }, []);
  return <div className="chat-creation-setup"><div ref={slot} />{children}</div>;
}

function CloudEnvironmentFields({controller, selected, disabled}: {controller: ChatController; selected?: string; disabled: boolean}) {
  const [environments, setEnvironments] = useState<{id: string; name: string; shared: boolean}[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const cloud = selected !== undefined;
  useEffect(() => {
    if (!cloud) return;
    const abort = new AbortController();
    setError("");
    setEnvironments(null);
    void controller.options.request<{id: string; name: string; shared: boolean}[]>("/api/codex/cloud-environments", {signal:abort.signal}).then(rows => {
      if (abort.signal.aborted) return;
      setEnvironments(rows);
      const previous = controller.getSnapshot().cloudEnvironment;
      if (previous && !rows.some(row => row.id === previous)) controller.setCloudEnvironment("");
    }).catch(error => { if (!abort.signal.aborted) setError((error as Error).message); });
    return () => abort.abort();
  }, [controller, cloud, retry]);
  return <div className="grid w-full max-w-[400px] gap-3">
    <div className="grid gap-1.5"><Label htmlFor="chat-execution-location">{uiText("执行位置")}</Label>
      <NativeSelect id="chat-execution-location" disabled={disabled} value={cloud ? "cloud" : "local"} onChange={event => controller.setCloudEnvironment(event.target.value === "cloud" ? "" : undefined)}>
        <NativeSelectOption value="local">{uiText("本机")}</NativeSelectOption>
        <NativeSelectOption value="cloud">Codex Cloud</NativeSelectOption>
      </NativeSelect>
    </div>
    {cloud && <div className="grid gap-1.5"><Label htmlFor="chat-cloud-environment">{uiText("云端环境")}</Label>
      <NativeSelect id="chat-cloud-environment" disabled={disabled || !environments?.length} value={environments?.some(row => row.id === selected) ? selected : ""} onChange={event => controller.setCloudEnvironment(event.target.value)}>
        <NativeSelectOption value="">{uiText(error ? "无法读取云端环境" : !environments ? "正在读取云端环境…" : environments.length ? "选择云端环境" : "没有可用的云端环境")}</NativeSelectOption>
        {environments?.map(environment => <NativeSelectOption key={environment.id} value={environment.id}>{environment.shared ? uiText("{0}（工作区共享）", environment.name) : environment.name}</NativeSelectOption>)}
      </NativeSelect>
      {error && <div className="flex items-center gap-2"><p role="alert" className="m-0 text-sm text-destructive">{error}</p><Button type="button" size="xs" variant="outline" onClick={() => setRetry(value => value+1)}>{uiText("重试")}</Button></div>}
    </div>}
  </div>;
}

const ChatRunIndicator = memo(function ChatRunIndicator({controller, portal}: {controller: ChatController; portal: React.RefObject<HTMLElement | null>}) {
  const state = useChatState(controller, s => ({stopping:s.stopping,submitting:s.submitting,chat:{busy:s.chat.busy,status:s.chat.status,external:s.chat.external,notice:s.chat.notice}}));
  if (controller.options.readOnly || (!state.chat.busy && !state.submitting && !state.stopping)) return null;
  const status = state.stopping || state.chat.status === "stopping" ? "stopping"
    : state.chat.status === "waiting" ? "waiting"
    : state.chat.status === "starting" ? "starting"
    : state.chat.busy ? "running" : "sending";
  const labels = {stopping: uiText("正在停止…"), waiting: uiText("等待你的确认"), starting: uiText("正在连接…"), running: state.chat.external ? uiText("Codex 正在运行…") : uiText("进行中…"), sending: uiText("正在发送…")};
  return <div className="chat-run-status"><ConversationRunIndicator status={status} label={labels[status]} />{state.chat.notice && <ConversationNotice message={state.chat.notice} portal={portal} />}</div>;
});

function ApprovalCard({approval, controller}: {approval: Approval; controller: ChatController}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getViewSnapshot);
  const [error, setError] = useState("");
  const disabled = !!state.answering || state.stopping || !state.chat.busy || state.chat.status === "stopping";
  return <Card className="gap-3 py-4"><form onSubmit={event => {
    event.preventDefault();
    if (disabled) return;
    setError("");
    const data = new FormData(event.currentTarget);
    const answers: Record<string, string[]> = {};
    for (const q of approval.questions || []) answers[q.id] = [String(data.get(`text:${q.id}`) || "").trim() || String(data.get(`choice:${q.id}`) || "")];
    const decision = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") || "accept";
    try { void controller.answer(approval, decision, answers, readElicitation(event.currentTarget, approval.elicitation)); }
    catch (error) { setError((error as Error).message); }
  }} onClick={event => {
    if ((event.target as Element).closest("[data-elicitation-open]")) {
      event.preventDefault();
      if (!disabled) void controller.openApprovalURL(approval);
      return;
    }
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-chat-decision]");
    if (button && !disabled) { setError(""); void controller.answer(approval, button.dataset.chatDecision!, {}); }
  }}>
    <CardHeader className="px-4"><CardTitle>{cleanText(approval.title)}</CardTitle></CardHeader>
    <CardContent className="space-y-3 px-4 py-3">
      {approval.details && <pre className="m-0 max-h-36 overflow-auto whitespace-pre-wrap wrap-anywhere text-xs">{cleanText(approval.details)}</pre>}
      <ElicitationFields elicitation={approval.elicitation} disabled={disabled} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {(approval.questions || []).map(q => <fieldset key={q.id} className="m-0 min-w-0 space-y-2 border-0 p-0" disabled={disabled}>
        <legend className="mb-2 text-sm">{q.header} · {q.question}</legend>
        {q.options?.length ? <NativeSelect name={`choice:${q.id}`} aria-label={q.question}><NativeSelectOption value="">{uiText("选择一个回答，或在下方补充")}</NativeSelectOption>{q.options.map(o => <NativeSelectOption key={o.label} value={o.label}>{o.label} · {o.description}</NativeSelectOption>)}</NativeSelect> : null}
        <Input name={`text:${q.id}`} type={q.isSecret ? "password" : "text"} autoComplete="off" aria-label={q.question + uiText("（补充回答）")} placeholder={uiText("输入回答或补充说明")} />
      </fieldset>)}
    </CardContent>
    <CardFooter className="justify-end gap-2 px-4">
      <ApprovalActions approval={approval} disabled={disabled} sending={state.answering === approval.id} />
    </CardFooter>
  </form></Card>;
}

export function ChatPanel({controller}: {controller: ChatController}) {
  const readOnly = !!controller.options.readOnly;
  const panel = useRef<HTMLElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = () => {
    setSearchOpen(false); controller.setSearch("");
    panel.current?.querySelector<HTMLButtonElement>('[data-chat-menu-trigger]')?.focus();
  };
  const state = useSyncExternalStore(controller.subscribe, controller.getViewSnapshot);
  const cloud = controller.isCloud();
  useLayoutEffect(() => {
    const form = document.getElementById("sessionCreationSetup");
    if (!form || !cloud) return;
    form.setAttribute("data-codex-cloud", "");
    return () => form.removeAttribute("data-codex-cloud");
  }, [cloud]);
  const attachments = useMemo(() => new ChatAttachmentAdapter((name, data) => controller.options.request("/api/chat-attachments", {method: "POST", body: JSON.stringify({name, data})})), [controller]);
  const directories = useSessionDirectories(controller,state.session,state.provider,state.chat.busy || state.submitting);
  const question = !readOnly ? controller.question() : undefined;
  const approvals = state.chat.approvals.filter(a => a !== question);
  const previousQuestion = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previousQuestion.current && !question) panel.current?.querySelector<HTMLTextAreaElement>(uiText("textarea[aria-label=\"对话消息\"]"))?.focus();
    previousQuestion.current = question?.id;
  }, [question?.id]);
  const entries = useMemo(() => mergeEntries(state.entries, state.chat.entries), [state.entries, state.chat.entries]);
  const messages = useMemo(() => convertEntries(entries), [entries]);
  // The server owns a linear history. Replacing a local echo must remove its
  // old repository entry rather than retain it as an alternate branch.
  const messageRepository = useMemo(() => ExportedMessageRepository.fromArray(messages), [messages]);
  const runtime = useConversationRuntime<ThreadMessage>(controller, {
    adapters: cloud ? {} : {attachments},
    messageRepository,
    isRunning: state.chat.busy || state.submitting,
    isLoading: state.loading && messages.length === 0,
    hasEarlier: !!state.cursor,
    onLoadEarlier: () => controller.history(true),
    isSendDisabled: !cloud && directories.preparing || !!state.chat.external && (state.chat.busy || state.chat.status === "unknown") || !controller.canSend() || !!state.chat.blocked || state.submitting || !!state.session?.archived || (state.chat.busy && (!state.capabilities.steer || !state.chat.turn_id || !["running","waiting"].includes(state.chat.status))),
    onNew: async message => {
      reading.latest();
      const text = message.content.filter(p => p.type === "text").map(p => p.text).join("\n");
      const images = [...message.content, ...(message.attachments || []).flatMap(a => a.content)].filter(p => p.type === "image").map(p => p.image);
      controller.draftAttachments = message.attachments || [];
      // The composer returns failed submissions to its draft. Let it own that
      // restoration, then mirror the result below so text is never appended twice.
      try { if (cloud) await controller.send(text, images, false); else await directories.send(text, images); } catch (error) {
        if (!panel.current && !controller.getSnapshot().draft) controller.setDraft(text);
        controller.setError((error as Error).message);
        throw new MessageNotSentError((error as Error).message);
      }
    },
    onCancel: state.chat.external && state.chat.busy ? undefined : controller.stop,
  });
  const reading = useChatReading(controller, runtime.thread);
  useEffect(() => {
    const composer = runtime.thread.composer;
    if (cloud) return;
    for (const attachment of controller.draftAttachments) {
      if (composer.getState().attachments.some(a => a.id === attachment.id)) continue;
      const restored = attachment.content ? {id: attachment.id, type: attachment.type, name: attachment.name, contentType: attachment.contentType, content: attachment.content} : attachment.file;
      if (restored) void composer.addAttachment(restored).catch(error => controller.setError((error as Error).message));
    }
    const unsubscribe = composer.subscribe(() => {
      const draft = composer.getState();
      if (!draft.submission && !controller.getSnapshot().submitting) { controller.draftAttachments = draft.attachments; controller.attachmentsChanged(); }
    });
    const unsubscribeErrors = composer.unstable_on("attachmentAddError", event => controller.setError(event.message));
    return () => { unsubscribe(); unsubscribeErrors(); };
  }, [controller, runtime, cloud, state.draftRestore]);
  const path = (state.chat.busy ? state.chat.context?.cwd : directories.cwd) || state.context?.cwd || state.session?.cwd || directories.target.cwd || "";
  const displayPath = isGeneralConversationDirectory(path) ? uiText("普通对话") : path;
  const context = conversationContext(path, controller.options.overview, state.session?.primary_project_id || directories.target.project_id);
  const additionalDirectories = state.chat.context?.additional_directories || state.context?.additional_directories || state.session?.additional_directories || [];
  const changePaths = useMemo(() => ({cwd: path, additionalDirectories,
    projectRoots: controller.options.overview?.projects.flatMap(project => [project.path, ...project.worktrees.map(tree => tree.path)]) || [],
  }), [path, additionalDirectories, controller.options.overview]);
  const occupied = !readOnly && !!state.session && (state.chat.status === "conflict" || /占用|终端|客户端|写入锁|active writer|another app/i.test(state.chat.blocked || ""));
  const status = occupied ? undefined : state.chat.blocked;
  const notice = !occupied && state.chat.notice && (readOnly || (!state.chat.busy && !state.submitting && !state.stopping)) ? state.chat.notice : undefined;
  const feedback = (occupied || state.draftNotice || status || notice || state.chat.retrying || state.chat.can_handoff || state.error || state.chat.error) &&
    <ConversationFeedback messages={[status, state.draftNotice, state.chat.retrying]} error={state.error || (!occupied ? state.chat.error : undefined)}>
      {occupied && <OccupiedConversation controller={controller} send={() => runtime.thread.composer.send()} />}
      {notice && <ConversationNotice message={notice} portal={panel} />}
      {state.capabilities.handoff && state.chat.can_handoff && !state.chat.busy && <Button type="button" size="sm" variant="outline" disabled={state.submitting} onClick={() => void controller.handoff()}>{uiText("在这里继续（等终端本轮结束）")}</Button>}
    </ConversationFeedback>;
  const terminal = state.terminal;
  const draftDirectoryName = !state.session && path && !isGeneralConversationDirectory(path) ? path.split(/[\\/]/).filter(Boolean).at(-1) : undefined;
  const contextSummary = (context.project || context.branch || draftDirectoryName) ? <>
    <span className="chat-workspace-project" title={context.project}><span>{context.project || draftDirectoryName || uiText("工作目录")}</span></span>
    {context.branch && <span className="chat-workspace-branch" title={uiText("分支 · {0}", context.branch)}><span>{context.branch}</span></span>}
  </> : (!state.session ? <span className="chat-workspace-project" title={uiText("默认目录（无需项目）")}><span>{uiText("默认目录")}</span></span> : undefined);
  const contextTitle = [context.project || draftDirectoryName || (context.branch ? uiText("工作目录") : ""), context.branch].filter(Boolean).join(" · ") || (!state.session ? uiText("默认目录") : "");
  return <ChatMediaProvider controller={controller} entries={entries}><ChatChangePathsProvider value={changePaths}>
    <ConversationPanel runtime={runtime} panelRef={panel} reading={reading}
      header={<ConversationHeader title={state.session ? state.session.name || uiText("未命名对话") : <ConversationDraftTitle controller={controller} />} titleID="assistantChatTitle" titleHint={state.session?.name}
        actions={<>
            {(state.session || state.submitting || state.chat.blocked || state.chat.status !== "idle") && <ChatStatus controller={controller} />}
            {!readOnly && state.session && controller.options.newConversation && <TooltipIconButton tooltip={uiText("新建对话")} aria-label={uiText("新建对话")} onClick={controller.options.newConversation}><PlusIcon /></TooltipIconButton>}
            {!cloud && <ChatFileToggle />}
            <ChatSessionMenu controller={controller} portal={panel} onSearch={() => setSearchOpen(true)} />
            <ParallelPaneControls />
        </>}
        context={cloud ? <span className="chat-workspace-project">{"Codex Cloud" + (state.session?.cloud_environment ? " · " + state.session.cloud_environment : "")}</span> : !state.session && document.getElementById("sessionBrowserDirectoryChoices") ? <button type="button" className="creation-header-directory" aria-label={uiText("选择工作目录")} aria-haspopup="dialog" aria-expanded={false} aria-controls="sessionBrowserDirectoryChoices-popover" aria-keyshortcuts="Meta+Shift+D Control+Shift+D" title={[contextTitle, displayPath].filter(Boolean).join("\n")} onClick={event => document.dispatchEvent(new CustomEvent("workhub:creation-directory", {detail:event.currentTarget}))}>
          <span className="conversation-context-summary">{contextSummary}</span><ChevronDownIcon aria-hidden="true" />
        </button> : <ConversationWorkingContext trigger={contextSummary} triggerTitle={contextTitle || undefined} header={directories.header}>
          {directories.context}
          <div className="chat-context-footer">
            <div className="chat-context-footer-row">
              <details className="chat-context-meta">
                <summary><span>{controller.options.environmentName || (controller.options.environment === "local" ? uiText("本机") : controller.options.environment)}</span><span aria-hidden="true">·</span><span>{uiText("会话信息")}</span><ChevronDownIcon aria-hidden="true" /></summary>
                <dl className="chat-context-facts grid gap-2 text-xs">
                  <dt>{uiText("执行环境")}</dt><dd>{controller.options.environmentName || (controller.options.environment === "local" ? uiText("本机") : controller.options.environment)}</dd>
                  <dt>{uiText("项目")}</dt><dd>{context.projectID && controller.options.openProject ? <button type="button" className="chat-workspace-link" aria-label={uiText("打开项目详情：{0}", context.project)} onClick={() => controller.options.openProject?.(context.projectID!,path)}>{context.project}</button> : context.project || uiText("工作目录")}</dd>
                  {context.branch && <><dt>{uiText("分支")}</dt><dd>{context.branch}</dd></>}
                  <dt>{state.chat.busy ? uiText("运行目录") : uiText("工作目录")}</dt><dd><code className="chat-workspace-path">{displayPath || uiText("普通对话")}</code></dd>
                  <dt>{uiText("目录类型")}</dt><dd>{context.kind}</dd>
                  {additionalDirectories.length > 0 && <><dt>{uiText("额外工作目录")}</dt><dd>{additionalDirectories.map(directory => <code key={directory} className="chat-context-directory">{directory}</code>)}</dd></>}
                </dl>
              </details>
              {!readOnly && state.session && <Button type="button" size="xs" variant="outline" className="chat-workspace-resume" disabled={!state.session.available} onClick={() => void controller.resume()}><TerminalIcon aria-hidden="true" />{uiText("在终端继续")}</Button>}
            </div>
            {(state.session || state.submitting || state.chat.blocked || state.chat.status !== "idle") && <ChatStatus controller={controller} />}
            {readOnly && <div className="flex items-center gap-2"><ChatControls controller={controller} portal={panel} managedDirectories={directories.managed} />{state.session && <Button type="button" variant="ghost" size="sm" data-session-action="global-resume" data-session={state.session.id} onClick={() => void controller.resume()} disabled={!state.session.available}>{uiText("在终端继续 ↗")}</Button>}</div>}
          </div>
        </ConversationWorkingContext>}>
        {!cloud && directories.dialog}
        {state.session && <ChatSearch controller={controller} container={reading.container} open={searchOpen} onClose={closeSearch} />}
      </ConversationHeader>}
      onKeyDownCapture={event => {
        if (state.chat.busy && state.capabilities.steer && event.key==="Enter" && (sendShortcut() === "enter" || event.ctrlKey || event.metaKey) && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && event.target instanceof HTMLTextAreaElement && event.target.closest(".aui-composer-root")) {event.preventDefault();event.stopPropagation();runtime.thread.composer.send();}
      }}
      onChange={event => {
        if (event.target instanceof HTMLTextAreaElement && event.target.closest(".aui-composer-root")) controller.setDraft(event.target.value);
      }}
      beforeThread={state.historyError && <Alert variant="destructive" className="shrink-0 rounded-none"><AlertDescription>{state.historyError}</AlertDescription></Alert>}
      thread={{
        dockComposer: !readOnly,
        emptyState: !readOnly && !state.session && <ConversationCreationSetup>{!cloud && directories.creation}{controller.options.environment === "local" && state.provider === "codex" && <CloudEnvironmentFields controller={controller} selected={state.cloudEnvironment} disabled={state.submitting} />}</ConversationCreationSetup>,
        composerStatus: !readOnly && <>{!cloud && !occupied && directories.composer}<div className="chat-composer-status">{feedback}<ChatRunIndicator controller={controller} portal={panel} /></div></>, components: chatComponents,
        autoFocus: !!controller.options.focusComposer && !readOnly && !state.session && !document.documentElement.hasAttribute("data-workspace-inactive"), readOnly,
        composer: occupied ? null : question ? <QuestionComposer key={questionDraftKey(question, state.chat.id)} approval={question} controller={controller} /> : undefined,
        composerControls: cloud ? undefined : <ChatControls controller={controller} portal={panel} managedDirectories={directories.managed} />,
      }}
      composerInput={{placeholder: uiText(state.session ? "补充说明、询问进展，或交代下一步…" : "描述你要完成的任务…")}}
      composerPrediction={!readOnly && state.provider === "codex" && !state.submitting && !state.chat.busy && !state.chat.external && !state.session?.archived && !state.chat.blocked && state.chat.status === "completed" && state.chat.prediction?.source_turn_id === state.chat.turn_id && entries.at(-1)?.turn_id === state.chat.turn_id ? state.chat.prediction : undefined}
      onDismissPrediction={controller.dismissPrediction}
      afterThread={<>
      {readOnly && (terminal?.waiting || !!terminal?.confirmations?.length) && <Alert className="max-h-[40%] shrink-0 overflow-y-auto rounded-none" role="alert"><AlertDescription>
        <p>{uiText("终端有待确认事项，请在原终端处理。")}{!terminal.connected && uiText("连接已断开，以下提示尚未核实。")}</p>
        {terminal.confirmations?.map(item => <div key={item.id} className="space-y-2"><strong>{cleanText(item.title)}</strong>{item.details && <pre className="whitespace-pre-wrap wrap-anywhere">{cleanText(item.details)}</pre>}{item.questions?.map(q => <p key={q.id}>{cleanText(q.header)} · {cleanText(q.question)}{q.options?.map(o => <span key={o.label} className="block">{cleanText(o.label)} · {cleanText(o.description)}</span>)}</p>)}</div>)}
      </AlertDescription></Alert>}
      {approvals.length > 0 && <div className="max-h-[40%] shrink-0 space-y-2 overflow-y-auto border-t p-4" aria-live="polite">{approvals.map(a => <ApprovalCard key={a.id} approval={a} controller={controller} />)}</div>}
</>}
      feedback={readOnly && feedback} />
  </ChatChangePathsProvider></ChatMediaProvider>;
}
