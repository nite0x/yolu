import { uiText, uiLocale } from "../i18n";
import { ConversationKindSwitch } from "./conversation-surface"
import { ShortcutBadge } from "./shortcut-icons"
import { Plus, Search, ArrowLeft, X, ChevronDown, ChevronRight, Pin, PinOff, GitBranch, RotateCw, Check, Folder, Ellipsis, MessageSquare, CircleAlert, Files, Maximize2, LoaderCircle, CircleHelp, CircleStop, ArrowRightLeft, CircleCheck, Columns2, SquarePen, ListFilter as ListFilterIcon, type LucideIcon } from "lucide-react"
import { ListCreateButton, ListFilter, ListSearch } from "./list-controls"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "./shared"
import { SessionHistoryPanel, type Session } from "./sessions"

import type { ConversationTreeRow } from "./conversation-tree"
import { conversationPathKey } from "./conversation-runtime"

export interface ConversationScope { kind: string; id?: string; name: string; cwd?: string; environment?: string; environmentName?: string }
export function SessionBrowser() {
  return <><div className="session-browser shadcn-scope" id="sessionBrowser" data-pane="list" hidden>
    <div className="session-browser-body">
      <aside className="session-browser-list" id="sessionBrowserListPane" aria-label={uiText("对话列表")}><div className="session-browser-list-tools">
        <span id="sessionBrowserCount" className="sr-only" role="status" aria-live="polite" />
        <p id="sessionBrowserContext" className="sr-only" />
        <ListSearch variant="plain" id="sessionBrowserScopeBar" input="sessionBrowserSearch" label={uiText("搜索对话、项目或分支")} placeholder={uiText("搜索对话…")} clear={{ id:"sessionSearchClear", "data-conversation-action":"clear-search" }} filter={
          <ListFilter id="sessionScopePicker" label={uiText("切换对话范围")} descriptionID="sessionScopeLabel" description={uiText("全部对话")} menuClass="session-scope-menu" icon={<ListFilterIcon aria-hidden="true" />}>
            <Label className="sr-only" htmlFor="sessionScopeSearch">{uiText("切换对话范围")}</Label><Input id="sessionScopeSearch" className="h-[32px] text-[12px] shadow-none focus-visible:ring-2 focus-visible:ring-ring/20" type="search" placeholder={uiText("搜索工作区、项目或目录")} /><Button type="button" variant="ghost" size="sm" data-conversation-action="all" id="sessionScopeAll" hidden>{uiText("查看全部对话")}</Button>
          <div id="sessionScopeOptions" />
          <div className="session-scope-filters">
            <label id="sessionEnvironmentField" className="session-environment-label" hidden><span>{uiText("执行环境")}</span><NativeSelect id="sessionsEnvironment" aria-label={uiText("筛选对话环境")}><option value="">{uiText("全部环境")}</option></NativeSelect></label>
            <label className="session-browser-archive"><input id="sessionBrowserArchived" type="checkbox" aria-label={uiText("查看已归档对话")} /><span>{uiText("仅查看已归档对话")}</span></label>
            <div id="sessionStatusFilters" className="session-status-filters" role="group" aria-label={uiText("按对话状态筛选")}>{[["all", uiText("全部")], ["running", uiText("进行中")], ["waiting", uiText("待确认")], ["unread", uiText("未读")]].map(([value, label]) => <button key={value} type="button" data-conversation-status={value} aria-pressed={value === "all"}>{label}<span data-status-count={value} hidden /></button>)}</div>
            <Button type="button" variant="ghost" size="sm" id="sessionClearFilters" data-conversation-action="clear-filters" hidden>{uiText("清除筛选")}</Button>
            <div id="workspaceConversationTools" hidden><Button type="button" variant="ghost" size="sm" className="justify-start text-xs" id="linkWorkspaceConversation" data-session-action="picker" aria-label={uiText("关联已有对话")}>{uiText("关联已有对话")}</Button></div>
          </div>
          </ListFilter>
        } actions={<>
          <ListCreateButton id="newBrowserSplitSession" data-conversation-action="new" data-conversation-placement="split" label={uiText("在右侧分栏新建")} icon={<Columns2 aria-hidden="true" />} />
          <ListCreateButton id="newBrowserSession" data-conversation-action="new" label={uiText("新建对话")} icon={<SquarePen aria-hidden="true" />} />
        </>} />
        <div id="sessionActiveFilterLabel" className="session-active-filter-label" hidden><span id="sessionActiveFilterText" /><button type="button" data-conversation-action="clear-scope-filters" aria-label={uiText("清除范围与筛选")} title={uiText("清除范围与筛选")}><X aria-hidden="true" /></button></div>
      </div><div id="sessionBrowserError" role="alert" hidden /><div id="sessionBrowserList" aria-label={uiText("对话结果")} /></aside>
      <div id="sessionBrowserResize" className="session-browser-resize" role="separator" tabIndex={0} aria-label={uiText("调整对话列表宽度")} aria-orientation="vertical" aria-controls="sessionBrowserListPane" aria-valuemin={220} aria-valuemax={520} aria-valuenow={280} />
      <section className="session-browser-detail" aria-label={uiText("对话详情")}>
        <div className="session-reading-toolbar"><div className="session-browser-mobile-back"><Button type="button" size="sm" variant="ghost" data-conversation-action="back"><ArrowLeft aria-hidden="true" />{uiText("对话列表")}</Button></div></div>
        <div className="session-reading-layout" id="sessionReadingLayout"><div className="session-reading-chat">
        <div className="shrink-0">
          <div id="sessionCreationSetup" className="conversation-creation-setup">
            <div id="conversationCreationKind" hidden><ConversationKindSwitch kind="ui" /></div>
            <div id="sessionBrowserNewDirectoryField" className="session-browser-new-directory" hidden><span id="sessionBrowserNewDirectoryLabel">{uiText("工作目录")}</span><div id="sessionBrowserDirectoryChoices" className="creation-choices" role="group" aria-labelledby="sessionBrowserNewDirectoryLabel" /><select id="sessionBrowserNewDirectory" hidden aria-label={uiText("工作目录")} /></div>
            <details id="sessionBrowserAdditionalField" className="session-browser-new-directory session-creation-additional" hidden><summary>{uiText("可访问的其他项目目录")}<span id="sessionBrowserAdditionalCount" /></summary><div id="sessionBrowserAdditionalDirectories" /></details>
          </div>
        </div>
        <div id="sessionBrowserEmpty" className="session-browser-empty" role="status">{uiText("选择一个对话，或新建对话开始工作。")}</div>
        <aside id="sessionHistoryPanel" className="session-history-panel shadcn-scope" role="region" aria-labelledby="sessionHistoryTitle" hidden><SessionHistoryPanel /></aside>
        </div><div id="conversationFilesResize" className="reading-splitter conversation-files-resize" role="separator" tabIndex={0} aria-label={uiText("调整对话与文件区域大小")} aria-orientation="vertical" aria-controls="conversationFilesDock" hidden /><div id="conversationFilesDock" className="conversation-files-dock" hidden><aside id="conversationFilesPane" className="conversation-files-pane" aria-labelledby="conversationFilesTitle">
          <header className="conversation-files-heading"><h3 id="conversationFilesTitle"><Files aria-hidden="true" />{uiText("文件与改动")}</h3><div><Button type="button" size="sm" variant="ghost" id="expandConversationFiles" aria-label={uiText("全屏查看文件")} aria-pressed={false}><Maximize2 aria-hidden="true" />{uiText("全屏")}</Button><Button type="button" size="icon-sm" variant="ghost" id="closeConversationFiles" aria-label={uiText("关闭文件面板")}><X aria-hidden="true" /></Button></div></header>
          <div id="conversationFilesMount" />
        </aside></div></div>
      </section>
    </div>
  </div><dialog id="conversationFilesDialog" className="conversation-files-dialog shadcn-scope" aria-labelledby="conversationFilesTitle" /></>
}
export function ConversationList({ sessions, rows, selected, showDirectory, showContext = true, loading, workspaceID, filtered, error, canCreate = true, parallel = false, parallelSessions = [], parallelFull = false, now = Date.now(), onSelect }: { onSelect?: (id: string) => void; sessions: Session[]; rows?: ConversationTreeRow[]; selected?: string | null; showDirectory: boolean; showContext?: boolean; loading?: boolean; workspaceID?: string; filtered?: boolean; error?: boolean; canCreate?: boolean; parallel?: boolean; parallelSessions?: string[]; parallelFull?: boolean; now?: number }) {
  if (!sessions.length && !rows?.length) return <div className="session-browser-empty-list" role="status">
    {loading ? <RotateCw className="session-list-loading" aria-hidden="true" /> : error ? <CircleAlert aria-hidden="true" /> : filtered ? <Search aria-hidden="true" /> : <MessageSquare aria-hidden="true" />}
    <strong>{loading ? uiText("正在读取对话…") : error ? uiText("暂时无法读取对话") : filtered ? uiText("没有匹配的对话") : workspaceID ? uiText("还没有关联的对话") : uiText("还没有对话")}</strong>
    <p>{loading ? uiText("正在同步各执行环境的记录") : error ? uiText("检查执行环境连接后重试。") : filtered ? uiText("试试其他关键词，或清除筛选条件。") : canCreate ? uiText("新建对话，从当前工作现场开始。") : uiText("当前范围暂无对话，可切换范围查看。")}</p>
    {!loading && (error || filtered || canCreate) && <Button type="button" variant="outline" size="sm" data-conversation-action={error ? "refresh" : filtered ? "reset-list" : "new"}>{error ? uiText("重新加载") : filtered ? uiText("清除搜索与筛选") : uiText("新建对话")}</Button>}
    {workspaceID && !loading && !error && !filtered && <Button type="button" variant="outline" size="sm" data-conversation-action="link-workspace">{uiText("关联已有对话")}</Button>}
  </div>
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const week = new Date(today)
  week.setDate(week.getDate() - 6)
  const group = (s: Session) => s.pinned ? uiText("已固定") : !s.updated_at ? uiText("更早") : s.updated_at * 1000 >= +today ? uiText("今天") : s.updated_at * 1000 >= +yesterday ? uiText("昨天") : s.updated_at * 1000 >= +week ? uiText("近 7 天") : uiText("更早")
  const groups = [uiText("已固定"), uiText("今天"), uiText("昨天"), uiText("近 7 天"), uiText("更早")].map(label => ({label, items: sessions.filter(s => group(s) === label)})).filter(g => g.items.length)
  const renderSession = (s: Session, row?: ConversationTreeRow) => {
    const sessionWorkspaceID = row?.group.workspaceID || workspaceID
    const directoryContext = row?.group.showContext ?? showContext
    const state = s.terminal ? s.terminal.attached ? "attached" : "running" : s.chat_status || "idle"
    const status = ({
      starting: {label: uiText("正在连接"), icon: LoaderCircle},
      running: {label: uiText("运行中"), icon: LoaderCircle},
      waiting: {label: uiText("待确认"), icon: CircleHelp},
      stopping: {label: uiText("正在停止"), icon: LoaderCircle},
      handoff: {label: uiText("等待交接"), icon: ArrowRightLeft},
      failed: {label: uiText("本轮未完成"), icon: CircleAlert},
      interrupted: {label: uiText("已停止"), icon: CircleStop},
      unknown: {label: uiText("状态待核实"), icon: CircleHelp},
      attached: {label: uiText("已打开"), icon: CircleCheck},
    } as Record<string, {label: string; icon: LucideIcon}>)[state]
    const StatusIcon = status?.icon
    const showProject = directoryContext && !!s.context?.project
    const showPath = showDirectory && directoryContext && !s.context?.project
    const showEnvironment = !!s.environment_name && !row?.group.environmentName
    const isParallel = parallel && parallelSessions.includes(s.browser_key || s.id)
    const directory = s.cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || s.cwd
    const key = s.browser_key || s.id
    const date = s.updated_at ? new Date(s.updated_at * 1000) : null
    const dateLabel = date ? date >= today ? date.toLocaleTimeString(uiLocale(), {hour: "2-digit", minute: "2-digit", hour12: false}) : date >= yesterday ? uiText("昨天") : date.toLocaleDateString(uiLocale(), {year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined, month: "numeric", day: "numeric"}) : ""
    return <li key={key} className={parallel ? "parallel-list-item" : sessionWorkspaceID && !s.terminal ? "has-session-menu" : undefined}><button type="button" className="session-browser-item" data-conversation-list-row={row?.key} data-conversation-session={onSelect ? undefined : key} onClick={onSelect ? () => onSelect(key) : undefined} data-conversation-terminal={s.terminal ? s.id : undefined} data-environment={s.environment_id} data-parallel-member={isParallel || undefined} aria-pressed={selected === key} aria-description={isParallel ? uiText("已并列") : undefined} title={`${s.name || uiText("未命名对话")}\n${s.environment_name || ""}\n${s.cwd}${s.context?.branch ? `\n${s.context.branch}` : ""}${isParallel ? `\n${uiText("已并列")}` : ""}`}>
      <span className="session-browser-item-heading">
        {s.terminal && <span className="sr-only">{uiText("终端")}</span>}
        <span className="session-browser-item-title" title={s.name || uiText("未命名对话")}>{s.name || uiText("未命名对话")}</span>
        {s.provider === "agy" && <span className="session-browser-environment" title="Antigravity (AGY)">AGY</span>}
        <span className="session-browser-item-status" data-session-indicators={s.terminal ? undefined : s.id} data-environment={s.environment_id}
          data-state={state} role="img" aria-label={status?.label} title={status?.label} hidden={!status}>
          {StatusIcon && <StatusIcon aria-hidden="true" />}
        </span>
        {s.unread && !status && <span className="session-browser-unread-dot" role="img" aria-label={uiText("有新消息")} title={uiText("有新消息")} />}
        <time className="session-browser-item-time" title={date?.toLocaleString(uiLocale(), {hour12: false})} dateTime={date?.toISOString()}>{dateLabel}</time>
      </span>
      {(showProject || showPath || showEnvironment) && <span className="session-browser-item-meta">
        {showProject && <span className="session-browser-item-project" title={`${s.cwd}${s.context?.branch ? `\n${s.context.branch}` : ""}`}>
          <span>{s.context?.project}</span>{s.context?.branch && <span className="session-browser-item-branch"><GitBranch aria-hidden="true" /><span>{s.context.branch}</span></span>}
        </span>}
        {showPath && <span className="session-browser-item-directory" title={s.cwd}>{directory}</span>}
        {showEnvironment && <span className="session-browser-environment" title={s.environment_name}>{s.environment_name}</span>}
      </span>}
      {s.error ? <span className="table-message">{s.error}</span> : null}
    </button>{parallel ? <Button type="button" variant="ghost" size="icon-sm" className="parallel-list-add" data-conversation-parallel={key} data-conversation-terminal={s.terminal ? s.id : undefined} data-parallel-open={isParallel || undefined} disabled={s.available === false || parallelFull && !isParallel} aria-label={isParallel ? uiText("定位对话：{0}", s.name) : uiText("将对话加入并列：{0}", s.name)} title={isParallel ? `${uiText("已并列")} · ${uiText("定位到对应栏")}` : parallelFull ? uiText("最多并列三个对话，可在栏标题中更换") : uiText("加入右侧并列")}>
      {isParallel ? <Columns2 aria-hidden="true" /> : <Plus aria-hidden="true" />}
    </Button> : sessionWorkspaceID && !s.terminal ? <details className="session-item-menu" data-session-menu={row?.key || key}><summary aria-label={uiText("对话操作：{0}", s.name || uiText("未命名对话"))} title={uiText("对话操作")}><Ellipsis aria-hidden="true" /></summary><div><Button type="button" variant="ghost" size="sm" data-conversation-unlink={s.id} data-environment={s.environment_id} data-workspace={sessionWorkspaceID} aria-label={uiText("取消关联 {0}", s.name || uiText("未命名对话"))}>{uiText("取消关联")}</Button></div></details> : null}</li>
  }
  if (rows) {
    const sections = new Map<string, { group: ConversationTreeRow["group"]; rows: ConversationTreeRow[] }>()
    for (const row of rows) {
      let section = sections.get(row.group.key)
      if (!section) { section = {group: row.group, rows: []}; sections.set(row.group.key, section) }
      section.rows.push(row)
    }
    return <div className="session-browser-groups session-browser-workspaces">{[...sections.values()].map(({group, rows}) => <section className="session-browser-group" key={group.key} data-conversation-group={group.key} aria-label={`${group.name}${group.environmentName ? ` · ${group.environmentName}` : ""}`}>
      {rows.filter(row => row.kind === "group").map(row => <h3 className="session-workspace-heading" key={row.key}>
        {group.href ? <a href={group.href} className="session-collection-link" data-collection-href={group.href} data-collection-environment={group.environment} title={group.name}>
          {group.identity ? <ShortcutBadge name={group.iconName || group.name} identity={group.identity} appearance={group.icon} /> : <Folder aria-hidden="true" />}
          <span className="session-workspace-name">{group.name}</span>
          {group.environmentName && <small>{group.environmentName}</small>}
        </a> : null}
        <button type="button" data-conversation-group-toggle={group.key} data-conversation-list-row={row.key} aria-expanded={!group.collapsed}
          aria-label={group.href ? uiText("展开或折叠 {0} 的对话", group.name) : undefined} className={group.href ? "session-collection-toggle" : undefined}
          title={group.name}>
          {group.collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {!group.href ? <span className="session-workspace-name">{group.name}</span> : null}
          <span className="session-workspace-count">{group.total}</span>
          {!group.href && group.environmentName && <small>{group.environmentName}</small>}
        </button>
      </h3>)}
      <ul className="session-browser-items">{rows.filter(row => row.kind === "session").map(row => renderSession(row.session, row))}</ul>
      {rows.filter(row => row.kind === "more").map(row => <button type="button" className="session-workspace-more" key={row.key} data-conversation-group-more={group.key} data-conversation-list-row={row.key}>{uiText("更多对话（{0}）", group.total - group.shown)}</button>)}
    </section>)}</div>
  }
  return <div className="session-browser-groups">{groups.map(g => <section className="session-browser-group" key={g.label} aria-label={g.label}>
    <h3 className="session-browser-group-heading">{g.label === uiText("已固定") && <Pin aria-hidden="true" />}{g.label}<span>{g.items.length}</span></h3>
    <ul className="session-browser-items">{g.items.map(s => renderSession(s))}</ul></section>)}</div>
}
export function ConversationScopes({ scopes, selected }: { scopes: ConversationScope[]; selected?: Pick<ConversationScope, "kind" | "id" | "cwd" | "environment"> }) {
  const renderScope = (scope: ConversationScope) => {
    const path = scope.cwd?.replace(/\\/g, "/").replace(/\/+$/, "") || ""
    const name = scope.kind === "directory" ? path.split("/").pop() || scope.cwd || scope.name : scope.name
    const parent = scope.kind === "directory" ? path.split("/").slice(0, -1).join("/") : ""
    const context = [parent, scope.environmentName].filter(Boolean).join(" · ")
    const current = scope.kind === selected?.kind && (scope.kind === "all" || scope.environment === selected.environment && scope.id === selected.id && conversationPathKey(scope.cwd || "") === conversationPathKey(selected.cwd || ""))
    return <Button key={JSON.stringify([scope.environment, scope.kind, scope.id, scope.cwd])} type="button" variant="ghost" className="session-scope-option h-auto w-full justify-start whitespace-normal px-2 py-1.5 text-left font-normal" data-conversation-scope={JSON.stringify(scope)} aria-current={current ? "true" : undefined} title={scope.cwd || scope.name}>
      <span className="session-scope-option-copy"><span className="session-scope-option-title">{name}</span>{context && <small className="session-scope-option-context">{context}</small>}</span>
    </Button>
  }
  return <>{scopes.filter(scope => scope.kind === "all").map(renderScope)}
    {[["workspace", uiText("工作区")], ["project", uiText("项目")], ["directory", uiText("工作目录")]].map(([kind, label]) => {
      const items = scopes.filter(scope => scope.kind === kind)
      return items.length ? <section className="session-scope-group" key={kind} aria-label={label}><h3>{label}</h3>{items.map(renderScope)}</section> : null
    })}
  </>
}
