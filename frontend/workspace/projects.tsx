import { ResourceIcon } from "./shortcut-icons"
import { uiText } from "../i18n";
import { ChevronRight, Circle, CircleAlert, Copy, FolderGit2, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Action, Feedback, StatusBadge, type ProjectOpenTool } from "./shared"
import type { Project, Workspace, Worktree } from "./types"
import { compactWorkspacePath } from "./workspace-path"
import { ResourceSwitcherTrigger } from "./list-controls"
import { WorkingDirectoryGroup, WorkingDirectoryRow, WorkingDirectoryTable, directoryBranch } from "./working-directories"

export type ProjectFilter = "all" | "dirty" | "error"
export type DirectoryFilter = "all" | "issues"
const directoryHasIssue = (t: Worktree) => !!(t.missing || t.prunable || t.error)
const directoryNeedsAttention = (tree: Worktree) => directoryHasIssue(tree) || !!(tree.dirty || tree.operation || tree.conflicts?.length ||
  (tree.upstream && !tree.detached && tree.sync_available && (tree.sync_ahead || tree.sync_behind)))
const hasIssue = (p: Project) => !!p.error || p.worktrees.some(directoryHasIssue)
const hasChanges = (p: Project) => p.worktrees.some(t => (t.dirty || 0) > 0)
const directoryWorkspaces = (t: Worktree) => t.workspaces?.length ? t.workspaces : t.workspace_id ? [{ id: t.workspace_id, name: t.workspace_name || t.workspace_id }] : []

function DirectoryRecovery({ tree, project, workspaces }: { tree: Worktree; project: Project; workspaces: Workspace[] }) {
  if (!directoryHasIssue(tree)) return null
  const linked = directoryWorkspaces(tree)
  const message = tree.error || (tree.missing ? linked.length ? uiText("目录已丢失，可更换关联工作区的工作目录，或检查原路径后重试。") : uiText("目录已丢失，请检查原路径，或创建新的工作目录。") : uiText("Worktree 登记需要修复，请检查目录是否仍在原位置。"))
  return <div className="project-directory-recovery" role="status" aria-label={uiText("处理 {0} 的目录异常", tree.path)}><p><CircleAlert aria-hidden="true" />{message}</p><div className="project-recovery-actions">
    <Action action="project-refresh" id={project.id}>{uiText("重新检查")}</Action>
    {linked.map(link => {
      const workspace = workspaces.find(workspace => workspace.id === link.id)
      const editable = workspace && workspace.state !== "archived" && workspace.state !== "creating"
      return <div className="project-workspace-recovery" key={link.id}><Action action="change-workspace-directory" id={link.id} data-project={project.id} disabled={!editable}>{linked.length === 1 ? uiText("更换工作目录") : uiText("更换「{0}」的目录", link.name || link.id)}</Action>{!editable ? <span>{workspace?.state === "archived" ? uiText("取消归档后可更换目录") : workspace?.state === "creating" ? uiText("工作区创建完成后可更换目录") : uiText("工作区信息暂不可用，请重新检查")}</span> : null}</div>
    })}
    {!linked.length ? <><Action action="new-worktree" id={project.id}>{uiText("创建 Worktree")}</Action><span>{uiText("此目录未关联工作区，可创建新目录继续工作。")}</span></> : null}
  </div></div>
}

function ProjectDirectoryDetails({ tree }: { tree: Worktree }) {
  return <>
    <div>{uiText("当前分支")} <code>{directoryBranch(tree)}</code></div>
    {tree.compare_available ? <div>{uiText("相对基线")} <code>{tree.comparison_ref || "master"}</code> · {tree.ahead || tree.behind ? uiText("领先 {0} · 落后 {1}", tree.ahead || 0, tree.behind || 0) : uiText("与基线一致")}</div> : null}
    {tree.upstream ? <div>{uiText("上游")} <code>{tree.upstream}</code></div> : null}
    {tree.locked ? <div>{uiText("工作目录已锁定")}</div> : null}
    {!tree.status_updated_at ? <div>{directoryHasIssue(tree) ? uiText("目录不可用，暂无法读取最新状态") : uiText("正在检查目录状态")}</div> : null}
  </>
}

function LinkedWorkspaces({ linked, path }: { linked: NonNullable<Worktree["workspaces"]>; path: string }) {
  return linked.length ? <div className="project-linked-workspaces">
    {linked.map(workspace => {
      const name = workspace.name || workspace.id
      return <Action key={workspace.id} action="jump-workspace" id={workspace.id} data-path={path} variant="secondary" className="directory-workspace-link h-auto" title={name} aria-label={uiText("打开工作区 {0}", name)}><span>{name}</span><span aria-hidden="true">↗</span></Action>
    })}
  </div> : <span className="directory-muted">{uiText("未关联工作区")}</span>
}

export function Projects({ projects, selectedID, openTool = "vscode", filter = "all", detailOpen = false, workspaces = [], directoryFilter = "all", searching = false, status, sourceWorkspace }: {
  projects: Project[]; selectedID: string | null; openTool?: ProjectOpenTool; filter?: ProjectFilter; detailOpen?: boolean; workspaces?: Workspace[]; directoryFilter?: DirectoryFilter; searching?: boolean; status?: "loading" | "empty"; sourceWorkspace?: string
}) {
  const visible = projects.filter(p => filter === "dirty" ? hasChanges(p) : filter === "error" ? hasIssue(p) : true)
  const p = detailOpen ? projects.find(p => p.id === selectedID) : undefined
  const filters = [{ value: "all", label: uiText("全部"), count: projects.length }, { value: "error", label: uiText("异常"), count: projects.filter(hasIssue).length }, { value: "dirty", label: uiText("有改动"), count: projects.filter(hasChanges).length }]
  const issues = p?.worktrees.filter(directoryHasIssue).length || 0
  const directories = p?.worktrees.filter(t => directoryFilter === "all" || directoryHasIssue(t)) || []
  const main = directories.find(tree => tree.path === p?.path)
  const worktrees = directories.filter(tree => tree !== main)
  const attention = worktrees.filter(directoryNeedsAttention)
  const other = worktrees.filter(tree => !directoryNeedsAttention(tree))
  const renderDirectory = (tree: Worktree, project: Project) => {
    const linked = directoryWorkspaces(tree)
    const issue = directoryHasIssue(tree)
    const name = tree === main ? uiText("主工作目录") : tree.branch || tree.path.split(/[\\/]/).filter(Boolean).pop() || tree.path
    return <WorkingDirectoryRow
      key={tree.path} project={project.id} name={name} path={tree.path} tree={tree} tool={openTool}
      primary={tree === main} usable={!tree.bare && !issue && !!tree.status_updated_at} issue={issue}
      linkedWorkspaces={<LinkedWorkspaces linked={linked} path={tree.path} />}
      details={<ProjectDirectoryDetails tree={tree} />}
      notice={issue ? <DirectoryRecovery tree={tree} project={project} workspaces={workspaces} /> : null}
    />
  }
  return <div className="project-workspace shadcn-scope" data-pane={detailOpen ? "detail" : "list"}>
    <section id="projectListPane" className="project-browser resource-list-page workspace-pane" aria-label={uiText("项目列表")} hidden={detailOpen}>
      <div className="project-filters" role="group" aria-label={uiText("筛选项目")} hidden={!!status}>{filters.map(f => <Action key={f.value} action="project-filter" data-filter={f.value} variant={filter === f.value ? "secondary" : "ghost"} aria-pressed={filter === f.value}>{f.label}<span>{f.count}</span></Action>)}</div>
      <div className="project-list-scroll resource-list-scroll">{visible.map(project => {
        const dirty = project.worktrees.filter(t => (t.dirty || 0) > 0).length
        return <Button key={project.id} type="button" variant="ghost" className="project-list-item grid h-auto min-w-0 whitespace-normal text-left font-normal" data-action="select-project" data-id={project.id} aria-pressed={selectedID === project.id} aria-controls="projectDetail" aria-label={uiText("打开 {0} 的工作目录", project.name)}>
          <span className={`project-list-name${hasIssue(project) ? " has-issue" : ""}`}>{hasIssue(project) ? <CircleAlert aria-hidden="true" /> : <FolderGit2 aria-hidden="true" />}<strong>{project.name}</strong></span>
          <span className="project-list-path" title={project.path}>{project.path}</span>
          <span className="project-list-meta"><span>{project.worktrees.length}{" "}{uiText("个目录")}</span>{hasIssue(project) ? <StatusBadge kind="failed">{project.error ? uiText("读取失败") : uiText("{0} 个异常", project.worktrees.filter(directoryHasIssue).length)}</StatusBadge> : null}{dirty ? <span className="project-change-indicator" title={uiText("{0} 个工作目录有未提交改动", dirty)} aria-label={uiText("{0} 个工作目录有未提交改动", dirty)}><Circle className="project-change-dot size-1.5" aria-hidden="true" />{dirty}{" "}{uiText("个目录有改动")}</span> : !project.status_updated_at && project.refreshing ? <span>{uiText("正在检查")}</span> : null}</span><ChevronRight className="project-list-enter" aria-hidden="true" />
        </Button>
      })}{status ? <div className="project-list-empty" role="status">{status === "loading" ? uiText("正在读取当前环境的项目…") : uiText("当前环境没有已登记的项目")}</div> : !visible.length ? <div className="project-list-empty">{uiText("没有匹配的项目")}{searching ? <Action action="clear-project-search" variant="link">{uiText("清除搜索")}</Action> : null}{filter !== "all" ? <Action action="project-filter" data-filter="all" variant="link">{uiText("查看全部项目")}</Action> : null}{!searching && filter === "all" ? <span>{uiText("试试其他名称或路径")}</span> : null}</div> : null}</div>
    </section>
    <section id="projectDetail" className="project-detail workspace-pane" hidden={!detailOpen} aria-label={p ? uiText("{0} 项目详情", p.name) : uiText("项目详情")}>
      <div className="resource-detail-content project-detail-content">{p ? <>
        <header className="project-detail-heading"><div><div className="resource-detail-title">
          <a href="#/projects" className="resource-breadcrumb-link" data-action="project-list" aria-label={uiText("返回项目列表")}>{uiText("项目")}</a>
          <span className="resource-breadcrumb-divider" aria-hidden="true">/</span><ResourceIcon kind="project" id={p.id} name={p.name} environment="" editable /><h2 tabIndex={-1}>{p.name}</h2><ResourceSwitcherTrigger kind="project" />
        </div><button type="button" className="directory-path" data-action="copy-path" data-path={p.path} title={uiText("{0}\n复制项目路径", p.path)} aria-label={uiText("复制项目路径 {0}", p.path)}><span>{compactWorkspacePath(p.path)}</span><Copy aria-hidden="true" /></button></div>
          <div className="project-detail-actions">{sourceWorkspace ? <Action action="jump-workspace" id={sourceWorkspace} data-return-directory variant="ghost">{uiText("返回工作区")}</Action> : null}<Action action="project-conversations" id={p.id}>{uiText("相关对话")}</Action><Action action="new-worktree" id={p.id} variant="default" disabled={!!p.error}>{uiText("创建 Worktree")}</Action>
            <details className="workspace-project-details project-more"><summary aria-label={uiText("更多项目操作")}><MoreHorizontal aria-hidden="true" /></summary><div className="workspace-project-details-body"><Action action="git-open" id={p.id} variant="ghost">{uiText("Git 操作 · 分支管理")}</Action><Action action="project-open-remote" id={p.id} data-path={p.path} variant="ghost" disabled={!!p.error}>{uiText("打开远端仓库")}</Action><hr /><Action action="remove-project" id={p.id} variant="ghost" className="text-destructive">{uiText("移除登记")}</Action></div></details>
          </div>
        </header>
        <div className="resource-section-heading project-directories-heading">
          <h3>{uiText("工作目录")} <span className="resource-section-count">{p.worktrees.length}</span></h3>
          {p.worktrees.length ? <div className="project-directory-filters" role="group" aria-label={uiText("筛选工作目录")}>
            <Action action="project-directory-filter" id={p.id} data-filter="all" aria-pressed={directoryFilter === "all"} variant={directoryFilter === "all" ? "secondary" : "outline"}>{uiText("全部目录 ·")} {p.worktrees.length}</Action>
            {issues || directoryFilter === "issues" ? <Action action="project-directory-filter" id={p.id} data-filter="issues" aria-pressed={directoryFilter === "issues"} variant={directoryFilter === "issues" ? "secondary" : "outline"} className={issues ? "project-issue-filter" : undefined}><CircleAlert aria-hidden="true" />{uiText("需要处理 ·")} {issues}</Action> : null}
          </div> : null}
        </div>
        {p.error ? <Feedback variant="destructive"><p className="m-0">{uiText("项目读取失败：")}{p.error}</p><Action action="project-refresh" id={p.id}>{uiText("重新检查")}</Action></Feedback> : directories.length ? <WorkingDirectoryTable label={uiText("项目工作目录")} showLinkedWorkspaces>
          {main ? renderDirectory(main, p) : null}
          {attention.length ? <WorkingDirectoryGroup label={uiText("需要关注")} count={attention.length} /> : null}
          {attention.map(tree => renderDirectory(tree, p))}
          {other.length ? <WorkingDirectoryGroup label={uiText("其他 Worktree")} count={other.length} /> : null}
          {other.map(tree => renderDirectory(tree, p))}
        </WorkingDirectoryTable> : directoryFilter === "issues" && p.worktrees.length ? <div className="project-detail-empty">{uiText("没有需要处理的工作目录。")}<Action action="project-directory-filter" id={p.id} data-filter="all">{uiText("查看全部目录")}</Action></div> : <div className="project-detail-empty">{p.refreshing ? uiText("正在发现工作目录…") : uiText("尚未发现工作目录，请检查项目路径后重新扫描。")}{!p.refreshing ? <Action action="project-refresh" id={p.id}>{uiText("重新检查")}</Action> : null}</div>}
      </> : <div className="project-detail-empty">{status === "empty" ? uiText("登记本地 Git 仓库，或从 Git 克隆新项目。已有 Worktree 会自动发现。") : status === "loading" ? uiText("正在读取当前环境的项目…") : uiText("这个项目已不存在，请重新选择项目")}</div>}
      {!p && detailOpen && <a href="#/projects" data-action="project-list" className="resource-breadcrumb-link">{uiText("返回项目列表")}</a>}</div>
    </section>
  </div>
}
