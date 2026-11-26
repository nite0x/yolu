import {uiText} from "../i18n"
import {Children, cloneElement, isValidElement, type ComponentProps, type ReactNode} from "react"
import {Badge} from "./primitives/badge"
import {Button} from "./primitives/button"
import {Alert} from "./primitives/alert"
import {Card} from "./primitives/card"
import {Input} from "./primitives/input"
import {Label} from "./primitives/label"
import {NativeSelect, NativeSelectOption as Option} from "./primitives/native-select"
import {Table, TableBody, TableHead, TableHeader, TableRow} from "./primitives/table"
import {HelpTip} from "./help-tip"
import {cn} from "../lib/utils"

export const statusLabels: Record<string, string> = { ready: uiText("已就绪"), partial: uiText("部分就绪"), archived: uiText("已归档"), creating: uiText("创建中"), pending: uiText("待创建"), failed: uiText("创建失败"), removed: uiText("目录已清理") }
const tones: Record<string, string> = {
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  partial: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300", warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  failed: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300", "primary-tag": "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300",
}
export function StatusBadge({ kind, children }: { kind: string; children?: ReactNode }) {
  return <Badge variant="outline" className={cn("shrink-0 rounded-md px-2 py-1 text-xs", tones[kind] || "border-border bg-secondary text-muted-foreground")}>{children || statusLabels[kind] || kind}</Badge>
}
export function Action({ action, id, children, ...props }: ComponentProps<typeof Button> & { action: string; id?: string }) {
  return <Button type="button" variant="outline" size="sm" data-action={action} data-id={id} {...props}>{children}</Button>
}

export function Field({ id, label, help, helpDisplay = "inline", required, children, ...props }: ComponentProps<"div"> & { id: string; label: string; help?: string; helpDisplay?: "inline" | "tooltip"; required?: boolean; children: ReactNode }) {
  const described = help ? Children.map(children, child => isValidElement<{ id?: string; "aria-describedby"?: string }>(child) && child.props.id === id ? cloneElement(child, { "aria-describedby": [child.props["aria-describedby"], `${id}-help`].filter(Boolean).join(" ") }) : child) : children
  const labelContent = <Label id={`${id}-label`} htmlFor={id} className="leading-relaxed">{label}{required ? <span className="text-destructive" aria-hidden="true"> *</span> : null}</Label>
  return <div {...props} className={cn("field grid gap-2", props.className)}>{help && helpDisplay === "tooltip" ? <div className="settings-label">{labelContent}<HelpTip id={`${id}-help`} label={label}>{help}</HelpTip></div> : labelContent}{described}{help && helpDisplay === "inline" ? <small id={`${id}-help`} className="text-xs leading-relaxed text-muted-foreground">{help}</small> : null}</div>
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
export function EmptyState({ title, description, action, button, href, header }: { title: string; description: string; action?: string; button?: string; href?: string; header?: ReactNode }) {
  return <Card className="shadcn-scope min-h-72 items-center justify-center gap-4 rounded-none border-0 p-8 text-center shadow-none">
    {header}
    <h2 className="m-0 text-lg font-semibold">{title}</h2>
    <p className="m-0 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
    {action ? <Action action={action} variant="default">{action.startsWith("new-") ? "＋ " : ""}{button}</Action> : href ? <Button variant="outline" asChild><a href={href}>{button}</a></Button> : null}
  </Card>
}
export { NativeSelect, Option }
