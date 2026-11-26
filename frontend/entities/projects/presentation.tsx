import {Badge} from "@/shared/ui/primitives/badge"
import {uiText, uiLocale} from "@/shared/i18n"
import {NativeSelectOptGroup} from "@/shared/ui/primitives/native-select"
import {NativeSelectOption as Option} from "@/shared/ui/primitives/native-select"
import {StatusBadge} from "@/shared/ui/data-display/status-badge"
import type {ReactNode} from "react"
import type {GitOverview, Worktree} from "./model"

export function Branch({ children }: { children?: ReactNode }) {
  return <Badge variant="outline" className="branch rounded-md border-border bg-muted font-mono text-xs font-normal text-foreground">{children || "detached HEAD"}</Badge>
}
export function TreeStatus({ tree: t, pending = false, compact = false }: { tree?: Worktree; pending?: boolean; compact?: boolean }) {
  if (!t) return <StatusBadge tone={pending ? "neutral" : "error"}>{pending ? uiText("正在发现目录") : uiText("目录未发现")}</StatusBadge>
  if (t.missing) return <StatusBadge tone="error">{uiText("目录丢失")}</StatusBadge>
  if (t.error) return <StatusBadge tone="error">{uiText("读取失败")}</StatusBadge>
  if (t.bare) return <StatusBadge tone="warning">{uiText("裸仓库")}</StatusBadge>
  if (t.prunable) return <StatusBadge tone="warning">{uiText("待修复登记")}</StatusBadge>
  if (!t.status_updated_at) return <StatusBadge tone="neutral">{uiText("正在检查")}</StatusBadge>
  return <><StatusBadge tone={t.dirty ? "warning" : "neutral"}>{t.dirty ? uiText("{0} 项改动", t.dirty) : uiText("无未提交改动")}</StatusBadge>{!compact ? <div className="comparison status-checked-at">{uiText("上次检查")} <time data-status-path={t.path} dateTime={t.status_updated_at}>{new Date(t.status_updated_at).toLocaleTimeString(uiLocale(), { hour12: false })}</time></div> : null}</>
}

export type ProjectOpenTool = "vscode" | "idea" | "terminal"
export const projectOpenLabels: Record<ProjectOpenTool, string> = { vscode: "VS Code", idea: "IDEA", terminal: uiText("终端") }
export function SourceOptions({ overview: v, includeHead = true }: { overview: GitOverview; includeHead?: boolean }) {
  return <><Option value="">{uiText("请选择来源分支")}</Option>{[[uiText("远端分支"), "remote"], [uiText("本地分支"), "local"]].map(([label, kind]) => {
    const branches = v.branches.filter(b => b.kind === kind)
    return branches.length ? <NativeSelectOptGroup key={kind} label={label}>{branches.map(b => <Option key={b.ref} value={b.ref}>{b.name} · {b.commit.slice(0, 8)}</Option>)}</NativeSelectOptGroup> : null
  })}{includeHead ? <Option value="HEAD">{uiText("当前 HEAD（")}{v.current || "detached"}{uiText("，请明确确认基线）")}</Option> : null}</>
}
