import { uiText } from "../i18n";
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CircleAlert, ClipboardCheck, Plus, SlidersHorizontal } from "lucide-react"
import { Action, StatusBadge, TreeStatus, canOpenMember, reusesDirectory, type ProjectOpenTool } from "./shared"
import type { Project, Workspace } from "./types"
import { memberSignals, workspaceSignals, workspaceFilterLabels, type WorkspaceFilter } from "./workspace-signals"
import { WorkingDirectoryRow, WorkingDirectoryTable } from "./working-directories"

export function WorkspaceList({ workspaces, selectedID, environment }: { workspaces: Workspace[]; selectedID?: string | null; environment?: string }) {
  return <div className="workspace-list shadcn-scope divide-y divide-border">{workspaces.map(q => {
    const {issues,dirty,push,conflicts,checking} = workspaceSignals(q)
    const status = !q.connected ? uiText("环境未连接") : !q.members.length ? uiText("待关联项目") : [issues ? uiText("{0} 个目录异常", issues) : "", conflicts ? uiText("{0} 个 Git 操作待处理", conflicts) : "", dirty ? uiText("{0} 个项目有改动", dirty) : "", push ? uiText("{0} 个项目待推送", push) : ""].filter(Boolean).join(" · ") || (checking ? uiText("等待检查工作目录") : uiText("无未提交改动"))
    return <Card key={`${q.environment_id}:${q.id}`} className="gap-0 rounded-none border-0 p-0 shadow-none"><a className="list-row focus-visible:outline-ring" aria-current={q.id === selectedID && q.environment_id === environment ? "true" : undefined} href={`?environment=${encodeURIComponent(q.environment_id)}#/workspaces/${encodeURIComponent(q.id)}`} data-action="open-workspace" data-id={q.id} data-environment={q.environment_id} aria-label={uiText("打开工作区 {0}", q.name)}><div className="row-main"><div className="row-title">{q.name}{q.state === "archived" ? <StatusBadge kind="archived" /> : null}</div>{q.description?.trim() && q.description.trim() !== q.name.trim() ? <div className="workspace-list-description">{q.description}</div> : null}<div className="row-subtitle">{q.members.length}{" "}{uiText("个项目 ·")}{" "}{q.environment_name}</div></div><div className="row-meta"><span className={`workspace-list-status${issues || conflicts || !q.connected ? " has-issues" : dirty || push ? " has-work" : ""}`}>{status}</span><time className="row-time" dateTime={q.created_at} title={uiText("创建时间：{0}", new Date(q.created_at).toLocaleString("zh-CN"))}>{uiText("创建于")}{" "}{new Date(q.created_at).toLocaleDateString("zh-CN")}</time></div><span className="chevron" aria-hidden="true">›</span></a></Card>
  })}</div>
}

export function WorkspaceActions({ workspace: q, environment }: { workspace: Workspace; environment: string }) {
  return <div className="workspace-page-actions shadcn-scope">
    <span className="workspace-environment">{environment}</span>
    {q.state !== "ready" ? <StatusBadge kind={q.state} /> : null}
    <Action action="workspace-review" id={q.id} disabled={q.state === "creating"} aria-label={uiText("开始收尾检查")}><ClipboardCheck aria-hidden="true" />{uiText("收尾检查")}</Action>
    <details className="workspace-more" data-workspace-detail="workspace-actions"><summary>{uiText("更多")}</summary><div className="workspace-more-menu">
      <Action action="edit-workspace" id={q.id} disabled={q.state === "creating"}>{uiText("编辑工作区信息")}</Action>
      <Action action="archive" id={q.id}>{q.state === "archived" ? uiText("取消归档") : uiText("归档工作区")}</Action>
      <hr />
      <Action action="remove-workspace" id={q.id} disabled={q.state === "creating"} className="text-destructive">{uiText("删除工作区记录")}</Action>
    </div></details>
  </div>
}

export function WorkspaceDetail({ workspace: q, projects, openTool = "vscode", filter = "all" }: { workspace: Workspace; projects: Project[]; environment: string; openTool?: ProjectOpenTool; filter?: WorkspaceFilter }) {
  const pending = (m: Workspace["members"][number]) => m.state === "ready" && !m.worktree?.status_updated_at && (!m.worktree || !!projects.find(p => p.id === m.project_id)?.refreshing)
  const editable = q.state !== "archived" && q.state !== "creating"
  const signals = workspaceSignals(q)
  const available = q.members.filter(canOpenMember).length
  const summary = !q.members.length ? uiText("关联项目后，在这里查看分支、改动和目录状态。") : [
    uiText("{0} 个关联项目", q.members.length), uiText("{0} 个目录可打开", available),
    signals.issues ? uiText("{0} 个目录需要处理", signals.issues) : "",
    signals.checking ? uiText("{0} 个目录正在检查", signals.checking) : "",
  ].filter(Boolean).join(" · ")
  const members = q.members.filter(m => filter === "all" || memberSignals(m)[filter])
  const filterKinds = Object.keys(workspaceFilterLabels) as WorkspaceFilter[]
  const quickFilters = filterKinds.filter(kind => kind === "all" || kind === filter || signals[kind] > 0)
  const otherFilters = filterKinds.filter(kind => !quickFilters.includes(kind))
  const showFilters = q.members.length > 1 || filter !== "all" || signals.issues > 0 || signals.dirty > 0 || signals.push > 0 || signals.conflicts > 0
  const filterButton = (kind: WorkspaceFilter) => <Action key={kind} action="workspace-project-filter" id={q.id} data-filter={kind} aria-pressed={kind === filter} className={kind === "issues" && signals.issues ? "workspace-issue-filter" : undefined} variant={kind === filter ? "secondary" : "outline"}>{kind === "issues" && signals.issues ? <CircleAlert aria-hidden="true" /> : null}{workspaceFilterLabels[kind]} · {kind === "all" ? q.members.length : signals[kind]}</Action>
  return <div className="shadcn-scope resource-detail-content workspace-summary">
    <div className="workspace-directory-overview">
      <div className="workspace-overview-main">
        <section className="workspace-info" aria-label={uiText("工作区目标")}>
          <div className="workspace-info-heading">
            <h2>{uiText("工作区目标")}</h2>
            {q.description?.trim() ? <Action variant="ghost" action="edit-workspace" id={q.id} disabled={q.state === "creating"}>{uiText("编辑目标")}</Action> : null}
          </div>
          {q.description?.trim()
            ? <><p id="workspaceDescription" className="workspace-description workspace-description-clamped">{q.description}</p>
              <button type="button" className="workspace-info-toggle" data-action="workspace-info-toggle" aria-controls="workspaceDescription" aria-expanded="false" hidden>{uiText("查看全部")}</button></>
            : <Action variant="ghost" action="edit-workspace" id={q.id} disabled={q.state === "creating"} className="h-auto p-0"><Plus aria-hidden="true" />{uiText("添加工作区目标")}</Action>}
        </section>
        <div className="workspace-overview-actions">
          <Action action="workspace-conversations" id={q.id}>{uiText("查看相关对话")}</Action>
          <Button type="button" size="sm" data-session-action="new" data-workspace={q.id} disabled={q.state !== "ready"}>{uiText("新建对话")}</Button>
        </div>
      </div>
      <div className="workspace-overview-status">
        <p className="workspace-project-summary">{summary}</p>
        {showFilters ? <div className="workspace-signal-filters" role="group" aria-label={uiText("按项目状态筛选")}>
          {quickFilters.map(filterButton)}
          {otherFilters.length > 0 ? <details className="workspace-more workspace-filter-more"><summary aria-label={uiText("更多项目状态筛选")}><SlidersHorizontal aria-hidden="true" />{uiText("更多筛选")}</summary><div className="workspace-more-menu">{otherFilters.map(filterButton)}</div></details> : null}
        </div> : null}
      </div>
    </div>
    <header className="resource-section-heading">
      <h2>{uiText("关联项目与工作目录")}</h2>
      <Action action="add-workspace-projects" id={q.id} disabled={!editable || q.members.length >= 30}><Plus aria-hidden="true" />{uiText("添加项目")}</Action>
    </header>
    {!q.members.length ? <div className="workspace-project-empty">{uiText("尚未关联项目。添加项目并选择工作目录，即可继续这项工作。")}</div> : null}
    {q.members.length > 0 && !members.length ? <p className="workspace-project-empty">{uiText("没有符合此状态的项目。")}<Action action="workspace-project-filter" id={q.id} data-filter="all">{uiText("查看全部项目")}</Action></p> : null}
    {members.length ? <WorkingDirectoryTable label={uiText("关联项目与工作目录")}>{members.map(m => {
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
      const directoryKind = {project: uiText("项目原目录"), worktree: uiText("已有 Worktree"), new: uiText("新建 Worktree"), existing: uiText("新建 Worktree（已有分支）")}[m.mode || "new"]
      const unavailableStatus = m.state !== "ready" ? <StatusBadge kind={m.state} /> :
        m.error ? <StatusBadge kind="failed">{uiText("目录不可用")}</StatusBadge> : <TreeStatus tree={t} pending={pending(m)} compact />
      const directoryNotice = drifted || notice || t?.operation === "merge" ? <>
        {drifted ? <div className="table-message workspace-project-notice">{uiText("分支已变化，原记录为")}{" "}{expected}<Action action="git-workspace-adopt" id={m.project_id} data-path={m.path} data-workspace={q.id} disabled={!active || !!t?.detached}>{uiText("采用当前分支")}</Action></div> : null}
        {notice ? <div className={`workspace-project-notice workspace-directory-notice${issue ? " has-issue" : ""}`} role="status">{issue ? <CircleAlert aria-hidden="true" /> : null}<span>{notice}</span>{issue ? <div className="workspace-recovery-actions">{retryable ? <Action action="retry" id={q.id} data-project={m.project_id} disabled={!editable}>{m.state === "removed" ? uiText("恢复此目录") : uiText("重试此项目")}</Action> : null}<Action action="change-workspace-directory" id={q.id} data-project={m.project_id} disabled={!editable || !projects.some(p => p.id === m.project_id)}>{uiText("更换工作目录")}</Action>{!editable ? <span className="workspace-recovery-help">{q.state === "archived" ? uiText("取消归档后可处理目录。") : uiText("工作区创建完成后可处理目录。")}</span> : null}</div> : null}</div> : null}
        {t?.operation === "merge" ? <div className="workspace-project-notice"><Action action="git-workspace-ai" id={m.project_id} data-path={m.path} data-workspace={q.id} disabled={!active}>{uiText("让 AI 完成合并")}</Action></div> : null}
      </> : null
      return <WorkingDirectoryRow
        key={m.project_id} project={m.project_id} name={m.project_name} path={m.path} tree={t} tool={openTool}
        usable={usable} issue={issue} workspace={{ id: q.id, editable }} unavailableStatus={unavailableStatus}
        details={<>
          <div>{directoryKind}</div>
          <div>{uiText("创建来源")} <code>{creationRef}</code>{m.base_commit ? <> · <code>{m.base_commit.slice(0, 8)}</code></> : null}</div>
          <div className="workspace-baseline" title={uiText("创建来源：{0}{1}", creationRef, m.base_commit ? uiText("；创建提交：{0}", m.base_commit) : "")}>{uiText("基线")} <code>{baseline}</code> · {difference}</div>
        </>}
        gitMenuActions={<>
          <Action action="git-workspace-pull" id={m.project_id} data-path={m.path} data-workspace={q.id} disabled={!active || !!t?.detached || !!t?.operation || !!t?.dirty}>{uiText("拉取")}</Action>
          <Action action="git-workspace-push" id={m.project_id} data-path={m.path} data-workspace={q.id} disabled={!active || !!t?.detached || !!t?.operation}>{uiText("推送")}</Action>
        </>}
        workspaceMenuActions={<>
          <Action action="change-workspace-directory" id={q.id} data-project={m.project_id} disabled={!editable}>{uiText("更换工作目录")}</Action>
          <Action action="remove-workspace-project" id={q.id} data-project={m.project_id} disabled={!editable} className="text-destructive">{uiText("从工作区移除")}</Action>
        </>}
        notice={directoryNotice}
      />
    })}</WorkingDirectoryTable> : null}
  </div>
}
