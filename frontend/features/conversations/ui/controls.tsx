import {uiText} from "@/shared/i18n"
import {memo, useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject} from "react"
import {ArchiveIcon, ArchiveRestoreIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronDownIcon, GaugeIcon, GitForkIcon, LoaderCircleIcon, MoreHorizontalIcon, OrbitIcon, PencilIcon, PinIcon, PinOffIcon, RefreshCwIcon, SearchIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldIcon, ShieldQuestionMarkIcon, SquareTerminalIcon, XIcon, ZapIcon, type LucideIcon} from "lucide-react"
import {Collapsible, DropdownMenu, Popover} from "radix-ui"
import {TooltipIconButton} from "../components/assistant-ui/elements/tooltip-icon-button"
import {Button} from "@/shared/ui/primitives/button"
import {Input} from "@/shared/ui/primitives/input"
import {NativeSelect, NativeSelectOption} from "@/shared/ui/primitives/native-select"
import {convertEntries, mergeEntries, newConversationSettings, type AgentProvider, type ChatContext, type PermissionMode} from "../model/messages"
import {effortLabel, findChatModel, isFastTier, permissionChoices, serviceTierLabel} from "../model/settings"
import {ChatController} from "../runtime/controller"
import {useChatState} from "../runtime/use-chat-state"
import {isGeneralConversationDirectory} from "@/entities/conversations/context"
import {ConversationStatusBadge} from "@/shared/ui/conversation-surface"

const providerLabel = (provider?: AgentProvider) => provider === "agy" ? "Antigravity" : "Codex";
const providerIcons = {codex: SquareTerminalIcon, agy: OrbitIcon};
const permissionIcons = {ask: ShieldQuestionMarkIcon, auto: ShieldCheckIcon, full: ShieldAlertIcon};
const modeLabel = (mode?: string) => mode === "plan" ? uiText("规划") : mode === "default" ? uiText("执行") : mode === "accept-edits" ? uiText("自动编辑") : mode === "auto" ? uiText("自动") : mode || uiText("未获取工作模式");
const approvalLabel = (policy: unknown, provider?: AgentProvider) => typeof policy === "string" ? ({"on-request": uiText("按需审批"), untrusted: uiText("非受信任操作需审批"), "on-failure": uiText("失败后审批"), never: uiText("无需审批")}[policy] || policy) : provider === "agy" ? uiText("由 Antigravity 管理") : uiText("由 Codex 管理");
type ControlsProps = {controller: ChatController; portal: RefObject<HTMLElement | null>};
const overlayClass = "shadcn-scope chat-control-overlay rounded-xl border border-border bg-background p-4 text-sm text-foreground shadow-lg outline-none";

function ChatStatusView({controller}: {controller: ChatController}) {
  const s = useChatState(controller, s => ({session:s.session ? {archived:s.session.archived} : null,submitting:s.submitting,chat:{blocked:s.chat.blocked,busy:s.chat.busy,external:s.chat.external,status:s.chat.status},terminal:{connected:s.terminal?.connected,waiting:s.terminal?.waiting}}));
  const status = s.chat.blocked ? "conflict" : s.submitting ? "sending" : s.chat.status;
  const labels: Record<string, string> = {sending: uiText("发送中"), unknown: uiText("原生状态待核实"), handoff: uiText("等待终端交接"), idle: uiText("可继续对话"), starting: uiText("正在连接"), running: uiText("运行中"), waiting: uiText("待确认"), stopping: uiText("正在停止"), completed: uiText("本轮已完成"), interrupted: uiText("已停止"), failed: uiText("本轮未完成"), conflict: uiText("暂不可发送")};
  const readOnly = controller.options.readOnly;
  if (!readOnly && !s.session?.archived && status === "running" && s.chat.busy) return null;
  const text = s.session?.archived ? uiText("已归档") : readOnly ? (s.terminal?.waiting ? uiText("终端待确认") : s.terminal?.connected ? uiText("终端实时同步") : uiText("历史同步中")) : s.chat.external && s.chat.busy ? status === "waiting" ? uiText("Codex 待确认") : uiText("Codex 中运行") : labels[status] || uiText("可继续对话");
  const busy = !readOnly && (s.chat.busy || s.submitting);
  return <ConversationStatusBadge data-state={status} data-header-secondary={!readOnly && !s.session?.archived && !busy && !s.chat.blocked && ["idle", "completed", "interrupted", "unknown"].includes(status)} data-compact-idle={!readOnly && !s.session?.archived && status === "idle"}>
    {busy && status !== "waiting" ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : status === "completed" ? <CheckIcon aria-hidden="true" /> : <span className="chat-status-dot" aria-hidden="true" />}{text}
  </ConversationStatusBadge>;
}

type SettingChoice = {value: string; label: string; description?: string; danger?: boolean; icon?: LucideIcon};

function contextPermission(context?: ChatContext): PermissionMode | undefined {
  if (context?.sandbox?.type === "dangerFullAccess" && context.approvalPolicy === "never") return "full";
  if (context?.approvalPolicy !== "on-request") return undefined;
  if (context.approvalsReviewer === "auto_review" || context.approvalsReviewer === "guardian_subagent") return "auto";
  if (context.sandbox?.type === "workspaceWrite" && context.approvalsReviewer === "user") return "ask";
  return undefined;
}

type ChoiceProps = {label: string; options: SettingChoice[]; value: string; disabled?: boolean; onChange: (value: string) => void};
function SettingChoices({label, options, value, disabled, onChange}: ChoiceProps) {
  const name = useId();
  return <fieldset className="chat-setting-segments" disabled={disabled} aria-label={label}>
    {options.map(({icon: Icon, ...option}) => <label key={option.value}>
      <input type="radio" className="sr-only" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
      {Icon && <Icon aria-hidden="true" />}
      <span>{option.label}</span>
    </label>)}
  </fieldset>;
}

function SettingPicker({summary, display, danger, portal, label, options, value, disabled, onChange}: ChoiceProps & {summary: string; display: string; danger?: boolean; portal: ControlsProps["portal"]}) {
  const id = useId();
  return <div className="chat-setting-line chat-setting-picker">
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger type="button" className="chat-setting-picker-trigger" aria-label={`${summary} · ${display}`} disabled={disabled}>
        <strong>{summary}</strong><span data-danger={danger || undefined}>{display}</span><ChevronDownIcon aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portal.current}>
        <DropdownMenu.Content className="shadcn-scope chat-control-overlay chat-setting-options" align="start" sideOffset={4} collisionPadding={12} aria-label={label}>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            {options.map((option, index) => <DropdownMenu.RadioItem key={option.value} value={option.value} textValue={option.label} data-value={option.value} data-danger={option.danger || undefined}
              aria-labelledby={`${id}-${index}-label`} aria-describedby={option.description ? `${id}-${index}-description` : undefined}>
              <span><span id={`${id}-${index}-label`}>{option.label}</span>{option.description && <small id={`${id}-${index}-description`}>{option.description}</small>}</span>
              <DropdownMenu.ItemIndicator><CheckIcon aria-hidden="true" /></DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>)}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </div>;
}

function ChatControlsView({controller, portal, managedDirectories}: ControlsProps & {managedDirectories?: boolean}) {
  const s = useChatState(controller, s => ({session:s.session,provider:s.provider,context:s.context,settings:s.settings,defaults:s.defaults,submitting:s.submitting,chat:{busy:s.chat.busy,context:s.chat.context},models:s.models,modes:s.modes,optionsLoading:s.optionsLoading}));
  const title = useId();
  const readOnly = controller.options.readOnly;
  useEffect(() => {if (!readOnly) void controller.loadOptions();}, [controller, readOnly]);
  const context = s.chat.context || s.context;
  const cwd = context?.cwd || s.session?.cwd || controller.options.target?.cwd;
  const model = context?.model || s.session?.model;
  const effort = context?.reasoningEffort || s.session?.reasoningEffort;
  const settings = s.session ? s.settings : newConversationSettings(s.settings, s.defaults);
  const usesSavedModel = !s.session && (!s.settings.model || s.settings.model === s.defaults.model);
  const nextModel = settings.model || model;
  const selectedModel = findChatModel(s.models, nextModel);
  const modelName = selectedModel?.displayName || nextModel || selectedModel?.model;
  const inheritedEffort = !s.session || nextModel !== model ? selectedModel?.defaultReasoningEffort : effort;
  const nextEffort = settings.effort || inheritedEffort;
  const nextMode = s.settings.mode || context?.mode;
  const defaultLabel = uiText("默认");
  const scoped = managedDirectories && s.provider === "codex";
  const assistant = controller.isYoluAssistant();
  const permissions = permissionChoices(s.provider).filter(choice => !assistant || choice.value !== "full");
  const permission = permissions.find(p => p.value === (s.session ? s.settings.permission : settings.permission));
  const effectivePermission = permission || permissions.find(p => p.value === (s.session ? contextPermission(context) : undefined));
  const defaultPermissionLabel = scoped ? uiText("按目录授权") : defaultLabel;
  const permissionLabel = effectivePermission?.label || defaultPermissionLabel;
  const defaultPermissionOption: SettingChoice = scoped && !s.session
    ? {value: "", label: uiText("按目录授权"), description: uiText("在对话顶部查看或更改目录访问权限。")}
    : {value: "", label: defaultLabel};
  const selectedPermissionValue = effectivePermission?.value || "";
  const tierOptions = s.provider === "codex" ? selectedModel?.serviceTiers || [] : [];
  const selectedTier = tierOptions.find(tier => tier.id === settings.serviceTier);
  const tiers = tierOptions.filter((tier, index, all) => tier.id && all.findIndex(item => item.id === tier.id) === index);
  const unreported = s.provider === "agy" ? uiText("Antigravity 未报告") : uiText("Codex 未报告");
  const changed = Object.values(s.settings).some(Boolean);
  const nextTurnChanged = nextModel !== model || nextEffort !== effort || nextMode !== context?.mode ||
    (!!permission && permission.value !== contextPermission(context)) || (!!selectedTier && selectedTier.id !== context?.serviceTier);
  const disabled = s.submitting || !!s.session?.archived;
  const modelOptions = s.models.map(m => ({value: m.model, label: m.displayName || m.model}));
  if (nextModel && !modelOptions.some(m => m.value === nextModel)) modelOptions.unshift({value: nextModel, label: modelName || nextModel});
  if (!s.session || !nextModel) modelOptions.unshift({value: "", label: defaultLabel});
  const efforts = [...new Set([
    ...(selectedModel?.supportedReasoningEfforts || []).map(e => e.reasoningEffort),
    ...(nextEffort ? [nextEffort] : []),
  ])].map(value => ({value, label: effortLabel(value)}));
  if (!s.session || !nextEffort) efforts.unshift({value: "", label: defaultLabel});
  const modes = [...new Set([...(nextMode ? [nextMode] : []), ...s.modes])].map(value => ({value, label: modeLabel(value)}));
  modes.unshift({value: "", label: uiText("默认")});
  const summaryModel = modelName || defaultLabel;
  const summaryEffort = effortLabel(nextEffort);
  const speedLabel = selectedTier ? serviceTierLabel(selectedTier) : tiers.length ? defaultLabel : uiText("由模型决定");
  const ProviderIcon = providerIcons[s.provider];
  const PermissionIcon = effectivePermission ? permissionIcons[effectivePermission.value] : ShieldIcon;
  const SpeedIcon = isFastTier(selectedTier?.id) ? ZapIcon : GaugeIcon;
  const summary = [
    providerLabel(s.provider),
    `${uiText("模型")} · ${summaryModel}`,
    summaryEffort && `${uiText("思考强度")} · ${summaryEffort}`,
    !readOnly && `${uiText("权限")} · ${permissionLabel}`,
    !readOnly && `${uiText("响应速度")} · ${speedLabel}`,
  ].filter(Boolean).join(" / ");
  return <Popover.Root onOpenChange={open => {if (open) void controller.loadOptions();}}>
    <Popover.Trigger asChild><Button type="button" variant="ghost" size="sm" className="chat-context-trigger chat-settings-trigger" aria-label={uiText("上下文与设置")}
      aria-description={summary} title={summary}>
      <ProviderIcon aria-hidden="true" />
      <span className="chat-settings-model-brief"><span className="chat-settings-model-prefix">{summaryModel.slice(0, -9)}</span><span className="chat-settings-model-suffix">{summaryModel.slice(-9)}</span></span>
      {summaryEffort && <span className="chat-settings-effort-brief">{summaryEffort}</span>}
      {!readOnly && <span className="chat-settings-state-icons" aria-hidden="true">
        <PermissionIcon data-danger={effectivePermission?.danger || undefined} />
        <SpeedIcon data-active={!!selectedTier || undefined} />
      </span>}
      {s.chat.busy && nextTurnChanged && <span className="chat-next-turn">{uiText("下轮")}</span>}
      <ChevronDownIcon aria-hidden="true" />
    </Button></Popover.Trigger>
    <Popover.Portal container={portal.current}><Popover.Content className="shadcn-scope chat-control-overlay chat-settings-popover chat-coding-settings" align="end" side={readOnly ? "bottom" : "top"} sideOffset={8} collisionPadding={12} aria-labelledby={title}>
      <header className="chat-setting-header"><h3 id={title}>{uiText("对话设置")}</h3><Popover.Close asChild><Button type="button" variant="ghost" size="icon" aria-label={uiText("关闭设置")}><XIcon aria-hidden="true" /></Button></Popover.Close></header>
      <div className="chat-setting-body">
        {!readOnly && <>
          <SettingPicker portal={portal} summary={uiText("模型")} display={summaryModel} label={uiText("下轮模型")} options={modelOptions} value={s.session ? nextModel || "" : s.settings.model || ""} disabled={disabled || s.optionsLoading} onChange={value => controller.setSettings({...s.settings, model: value && (!s.session || value !== model) ? value : undefined, effort: undefined, serviceTier: undefined, useModelEffort: undefined, useDefaultSpeed: undefined})} />
          <div className="chat-setting-line"><strong>{uiText("思考强度")}</strong>{s.provider === "agy" && !selectedModel?.supportedReasoningEfforts?.length
            ? <span className="chat-setting-unavailable">{uiText("由模型决定")}</span>
            : <SettingChoices label={uiText("下轮思考强度")} options={efforts} value={(s.session ? nextEffort : settings.effort) || ""} disabled={disabled || s.optionsLoading || !selectedModel} onChange={value => controller.setSettings({
              ...s.settings,
              effort: value && (!s.session || value !== inheritedEffort) ? value : undefined,
              useModelEffort: !value && usesSavedModel && s.defaults.effort ? true : undefined,
            })} />}</div>
          <div className="chat-setting-line"><strong>{uiText("响应速度")}</strong>{tiers.length
            ? <SettingChoices label={uiText("响应速度")} options={[{value: "", label: uiText("默认")}, ...tiers.map(tier => ({value: tier.id, label: serviceTierLabel(tier)}))]} value={selectedTier?.id || ""} disabled={disabled || s.optionsLoading} onChange={value => controller.setSettings({
              ...s.settings,
              serviceTier: value || undefined,
              useDefaultSpeed: !value && usesSavedModel && s.defaults.serviceTier ? true : undefined,
            })} />
            : <span className="chat-setting-unavailable">{uiText("由模型决定")}</span>}</div>
          <SettingPicker portal={portal} summary={uiText("权限")} display={permissionLabel} danger={effectivePermission?.danger} label={uiText("权限设置")} options={[defaultPermissionOption, ...permissions]} value={selectedPermissionValue} disabled={disabled} onChange={value => controller.setSettings({
            ...s.settings,
            permission: value && (!s.session || value !== contextPermission(context)) ? (value as PermissionMode) : undefined,
            useDefaultPermission: !value && !s.session && s.defaults.permission ? true : undefined,
          })} />
          <details className="chat-setting-more"><summary>{uiText("工作模式")}</summary><SettingChoices label={uiText("下轮工作模式")} options={modes} value={nextMode || ""} disabled={disabled || s.optionsLoading} onChange={value => controller.setSettings({...s.settings, mode: value && value !== context?.mode ? value : undefined})} /></details>
        </>}
        {(readOnly || s.session) && <Collapsible.Root className="chat-setting-more"><Collapsible.Trigger className="chat-context-disclosure flex w-full items-center justify-between text-xs">{uiText("当前上下文与权限")}<ChevronDownIcon aria-hidden="true" /></Collapsible.Trigger><Collapsible.Content>
          <dl className="chat-context-facts mt-3 grid gap-2 text-xs"><dt>{uiText("对话引擎")}</dt><dd>{providerLabel(s.provider)}</dd><dt>{uiText("主工作目录")}</dt><dd>{isGeneralConversationDirectory(cwd) ? uiText("普通对话") : cwd || uiText("所选项目目录")}</dd><dt>{uiText("额外工作目录")}</dt><dd>{context?.additional_directories?.join("、") || uiText("未报告额外目录")}</dd><dt>{uiText("当前模型 / 思考强度")}</dt><dd>{model || unreported} / {effort ? effortLabel(effort) : uiText("未获取思考强度")}</dd><dt>{uiText("当前工作模式")}</dt><dd>{modeLabel(context?.mode)}</dd><dt>{uiText("审批策略")}</dt><dd>{approvalLabel(context?.approvalPolicy, s.provider)}</dd><dt>{uiText("批准方式")}</dt><dd>{context?.approvalsReviewer === "auto_review" || context?.approvalsReviewer === "guardian_subagent" ? uiText("帮我批准") : context?.approvalsReviewer === "user" ? uiText("手动批准") : unreported}</dd><dt>{uiText("沙箱")}</dt><dd>{context?.sandbox?.type || unreported}</dd></dl>
        </Collapsible.Content></Collapsible.Root>}
      </div>
      {!readOnly && !s.session && !assistant && <div className="chat-setting-creation">
        <div className="chat-setting-line">
          <strong>{uiText("新建时选择引擎")}</strong>
          <SettingChoices label={uiText("对话引擎")} options={[
            {value: "codex", label: providerLabel("codex"), icon: providerIcons.codex},
            {value: "agy", label: providerLabel("agy"), icon: providerIcons.agy},
          ]} value={s.provider} disabled={disabled} onChange={value => controller.setProvider(value as AgentProvider)} />
        </div>
      </div>}
      {!readOnly && (changed || (s.chat.busy && nextTurnChanged)) && <footer className="chat-setting-footer">
        {s.chat.busy && nextTurnChanged && <p>{uiText("下轮生效")}</p>}
        {changed && <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => controller.setSettings({})}>{s.session ? uiText("恢复当前设置") : uiText("恢复默认设置")}</Button>}
      </footer>}
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
      <DropdownMenu.Trigger asChild><TooltipIconButton ref={trigger} data-chat-menu-trigger tooltip={uiText("更多对话操作")} aria-label={uiText("更多对话操作")} disabled={s.managing}><MoreHorizontalIcon /></TooltipIconButton></DropdownMenu.Trigger>
      <DropdownMenu.Portal container={portal.current}><DropdownMenu.Content className={`${overlayClass} chat-session-menu`} align="end" sideOffset={8} collisionPadding={12} onCloseAutoFocus={event => {if (editor || searchSelected.current) event.preventDefault(); searchSelected.current = false;}}>
        <DropdownMenu.Item className="chat-menu-item" onSelect={() => {searchSelected.current = true; onSearch();}}><SearchIcon />{uiText("查找消息")}</DropdownMenu.Item>
        <DropdownMenu.Item className="chat-menu-item" disabled={s.loading} onSelect={() => void controller.history()}><RefreshCwIcon />{uiText("刷新历史")}</DropdownMenu.Item>
        {!readOnly && <>
        <DropdownMenu.Separator className="my-1 border-t" />
        <DropdownMenu.Item className="chat-menu-item" onSelect={() => openEditor("rename")}><PencilIcon />{uiText("重命名")}</DropdownMenu.Item>
        <DropdownMenu.Item className="chat-menu-item" onSelect={() => void controller.manage(s.session?.pinned ? "unpin" : "pin")}>{s.session.pinned ? <PinOffIcon /> : <PinIcon />}{s.session.pinned ? uiText("取消固定") : uiText("固定对话")}</DropdownMenu.Item>
        {s.capabilities.fork && <DropdownMenu.Item className="chat-menu-item" disabled={s.chat.busy || s.submitting || s.session.archived} onSelect={() => openEditor("fork")}><GitForkIcon />{uiText("从历史分叉")}</DropdownMenu.Item>}
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
export const ChatControls = memo(ChatControlsView);
