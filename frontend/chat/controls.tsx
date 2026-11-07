import { uiText } from "../i18n";
import {memo, useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject} from "react";
import {ArchiveIcon, ArchiveRestoreIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, GitForkIcon, LoaderCircleIcon, MoreHorizontalIcon, PencilIcon, PinIcon, PinOffIcon, RefreshCwIcon, SearchIcon, HandIcon, ShieldCheckIcon, ShieldAlertIcon, ZapIcon, XIcon} from "lucide-react";
import {Collapsible, DropdownMenu, Popover} from "radix-ui";
import {TooltipIconButton} from "@/components/assistant-ui/elements/tooltip-icon-button";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {NativeSelect, NativeSelectOption} from "@/components/ui/native-select";
import {convertEntries, mergeEntries, newConversationSettings, type ChatContext, type PermissionMode} from "./model";
import {ChatController} from "./controller";
import {useChatState} from './use-chat-state';
import {ConversationStatusBadge} from '../workspace/conversation-surface';

const modeLabel = (mode?: string) => mode === "plan" ? uiText("规划") : mode === "default" ? uiText("执行") : uiText("未获取工作模式");
const approvalLabel = (policy: unknown) => typeof policy === "string" ? ({"on-request": uiText("按需审批"), untrusted: uiText("非受信任操作需审批"), "on-failure": uiText("失败后审批"), never: uiText("无需审批")}[policy] || policy) : uiText("由 Codex 管理");
type ControlsProps = {controller: ChatController; portal: RefObject<HTMLElement | null>};
const overlayClass = "chat-control-overlay rounded-xl border bg-background p-4 text-sm text-foreground shadow-lg outline-none";

function ChatStatusView({controller}: {controller: ChatController}) {
  const s = useChatState(controller, s => ({session:s.session ? {archived:s.session.archived} : null,submitting:s.submitting,chat:{blocked:s.chat.blocked,busy:s.chat.busy,external:s.chat.external,status:s.chat.status},terminal:{connected:s.terminal?.connected,waiting:s.terminal?.waiting}}));
  const status = s.chat.blocked ? "conflict" : s.submitting ? "sending" : s.chat.status;
  const labels: Record<string, string> = {sending: uiText("发送中"), unknown: uiText("原生状态待核实"), handoff: uiText("等待终端交接"), idle: uiText("可继续对话"), starting: uiText("正在连接"), running: uiText("运行中"), waiting: uiText("待确认"), stopping: uiText("正在停止"), completed: uiText("本轮已完成"), interrupted: uiText("已停止"), failed: uiText("本轮未完成"), conflict: uiText("暂不可发送")};
  const readOnly = controller.options.readOnly;
  if (!readOnly && !s.session?.archived && status === "running" && s.chat.busy) return null;
  const text = s.session?.archived ? uiText("已归档") : readOnly ? (s.terminal?.waiting ? uiText("终端待确认") : s.terminal?.connected ? uiText("终端实时同步") : uiText("历史同步中")) : s.chat.external && s.chat.busy ? status === "waiting" ? uiText("Codex 待确认") : uiText("Codex 中运行") : labels[status] || uiText("可继续对话");
  const busy = !readOnly && (s.chat.busy || s.submitting);
  return <ConversationStatusBadge data-state={status} data-compact-idle={!readOnly && !s.session?.archived && status === "idle"}>
    {busy && status !== "waiting" ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : status === "completed" ? <CheckIcon aria-hidden="true" /> : <span className="chat-status-dot" aria-hidden="true" />}{text}
  </ConversationStatusBadge>;
}

const permissions = [
  {value: "ask", label: uiText("请求批准"), description: uiText("编辑工作区外文件和使用互联网时请求批准"), icon: HandIcon},
  {value: "auto", label: uiText("帮我批准"), description: uiText("自动审查批准请求，风险操作仍需确认"), icon: ShieldCheckIcon},
  {value: "full", label: uiText("完全访问权限"), description: uiText("可不受沙箱限制地访问互联网和电脑上的文件"), icon: ShieldAlertIcon},
] as const;
function contextPermission(context?: ChatContext): PermissionMode | undefined {
  if (context?.sandbox?.type === "dangerFullAccess" && context.approvalPolicy === "never") return "full";
  if (context?.sandbox?.type !== "workspaceWrite" || context.approvalPolicy !== "on-request") return undefined;
  if (context.approvalsReviewer === "auto_review" || context.approvalsReviewer === "guardian_subagent") return "auto";
  return context.approvalsReviewer === "user" ? "ask" : undefined;
}
function ChatPermissionsView({controller, portal}: ControlsProps) {
  const s = useChatState(controller, s => ({session:s.session,context:s.context,settings:s.settings,defaults:s.defaults,submitting:s.submitting,chat:{busy:s.chat.busy,context:s.chat.context}}));
  const context = s.chat.context || s.context;
  const current = contextPermission(context);
  const value = s.settings.permission || (s.session ? current : s.defaults.permission);
  const inheritedLabel = s.session ? uiText("沿用对话权限") : uiText("沿用 Codex 默认权限");
  const selected = permissions.find(p => p.value === value);
  const Icon = selected?.icon || ShieldCheckIcon;
  const pending = !!s.session && s.chat.busy && !!s.settings.permission && s.settings.permission !== current;
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" size="sm" className="chat-permission-trigger" data-permission={value || "inherit"} aria-label={uiText("权限设置")} title={selected?.label || inheritedLabel} disabled={s.submitting || !!s.session?.archived}>
      <Icon aria-hidden="true" /><span>{selected?.label || inheritedLabel}</span>{pending && <span className="chat-next-turn">{uiText("下轮")}</span>}
    </Button></DropdownMenu.Trigger>
    <DropdownMenu.Portal container={portal.current}><DropdownMenu.Content className={`${overlayClass} chat-permission-menu`} align="start" side="top" sideOffset={10} collisionPadding={12}>
      <DropdownMenu.Label className="chat-permission-heading">{uiText("应如何批准操作？")}</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={s.settings.permission || ""} onValueChange={permission => controller.setSettings({...s.settings, permission: permission ? permission as PermissionMode : undefined})}>
        {permissions.map(p => <DropdownMenu.RadioItem key={p.value} value={p.value} className="chat-permission-option" data-permission={p.value}>
          <p.icon aria-hidden="true" /><span><strong>{p.label}</strong><span className="chat-permission-description">{p.description}</span></span>{s.settings.permission === p.value && <CheckIcon className="chat-permission-check" aria-hidden="true" />}
        </DropdownMenu.RadioItem>)}
        <DropdownMenu.Separator className="my-1 border-t" /><DropdownMenu.RadioItem value="" className="chat-permission-inherit">{s.session ? uiText("沿用对话权限") : uiText("使用新对话默认权限")}{!s.settings.permission && <DropdownMenu.ItemIndicator><CheckIcon aria-hidden="true" /></DropdownMenu.ItemIndicator>}</DropdownMenu.RadioItem>
      </DropdownMenu.RadioGroup>
      <p className="chat-permission-note">{uiText("下轮发送时应用，运行中补充消息沿用本轮权限。")}</p>
    </DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
const effortLabel = (effort?: string) => effort ? ({none: uiText("无"), minimal: uiText("最低"), low: uiText("低"), medium: uiText("中"), high: uiText("高"), xhigh: uiText("超高"), max: uiText("最高"), ultra: uiText("极高")}[effort] || effort) : "";

function ChatControlsView({controller, portal}: ControlsProps) {
  const s = useChatState(controller, s => ({session:s.session,context:s.context,settings:s.settings,defaults:s.defaults,submitting:s.submitting,chat:{busy:s.chat.busy,context:s.chat.context},models:s.models,modes:s.modes,optionsLoading:s.optionsLoading}));
  const title = useId();
  useEffect(() => {if (!controller.options.readOnly) void controller.loadOptions();}, [controller]);
  const context = s.chat.context || s.context;
  const model = context?.model || s.session?.model;
  const effort = context?.reasoningEffort || s.session?.reasoningEffort;
  const settings = s.session ? s.settings : newConversationSettings(s.settings, s.defaults);
  const nextModel = settings.model || model;
  const selectedModel = s.models.find(m => m.model === nextModel);
  const modelName = selectedModel?.displayName || nextModel;
  const inheritedEffort = (settings.model && settings.model !== model || !s.session) ? selectedModel?.defaultReasoningEffort : effort;
  const nextEffort = s.settings.effort || inheritedEffort;
  const nextMode = s.settings.mode || context?.mode;
  const efforts = selectedModel?.supportedReasoningEfforts || [];
  const changed = s.session ? nextModel !== model || nextEffort !== effort || nextMode !== context?.mode : Object.values(s.settings).some(Boolean);
  return <Popover.Root onOpenChange={open => {if (open) void controller.loadOptions();}}>
    <Popover.Trigger asChild><Button type="button" variant="ghost" size="sm" className="chat-context-trigger" aria-label={uiText("上下文与设置")}>
      <ZapIcon aria-hidden="true" /><span className="truncate">{modelName || (s.optionsLoading ? uiText("正在读取模型…") : !s.session ? uiText("沿用 Codex 默认模型") : uiText("选择模型"))}{nextEffort ? ` · ${effortLabel(nextEffort)}` : ""}{nextMode ? ` · ${modeLabel(nextMode)}` : ""}</span>{s.chat.busy && changed && <span className="chat-next-turn">{uiText("下轮")}</span>}<ChevronDownIcon aria-hidden="true" />
    </Button></Popover.Trigger>
    <Popover.Portal container={portal.current}><Popover.Content className={`${overlayClass} chat-settings-popover space-y-3`} align="end" side={controller.options.readOnly ? "bottom" : "top"} sideOffset={8} collisionPadding={12} aria-labelledby={title}>
      <div className="flex items-center justify-between gap-4"><h3 id={title} className="text-sm font-semibold">{uiText("上下文与设置")}</h3><Popover.Close asChild><Button variant="ghost" size="icon" className="size-6" aria-label={uiText("关闭设置")}><XIcon className="size-4" /></Button></Popover.Close></div>
      {!controller.options.readOnly && <>
        <p className="text-xs text-muted-foreground">{uiText("设置在下一轮发送时应用。运行中补充消息沿用本轮设置。")}</p>
        <label className="grid gap-1.5 text-xs">{uiText("模型")}<NativeSelect aria-label={uiText("下轮模型")} value={s.session ? nextModel || "" : s.settings.model || ""} disabled={s.optionsLoading || s.submitting} onChange={e => controller.setSettings({...s.settings, model: s.session && e.target.value === model ? undefined : e.target.value || undefined, effort: undefined})}>{!s.session ? <NativeSelectOption value="">{uiText("使用新对话默认模型")}</NativeSelectOption> : !nextModel && <NativeSelectOption value="" disabled>{s.optionsLoading ? uiText("正在读取模型…") : uiText("未获取模型")}</NativeSelectOption>}{nextModel && !s.models.some(m => m.model === nextModel) && <NativeSelectOption value={nextModel}>{nextModel}</NativeSelectOption>}{s.models.map(m => <NativeSelectOption key={m.id} value={m.model}>{m.displayName || m.model}</NativeSelectOption>)}</NativeSelect></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-xs">{uiText("思考强度")}<NativeSelect aria-label={uiText("下轮思考强度")} value={s.session ? nextEffort || "" : s.settings.effort || ""} disabled={s.optionsLoading || s.submitting} onChange={e => controller.setSettings({...s.settings, effort: s.session && e.target.value === inheritedEffort ? undefined : e.target.value || undefined})}>{!s.session ? <NativeSelectOption value="">{uiText("使用模型默认强度")}</NativeSelectOption> : !nextEffort && <NativeSelectOption value="" disabled>{uiText("未获取思考强度")}</NativeSelectOption>}{nextEffort && !efforts.some(e => e.reasoningEffort === nextEffort) && <NativeSelectOption value={nextEffort}>{effortLabel(nextEffort)}</NativeSelectOption>}{efforts.map(e => <NativeSelectOption key={e.reasoningEffort} value={e.reasoningEffort}>{effortLabel(e.reasoningEffort)}</NativeSelectOption>)}</NativeSelect></label>
          <label className="grid gap-1.5 text-xs">{uiText("工作模式")}<NativeSelect aria-label={uiText("下轮工作模式")} value={nextMode || ""} disabled={s.optionsLoading || s.submitting} onChange={e => controller.setSettings({...s.settings, mode: e.target.value === context?.mode ? undefined : e.target.value || undefined})}>{!nextMode && <NativeSelectOption value="" disabled>{uiText("未获取工作模式")}</NativeSelectOption>}{nextMode && !s.modes.includes(nextMode) && <NativeSelectOption value={nextMode}>{modeLabel(nextMode)}</NativeSelectOption>}{s.modes.map(mode => <NativeSelectOption key={mode} value={mode}>{modeLabel(mode)}</NativeSelectOption>)}</NativeSelect></label>
        </div>
        {s.optionsLoading && <p role="status" className="text-xs text-muted-foreground">{uiText("正在读取 Codex 设置…")}</p>}
        {changed && <div className="flex items-center justify-between gap-2 text-xs"><span>{uiText("已设置下一轮参数")}</span><Button size="sm" variant="ghost" onClick={() => {const settings = s.settings.permission ? {permission: s.settings.permission} : {}; controller.setSettings(s.session ? settings : {});}}>{s.session ? uiText("恢复当前设置") : uiText("恢复默认设置")}</Button></div>}
      </>}
      <Collapsible.Root className="border-t pt-3"><Collapsible.Trigger className="chat-context-disclosure flex w-full items-center justify-between text-xs">{uiText("当前上下文与权限")}<ChevronDownIcon className="size-3" aria-hidden="true" /></Collapsible.Trigger><Collapsible.Content>
        <dl className="chat-context-facts mt-3 grid gap-2 text-xs"><dt>{uiText("主工作目录")}</dt><dd>{context?.cwd || s.session?.cwd || controller.options.target?.cwd || uiText("所选项目目录")}</dd><dt>{uiText("额外工作目录")}</dt><dd>{context?.additional_directories?.join("、") || uiText("未报告额外目录")}</dd><dt>{uiText("当前模型 / 思考强度")}</dt><dd>{model || uiText("Codex 未报告")} / {effort ? effortLabel(effort) : uiText("未获取思考强度")}</dd><dt>{uiText("当前工作模式")}</dt><dd>{modeLabel(context?.mode)}</dd><dt>{uiText("审批策略")}</dt><dd>{approvalLabel(context?.approvalPolicy)}</dd><dt>{uiText("批准方式")}</dt><dd>{context?.approvalsReviewer === "auto_review" || context?.approvalsReviewer === "guardian_subagent" ? uiText("帮我批准") : context?.approvalsReviewer === "user" ? uiText("手动批准") : uiText("Codex 未报告")}</dd><dt>{uiText("沙箱")}</dt><dd>{context?.sandbox?.type || uiText("Codex 未报告")}</dd></dl>
      </Collapsible.Content></Collapsible.Root>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

export function ChatSessionMenu({controller, portal, onSearch}: ControlsProps & {onSearch: () => void}) {
  const s = useSyncExternalStore(controller.subscribe, controller.getViewSnapshot);
  const [editor, setEditor] = useState<"rename" | "fork" | null>(null);
  const [name, setName] = useState("");
  const [turn, setTurn] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const searchSelected = useRef(false);
  const title = useId();
  const turns = [...new Set(mergeEntries(s.entries, s.chat.entries).filter(e => e.kind === "assistant" && e.turn_id && e.status !== "inProgress").map(e => e.turn_id))];
  const readOnly = !!controller.options.readOnly;
  if (!s.session) return null;
  const openEditor = (mode: "rename" | "fork") => {setName(s.session?.name || ""); setTurn(""); setEditor(mode);};
  const submit = async () => {
    await controller.manage(editor!, editor === "rename" ? name.trim() : undefined, turn);
    if (!controller.getSnapshot().error) setEditor(null);
  };
  return <Popover.Root open={!!editor} onOpenChange={open => {if (!open && !s.managing) setEditor(null);}}>
    <Popover.Anchor asChild><span className="inline-flex"><DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild><TooltipIconButton ref={trigger} className={readOnly ? "chat-readonly-menu-trigger" : undefined} data-chat-menu-trigger tooltip={uiText("更多对话操作")} aria-label={uiText("更多对话操作")} disabled={s.managing}><MoreHorizontalIcon /></TooltipIconButton></DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portal.current}><DropdownMenu.Content className={`${overlayClass} chat-session-menu`} align="end" sideOffset={8} collisionPadding={12} onCloseAutoFocus={event => {if (editor || searchSelected.current) event.preventDefault(); searchSelected.current = false;}}>
        <DropdownMenu.Item className="chat-menu-item chat-menu-secondary-action" onSelect={() => {searchSelected.current = true; onSearch();}}><SearchIcon />{uiText("查找消息")}</DropdownMenu.Item>
        <DropdownMenu.Item className="chat-menu-item chat-menu-secondary-action" disabled={s.loading} onSelect={() => void controller.history()}><RefreshCwIcon />{uiText("刷新历史")}</DropdownMenu.Item>
        {!readOnly && <>
        <DropdownMenu.Separator className="chat-menu-secondary-action my-1 border-t" />
        <DropdownMenu.Item className="chat-menu-item" onSelect={() => openEditor("rename")}><PencilIcon />{uiText("重命名")}</DropdownMenu.Item>
        <DropdownMenu.Item className="chat-menu-item" onSelect={() => void controller.manage(s.session?.pinned ? "unpin" : "pin")}>{s.session.pinned ? <PinOffIcon /> : <PinIcon />}{s.session.pinned ? uiText("取消固定") : uiText("固定对话")}</DropdownMenu.Item>
        <DropdownMenu.Item className="chat-menu-item" disabled={s.chat.busy || s.submitting || s.session.archived} onSelect={() => openEditor("fork")}><GitForkIcon />{uiText("从历史分叉")}</DropdownMenu.Item>
        <DropdownMenu.Separator className="my-1 border-t" />
        <DropdownMenu.Item className="chat-menu-item" disabled={s.chat.busy || s.submitting} onSelect={() => void controller.manage(s.session?.archived ? "restore" : "archive")}>{s.session.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}{s.session.archived ? uiText("恢复对话") : uiText("归档对话")}</DropdownMenu.Item>
        </>}
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root></span></Popover.Anchor>
    <Popover.Portal container={portal.current}><Popover.Content className={`${overlayClass} chat-manage-popover space-y-3`} align="end" sideOffset={8} collisionPadding={12} aria-labelledby={title} onCloseAutoFocus={event => {event.preventDefault(); trigger.current?.focus();}}>
      <h3 id={title} className="text-sm font-semibold">{editor === "rename" ? uiText("重命名对话") : uiText("从历史分叉")}</h3>
      <form className="space-y-3" onSubmit={e => {e.preventDefault(); void submit();}}>
        {editor === "rename" ? <Input aria-label={uiText("对话名称")} value={name} maxLength={160} required disabled={s.managing} onChange={e => setName(e.target.value)} /> : <><label className="grid gap-1.5 text-xs">{uiText("复制至哪一轮")}<NativeSelect aria-label={uiText("分叉至哪一轮")} value={turn} disabled={s.managing} onChange={e => setTurn(e.target.value)}><NativeSelectOption value="">{uiText("全部已完成轮次")}</NativeSelectOption>{turns.map((id, i) => <NativeSelectOption key={id} value={id}>{uiText("截至第")}{" "}{i + 1}{" "}{uiText("轮（已加载历史）")}</NativeSelectOption>)}</NativeSelect></label><p className="text-xs text-muted-foreground">{uiText("复制对话历史，共用当前工作目录。")}</p></>}
        {s.error && <p role="alert" className="text-xs text-destructive">{s.error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" disabled={s.managing} onClick={() => setEditor(null)}>{uiText("取消")}</Button><Button type="submit" size="sm" disabled={s.managing || editor === "rename" && !name.trim()}>{s.managing ? uiText("处理中…") : editor === "rename" ? uiText("保存名称") : uiText("创建分叉对话")}</Button></div>
      </form>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

export function ChatSearch({controller, container, open, onClose}: {controller: ChatController; container: RefObject<HTMLDivElement | null>; open: boolean; onClose: () => void}) {
  const s = useSyncExternalStore(controller.subscribe, controller.getViewSnapshot);
  const [index, setIndex] = useState(0);
  const [count, setCount] = useState(0);
  const matches = useRef<HTMLElement[]>([]);
  const previousSearch = useRef("");
  useEffect(() => {
    const nodes = [...container.current?.querySelectorAll<HTMLElement>("[data-chat-message-id]") || []];
    const text = open ? s.search.trim().toLocaleLowerCase() : "";
    const hitIDs = new Set(text ? convertEntries(mergeEntries(s.entries, s.chat.entries)).filter(message => {
      const content = typeof message.content === "string" ? message.content : message.content.map(part => part.type === "text" ? part.text : part.type === "tool-call" ? [part.toolName, part.argsText, JSON.stringify(part.result)].join(" ") : "").join(" ");
      return content.toLocaleLowerCase().includes(text);
    }).map(message => String(message.id)) : []);
    const found = nodes.filter(n => hitIDs.has(n.dataset.chatMessageId || ""));
    matches.current = found; setCount(found.length);
    const changed = previousSearch.current !== text; previousSearch.current = text;
    setIndex(i => changed ? 0 : Math.max(0, Math.min(i, found.length - 1)));
    for (const node of nodes) node.toggleAttribute("data-search-hit", found.includes(node));
    return () => nodes.forEach(n => n.removeAttribute("data-search-hit"));
  }, [s.search, s.entries, s.chat.entries, container, open]);
  const jump = (delta: number) => {if (!matches.current.length) return; const next = (index + delta + matches.current.length) % matches.current.length; setIndex(next); matches.current[next].scrollIntoView({block: "center", behavior: "smooth"});};
  if (!open) return null;
  return <div className="chat-search-bar border-t pt-2" role="search" aria-label={uiText("查找消息")} onKeyDown={e => {if (e.key === "Escape") {e.stopPropagation(); onClose();} else if (e.key === "Enter" && e.target instanceof HTMLInputElement) {e.preventDefault(); jump(e.shiftKey ? -1 : 1);}}}>
    <div className="flex items-center gap-1"><SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><Input autoFocus type="search" aria-label={uiText("查找对话内容")} placeholder={uiText("搜索消息和命令")} value={s.search} onChange={e => controller.setSearch(e.target.value)} className="h-8 min-w-0 flex-1" /><span role="status" className="shrink-0 px-1 text-xs text-muted-foreground">{count ? `${index + 1}/${count}` : s.search ? uiText("无匹配") : ""}</span><TooltipIconButton tooltip={uiText("上一处")} aria-label={uiText("上一处")} disabled={!count} onClick={() => jump(-1)}><ArrowUpIcon /></TooltipIconButton><TooltipIconButton tooltip={uiText("下一处")} aria-label={uiText("下一处")} disabled={!count} onClick={() => jump(1)}><ArrowDownIcon /></TooltipIconButton><TooltipIconButton tooltip={uiText("关闭查找")} aria-label={uiText("关闭查找")} onClick={onClose}><XIcon /></TooltipIconButton></div>
    {s.cursor && <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground"><span>{uiText("正在查找已加载的历史")}</span><Button type="button" size="sm" variant="ghost" disabled={s.searching} onClick={() => void controller.searchAll()}>{s.searching ? uiText("正在加载…") : uiText("搜索全部历史")}</Button></div>}
    {s.searchError && <p role="alert" className="text-xs text-destructive">{s.searchError}</p>}
  </div>;
}

export const ChatStatus = memo(ChatStatusView);
export const ChatPermissions = memo(ChatPermissionsView);
export const ChatControls = memo(ChatControlsView);
