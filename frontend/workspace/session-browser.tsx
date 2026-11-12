import { uiText, uiLocale } from "../i18n";
import { ConversationKindSwitch } from "./conversation-surface"
import { ShortcutBadge, ShortcutIconSettingsButton, defaultShortcutIcon, type ShortcutIcon } from "./shortcut-icons"
import { Plus, Search, ArrowLeft, X, ChevronDown, ChevronRight, Pin, PinOff, GitBranch, SlidersHorizontal, RotateCw, Check, Folder, Ellipsis, MessageSquare, CircleAlert, Files, Maximize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "./shared"
import { SessionHistoryPanel, type Session } from "./sessions"

import type { ConversationTreeRow } from "./conversation-tree"

export interface ConversationScope { kind: string; id?: string; name: string; cwd?: string; environment?: string }
export function SessionBrowser() {
  return <><div className="session-browser shadcn-scope" id="sessionBrowser" data-pane="list" hidden>
    <div className="session-browser-body">
      <aside className="session-browser-list" id="sessionBrowserListPane" aria-label={uiText("对话列表")}><div className="session-browser-list-tools">
        <div className="session-browser-list-heading"><strong>{uiText("对话")}</strong>
          <div className="session-browser-heading-actions">
            <Button type="button" size="sm" className="h-[30px] rounded-r-none" id="newBrowserSession" data-conversation-action="new" aria-label={uiText("新建对话")}><Plus aria-hidden="true" /><span>{uiText("新建对话")}</span></Button>
            <details id="sessionActionPicker" className="session-action-picker"><summary aria-label={uiText("更多对话操作")} title={uiText("选择新建方式或关联对话")}><ChevronDown aria-hidden="true" /></summary>
              <div className="session-action-menu" role="group" aria-label={uiText("对话操作")}>
                <Button type="button" variant="ghost" size="sm" className="justify-start" data-conversation-action="new" data-conversation-placement="tab">{uiText("在新标签页新建")}<span className="session-action-default">{uiText("默认")}</span></Button>
                <Button type="button" variant="ghost" size="sm" className="justify-start" data-conversation-action="new" data-conversation-placement="split">{uiText("在右侧分栏新建")}</Button>
                <Button type="button" variant="ghost" size="sm" className="justify-start" data-conversation-action="new" data-conversation-placement="current">{uiText("在当前标签页新建")}</Button>
                <div id="taskConversationTools" className="session-action-association" hidden>
                  <Button type="button" variant="ghost" size="sm" className="justify-start" id="linkTaskConversation" data-session-action="picker" aria-label={uiText("关联已有对话")}>{uiText("关联已有对话")}</Button>
                </div>
              </div>
            </details>
          </div>
        </div>
    <div className="session-browser-scope" id="sessionBrowserScopeBar">
      <details className="session-scope-picker" id="sessionScopePicker"><summary aria-label={uiText("切换对话范围")}><Folder aria-hidden="true" /><span id="sessionScopeLabel">{uiText("全部对话")}</span><ChevronDown aria-hidden="true" /></summary>
        <div className="session-scope-menu" popover="manual"><Label htmlFor="sessionScopeSearch">{uiText("切换对话范围")}</Label><Input id="sessionScopeSearch" type="search" placeholder={uiText("搜索任务、项目或目录")} /><Button type="button" variant="ghost" size="sm" data-conversation-action="all" id="sessionScopeAll" hidden>{uiText("查看全部对话")}</Button><div id="sessionScopeOptions" /></div>
      </details>
      <Button type="button" variant="ghost" size="sm" id="pinConversationDirectory" data-conversation-action="pin-directory" hidden><Pin aria-hidden="true" /><span>{uiText("固定此目录")}</span></Button>
    </div>
        <p id="sessionBrowserContext" className="sr-only" />
        <div className="session-browser-search-row">
          <div className="session-browser-search"><Search aria-hidden="true" /><label className="sr-only" htmlFor="sessionBrowserSearch">{uiText("搜索对话、项目或分支")}</label><Input id="sessionBrowserSearch" className="px-8" type="search" placeholder={uiText("搜索对话、项目或分支")} autoComplete="off" /><button type="button" id="sessionSearchClear" data-conversation-action="clear-search" aria-label={uiText("清除搜索")} title={uiText("清除搜索")} hidden><X aria-hidden="true" /></button></div>
          <details id="sessionFilterPicker" className="session-filter-picker"><summary aria-label={uiText("筛选对话")} title={uiText("筛选环境、目录与归档")}><SlidersHorizontal aria-hidden="true" /><span id="sessionFilterCount" hidden /></summary><div className="session-filter-menu" role="group" aria-label={uiText("对话筛选条件")}>
            <div className="session-filter-heading"><strong>{uiText("筛选对话")}</strong><button type="button" data-conversation-action="close-filters" aria-label={uiText("关闭筛选")}><X aria-hidden="true" /></button></div>
            <label id="sessionEnvironmentField" className="session-environment-label" hidden><span>{uiText("执行环境")}</span><NativeSelect id="sessionsEnvironment" aria-label={uiText("筛选对话环境")}><option value="">{uiText("全部环境")}</option></NativeSelect></label>
            <label id="sessionDirectoryField"><span>{uiText("工作目录")}</span><NativeSelect id="sessionDirectoryFilter" aria-label={uiText("筛选工作目录")} /></label>
            <label className="session-browser-archive"><input id="sessionBrowserArchived" type="checkbox" aria-label={uiText("查看已归档对话")} /><span>{uiText("仅查看已归档对话")}</span></label>
            <p className="session-filter-hint">{uiText("筛选仅影响列表，运行中的对话会继续。")}</p>
          </div></details>
        </div>
        <div id="sessionStatusFilters" className="session-status-filters" role="group" aria-label={uiText("按对话状态筛选")}>{[["all", uiText("全部")], ["running", uiText("进行中")], ["waiting", uiText("待确认")], ["unread", uiText("未读")]].map(([value, label]) => <button key={value} type="button" data-conversation-status={value} aria-pressed={value === "all"}>{label}<span data-status-count={value} hidden /></button>)}</div>
        <p id="sessionActiveFilterLabel" className="session-active-filter-label" hidden />
        <div className="session-browser-list-caption"><span id="sessionBrowserCount" role="status" aria-live="polite" /><div className="session-browser-caption-actions"><Button type="button" variant="ghost" size="sm" id="sessionClearFilters" data-conversation-action="clear-filters" hidden>{uiText("清除筛选")}</Button><Button type="button" variant="ghost" size="icon" data-conversation-action="refresh" title={uiText("刷新对话列表")} aria-label={uiText("刷新对话列表")}><RotateCw aria-hidden="true" /></Button></div></div>
      </div><div id="sessionBrowserError" role="alert" hidden /><div id="sessionBrowserList" aria-label={uiText("对话结果")} /></aside>
      <div id="sessionBrowserResize" className="session-browser-resize" role="separator" tabIndex={0} aria-label={uiText("调整对话列表宽度")} aria-orientation="vertical" aria-controls="sessionBrowserListPane" aria-valuemin={220} aria-valuemax={520} aria-valuenow={280} />
      <section className="session-browser-detail" aria-label={uiText("对话详情")}>
        <div id="conversationCreationKind" hidden><ConversationKindSwitch kind="ui" /></div>
        <div className="session-reading-toolbar"><div className="session-browser-mobile-back"><Button type="button" size="sm" variant="ghost" data-conversation-action="back"><ArrowLeft aria-hidden="true" />{uiText("对话列表")}</Button></div></div>
        <div className="session-reading-layout" id="sessionReadingLayout"><div className="session-reading-chat">
        <div id="sessionBrowserNewDirectoryField" className="session-browser-new-directory" hidden><span id="sessionBrowserNewDirectoryLabel">{uiText("工作目录")}</span><div id="sessionBrowserDirectoryChoices" className="creation-choices" role="group" aria-labelledby="sessionBrowserNewDirectoryLabel" /><select id="sessionBrowserNewDirectory" hidden aria-label={uiText("工作目录")} /></div>
        <details id="sessionBrowserAdditionalField" className="session-browser-new-directory session-creation-additional" hidden><summary>{uiText("可访问的其他项目目录")}<span id="sessionBrowserAdditionalCount" /></summary><div id="sessionBrowserAdditionalDirectories" /></details>
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
interface ShortcutTask { environment?: string; appearance?: ShortcutIcon; id: string; name: string; projects: string; pinned: boolean; archived: boolean }
interface ShortcutDirectory { appearance?: ShortcutIcon; key?: string; environment?: string; cwd: string; name: string; parent: string; pinned: boolean }
export function ConversationShortcuts({ tasks, directories, pinnedDirectories, selected, selectedDirectory, search, archived, environment, kind }: {
  tasks: ShortcutTask[]; directories: ShortcutDirectory[]; pinnedDirectories: ShortcutDirectory[];
  selected?: string | null; selectedDirectory?: string | null; search: string; archived: boolean; environment: string;
  kind?: "task" | "directory";
}) {
  const pinned = tasks.filter(task => task.pinned && !task.archived)
  const query = search.trim().toLowerCase()
  const matches = (values: string[]) => values.join(" ").toLowerCase().includes(query)
  const visibleTasks = tasks.filter(task => (archived || !task.archived) && matches([task.name, task.projects, task.environment || ""]))
  const visibleDirectories = directories.filter(directory => matches([directory.cwd, directory.name, directory.parent]))
  const title = kind === "task" ? uiText("固定任务") : kind === "directory" ? uiText("固定项目目录") : uiText("固定入口")
  const searchLabel = kind === "task" ? uiText("搜索任务") : kind === "directory" ? uiText("搜索项目目录") : uiText("搜索任务或目录")
  return <section aria-labelledby="shortcutPinnedTitle">
    <div className="task-shortcuts-heading"><h2 id="shortcutPinnedTitle"><Pin aria-hidden="true" />{title}</h2>
      <ShortcutIconSettingsButton />
      <details id="taskShortcutPicker" className="task-shortcut-picker"><summary aria-label={kind ? uiText("管理{0}", title) : uiText("管理固定入口")} title={kind ? title : uiText("固定任务或目录")}><Plus aria-hidden="true" /></summary>
        <div className="task-shortcut-options" id="shortcutPickerPanel" popover="manual">
          <Label htmlFor="shortcutSearch">{searchLabel}</Label><Input id="shortcutSearch" type="search" placeholder={kind === "directory" ? uiText("目录名或路径") : uiText("任务名、项目名或路径")} defaultValue={search} />
          <p className="shortcut-picker-caption">{kind === "directory" ? uiText("{0} · 已固定 {1} 个目录", environment, pinnedDirectories.length) : uiText("{0} · {1} 个未归档任务 · 已固定 {2} 个", environment, tasks.filter(task => !task.archived).length, pinned.length)}</p>
          {kind !== "directory" && <label className="shortcut-archive-toggle"><input id="shortcutArchived" type="checkbox" defaultChecked={archived} />{uiText("显示归档任务")}</label>}
          <div className="shortcut-picker-results">
            {kind !== "directory" && <><h3>{uiText("任务")}</h3><div role="group" aria-label={uiText("固定任务")}>{visibleTasks.length ? visibleTasks.map(task => <button key={task.id} type="button" data-task-shortcut-pin={task.id} aria-pressed={task.pinned} disabled={task.archived && !task.pinned} title={task.archived ? uiText("取消归档后可固定") : task.projects}>
              <span><span className="shortcut-option-title">{task.name}{task.archived && <small>{" "}{uiText("· 已归档")}</small>}</span><small>{task.projects}{task.environment && ` · ${task.environment}`}</small></span><span className="shortcut-option-state">{task.pinned ? <><Check aria-hidden="true" />{uiText("已固定")}</> : uiText("固定")}</span>
            </button>) : <p className="conversation-shortcuts-empty">{query ? uiText("没有匹配的任务") : uiText("暂无任务")}</p>}</div></>}
            {kind !== "task" && <><h3>{uiText("目录")}</h3><div role="group" aria-label={uiText("固定目录")}>{visibleDirectories.length ? visibleDirectories.map(directory => <button key={directory.key || directory.cwd} type="button" data-directory-shortcut-pin={directory.key || directory.cwd} aria-pressed={directory.pinned} title={directory.cwd}>
              <span><span className="shortcut-option-title"><Folder aria-hidden="true" />{directory.name}</span><small>{directory.parent}</small></span><span className="shortcut-option-state">{directory.pinned ? <><Check aria-hidden="true" />{uiText("已固定")}</> : uiText("固定")}</span>
            </button>) : <p className="conversation-shortcuts-empty">{query ? uiText("没有匹配的目录") : uiText("暂无已登记的工作目录")}</p>}</div></>}
          </div>
        </div>
      </details>
    </div>
    {kind !== "directory" && (pinned.length ? <ul aria-label={uiText("固定任务")}>{pinned.map(task => <li key={task.id} className="conversation-shortcut-row">
      <button type="button" className="conversation-shortcut-open" data-shortcut-icon-key={JSON.stringify(["task", task.id])} data-shortcut-name={task.name} data-shortcut-icon={JSON.stringify(task.appearance || defaultShortcutIcon(JSON.stringify(["task", task.id])))} aria-label={uiText("任务：{0} · {1} · {2}", task.name, task.environment || "", task.projects)} data-task-shortcut={task.id} aria-current={selected === task.id ? "true" : undefined} title={uiText("{0}\n{1}\n{2}\n打开任务对话", task.name, task.projects, task.environment || "")}>
        <ShortcutBadge name={task.name} identity={JSON.stringify(["task", task.id])} appearance={task.appearance} /><span className="conversation-shortcut-copy"><span className="conversation-shortcut-title">{task.name}<small className="shortcut-entry-kind">{uiText("任务对话")}</small></span><span className="conversation-shortcut-context">{task.projects || uiText("任务对话")}{task.environment && ` · ${task.environment}`}</span></span>
      </button>
      <button type="button" className="conversation-shortcut-pin" data-task-shortcut-pin={task.id} aria-label={uiText("取消固定任务：{0}", task.name)} title={uiText("取消固定任务")}><PinOff aria-hidden="true" /></button>
    </li>)}</ul> : <p className="conversation-shortcuts-empty">{kind ? uiText("点击 + 固定任务") : uiText("点击 + 固定任务或目录")}</p>)}
    {kind !== "task" && pinnedDirectories.length > 0 && <>{!kind && <h3 className="shortcut-directory-heading">{uiText("目录")}</h3>}<ul aria-label={uiText("固定项目目录")}>{pinnedDirectories.map(directory => <li key={directory.key || directory.cwd} className="conversation-shortcut-row">
      <button type="button" className="conversation-shortcut-open" data-shortcut-icon-key={JSON.stringify(["directory", directory.key || directory.cwd])} data-shortcut-name={directory.name} data-shortcut-icon={JSON.stringify(directory.appearance || defaultShortcutIcon(JSON.stringify(["directory", directory.key || directory.cwd])))} aria-label={uiText("目录：{0} · {1}", directory.name, directory.parent)} data-directory-shortcut={directory.key || directory.cwd} aria-current={selectedDirectory === (directory.key || directory.cwd) ? "true" : undefined} title={`${directory.cwd}\n${directory.parent}`}><ShortcutBadge name={directory.name} identity={JSON.stringify(["directory", directory.key || directory.cwd])} appearance={directory.appearance} /><span className="conversation-shortcut-copy"><span className="conversation-shortcut-title">{directory.name}</span><span className="conversation-shortcut-context">{directory.parent}</span></span></button>
      <button type="button" className="conversation-shortcut-pin" data-directory-shortcut-pin={directory.key || directory.cwd} aria-label={uiText("取消固定目录：{0}", directory.cwd)} title={uiText("取消固定目录")}><PinOff aria-hidden="true" /></button>
    </li>)}</ul></>}
    {kind === "directory" && pinnedDirectories.length === 0 && <p className="conversation-shortcuts-empty">{uiText("点击 + 固定项目目录")}</p>}
  </section>
}
export function ConversationList({ sessions, rows, selected, showDirectory, showContext = true, loading, taskID, filtered, error, canCreate = true, parallel = false, parallelSessions = [], parallelFull = false, now = Date.now() }: { sessions: Session[]; rows?: ConversationTreeRow[]; selected?: string | null; showDirectory: boolean; showContext?: boolean; loading?: boolean; taskID?: string; filtered?: boolean; error?: boolean; canCreate?: boolean; parallel?: boolean; parallelSessions?: string[]; parallelFull?: boolean; now?: number }) {
  if (!sessions.length && !rows?.length) return <div className="session-browser-empty-list" role="status">
    {loading ? <RotateCw className="session-list-loading" aria-hidden="true" /> : error ? <CircleAlert aria-hidden="true" /> : filtered ? <Search aria-hidden="true" /> : <MessageSquare aria-hidden="true" />}
    <strong>{loading ? uiText("正在读取对话…") : error ? uiText("暂时无法读取对话") : filtered ? uiText("没有匹配的对话") : uiText("还没有对话")}</strong>
    <p>{loading ? uiText("正在同步各执行环境的记录") : error ? uiText("检查执行环境连接后重试。") : filtered ? uiText("试试其他关键词，或清除筛选条件。") : canCreate ? uiText("新建对话，从当前工作现场开始。") : uiText("当前范围暂无对话，可切换范围查看。")}</p>
    {!loading && (error || filtered || canCreate) && <Button type="button" variant="outline" size="sm" data-conversation-action={error ? "refresh" : filtered ? "reset-list" : "new"}>{error ? uiText("重新加载") : filtered ? uiText("清除搜索与筛选") : uiText("新建对话")}</Button>}
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
    const sessionTaskID = row?.group.taskID || taskID
    const directoryContext = row?.group.showContext ?? showContext
    const status = ({starting: uiText("正在连接"), running: uiText("运行中"), waiting: uiText("待确认"), stopping: uiText("正在停止"), handoff: uiText("等待交接"), failed: uiText("本轮未完成"), interrupted: uiText("已停止"), unknown: uiText("状态待核实")} as Record<string, string>)[s.chat_status || ""] || ""
    const directory = s.cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || s.cwd
    const key = s.browser_key || s.id
    const date = s.updated_at ? new Date(s.updated_at * 1000) : null
    const dateLabel = date ? date >= today ? date.toLocaleTimeString(uiLocale(), {hour: "2-digit", minute: "2-digit", hour12: false}) : date >= yesterday ? uiText("昨天") : date.toLocaleDateString(uiLocale(), {year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined, month: "numeric", day: "numeric"}) : ""
    return <li key={key} className={parallel ? "parallel-list-item" : sessionTaskID && !s.terminal ? "has-session-menu" : undefined}><button type="button" className="session-browser-item" data-conversation-list-row={row?.key} data-conversation-session={key} data-conversation-terminal={s.terminal ? s.id : undefined} data-environment={s.environment_id} aria-pressed={selected === key} title={`${s.name || uiText("未命名对话")}\n${s.environment_name || ""}\n${s.cwd}${s.context?.branch ? `\n${s.context.branch}` : ""}`}>
      <span className="session-browser-item-heading"><span className="session-browser-item-title">{s.name || uiText("未命名对话")}</span>{s.terminal && <span className="parallel-list-badge">{uiText("终端")}</span>}{parallel && parallelSessions.includes(key) && <span className="parallel-list-badge">{uiText("已并列")}</span>}{s.unread && <span className="session-browser-unread-dot" aria-label={uiText("有新消息")} />}</span>
      {directoryContext && s.context?.project ? <span className="session-browser-item-context">
        <span className="session-browser-item-project" title={`${s.cwd}${s.context.branch ? `\n${s.context.branch}` : ""}`}><span>{s.context.project}</span>{s.context.branch && <span className="session-browser-item-branch"><GitBranch aria-hidden="true" /><span>{s.context.branch}</span></span>}</span>
      </span> : null}
      {showDirectory && directoryContext && !s.context?.project ? <span className="session-browser-item-directory" title={s.cwd}>{directory}</span> : null}
      <span className="session-browser-item-meta"><span className="session-browser-item-signals">{s.environment_name && <span className="session-browser-environment" title={s.environment_name}>{s.environment_name}</span>}<span data-session-indicators={s.terminal ? undefined : s.id} data-environment={s.environment_id} data-state={s.chat_status || (s.unread ? "unread" : "idle")} hidden={!status && !s.unread}>{s.terminal ? s.terminal.attached ? uiText("已打开") : uiText("运行中") : status || (s.unread ? uiText("有新消息") : "")}</span></span><time title={date?.toLocaleString(uiLocale(), {hour12: false})} dateTime={date?.toISOString()}>{dateLabel}</time></span>
      {s.error ? <span className="table-message">{s.error}</span> : null}
    </button>{parallel ? <Button type="button" variant="ghost" size="icon-sm" className="parallel-list-add" data-conversation-parallel={key} data-conversation-terminal={s.terminal ? s.id : undefined} disabled={s.available === false || parallelFull && !parallelSessions.includes(key)} aria-label={parallelSessions.includes(key) ? uiText("定位对话：{0}", s.name) : uiText("将对话加入并列：{0}", s.name)} title={parallelSessions.includes(key) ? uiText("定位到对应栏") : parallelFull ? uiText("最多并列三个对话，可在栏标题中更换") : uiText("加入右侧并列")}><Plus aria-hidden="true" /></Button> : sessionTaskID && !s.terminal ? <details className="session-item-menu" data-session-menu={row?.key || key}><summary aria-label={uiText("对话操作：{0}", s.name || uiText("未命名对话"))} title={uiText("对话操作")}><Ellipsis aria-hidden="true" /></summary><div><Button type="button" variant="ghost" size="sm" data-conversation-unlink={s.id} data-environment={s.environment_id} data-task={sessionTaskID} aria-label={uiText("取消关联 {0}", s.name || uiText("未命名对话"))}>{uiText("取消关联")}</Button></div></details> : null}</li>
  }
  if (rows) {
    const sections = new Map<string, { group: ConversationTreeRow["group"]; rows: ConversationTreeRow[] }>()
    for (const row of rows) {
      let section = sections.get(row.group.key)
      if (!section) { section = {group: row.group, rows: []}; sections.set(row.group.key, section) }
      section.rows.push(row)
    }
    return <div className="session-browser-groups session-browser-workspaces">{[...sections.values()].map(({group, rows}) => <section className="session-browser-group" key={group.key} data-conversation-group={group.key} aria-label={`${group.name}${group.environmentName ? ` · ${group.environmentName}` : ""}`}>
      {rows.filter(row => row.kind === "group").map(row => <h3 className="session-workspace-heading" key={row.key}><button type="button" data-conversation-group-toggle={group.key} data-conversation-list-row={row.key} aria-expanded={!group.collapsed}>
        {group.collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}<span className="session-workspace-name">{group.name}</span><span className="session-workspace-count">{group.total}</span>
        {group.environmentName && <small>{group.environmentName}</small>}
      </button></h3>)}
      <ul className="session-browser-items">{rows.filter(row => row.kind === "session").map(row => renderSession(row.session, row))}</ul>
      {rows.filter(row => row.kind === "more").map(row => <button type="button" className="session-workspace-more" key={row.key} data-conversation-group-more={group.key} data-conversation-list-row={row.key}>{uiText("更多对话（{0}）", group.total - group.shown)}</button>)}
    </section>)}</div>
  }
  return <div className="session-browser-groups">{groups.map(g => <section className="session-browser-group" key={g.label} aria-label={g.label}>
    <h3 className="session-browser-group-heading">{g.label === uiText("已固定") && <Pin aria-hidden="true" />}{g.label}<span>{g.items.length}</span></h3>
    <ul className="session-browser-items">{g.items.map(s => renderSession(s))}</ul></section>)}</div>
}
export function ConversationScopes({ scopes }: { scopes: ConversationScope[] }) {
  return <>{scopes.map(s => <Button key={JSON.stringify([s.environment, s.kind, s.id, s.cwd])} type="button" variant="ghost" className="session-scope-option h-auto w-full justify-between gap-4 whitespace-normal text-left font-normal" data-conversation-scope={JSON.stringify(s)}><span>{s.name}</span><small>{({ all: uiText("所有目录"), task: uiText("任务"), project: uiText("项目"), directory: uiText("工作目录") } as Record<string, string>)[s.kind]}</small></Button>)}</>
}
