import { uiText } from "../i18n";
import { ArrowLeft, Circle, CircleAlert, Copy, FolderGit2, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Action, Feedback, StatusBadge, type ProjectOpenTool } from "./shared"
import type { Project, Task, Worktree } from "./types"
import { compactWorkspacePath } from "./workspace-path"
import { WorkingDirectoryRow, WorkingDirectoryTable, directoryBranch } from "./working-directories"

export type ProjectFilter = "all" | "dirty" | "error"
export type DirectoryFilter = "all" | "issues"
const directoryHasIssue = (t: Worktree) => !!(t.missing || t.prunable || t.error)
const hasIssue = (p: Project) => !!p.error || p.worktrees.some(directoryHasIssue)
const hasChanges = (p: Project) => p.worktrees.some(t => (t.dirty || 0) > 0)
const directoryTasks = (t: Worktree) => t.requirements?.length ? t.requirements : t.requirement_id ? [{ id: t.requirement_id, name: t.requirement_name || t.requirement_id }] : []

function DirectoryRecovery({ tree, project, tasks }: { tree: Worktree; project: Project; tasks: Task[] }) {
  if (!directoryHasIssue(tree)) return null
  const linked = directoryTasks(tree)
  const message = tree.error || (tree.missing ? linked.length ? uiText("目录已丢失，可更换关联任务的工作目录，或检查原路径后重试。") : uiText("目录已丢失，请检查原路径，或创建新的工作目录。") : uiText("Worktree 登记需要修复，请检查目录是否仍在原位置。"))
  return <div className="project-directory-recovery" role="status" aria-label={uiText("处理 {0} 的目录异常", tree.path)}><p><CircleAlert aria-hidden="true" />{message}</p><div className="project-recovery-actions">
    <Action action="project-refresh" id={project.id}>{uiText("重新检查")}</Action>
    {linked.map(link => {
      const task = tasks.find(task => task.id === link.id)
      const editable = task && task.state !== "archived" && task.state !== "creating"
      return <div className="project-task-recovery" key={link.id}><Action action="change-task-directory" id={link.id} data-project={project.id} disabled={!editable}>{linked.length === 1 ? uiText("更换工作目录") : uiText("更换「{0}」的目录", link.name || link.id)}</Action>{!editable ? <span>{task?.state === "archived" ? uiText("取消归档后可更换目录") : task?.state === "creating" ? uiText("任务创建完成后可更换目录") : uiText("任务信息暂不可用，请重新检查")}</span> : null}</div>
    })}
    {!linked.length ? <><Action action="new-worktree" id={project.id}>{uiText("创建 Worktree")}</Action><span>{uiText("此目录未关联任务，可创建新目录继续工作。")}</span></> : null}
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

function LinkedWorkspaces({ linked }: { linked: NonNullable<Worktree["requirements"]> }) {
  return linked.length ? <div className="project-linked-workspaces">
    {linked.map(workspace => {
      const name = workspace.name || workspace.id
      return <Action key={workspace.id} action="jump-requirement" id={workspace.id} variant="link" title={name} aria-label={uiText("打开工作区 {0}", name)}><span>{name}</span><span aria-hidden="true">↗</span></Action>
    })}
  </div> : <span className="directory-muted">{uiText("未关联工作区")}</span>
}

export function Projects({ projects, selectedID, openTool = "vscode", filter = "all", detailOpen = false, tasks = [], directoryFilter = "all", searching = false, status }: {
  projects: Project[]; selectedID: string | null; openTool?: ProjectOpenTool; filter?: ProjectFilter; detailOpen?: boolean; tasks?: Task[]; directoryFilter?: DirectoryFilter; searching?: boolean; status?: "loading" | "empty"
}) {
  const visible = projects.filter(p => filter === "dirty" ? hasChanges(p) : filter === "error" ? hasIssue(p) : true)
  const p = visible.find(p => p.id === selectedID) || visible[0]
  const filters = [{ value: "all", label: uiText("全部"), count: projects.length }, { value: "error", label: uiText("异常"), count: projects.filter(hasIssue).length }, { value: "dirty", label: uiText("有改动"), count: projects.filter(hasChanges).length }]
  const issues = p?.worktrees.filter(directoryHasIssue).length || 0
  const directories = p?.worktrees.filter(t => directoryFilter === "all" || directoryHasIssue(t)) || []
  return <div className="project-workspace shadcn-scope" data-pane={detailOpen && p ? "detail" : "list"}>
    <aside id="projectListPane" className="project-browser workspace-pane" aria-label={uiText("项目列表")}>
      <div className="project-filters" role="group" aria-label={uiText("筛选项目")} hidden={!!status}>{filters.map(f => <Action key={f.value} action="project-filter" data-filter={f.value} variant={filter === f.value ? "secondary" : "ghost"} aria-pressed={filter === f.value}>{f.label}<span>{f.count}</span></Action>)}</div>
      <div className="project-list-scroll">{visible.map(project => {
        const dirty = project.worktrees.filter(t => (t.dirty || 0) > 0).length
        return <Button key={project.id} type="button" variant="ghost" className="project-list-item flex h-auto w-full min-w-0 flex-col items-stretch gap-2 whitespace-normal p-3 text-left font-normal" data-action="select-project" data-id={project.id} aria-pressed={p?.id === project.id} aria-controls="projectDetail" aria-label={uiText("打开 {0} 的工作目录", project.name)}>
          <span className={`project-list-name${hasIssue(project) ? " has-issue" : ""}`}>{hasIssue(project) ? <CircleAlert aria-hidden="true" /> : <FolderGit2 aria-hidden="true" />}<strong>{project.name}</strong></span>
          <span className="project-list-path" title={project.path}>{project.path}</span>
          <span className="project-list-meta"><span>{project.worktrees.length}{" "}{uiText("个目录")}</span>{hasIssue(project) ? <StatusBadge kind="failed">{project.error ? uiText("读取失败") : uiText("{0} 个异常", project.worktrees.filter(directoryHasIssue).length)}</StatusBadge> : null}{dirty ? <span className="project-change-indicator" title={uiText("{0} 个工作目录有未提交改动", dirty)} aria-label={uiText("{0} 个工作目录有未提交改动", dirty)}><Circle className="project-change-dot size-1.5" aria-hidden="true" />{dirty}{" "}{uiText("个目录有改动")}</span> : !project.status_updated_at && project.refreshing ? <span>{uiText("正在检查")}</span> : null}<span className="project-list-enter">{uiText("查看目录 →")}</span></span>
        </Button>
      })}{status ? <div className="project-list-empty" role="status">{status === "loading" ? uiText("正在读取当前环境的项目…") : uiText("当前环境没有已登记的项目")}</div> : !visible.length ? <div className="project-list-empty">{uiText("没有匹配的项目")}{searching ? <Action action="clear-project-search" variant="link">{uiText("清除搜索")}</Action> : null}{filter !== "all" ? <Action action="project-filter" data-filter="all" variant="link">{uiText("查看全部项目")}</Action> : null}{!searching && filter === "all" ? <span>{uiText("试试其他名称或路径")}</span> : null}</div> : null}</div>
    </aside>
    <div className="project-resize-handle" role="separator" aria-label={uiText("调整项目列表宽度")} aria-orientation="vertical" aria-controls="projectListPane projectDetail" aria-valuemin={200} aria-valuemax={640} aria-valuenow={248} tabIndex={0} data-project-resize title={uiText("拖动调整两栏宽度，也可使用左右方向键")} />
    <section id="projectDetail" className="project-detail workspace-pane" aria-label={p ? uiText("{0} 项目详情", p.name) : uiText("项目详情")}>
      {p ? <>
        <div className="project-list-back"><Action action="project-list" variant="ghost" className="pl-0 text-muted-foreground"><ArrowLeft aria-hidden="true" />{uiText("返回项目列表")}</Action></div>
        <header className="project-detail-heading"><div><h2 tabIndex={-1}>{p.name}</h2><button type="button" className="directory-path" data-action="copy-path" data-path={p.path} title={uiText("{0}\n复制项目路径", p.path)} aria-label={uiText("复制项目路径 {0}", p.path)}><span>{compactWorkspacePath(p.path)}</span><Copy aria-hidden="true" /></button></div>
          <div className="project-detail-actions"><Action action="project-conversations" id={p.id}>{uiText("相关对话")}</Action><Action action="new-worktree" id={p.id} disabled={!!p.error}>{uiText("创建 Worktree")}</Action>
            <details className="task-project-details project-more"><summary aria-label={uiText("更多项目操作")}><MoreHorizontal aria-hidden="true" /></summary><div className="task-project-details-body"><Action action="git-open" id={p.id} variant="ghost">{uiText("Git 操作 · 分支管理")}</Action><Action action="project-open-remote" id={p.id} data-path={p.path} variant="ghost" disabled={!!p.error}>{uiText("打开远端仓库")}</Action><hr /><Action action="remove-project" id={p.id} variant="ghost" className="text-destructive">{uiText("移除登记")}</Action></div></details>
          </div>
        </header>
        <div className="project-directories-heading"><h3>{uiText("工作目录")}{" "}<span>{p.worktrees.length}</span></h3><span>{uiText("自动发现并更新本地状态")}</span></div>
        {p.worktrees.length ? <div className="project-directory-filters" aria-label={uiText("筛选工作目录")}><Action action="project-directory-filter" id={p.id} data-filter="all" aria-pressed={directoryFilter === "all"} variant={directoryFilter === "all" ? "secondary" : "outline"}>{uiText("全部目录 ·")}{" "}{p.worktrees.length}</Action>{issues || directoryFilter === "issues" ? <Action action="project-directory-filter" id={p.id} data-filter="issues" aria-pressed={directoryFilter === "issues"} variant={directoryFilter === "issues" ? "secondary" : "outline"} className={issues ? "project-issue-filter" : undefined}><CircleAlert aria-hidden="true" />{uiText("需要处理 ·")}{" "}{issues}</Action> : null}</div> : null}
        {p.error ? <Feedback variant="destructive"><p className="m-0">{uiText("项目读取失败：")}{p.error}</p><Action action="project-refresh" id={p.id}>{uiText("重新检查")}</Action></Feedback> : directories.length ? <WorkingDirectoryTable label={uiText("项目工作目录")} showLinkedWorkspaces>
          {directories.map(tree => {
            const linked = directoryTasks(tree)
            const issue = directoryHasIssue(tree)
            const name = tree.path === p.path ? uiText("主工作目录") : linked.length ? linked.map(workspace => workspace.name || workspace.id).join("、") : tree.branch || tree.path.split(/[\\/]/).filter(Boolean).pop() || tree.path
            return <WorkingDirectoryRow
              key={tree.path} project={p.id} name={name} path={tree.path} tree={tree} tool={openTool}
              usable={!tree.bare && !issue && !!tree.status_updated_at} issue={issue}
              linkedWorkspaces={<LinkedWorkspaces linked={linked} />}
              details={<ProjectDirectoryDetails tree={tree} />}
              notice={issue ? <DirectoryRecovery tree={tree} project={p} tasks={tasks} /> : null}
            />
          })}
        </WorkingDirectoryTable> : directoryFilter === "issues" && p.worktrees.length ? <div className="project-detail-empty">{uiText("没有需要处理的工作目录。")}<Action action="project-directory-filter" id={p.id} data-filter="all">{uiText("查看全部目录")}</Action></div> : <div className="project-detail-empty">{p.refreshing ? uiText("正在发现工作目录…") : uiText("尚未发现工作目录，请检查项目路径后重新扫描。")}{!p.refreshing ? <Action action="project-refresh" id={p.id}>{uiText("重新检查")}</Action> : null}</div>}
      </> : <div className="project-detail-empty">{status === "empty" ? uiText("登记本地 Git 仓库，或从 Git 克隆新项目。已有 Worktree 会自动发现。") : status === "loading" ? null : uiText("没有匹配的项目，请调整搜索或筛选条件。")}</div>}
    </section>
  </div>
}
