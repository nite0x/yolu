import { uiText, uiLocale } from "../i18n";
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption as Option, NativeSelectOptGroup } from "@/components/ui/native-select"
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { ChevronDown, CodeXml, FolderOpen, Terminal } from "lucide-react"
import type { GitOverview, Worktree } from "./types"

export const statusLabels: Record<string, string> = { ready: uiText("已就绪"), partial: uiText("部分就绪"), archived: uiText("已归档"), creating: uiText("创建中"), pending: uiText("待创建"), failed: uiText("创建失败"), removed: uiText("目录已清理") }
const tones: Record<string, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  partial: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300", warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  failed: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300", "primary-tag": "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300",
}
export function StatusBadge({ kind, children }: { kind: string; children?: ReactNode }) {
  return <Badge variant="outline" className={cn("shrink-0 rounded-md px-2 py-1 text-xs", tones[kind] || "border-border bg-secondary text-muted-foreground")}>{children || statusLabels[kind] || kind}</Badge>
}
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

export function Action({ action, id, children, ...props }: ComponentProps<typeof Button> & { action: string; id?: string }) {
  return <Button type="button" variant="outline" size="sm" data-action={action} data-id={id} {...props}>{children}</Button>
}

export type ProjectOpenTool = "vscode" | "idea" | "terminal"
export const projectOpenLabels: Record<ProjectOpenTool, string> = { vscode: "VS Code", idea: "IDEA", terminal: uiText("终端") }
export function ProjectOpenActions({ project, path, disabled, tool, primary = false }: { project: string; path: string; disabled?: boolean; tool: ProjectOpenTool; primary?: boolean }) {
  return <div className={`workspace-split-action${primary ? " workspace-split-accent" : ""}`} data-project-open>
    <Action className="workspace-split-primary rounded-r-none" variant={primary ? "default" : "outline"} action={tool === "terminal" ? "project-terminal" : `project-open-${tool}`} id={project} data-path={path} data-project-open-primary aria-label={uiText("用 {0} 打开工作目录", projectOpenLabels[tool])} disabled={disabled}>{tool === "terminal" ? <Terminal aria-hidden="true" /> : <CodeXml aria-hidden="true" />}<span data-project-open-label>{uiText("{0} 打开", projectOpenLabels[tool])}</span></Action>
    {!disabled ? <details className="workspace-action-menu"><summary aria-label={uiText("选择打开方式")}><ChevronDown aria-hidden="true" /></summary><div className="workspace-action-menu-body">
      {(["vscode", "idea", "terminal"] as const).map(choice => <Action key={choice} variant="ghost" className="justify-start font-normal" action={choice === "terminal" ? "project-terminal" : `project-open-${choice}`} id={project} data-path={path} data-project-open-choice={choice}>{choice === "terminal" ? <Terminal aria-hidden="true" /> : <CodeXml aria-hidden="true" />}{projectOpenLabels[choice]}</Action>)}
      <Action variant="ghost" className="justify-start font-normal" action="project-open-folder" id={project} data-path={path}><FolderOpen aria-hidden="true" />{uiText("在文件管理器中打开")}</Action>
    </div></details> : <Button className="workspace-split-toggle rounded-l-none border-l-0" size="icon-sm" variant={primary ? "default" : "outline"} disabled aria-label={uiText("选择打开方式")}><ChevronDown aria-hidden="true" /></Button>}
  </div>
}
export function Field({ id, label, help, required, children, ...props }: ComponentProps<"div"> & { id: string; label: string; help?: string; required?: boolean; children: ReactNode }) {
  const described = help ? Children.map(children, child => isValidElement<{ id?: string; "aria-describedby"?: string }>(child) && child.props.id === id ? cloneElement(child, { "aria-describedby": [child.props["aria-describedby"], `${id}-help`].filter(Boolean).join(" ") }) : child) : children
  return <div {...props} className={cn("field grid gap-2", props.className)}><Label id={`${id}-label`} htmlFor={id} className="leading-relaxed">{label}{required ? <span className="text-destructive" aria-hidden="true"> *</span> : null}</Label>{described}{help ? <small id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">{help}</small> : null}</div>
}
export function Check({ label, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return <Label className="flex min-h-9 cursor-pointer items-center gap-2 leading-relaxed"><Input {...props} type="checkbox" className="m-0 size-4 min-w-4 shrink-0 accent-primary shadow-none" /><span>{label}</span></Label>
}
export function Feedback({ variant, className, ...props }: ComponentProps<typeof Alert>) {
  return <Alert variant={variant} {...props} className={cn("block whitespace-pre-wrap text-sm leading-relaxed", className)} />
}
export function Preview({ title, id }: { title: string; id: string }) {
  return <Card className="gap-2 rounded-lg bg-muted p-4 shadow-none"><div className="text-xs text-muted-foreground">{title}</div><pre id={id} className="m-0 whitespace-pre-wrap break-all font-mono text-sm leading-relaxed" /></Card>
}
export function ModalHeader({ id, title }: { id: string; title: string }) {
  return <div className="dialog-header mb-4 gap-4"><div><h2 id={id} className="m-0 text-xl font-semibold">{title}</h2></div><Button type="button" variant="ghost" size="icon" className="close-dialog shrink-0" aria-label={uiText("关闭")}>×</Button></div>
}
export function ModalFooter({ children, note }: { children: ReactNode; note?: string }) {
  return <div className="dialog-footer">{note ? <span className="footer-note">{note}</span> : null}<Button type="button" variant="outline" className="close-dialog">{uiText("取消")}</Button>{children}</div>
}
export function DataTable({ headers, children, label, containerClassName, headerClassName }: { headers: string[]; children: ReactNode; label: string; containerClassName?: string; headerClassName?: string }) {
  return <Table role="table" aria-label={label} containerClassName={containerClassName}><TableHeader role="rowgroup"><TableRow role="row">{headers.map((title, index) => <TableHead key={index} role="columnheader" scope="col" className={cn("bg-muted px-3 text-xs text-muted-foreground whitespace-normal", headerClassName)}>{title}</TableHead>)}</TableRow></TableHeader><TableBody role="rowgroup">{children}</TableBody></Table>
}
export function SourceOptions({ overview: v, includeHead = true }: { overview: GitOverview; includeHead?: boolean }) {
  return <><Option value="">{uiText("请选择来源分支")}</Option>{[[uiText("远端分支"), "remote"], [uiText("本地分支"), "local"]].map(([label, kind]) => {
    const branches = v.branches.filter(b => b.kind === kind)
    return branches.length ? <NativeSelectOptGroup key={kind} label={label}>{branches.map(b => <Option key={b.ref} value={b.ref}>{b.name} · {b.commit.slice(0, 8)}</Option>)}</NativeSelectOptGroup> : null
  })}{includeHead ? <Option value="HEAD">{uiText("当前 HEAD（")}{v.current || "detached"}{uiText("，请明确确认基线）")}</Option> : null}</>
}
export function EmptyState({ title, description, action, button, href, header }: { title: string; description: string; action?: string; button?: string; href?: string; header?: ReactNode }) {
  return <Card className="shadcn-scope min-h-72 items-center justify-center gap-4 rounded-none border-0 p-8 text-center shadow-none">
    {header}
    <h2 className="m-0 text-lg font-semibold">{title}</h2>
    <p className="m-0 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
    {action ? <Action action={action} variant="default">{action.startsWith("new-") ? "＋ " : ""}{button}</Action> : href ? <Button variant="outline" asChild><a href={href}>{button}</a></Button> : null}
  </Card>
}
export { NativeSelect, Option }
