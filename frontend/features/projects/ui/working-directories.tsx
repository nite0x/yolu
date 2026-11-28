import {Check, ChevronDown, ChevronRight, CircleAlert, CodeXml, Copy, Files, Folder, FolderOpen, GitBranch, GitCommitHorizontal, Layers, MessageSquare, MoreHorizontal, Pencil, Plus, Terminal} from "lucide-react"
import {uiLocale, uiText} from "@/shared/i18n"
import {Action} from "@/shared/ui/actions/button"
import {Feedback} from "@/shared/ui/feedback/message"
import {StatusBadge} from "@/shared/ui/data-display/status-badge"
import {Branch, projectOpenLabels, TreeStatus, type ProjectOpenTool} from "@/entities/projects/presentation"
import {conversationPathKey} from "@/shared/lib/workspace-identity"
import {conversationStatusMatches} from "@/entities/conversations/status"
import {sessionTime} from "@/entities/conversations/presentation"
import type {Session} from "@/entities/conversations/catalog"
import type {Worktree} from "@/entities/projects/model"
import {compactWorkspacePath} from "@/shared/lib/workspace-path"

export type DirectorySection = "changes" | "sessions" | "git"
export type DirectoryCardState = { expanded: boolean; section?: DirectorySection }
export type ProjectConversations = { sessions: Session[]; loading?: boolean; error?: string }

const DIRECTORY_SESSION_PREVIEW_LIMIT = 5

export const directoryHasIssue = (tree: Worktree) => !!(tree.missing || tree.prunable || tree.error)
export const directoryUsable = (tree?: Worktree) => !!tree && !tree.bare && !directoryHasIssue(tree) && !!tree.status_updated_at
export const directoryNeedsAttention = (tree: Worktree) => directoryHasIssue(tree) || !!(tree.dirty || tree.operation || tree.conflicts?.length ||
  (tree.upstream && !tree.detached && tree.sync_available && (tree.sync_ahead || tree.sync_behind)))
export function directoryName(tree: Worktree, primary: boolean, projectFolder?: string) {
  if (primary) return uiText("主工作目录")
  const segments = tree.path.split(/[\\/]/).filter(Boolean)
  const folder = segments.at(-1)
  return (folder === projectFolder && segments.at(-2)) || folder || tree.path
}
export function directoryNames(trees: Worktree[], mainKey: string, projectFolder?: string) {
  const entries = trees.map(tree => {
    const key = conversationPathKey(tree.path)
    const primary = key === mainKey
    const segments = tree.path.split(/[\\/]/).filter(Boolean)
    return { key, primary, segments, name: directoryName(tree, primary, projectFolder), depth: 1 }
  })
  const counts = new Map<string, number>()
  for (const entry of entries) if (!entry.primary) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
  for (let depth = 2; depth <= 3; depth++) {
    const colliding = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name))
    if (!colliding.size) break
    counts.clear()
    for (const entry of entries) {
      if (!entry.primary && colliding.has(entry.name) && entry.segments.length >= depth) {
        const tail = entry.segments.slice(-depth)
        entry.name = tail.join("/")
        entry.depth = depth
      }
      if (!entry.primary) counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1)
    }
  }
  return new Map(entries.map(entry => [entry.key, entry.name]))
}
const directoryBranch = (tree: Worktree) => tree.branch || (tree.detached ? (tree.head ? `detached @ ${tree.head.slice(0, 7)}` : "detached HEAD") : tree.bare ? uiText("裸仓库") : uiText("尚未读取分支"))
const updatedAt = (session: Session) => session.updated_at || session.updatedAt || 0

export function DirectoryPath({path, project}: {path: string; project?: boolean}) {
  return <button type="button" className="directory-path" data-action="copy-path" data-path={path} data-detail-focus="copy-path"
    title={path} aria-label={project ? uiText("复制项目路径 {0}", path) : uiText("复制目录路径 {0}", path)}>
    <span>{compactWorkspacePath(path)}</span><Copy aria-hidden="true" />
  </button>
}

export function ProjectConversationRows({project, sessions, directoryLabels}: {
  project: string; sessions: Session[]; directoryLabels?: Map<string, string[]>
}) {
  return <ul className="project-conversation-rows">{sessions.map(session => {
    const timestamp = updatedAt(session)
    const context = directoryLabels?.get(session.id)?.join(", ")
    const waiting = conversationStatusMatches(session, "waiting")
    const running = conversationStatusMatches(session, "running")
    return <li key={session.id}>
      <Action action="project-conversations" id={project} variant="ghost" className="project-conversation-row" data-session={session.id} data-detail-focus={`session:${session.id}`}>
        <span className="project-conversation-icon"><MessageSquare aria-hidden="true" /></span>
        <span className="project-conversation-info">
          <strong>{session.name || uiText("未命名对话")}</strong>
          <span>{session.provider === "cursor" ? "Cursor" : session.provider === "agy" ? "Antigravity" : "Codex"}{context ? ` · ${context}` : ""}</span>
        </span>
        {waiting || running ? <StatusBadge tone={waiting ? "warning" : "accent"}>{waiting ? uiText("待确认") : uiText("运行中")}</StatusBadge> : null}
        {timestamp ? <time dateTime={new Date(timestamp * 1000).toISOString()}>{sessionTime(timestamp)}</time> : null}
        <ChevronRight className="project-conversation-enter" aria-hidden="true" />
      </Action>
    </li>
  })}</ul>
}

export function ProjectConversationFeedback({conversations, project, empty}: {conversations: ProjectConversations; project: string; empty?: string}) {
  if (conversations.error) return <div className="project-conversation-feedback" role="alert">
    <span>{uiText("对话读取失败：")}{conversations.error}</span>
    <Action action="project-conversations-refresh" id={project} size="sm">{uiText("重试")}</Action>
  </div>
  if (conversations.loading && !conversations.sessions.length) return <p role="status" className="directory-muted">{uiText("正在读取项目对话…")}</p>
  return empty ? <p className="directory-muted">{empty}</p> : null
}

export function WorkingDirectoryCard({project, tree, name, primary, tool, state, sessions, conversations, readOnly}: {
  project: string; tree: Worktree; name: string; primary: boolean; tool: ProjectOpenTool; state: DirectoryCardState
  sessions: Session[]; conversations: ProjectConversations; readOnly: boolean
}) {
  const path = tree.path
  const branch = directoryBranch(tree)
  const issue = directoryHasIssue(tree)
  const usable = directoryUsable(tree)
  const idle = !primary && !issue && usable && !tree.dirty && !sessions.length && (tree.detached || !tree.upstream)
  const section = state.section || (tree.dirty || !sessions.length ? "changes" : "sessions")
  const target = { id: project, "data-path": path }
  const panel = `directory-panel-${encodeURIComponent(path)}`
  const previewSessions = sessions.slice(0, DIRECTORY_SESSION_PREVIEW_LIMIT)
  const sections: [DirectorySection, string, number?][] = [
    ["changes", uiText("变更摘要"), usable && tree.dirty ? tree.dirty : undefined],
    ["sessions", uiText("关联对话"), sessions.length || undefined],
    ["git", uiText("Git 状态")],
  ]
  return <article tabIndex={-1} aria-label={name} data-directory-path={path} data-primary-directory={primary || undefined} data-idle-directory={idle || undefined} className="working-directory-card">
    <div className="directory-card-body">
      <div className="directory-card-row">
        <div className="directory-card-main">
          <div className="directory-identity-main">
            <Folder aria-hidden="true" />
            <h4 title={name}>{name}</h4>
            {primary ? <StatusBadge tone="accent">{uiText("主仓库")}</StatusBadge> : null}
            <Branch><GitBranch aria-hidden="true" /><span title={branch}>{branch}</span></Branch>
            {usable ? <><DirectoryLocalStatus tree={tree} project={project} name={name} /><GitSyncStatus tree={tree} compact /></> : <TreeStatus tree={tree} compact />}
          </div>
          <div className="directory-card-meta">
            <DirectoryPath path={path} />
            <span className="directory-meta-sep" aria-hidden="true">·</span>
            <Action action="project-directory-section" {...target} data-section="sessions" variant="ghost" className="directory-session-count" data-empty={!sessions.length || undefined} data-detail-focus="session-count" aria-controls={panel}>
              <MessageSquare aria-hidden="true" />{conversations.loading && !conversations.sessions.length || conversations.error && !conversations.sessions.length ? uiText("关联对话") : uiText("{0} 条关联对话", sessions.length)}
            </Action>
          </div>
        </div>
        <div className="directory-actions">
          <Action action="changes-open" {...target} data-mode="all" data-detail-focus="files" variant="ghost" size="icon-sm" className="directory-icon-action" disabled={!usable} title={uiText("文件与改动")} aria-label={uiText("文件与改动")} aria-controls="projectFilesPane"><Files aria-hidden="true" /></Action>
          <details className="workspace-more directory-more" data-project-open>
            <summary title={uiText("{0} 更多操作", name)} aria-label={uiText("{0} 更多操作", name)}><MoreHorizontal aria-hidden="true" /></summary>
            <div className="workspace-more-menu">
              <Action action="project-conversation-new" {...target} disabled={!usable || readOnly}><Plus aria-hidden="true" />{uiText("新建对话")}</Action>
              <Action action={tool === "terminal" ? "project-terminal" : `project-open-${tool}`} {...target} data-project-open-primary disabled={!usable} title={uiText("用 {0} 打开工作目录", projectOpenLabels[tool])} aria-label={uiText("用 {0} 打开工作目录", projectOpenLabels[tool])}>{tool === "terminal" ? <Terminal aria-hidden="true" /> : <CodeXml aria-hidden="true" />}<span data-project-open-label>{uiText("{0} 打开", projectOpenLabels[tool])}</span></Action>
              {(["vscode", "idea", "terminal"] as const).filter(choice => choice !== tool).map(choice => <Action key={choice} action={choice === "terminal" ? "project-terminal" : `project-open-${choice}`} {...target} data-project-open-choice={choice} disabled={!usable}>{choice === "terminal" ? <Terminal aria-hidden="true" /> : <CodeXml aria-hidden="true" />}{projectOpenLabels[choice]}</Action>)}
              <Action action="project-open-folder" {...target} disabled={!usable}><FolderOpen aria-hidden="true" />{uiText("在文件管理器中打开")}</Action>
              <Action action="changes-open" {...target} disabled={!usable}><Pencil aria-hidden="true" />{uiText("查看变更")}</Action>
              <Action action="git-open" {...target} disabled={!usable}>{uiText("Git 操作")}</Action>
              <Action action="project-commit-plan" {...target} disabled={!usable}><Layers aria-hidden="true" />{uiText("分批提交")}</Action>
              <Action action="project-open-remote" {...target} disabled={!usable}>{uiText("打开远端仓库")}</Action>
              <Action action="project-refresh" {...target}>{uiText("刷新 Git 状态")}</Action>
              {!primary && !tree.bare ? <Action action="remove-worktree" {...target}>{uiText("移除 Worktree")}</Action> : null}
            </div>
          </details>
          <Action action="project-directory-toggle" {...target} variant="ghost" size="icon-sm" className="directory-expand-button" data-detail-focus="expand" aria-expanded={state.expanded} aria-controls={panel}
            aria-label={state.expanded ? uiText("收起 {0}", name) : uiText("展开 {0}", name)}><ChevronDown aria-hidden="true" /></Action>
        </div>
      </div>
      {issue ? <Feedback tone="error" className="directory-recovery"><p><CircleAlert aria-hidden="true" />{tree.error || uiText("检查 Worktree 目录是否仍在原位置。")}</p><Action action="project-refresh" {...target}>{uiText("重新检查")}</Action></Feedback> : null}
    </div>
    <div id={panel} className="directory-card-expanded" hidden={!state.expanded}>{state.expanded ? <>
      <fieldset className="directory-sections m-0 min-w-0 border-x-0 border-t-0 p-0" aria-label={name}>{sections.map(([value, label, count]) =>
        <Action key={value} action="project-directory-section" {...target} data-section={value} data-detail-focus={`section:${value}`} variant="ghost" aria-pressed={section === value}>
          {label}{count ? <span className="directory-tab-count">{count}</span> : null}
        </Action>)}</fieldset>
      <div className="directory-section-content">
        {section === "changes" ? <DirectoryChanges tree={tree} project={project} usable={usable} /> : section === "git" ? <DirectoryGit tree={tree} project={project} usable={usable} /> : <>
          <ProjectConversationRows project={project} sessions={previewSessions} />
          {sessions.length > previewSessions.length ? <div className="directory-sessions-footer">
            <Action action="project-conversations" id={project} variant="ghost">{uiText("查看全部 {0} 条关联对话", sessions.length)}<ChevronRight aria-hidden="true" /></Action>
          </div> : null}
          <ProjectConversationFeedback project={project} conversations={conversations} empty={sessions.length ? undefined : uiText("暂无关联对话")} />
        </>}
      </div>
    </> : null}</div>
  </article>
}

function DirectoryChanges({tree, project, usable}: {tree: Worktree; project: string; usable: boolean}) {
  const counts = tree.changes
  const breakdown = counts && ([
    ["modified", counts.modified, uiText("修改 {0}", counts.modified)],
    ["added", counts.added, uiText("新增 {0}", counts.added)],
    ["deleted", counts.deleted, uiText("删除 {0}", counts.deleted)],
  ] as const)
  if (!usable) return <p className="directory-muted">{uiText("目录状态暂不可用")}</p>
  return <div className="directory-summary-content">
    {tree.dirty && breakdown ? <div className="directory-change-breakdown">
      <svg className="directory-change-bar" aria-hidden="true" viewBox={`0 0 ${tree.dirty} 1`} preserveAspectRatio="none">
        <rect data-kind="modified" x={0} width={counts.modified} height={1} />
        <rect data-kind="added" x={counts.modified} width={counts.added} height={1} />
        <rect data-kind="deleted" x={counts.modified + counts.added} width={counts.deleted} height={1} />
      </svg>
      <span className="directory-change-legend">{breakdown.map(([kind, , label]) => <span key={kind} data-kind={kind}>{label}</span>)}</span>
    </div> : <p className="directory-muted">{tree.dirty ? uiText("{0} 项改动", tree.dirty) : uiText("工作目录干净，无未提交改动")}</p>}
    <div className="directory-summary-actions">
      <Action action="changes-open" id={project} data-path={tree.path} variant="ghost" data-detail-focus="view-all-changes">{uiText("查看全部变更")}<ChevronRight aria-hidden="true" /></Action>
    </div>
  </div>
}

function DirectoryGit({tree, project, usable}: {tree: Worktree; project: string; usable: boolean}) {
  return <div className="directory-summary-content">
    <div className="directory-detail-content">
      <div>{uiText("当前分支")} <code>{directoryBranch(tree)}</code>{tree.head ? <> · <code title={tree.head}>{tree.head.slice(0, 8)}</code></> : null}</div>
      {usable ? <><GitSyncStatus tree={tree} />{tree.compare_available ? <div>{uiText("相对基线")} <code>{tree.comparison_ref}</code> · {tree.ahead || tree.behind ? uiText("领先 {0} · 落后 {1}", tree.ahead || 0, tree.behind || 0) : uiText("与基线一致")}</div> : null}</> : <div>{uiText("目录状态暂不可用")}</div>}
      {tree.locked ? <div>{uiText("工作目录已锁定")}</div> : null}
      {tree.status_updated_at ? <div>{uiText("上次检查")} <time data-status-path={tree.path} dateTime={tree.status_updated_at}>{new Date(tree.status_updated_at).toLocaleTimeString(uiLocale(), { hour12: false })}</time></div> : null}
    </div>
    <div className="directory-summary-actions">
      <Action action="project-refresh" id={project} variant="ghost">{uiText("刷新 Git 状态")}</Action>
      <Action action="git-open" id={project} data-path={tree.path} variant="ghost" disabled={!usable}>{uiText("Git 操作")}<ChevronRight aria-hidden="true" /></Action>
    </div>
  </div>
}

function DirectoryLocalStatus({tree, project, name}: {tree: Worktree; project: string; name: string}) {
  const committed = !tree.detached && !!tree.upstream && tree.sync_available && (tree.sync_ahead || 0) > 0
  return <div className="directory-local-status">
    {tree.dirty ? <Action action="changes-open" id={project} data-path={tree.path} variant="ghost" className="directory-changes-link" aria-label={uiText("查看 {0} 的 {1} 项改动", name, tree.dirty)}>
      <StatusBadge tone="warning"><Pencil aria-hidden="true" />{uiText("有改动")} {tree.dirty}</StatusBadge>
    </Action> : !committed ? <span className="directory-status-clean" title={uiText("工作目录干净，无未提交改动")}><Check aria-hidden="true" />{uiText("干净")}</span> : null}
    {committed ? <span title={uiText("已有 {0} 个提交待推送", tree.sync_ahead)}><StatusBadge tone="accent"><GitCommitHorizontal aria-hidden="true" />{uiText("已提交")}</StatusBadge></span> : null}
  </div>
}

function GitSyncStatus({tree, compact = false}: {tree: Worktree; compact?: boolean}) {
  const {upstream, detached, sync_available, sync_ahead = 0, sync_behind = 0, operation, conflicts} = tree
  const synced = sync_available && !!upstream && !detached && !sync_behind && !sync_ahead
  const diverged = sync_available && !!upstream && !detached && (sync_ahead > 0 || sync_behind > 0)
  if (compact && detached && !operation) return null
  return <div className="directory-sync" title={uiText("同步数量基于本地最近获取的上游记录；获取远端后更新。")}>
    {!compact || !detached ? (diverged ? <StatusBadge tone="neutral">
      <span className="directory-sync-summary"><code title={upstream}>{upstream}</code>
        <span role="img" className="directory-sync-counts" aria-label={uiText("待推送 {0} 个提交，待拉取 {1} 个提交", sync_ahead, sync_behind)} title={uiText("↑ 待推送 {0} · ↓ 待拉取 {1}{2}", sync_ahead, sync_behind, sync_ahead && sync_behind ? uiText(" · 已分歧") : "")}>
          <span data-active={sync_ahead > 0}>↑{sync_ahead}</span><span data-active={sync_behind > 0}>↓{sync_behind}</span>
        </span>
      </span>
    </StatusBadge> : <span className="directory-sync-inline" data-synced={synced || undefined}>
      {upstream && !detached ? <span className="directory-sync-summary"><code title={upstream}>{upstream}</code>
        {sync_available ? <span role="img" className="directory-sync-counts" aria-label={uiText("待推送 {0} 个提交，待拉取 {1} 个提交", sync_ahead, sync_behind)} title={uiText("↑ 待推送 {0} · ↓ 待拉取 {1}{2}", sync_ahead, sync_behind, "")}>
          <span data-active={false}>↑{sync_ahead}</span><span data-active={false}>↓{sync_behind}</span>
        </span> : <span title={uiText("上游不可用，请获取远端")}>{uiText("暂不可用")}</span>}
      </span> : detached ? uiText("游离 HEAD") : uiText("未设置上游")}
    </span>) : null}
    {operation ? <StatusBadge tone="warning">{operation === "merge" ? uiText("合并进行中{0}", conflicts?.length ? uiText(" · {0} 个冲突文件", conflicts.length) : uiText(" · 等待完成提交")) : uiText("{0} 进行中", operation)}</StatusBadge> : null}
  </div>
}
