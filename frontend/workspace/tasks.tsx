import { uiText, uiLocale } from "../i18n";
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CircleAlert, ClipboardCheck, Copy, GitBranch, MoreHorizontal, Plus, SlidersHorizontal } from "lucide-react"
import { Action, GitSyncStatus, TaskOpenActions, StatusBadge, TreeStatus, canOpenMember, reusesDirectory } from "./shared"
import type { ProjectOpenTool } from "./shared"
import type { Project, Task } from "./types"
import { memberSignals, taskSignals, taskFilterLabels, type TaskFilter } from "./task-signals"
import { compactWorkspacePath } from "./workspace-path"

export function TaskList({ tasks, selectedID, environment }: { tasks: Task[]; selectedID?: string | null; environment?: string }) {
  return <div className="task-list shadcn-scope divide-y divide-border">{tasks.map(q => {
    const {issues,dirty,push,conflicts,checking} = taskSignals(q)
    const status = !q.connected ? uiText("环境未连接") : !q.members.length ? uiText("待关联项目") : [issues ? uiText("{0} 个目录异常", issues) : "", conflicts ? uiText("{0} 个 Git 操作待处理", conflicts) : "", dirty ? uiText("{0} 个项目有改动", dirty) : "", push ? uiText("{0} 个项目待推送", push) : ""].filter(Boolean).join(" · ") || (checking ? uiText("等待检查工作目录") : uiText("无未提交改动"))
    return <Card key={`${q.environment_id}:${q.id}`} className="gap-0 rounded-none border-0 p-0 shadow-none"><a className="list-row focus-visible:outline-ring" aria-current={q.id === selectedID && q.environment_id === environment ? "true" : undefined} href={`?environment=${encodeURIComponent(q.environment_id)}#/requirements/${encodeURIComponent(q.id)}`} data-action="open-requirement" data-id={q.id} data-environment={q.environment_id} aria-label={uiText("打开任务 {0}", q.name)}><div className="row-main"><div className="row-title">{q.name}{q.state === "archived" ? <StatusBadge kind="archived" /> : null}</div>{q.description?.trim() && q.description.trim() !== q.name.trim() ? <div className="task-list-description">{q.description}</div> : null}<div className="row-subtitle">{q.members.length}{" "}{uiText("个项目 ·")}{" "}{q.environment_name}</div></div><div className="row-meta"><span className={`task-list-status${issues || conflicts || !q.connected ? " has-issues" : dirty || push ? " has-work" : ""}`}>{status}</span><time className="row-time" dateTime={q.created_at} title={uiText("创建时间：{0}", new Date(q.created_at).toLocaleString("zh-CN"))}>{uiText("创建于")}{" "}{new Date(q.created_at).toLocaleDateString("zh-CN")}</time></div><span className="chevron" aria-hidden="true">›</span></a></Card>
  })}</div>
}

export function TaskActions({ task: q, environment }: { task: Task; environment: string }) {
  return <div className="task-page-actions shadcn-scope">
    <span className="task-environment">{environment}</span><StatusBadge kind={q.state === "archived" ? "archived" : "neutral"}>{q.state === "archived" ? uiText("已归档") : uiText("未归档")}</StatusBadge>
    <Action action="task-conversations" id={q.id}>{uiText("查看相关对话")}</Action>
    <Button type="button" variant="outline" size="sm" data-session-action="new" data-requirement={q.id} disabled={q.state !== "ready"}>{uiText("新建对话")}</Button>
    <Action action="task-review" id={q.id} disabled={q.state === "creating"} aria-label={uiText("开始收尾检查")}><ClipboardCheck aria-hidden="true" />{uiText("收尾检查")}</Action>
    <details className="task-more" data-workspace-detail="task-actions"><summary>{uiText("更多")}</summary><div className="task-more-menu">
      <Action action="edit-task" id={q.id} disabled={q.state === "creating"}>{uiText("编辑任务信息")}</Action>
      <Action action="archive" id={q.id}>{q.state === "archived" ? uiText("取消归档") : uiText("归档任务")}</Action>
      <hr />
      <Action action="remove-task" id={q.id} disabled={q.state === "creating"} className="text-destructive">{uiText("删除工作区记录")}</Action>
    </div></details>
  </div>
}

export function TaskDetail({ task: q, projects, openTool = "vscode", filter = "all" }: { task: Task; projects: Project[]; environment: string; openTool?: ProjectOpenTool; filter?: TaskFilter }) {
  const pending = (m: Task["members"][number]) => m.state === "ready" && !m.worktree?.status_updated_at && (!m.worktree || !!projects.find(p => p.id === m.project_id)?.refreshing)
  const editable = q.state !== "archived" && q.state !== "creating"
  const signals = taskSignals(q)
  const available = q.members.filter(canOpenMember).length
  const summary = !q.members.length ? uiText("关联项目后，在这里查看分支、改动和目录状态。") : [
    uiText("{0} 个关联项目", q.members.length), uiText("{0} 个目录可打开", available),
    signals.issues ? uiText("{0} 个目录需要处理", signals.issues) : "",
    signals.checking ? uiText("{0} 个目录正在检查", signals.checking) : "",
  ].filter(Boolean).join(" · ")
  const members = q.members.filter(m => filter === "all" || memberSignals(m)[filter])
  const filterKinds = Object.keys(taskFilterLabels) as TaskFilter[]
  const quickFilters = filterKinds.filter(kind => kind === "all" || kind === filter || signals[kind] > 0)
  const otherFilters = filterKinds.filter(kind => !quickFilters.includes(kind))
  const filterButton = (kind: TaskFilter) => <Action key={kind} action="task-project-filter" id={q.id} data-filter={kind} aria-pressed={kind === filter} className={kind === "issues" && signals.issues ? "task-issue-filter" : undefined} variant={kind === filter ? "secondary" : "outline"}>{kind === "issues" && signals.issues ? <CircleAlert aria-hidden="true" /> : null}{taskFilterLabels[kind]} · {kind === "all" ? q.members.length : signals[kind]}</Action>
  return <Card className="shadcn-scope requirement-workspace gap-4 rounded-none border-0 p-5 shadow-none">
    <section className={`task-info${q.description?.trim() ? "" : " task-info-empty"}`} aria-label={uiText("任务目标")}><div className="task-info-heading"><strong>{uiText("任务目标")}</strong>{q.description?.trim() ? <div className="flex items-center gap-3"><button type="button" className="task-info-toggle" data-action="task-info-toggle" aria-controls="taskDescription" aria-expanded="false" hidden>{uiText("查看全部")}</button><Action variant="ghost" action="edit-task" id={q.id} disabled={q.state === "creating"}>{uiText("编辑目标")}</Action></div> : null}</div>
      {q.description?.trim() ? <p id="taskDescription" className="task-description task-description-clamped">{q.description}</p> : <div className="task-goal-prompt"><Action variant="ghost" action="edit-task" id={q.id} disabled={q.state === "creating"}><Plus aria-hidden="true" />{uiText("添加任务目标")}</Action></div>}
    </section>
    <div className="task-directory-overview"><div className="detail-top"><div className="min-w-0"><h2 className="m-0 text-base font-semibold">{uiText("关联项目与工作目录")}</h2><p className="task-project-summary">{summary}</p></div><div className="detail-actions"><Action action="add-requirement-projects" id={q.id} disabled={!editable || q.members.length >= 30}><Plus aria-hidden="true" />{uiText("添加项目")}</Action></div></div>
      {q.members.length ? <div className="task-signal-filters" aria-label={uiText("按项目状态筛选")}>{quickFilters.map(filterButton)}{otherFilters.length > 0 ? <details className="task-more task-filter-more"><summary aria-label={uiText("更多项目状态筛选")}><SlidersHorizontal aria-hidden="true" />{uiText("更多筛选")}</summary><div className="task-more-menu">{otherFilters.map(filterButton)}</div></details> : null}</div> : null}
    </div>
    {!q.members.length ? <div className="task-project-empty">{uiText("尚未关联项目。添加项目并选择工作目录，即可继续这项工作。")}</div> : null}
    {q.members.length > 0 && !members.length ? <p className="task-project-empty">{uiText("没有符合此状态的项目。")}<Action action="task-project-filter" id={q.id} data-filter="all">{uiText("查看全部项目")}</Action></p> : null}
    <div className="task-project-list" aria-label={uiText("任务关联项目")}>{members.map(m => {
      const t = m.worktree
      const usable = canOpenMember(m)
      const active = usable && editable
      const issue = memberSignals(m).issues
      const retryable = ["failed", "pending", "removed"].includes(m.state)
      const notice = m.error || t?.error || (t?.missing ? uiText("工作目录已丢失。请选择其他目录继续工作。") : t?.prunable ? uiText("Worktree 登记需要修复，可先更换工作目录。") : t?.bare ? uiText("此目录是裸仓库，请选择可工作的目录。") : m.state === "removed" ? uiText("此工作目录已清理，可以恢复或更换目录。") : m.state === "failed" ? uiText("工作目录准备失败，请重试或更换目录。") : m.state === "pending" ? uiText("工作目录尚未创建。") : m.state === "creating" ? uiText("正在准备工作目录…") : !usable ? uiText("正在检查工作目录…") : "")
      const expected = m.branch || (!reusesDirectory(m) ? q.branch : "")
      const drifted = !!t && !!expected && t.branch !== expected
      const creationRef = m.base_ref?.replace(/^refs\/(heads|remotes)\//, "") || uiText("已有工作目录")
      const baseline = t?.comparison_ref || creationRef
      const difference = t?.compare_available ? [t.ahead ? uiText("领先 {0}", t.ahead) : "", t.behind ? uiText("落后 {0}", t.behind) : ""].filter(Boolean).join(" · ") || uiText("与基线一致") : uiText("暂不可比较")
      return <article key={m.project_id} className={`task-project${issue ? " task-project-has-issue" : ""}`} data-project-id={m.project_id} aria-label={m.project_name}>
        <div className="task-project-main"><div className="task-project-heading"><strong>{m.project_name}</strong><span className="task-directory-kind">{{project: uiText("项目原目录"), worktree: uiText("已有 Worktree"), new: uiText("新建 Worktree"), existing: uiText("新建 Worktree（已有分支）")}[m.mode || "new"]}</span></div>
          <div className="task-project-state">{t ? <Action className="task-current-branch" variant="ghost" action="git-open" id={m.project_id} data-path={m.path} data-requirement={q.id} disabled={!active} aria-label={uiText("查看 {0} 的分支", m.project_name)} title={t.branch || "detached HEAD"}><GitBranch aria-hidden="true" /><span>{t.branch || "detached HEAD"}</span></Action> : <span className="quiet">{uiText("尚未读取分支")}</span>}{m.state === "ready" ? m.error ? <StatusBadge kind="failed">{uiText("目录不可用")}</StatusBadge> : <TreeStatus tree={t} pending={pending(m)} compact /> : <StatusBadge kind={m.state} />}{m.state === "ready" && !m.error ? <GitSyncStatus tree={t} compact /> : null}</div>
          <button type="button" className="task-project-path path" data-action="copy-path" data-path={m.path} title={uiText("{0}\n点击复制完整路径", m.path)} aria-label={uiText("复制工作目录路径 {0}", m.path)}>{compactWorkspacePath(m.path)}<Copy aria-hidden="true" /></button>
        </div>
        <div className="workspace-project-actions task-project-primary-actions">
          <TaskOpenActions project={m.project_id} path={m.path} disabled={!usable} tool={openTool} primary />
          <Action action="changes-open" id={m.project_id} data-path={m.path} disabled={!usable}>{uiText("文件与改动")}</Action>
          <details className="task-more task-project-more" data-workspace-detail={`menu:${m.project_id}`}><summary aria-label={uiText("{0} 更多操作", m.project_name)}><MoreHorizontal aria-hidden="true" /></summary><div className="task-more-menu">
            <Action action="workspace-conversation-new" id={m.project_id} data-path={m.path} disabled={!usable}>{uiText("新建对话…")}</Action>
            <hr />
            <Action action="git-open" id={m.project_id} data-path={m.path} data-requirement={q.id} disabled={!active}>{uiText("Git 操作")}</Action>
            <Action action="git-task-pull" id={m.project_id} data-path={m.path} data-requirement={q.id} disabled={!active || !!t?.detached || !!t?.operation || !!t?.dirty}>{uiText("拉取")}</Action>
            <Action action="git-task-push" id={m.project_id} data-path={m.path} data-requirement={q.id} disabled={!active || !!t?.detached || !!t?.operation}>{uiText("推送")}</Action>
            <Action action="project-open-remote" id={m.project_id} data-path={m.path} disabled={!usable}>{uiText("打开远端仓库")}</Action>
            <hr />
            <Action action="change-task-directory" id={q.id} data-project={m.project_id} disabled={!editable}>{uiText("更换工作目录")}</Action>
            <Action action="remove-task-project" id={q.id} data-project={m.project_id} disabled={!editable} className="text-destructive">{uiText("从任务移除")}</Action>
          </div></details>
        </div>
        {drifted ? <div className="table-message task-project-notice">{uiText("分支已变化，原记录为")}{" "}{expected}<Action action="git-task-adopt" id={m.project_id} data-path={m.path} data-requirement={q.id} disabled={!active || !!t?.detached}>{uiText("采用当前分支")}</Action></div> : null}
        {notice ? <div className={`task-project-notice task-directory-notice${issue ? " has-issue" : ""}`} role="status">{issue ? <CircleAlert aria-hidden="true" /> : null}<span>{notice}</span>{issue ? <div className="task-recovery-actions">{retryable ? <Action action="retry" id={q.id} data-project={m.project_id} disabled={!editable}>{m.state === "removed" ? uiText("恢复此目录") : uiText("重试此项目")}</Action> : null}<Action action="change-task-directory" id={q.id} data-project={m.project_id} disabled={!editable || !projects.some(p => p.id === m.project_id)}>{uiText("更换工作目录")}</Action>{!editable ? <span className="task-recovery-help">{q.state === "archived" ? uiText("取消归档后可处理目录。") : uiText("任务创建完成后可处理目录。")}</span> : null}</div> : null}</div> : null}
        {t?.operation === "merge" ? <div className="task-project-notice"><Action action="git-task-ai" id={m.project_id} data-path={m.path} data-requirement={q.id} disabled={!active}>{uiText("让 AI 完成合并")}</Action></div> : null}
        <details className="task-project-details" data-workspace-detail={`project:${m.project_id}`}><summary>{uiText("详细信息")}</summary><div className="task-project-details-body">
          <div className="task-full-path">{uiText("工作目录")}{" "}<code>{m.path}</code></div>
          <div>{uiText("创建来源")}{" "}<code>{creationRef}</code>{m.base_commit ? <> · <code>{m.base_commit.slice(0,8)}</code></> : null}</div>
          <div className="task-baseline" title={uiText("创建来源：{0}{1}", creationRef, m.base_commit ? uiText("；创建提交：{0}", m.base_commit) : "")}>{uiText("基线")}{" "}<code>{baseline}</code> · {difference}</div>
          {t?.status_updated_at ? <div>{uiText("上次检查")} <time data-status-path={t.path} dateTime={t.status_updated_at}>{new Date(t.status_updated_at).toLocaleTimeString(uiLocale(), { hour12: false })}</time></div> : null}
        </div></details>
      </article>
    })}</div>
  </Card>
}
