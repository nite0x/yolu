import {Badge} from "@/shared/ui/primitives/badge"
import {uiText, uiLocale} from "@/shared/i18n"
import {Button} from "@/shared/ui/primitives/button"
import {NativeSelectOptGroup} from "@/shared/ui/primitives/native-select"
import {Action, Option, StatusBadge} from "@/shared/ui/patterns"
import {ChevronDown, CodeXml, FolderOpen, Terminal} from "lucide-react"
import type {ReactNode} from "react"
import type {GitOverview, Worktree} from "./model"

export function Branch({ children }: { children?: ReactNode }) {
  return <Badge variant="outline" className="branch rounded-md border-border bg-muted font-mono text-xs font-normal text-foreground">{children || "detached HEAD"}</Badge>
}
export function TreeStatus({ tree: t, pending = false, compact = false }: { tree?: Worktree; pending?: boolean; compact?: boolean }) {
  if (!t) return <StatusBadge kind={pending ? "neutral" : "failed"}>{pending ? uiText("正在发现目录") : uiText("目录未发现")}</StatusBadge>
  if (t.missing) return <StatusBadge kind="failed">{uiText("目录丢失")}</StatusBadge>
  if (t.error) return <StatusBadge kind="failed">{uiText("读取失败")}</StatusBadge>
  if (t.bare) return <StatusBadge kind="warning">{uiText("裸仓库")}</StatusBadge>
  if (t.prunable) return <StatusBadge kind="warning">{uiText("待修复登记")}</StatusBadge>
  if (!t.status_updated_at) return <StatusBadge kind="neutral">{uiText("正在检查")}</StatusBadge>
  return <><StatusBadge kind={t.dirty ? "warning" : "neutral"}>{t.dirty ? uiText("{0} 项改动", t.dirty) : uiText("无未提交改动")}</StatusBadge>{!compact ? <div className="comparison status-checked-at">{uiText("上次检查")} <time data-status-path={t.path} dateTime={t.status_updated_at}>{new Date(t.status_updated_at).toLocaleTimeString(uiLocale(), { hour12: false })}</time></div> : null}</>
}

export type ProjectOpenTool = "vscode" | "idea" | "terminal"
export const projectOpenLabels: Record<ProjectOpenTool, string> = { vscode: "VS Code", idea: "IDEA", terminal: uiText("终端") }
export function ProjectOpenActions({ project, path, disabled, tool, primary = false, compact = false }: { project: string; path: string; disabled?: boolean; tool: ProjectOpenTool; primary?: boolean; compact?: boolean }) {
  const openLabel = uiText("用 {0} 打开工作目录", projectOpenLabels[tool])
  const buttonVariant = primary ? "default" : compact ? "ghost" : "outline"
  return <div className={`workspace-split-action${primary ? " workspace-split-accent" : ""}${compact ? " workspace-split-compact" : ""}`} data-project-open>
    <Action className="workspace-split-primary rounded-r-none" variant={buttonVariant} action={tool === "terminal" ? "project-terminal" : `project-open-${tool}`} id={project} data-path={path} data-project-open-primary title={openLabel} aria-label={openLabel} disabled={disabled}>{tool === "terminal" ? <Terminal aria-hidden="true" /> : <CodeXml aria-hidden="true" />}<span data-project-open-label className={compact ? "sr-only" : undefined}>{uiText("{0} 打开", projectOpenLabels[tool])}</span></Action>
    {!disabled ? <details className="workspace-action-menu"><summary aria-label={uiText("选择打开方式")}><ChevronDown aria-hidden="true" /></summary><div className="workspace-action-menu-body">
      {(["vscode", "idea", "terminal"] as const).map(choice => <Action key={choice} variant="ghost" className="justify-start font-normal" action={choice === "terminal" ? "project-terminal" : `project-open-${choice}`} id={project} data-path={path} data-project-open-choice={choice}>{choice === "terminal" ? <Terminal aria-hidden="true" /> : <CodeXml aria-hidden="true" />}{projectOpenLabels[choice]}</Action>)}
      <Action variant="ghost" className="justify-start font-normal" action="project-open-folder" id={project} data-path={path}><FolderOpen aria-hidden="true" />{uiText("在文件管理器中打开")}</Action>
    </div></details> : <Button className="workspace-split-toggle rounded-l-none border-l-0" size="icon-sm" variant={buttonVariant} disabled aria-label={uiText("选择打开方式")}><ChevronDown aria-hidden="true" /></Button>}
  </div>
}
export function SourceOptions({ overview: v, includeHead = true }: { overview: GitOverview; includeHead?: boolean }) {
  return <><Option value="">{uiText("请选择来源分支")}</Option>{[[uiText("远端分支"), "remote"], [uiText("本地分支"), "local"]].map(([label, kind]) => {
    const branches = v.branches.filter(b => b.kind === kind)
    return branches.length ? <NativeSelectOptGroup key={kind} label={label}>{branches.map(b => <Option key={b.ref} value={b.ref}>{b.name} · {b.commit.slice(0, 8)}</Option>)}</NativeSelectOptGroup> : null
  })}{includeHead ? <Option value="HEAD">{uiText("当前 HEAD（")}{v.current || "detached"}{uiText("，请明确确认基线）")}</Option> : null}</>
}
