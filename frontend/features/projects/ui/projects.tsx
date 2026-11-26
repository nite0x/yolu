import {uiText} from "@/shared/i18n"
import {ChevronRight, Circle, CircleAlert} from "lucide-react"
import {Button} from "@/shared/ui/primitives/button"
import {Action} from "@/shared/ui/actions/button"
import {StatusBadge} from "@/shared/ui/data-display/status-badge"
import type {ProjectOpenTool} from "@/entities/projects/presentation"
import {ResourceIcon} from "@/shared/ui/resource-icons"
import type {Project} from "@/entities/projects/model"
import {ProjectDetail, type ProjectDetailView} from "./detail"
import {directoryHasIssue} from "./working-directories"

export type ProjectFilter = "all" | "dirty" | "error"
const hasIssue = (p: Project) => !!p.error || p.worktrees.some(directoryHasIssue)
const hasChanges = (p: Project) => p.worktrees.some(t => (t.dirty || 0) > 0)

export function Projects({projects, selectedID, openTool = "vscode", filter = "all", detailOpen = false, detailView, searching = false, status}: {
  projects: Project[]; selectedID: string | null; openTool?: ProjectOpenTool; filter?: ProjectFilter; detailOpen?: boolean; detailView: ProjectDetailView; searching?: boolean; status?: "loading" | "empty"
}) {
  const visible = projects.filter(p => filter === "dirty" ? hasChanges(p) : filter === "error" ? hasIssue(p) : true)
  const p = detailOpen ? projects.find(p => p.id === selectedID) : undefined
  const filters = [{ value: "all", label: uiText("全部"), count: projects.length }, { value: "error", label: uiText("异常"), count: projects.filter(hasIssue).length }, { value: "dirty", label: uiText("有改动"), count: projects.filter(hasChanges).length }]
  return <div className="project-workspace shadcn-scope" data-pane={detailOpen ? "detail" : "list"}>
    <section id="projectListPane" className="project-browser resource-list-page workspace-pane" aria-label={uiText("项目列表")} hidden={detailOpen}>
      <fieldset className="project-filters m-0 min-w-0 border-x-0 border-t-0" aria-label={uiText("筛选项目")} hidden={!!status}>{filters.map(f => <Action key={f.value} action="project-filter" data-filter={f.value} variant={filter === f.value ? "secondary" : "ghost"} aria-pressed={filter === f.value}>{f.label}<span>{f.count}</span></Action>)}</fieldset>
      <div className="project-list-scroll resource-list-scroll">{visible.length ? <div className="project-list-group">{visible.map(project => {
        const dirty = project.worktrees.filter(t => (t.dirty || 0) > 0).length
        const issue = hasIssue(project)
        return <Button key={project.id} type="button" variant="ghost" className="project-list-item grid h-auto min-w-0 whitespace-normal text-left font-normal" data-action="select-project" data-id={project.id} aria-pressed={selectedID === project.id} aria-controls="projectDetail" aria-label={uiText("打开 {0} 的工作目录", project.name)}>
          <span className="project-list-avatar" aria-hidden="true"><ResourceIcon kind="project" id={project.id} name={project.name} environment="" /></span>
          <span className={`project-list-name${issue ? " has-issue" : ""}`}><strong>{project.name}</strong>{issue ? <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" /> : null}</span>
          <span className="project-list-path" title={project.path}>{project.path}</span>
          <span className="project-list-meta"><span>{project.worktrees.length}{" "}{uiText("个目录")}</span>{issue ? <StatusBadge tone="error">{project.error ? uiText("读取失败") : uiText("{0} 个异常", project.worktrees.filter(directoryHasIssue).length)}</StatusBadge> : null}{dirty ? <span role="img" className="project-change-indicator" title={uiText("{0} 个工作目录有未提交改动", dirty)} aria-label={uiText("{0} 个工作目录有未提交改动", dirty)}><Circle className="project-change-dot size-1.5" aria-hidden="true" />{dirty}{" "}{uiText("个目录有改动")}</span> : !project.status_updated_at && project.refreshing ? <span>{uiText("正在检查")}</span> : null}</span><ChevronRight className="project-list-enter" aria-hidden="true" />
        </Button>
      })}</div> : null}{status ? <div className="project-list-empty" role="status">{status === "loading" ? uiText("正在读取当前环境的项目…") : uiText("当前环境没有已登记的项目")}</div> : !visible.length ? <div className="project-list-empty">{uiText("没有匹配的项目")}{searching ? <Action action="clear-project-search" variant="link">{uiText("清除搜索")}</Action> : null}{filter !== "all" ? <Action action="project-filter" data-filter="all" variant="link">{uiText("查看全部项目")}</Action> : null}{!searching && filter === "all" ? <span>{uiText("试试其他名称或路径")}</span> : null}</div> : null}</div>
    </section>
    <section id="projectDetail" className="project-detail workspace-pane" hidden={!detailOpen} aria-label={p ? uiText("{0} 项目详情", p.name) : uiText("项目详情")}>
      {p ? <ProjectDetail project={p} tool={openTool} view={detailView} /> : <div className="resource-detail-content">
        <div className="project-detail-empty" role="status">{status === "empty" ? uiText("登记本地 Git 仓库，或从 Git 克隆新项目。已有 Worktree 会自动发现。") : status === "loading" ? uiText("正在读取当前环境的项目…") : uiText("这个项目已不存在，请重新选择项目")}</div>
        {detailOpen ? <a href="#/projects" data-action="project-list" className="resource-breadcrumb-link">{uiText("返回项目列表")}</a> : null}
      </div>}
    </section>
  </div>
}
