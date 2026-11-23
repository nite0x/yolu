import { uiText } from "../i18n";
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { Folder, Code2, Terminal, Rocket, Bug, Sparkles, Database, Globe, Layers, Briefcase, FlaskConical } from "lucide-react"

const icons = { folder: Folder, code: Code2, terminal: Terminal, rocket: Rocket, bug: Bug, sparkles: Sparkles, database: Database, globe: Globe, layers: Layers, briefcase: Briefcase, flask: FlaskConical }
const iconNames = { folder: uiText("文件夹"), code: uiText("代码"), terminal: uiText("终端"), rocket: uiText("火箭"), bug: uiText("问题修复"), sparkles: uiText("灵感"), database: uiText("数据库"), globe: uiText("网站"), layers: uiText("组件"), briefcase: uiText("工作"), flask: uiText("试验") }
const colors = { indigo: uiText("靛蓝"), blue: uiText("蓝色"), teal: uiText("青色"), green: uiText("绿色"), amber: uiText("琥珀"), rose: uiText("玫红"), violet: uiText("紫色"), slate: uiText("灰色") }
export type ShortcutIcon = {icon: string; color: string}
export function defaultShortcutIcon(identity: string): ShortcutIcon {
  let hash = 0
  for (const char of identity) hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0
  return {icon: "auto", color: Object.keys(colors)[hash % Object.keys(colors).length]}
}
export function ShortcutBadge({name, identity, appearance}: {name: string; identity: string; appearance?: ShortcutIcon}) {
  const value = {...defaultShortcutIcon(identity), ...appearance}
  const Icon = icons[value.icon as keyof typeof icons]
  const words = name.trim().split(/[\s_\-./]+/).filter(Boolean)
  const initials = words.length > 1 ? words.slice(0, 2).map(word => Array.from(word)[0]).join("") : Array.from(name).slice(0, 2).join("")
  return <span className="shortcut-badge" data-color={value.color} aria-hidden="true">{Icon ? <Icon /> : initials.toUpperCase()}</span>
}
export function ResourceIcon({kind, id, name, environment = "local", appearance, editable = false}: {
  kind: "project"; id: string; name: string; environment?: string; appearance?: ShortcutIcon; editable?: boolean
}) {
  const identity = `${kind}:${id}`
  const badge = <ShortcutBadge name={name} identity={identity} appearance={appearance} />
  const data = {"data-resource-icon": identity, "data-resource-name": name, "data-environment": environment, "data-resource-appearance": JSON.stringify(appearance || {})}
  return editable ? <button type="button" className="resource-icon-edit" data-resource-icon-edit {...data} aria-label={uiText("编辑图标：{0}", name)} title={uiText("编辑图标：{0}", name)}>{badge}</button> : <span {...data}>{badge}</span>
}
type Entry = {key: string; name: string; appearance: ShortcutIcon; environment: string}
function IconEditor({entry, close, save}: {entry: Entry; close: () => void; save: (value: ShortcutIcon) => Promise<void>}) {
  const [value, setValue] = useState({...defaultShortcutIcon(entry.key), ...entry.appearance})
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  return <form onSubmit={async event => {
    event.preventDefault()
    if (pending) return
    setPending(true); setError("")
    try { await save(value); close() } catch (error) { setError((error as Error).message) } finally { setPending(false) }
  }} aria-busy={pending}>
    <h2 id="shortcutIconTitle">{uiText("编辑图标")}</h2>
    <div className="shortcut-icon-preview"><ShortcutBadge name={entry.name} identity={entry.key} appearance={value} /><span>{entry.name}</span></div>
    <fieldset disabled={pending}><legend>{uiText("图标")}</legend><div className="shortcut-icon-options"><button type="button" aria-label={uiText("名称缩写")} aria-pressed={value.icon === "auto"} onClick={() => setValue(current => ({...current, icon:"auto"}))}>{uiText("自动")}</button>{Object.entries(icons).map(([key, Icon]) => <button key={key} type="button" aria-label={iconNames[key as keyof typeof iconNames]} aria-pressed={value.icon === key} onClick={() => setValue(current => ({...current, icon:key}))}><Icon aria-hidden="true" /></button>)}</div></fieldset>
    <fieldset disabled={pending}><legend>{uiText("颜色")}</legend><div className="shortcut-icon-options">{Object.entries(colors).map(([key, label]) => <button key={key} type="button" aria-label={label} aria-pressed={value.color === key} onClick={() => setValue(current => ({...current, color:key}))}><span className="shortcut-color-swatch shortcut-badge" data-color={key} aria-hidden="true" /></button>)}</div></fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="shortcut-icon-actions"><button type="button" disabled={pending} onClick={() => setValue(defaultShortcutIcon(entry.key))}>{uiText("恢复默认")}</button><span /><button type="button" disabled={pending} onClick={close}>{uiText("取消")}</button><button type="submit" disabled={pending}>{pending ? uiText("保存中…") : uiText("保存")}</button></div>
  </form>
}
export function setupResourceIcons(container: HTMLElement) {
  let hostDocument = document
  try { if (window.parent !== window && window.parent.location?.origin === window.location.origin && window.parent.document?.body) hostDocument = window.parent.document } catch { /* Use this document outside the application host. */ }
  const dialog = hostDocument.createElement("dialog")
  dialog.className = "shortcut-icon-dialog"
  dialog.setAttribute("aria-labelledby", "shortcutIconTitle")
  hostDocument.body.append(dialog)
  const root = createRoot(dialog)
  let trigger: HTMLElement | null = null
  let saving = false
  const close = () => {
    dialog.close(); root.render(null)
    const replacement = [...container.querySelectorAll<HTMLElement>("[data-resource-icon-edit]")].find(button => button.dataset.resourceIcon === trigger?.dataset.resourceIcon && button.dataset.environment === trigger?.dataset.environment)
    const target = trigger?.isConnected ? trigger : replacement
    target?.focus({preventScroll:true})
  }
  const click = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLElement>("[data-resource-icon-edit]")
    if (!button) return
    trigger = button
    const entry: Entry = {key:button.dataset.resourceIcon!, name:button.dataset.resourceName!, environment:button.dataset.environment!, appearance:JSON.parse(button.dataset.resourceAppearance || "{}")}
    flushSync(() => root.render(<IconEditor key={entry.environment + entry.key} entry={entry} close={close} save={async value => {
      saving = true
      try {
        await new Promise<void>((resolve, reject) => window.dispatchEvent(new CustomEvent("workhub:resource-icon-save", {detail:{...entry, value, resolve, reject}})))
      } finally { saving = false }
    }} />))
    dialog.showModal()
  }
  const cancel = (event: Event) => {event.preventDefault(); if (!saving) close()}
  dialog.addEventListener("cancel", cancel)
  container.addEventListener("click", click)
  return () => {container.removeEventListener("click", click); dialog.removeEventListener("cancel", cancel); root.unmount(); dialog.remove()}
}
