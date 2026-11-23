import { Activity, ChevronRight, Folder, MessageSquare, MoreHorizontal, Pencil, Plus, RefreshCw } from "lucide-react"
import { uiText } from "../i18n"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Action, Feedback, type ProjectOpenTool } from "./shared"
import { ResourceIcon } from "./shortcut-icons"
import { ResourceSwitcherTrigger } from "./list-controls"
import { conversationPathKey } from "./conversation-runtime"
import { conversationStatusMatches } from "./conversation-list"
import { DirectoryPath, ProjectConversationFeedback, ProjectConversationRows, WorkingDirectoryCard, directoryHasIssue, directoryName, directoryNeedsAttention, directoryUsable, type DirectoryCardState, type ProjectConversations } from "./working-directories"
import type { Project } from "./types"
import type { Session } from "./sessions"

export type DirectoryFilter = "all" | "dirty" | "active" | "clean" | "issues"
export type DirectorySort = "recent" | "name" | "changes"
export type ProjectDetailView = {
  filter: DirectoryFilter; sort: DirectorySort; cards: Map<string, DirectoryCardState>
  conversations: ProjectConversations; directory?: string; readOnly?: boolean
}

export function ProjectDetail({project, tool, view}: {project: Project; tool: ProjectOpenTool; view: ProjectDetailView}) {
  const {filter, sort, cards, conversations, directory, readOnly = false} = view
  const sessions = conversations.sessions.filter(session => !session.archived).sort((a, b) => sessionTimestamp(b) - sessionTimestamp(a))
  const sessionsByPath = new Map<string, Session[]>()
  for (const session of sessions) {
    const paths = new Set((session.project_directories ?? [session.cwd]).filter(Boolean).map(conversationPathKey))
    for (const path of paths) {
      const related = sessionsByPath.get(path) ?? []
      related.push(session)
      sessionsByPath.set(path, related)
    }
  }
  const labels = new Map<string, string[]>()
  const mainKey = conversationPathKey(project.path)
  const items = project.worktrees.map(tree => {
    const key = conversationPathKey(tree.path)
    const primary = key === mainKey
    const name = directoryName(tree, primary, project.folder)
    const related = sessionsByPath.get(key) ?? []
    for (const session of related) labels.set(session.id, [...(labels.get(session.id) ?? []), name])
    return {tree, primary, name, related, state: cards.get(key) ?? {expanded: primary || key === directory}}
  })
  const visible = items.filter(({tree, related}) => {
    switch (filter) {
      case "dirty": return directoryUsable(tree) && !!tree.dirty
      case "active": return !!related.length
      case "clean": return directoryUsable(tree) && !tree.dirty
      case "issues": return directoryHasIssue(tree)
      default: return true
    }
  }).sort((a, b) => {
    if (a.primary !== b.primary) return a.primary ? -1 : 1
    if (sort === "name") return a.name.localeCompare(b.name)
    if (sort === "changes") return (b.tree.dirty || 0) - (a.tree.dirty || 0) || a.name.localeCompare(b.name)
    return sessionTimestamp(b.related[0]) - sessionTimestamp(a.related[0]) || Number(directoryNeedsAttention(b.tree)) - Number(directoryNeedsAttention(a.tree))
  })
  const issueCount = items.filter(({tree}) => directoryHasIssue(tree)).length
  const totalChanges = items.reduce((total, {tree}) => total + (directoryUsable(tree) ? tree.dirty || 0 : 0), 0)
  const totalRunning = sessions.filter(session => conversationStatusMatches(session, "running")).length
  const unknownSessions = !sessions.length && !!(conversations.loading || conversations.error)
  const unknownStatus = items.some(({tree}) => !directoryUsable(tree))
  const main = items.find(item => item.primary)
  const allExpanded = visible.every(({state}) => state.expanded)

  return <div className="resource-detail-content project-detail-content" data-project-id={project.id}>
    <div className="project-breadcrumb">
      <a href="#/projects" className="resource-breadcrumb-link" data-action="project-list" data-detail-focus="project-list" aria-label={uiText("返回项目列表")}>{uiText("项目")}</a>
      <ChevronRight aria-hidden="true" /><span title={project.name}>{project.name}</span><ResourceSwitcherTrigger kind="project" />
    </div>
    <header className="project-detail-heading">
      <div className="project-detail-identity"><ResourceIcon kind="project" id={project.id} name={project.name} environment="" editable />
        <div><h2 tabIndex={-1} data-detail-focus="project-title">{project.name}</h2><DirectoryPath path={project.path} project /></div>
      </div>
      <div className="project-detail-actions">
        <Action action="project-conversation-new" id={project.id} data-path={project.path} variant="default" disabled={!!project.error || !directoryUsable(main?.tree) || readOnly}><Plus aria-hidden="true" />{uiText("新建对话")}</Action>
        <Action action="project-conversations" id={project.id}>{uiText("相关对话")}</Action>
        <Action action="new-worktree" id={project.id} disabled={!!project.error}><Plus aria-hidden="true" />{uiText("创建 Worktree")}</Action>
        <details className="workspace-project-details project-more"><summary aria-label={uiText("更多项目操作")}><MoreHorizontal aria-hidden="true" /></summary>
          <div className="workspace-project-details-body">
            <Action action="project-refresh" id={project.id} variant="ghost"><RefreshCw aria-hidden="true" />{uiText("刷新 Git 状态")}</Action>
            <Action action="git-open" id={project.id} variant="ghost" disabled={!!project.error}>{uiText("Git 操作 · 分支管理")}</Action>
            <Action action="project-open-remote" id={project.id} data-path={project.path} variant="ghost" disabled={!!project.error}>{uiText("打开远端仓库")}</Action>
            <hr /><Action action="remove-project" id={project.id} variant="ghost" className="text-destructive">{uiText("移除登记")}</Action>
          </div>
        </details>
      </div>
    </header>
    {project.error ? <Feedback variant="destructive"><p className="m-0">{uiText("项目读取失败：")}{project.error}</p><Action action="project-refresh" id={project.id}>{uiText("重新检查")}</Action></Feedback> : <>
      <ul className="project-detail-summary" aria-label={uiText("项目摘要")}>
        <li><Folder aria-hidden="true" /><strong>{project.refreshing && !items.length ? "…" : items.length}</strong>{uiText("个工作目录")}</li>
        <li title={unknownStatus ? uiText("部分工作目录的 Git 状态暂不可用") : undefined}><Pencil aria-hidden="true" /><strong>{unknownStatus ? items.some(({tree}) => directoryUsable(tree)) ? `${totalChanges}+` : "—" : totalChanges}</strong>{uiText("项本地变更")}</li>
        <li><MessageSquare aria-hidden="true" /><strong>{unknownSessions ? "—" : sessions.length}</strong>{uiText("条项目对话")}</li>
        <li><Activity aria-hidden="true" /><strong>{unknownSessions ? "—" : totalRunning}</strong>{uiText("个运行中 Agent")}</li>
      </ul>
      {items.length > 1 ? <div className="project-worktree-banner"><strong>{uiText("多 Worktree 工作目录")}</strong>
        <Action action="project-directory-expand-all" id={project.id} data-expand={String(!allExpanded)} data-detail-focus="expand-all" disabled={!visible.length}>{allExpanded && visible.length ? uiText("全部收起") : uiText("全部展开")}</Action>
      </div> : null}
      <section aria-labelledby="projectDirectoriesTitle">
        <div className="resource-section-heading project-directories-heading">
          <h3 id="projectDirectoriesTitle">{uiText("工作目录")} <span className="resource-section-count">{visible.length}</span></h3>
          {items.length > 1 ? <div className="project-directory-controls">
            <NativeSelect size="sm" defaultValue={filter} data-project-directory-filter data-detail-focus="directory-filter" aria-label={uiText("筛选工作目录")}>
              <NativeSelectOption value="all">{uiText("全部目录")}</NativeSelectOption>
              <NativeSelectOption value="dirty">{uiText("有改动")}</NativeSelectOption>
              <NativeSelectOption value="active">{uiText("有对话")}</NativeSelectOption>
              <NativeSelectOption value="clean">{uiText("干净")}</NativeSelectOption>
              {issueCount || filter === "issues" ? <NativeSelectOption value="issues">{uiText("需要处理 ·")} {issueCount}</NativeSelectOption> : null}
            </NativeSelect>
            <NativeSelect size="sm" defaultValue={sort} data-project-directory-sort data-detail-focus="directory-sort" aria-label={uiText("排序工作目录")}>
              <NativeSelectOption value="recent">{uiText("最近使用")}</NativeSelectOption>
              <NativeSelectOption value="name">{uiText("名称")}</NativeSelectOption>
              <NativeSelectOption value="changes">{uiText("改动数量")}</NativeSelectOption>
            </NativeSelect>
          </div> : null}
        </div>
        {visible.length ? <div className="working-directory-cards" aria-label={uiText("项目工作目录")}>{visible.map(({tree, name, primary, state, related}) =>
          <WorkingDirectoryCard key={tree.path} project={project.id} tree={tree} name={name} tool={tool} primary={primary} state={state} sessions={related} conversations={conversations} readOnly={readOnly} />)}</div>
          : <div className="project-detail-empty" role="status">{items.length ? <>
            {filter === "active" && unknownSessions ? <ProjectConversationFeedback conversations={conversations} project={project.id} /> : uiText("没有符合筛选条件的工作目录")}
            <Action action="project-directory-reset" id={project.id} data-detail-focus="directory-filter">{uiText("查看全部目录")}</Action>
          </> : <>{project.refreshing ? uiText("正在发现工作目录…") : uiText("尚未发现工作目录，请检查项目路径后重新扫描。")}
            {!project.refreshing ? <Action action="project-refresh" id={project.id}>{uiText("重新检查")}</Action> : null}</>}
          </div>}
      </section>
      <section className="project-activity" aria-labelledby="projectActivityTitle">
        <div className="resource-section-heading"><h3 id="projectActivityTitle">{uiText("最近开发活动")}</h3><Action action="project-conversations" id={project.id} variant="ghost">{uiText("查看全部")}<ChevronRight aria-hidden="true" /></Action></div>
        <ProjectConversationRows project={project.id} sessions={sessions.slice(0, 3)} directoryLabels={labels} />
        <ProjectConversationFeedback conversations={conversations} project={project.id} empty={sessions.length ? undefined : uiText("暂无项目对话")} />
      </section>
    </>}
  </div>
}

function sessionTimestamp(session?: Session) { return session?.updated_at || session?.updatedAt || 0 }
