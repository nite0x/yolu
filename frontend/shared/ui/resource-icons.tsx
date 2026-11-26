import {uiText} from "../i18n"
import {useState} from "react"
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {Folder, Code2, Terminal, Rocket, Bug, Sparkles, Database, Globe, Layers, Briefcase, FlaskConical, Box, Cpu, Server, Bot, Wrench, Shield, BookOpen, Compass, Puzzle, Shuffle} from "lucide-react"

const icons = {
  code: Code2,
  terminal: Terminal,
  rocket: Rocket,
  database: Database,
  globe: Globe,
  layers: Layers,
  box: Box,
  cpu: Cpu,
  server: Server,
  bot: Bot,
  wrench: Wrench,
  shield: Shield,
  book: BookOpen,
  compass: Compass,
  puzzle: Puzzle,
  sparkles: Sparkles,
  briefcase: Briefcase,
  flask: FlaskConical,
  bug: Bug,
  folder: Folder,
}
const iconNames: Record<keyof typeof icons, string> = {
  code: uiText("代码"),
  terminal: uiText("终端"),
  rocket: uiText("火箭"),
  database: uiText("数据库"),
  globe: uiText("网站"),
  layers: uiText("组件"),
  box: uiText("软件包"),
  cpu: uiText("计算"),
  server: uiText("服务"),
  bot: uiText("智能体"),
  wrench: uiText("工具"),
  shield: uiText("安全"),
  book: uiText("文档"),
  compass: uiText("探索"),
  puzzle: uiText("插件"),
  sparkles: uiText("灵感"),
  briefcase: uiText("工作"),
  flask: uiText("试验"),
  bug: uiText("问题修复"),
  folder: uiText("文件夹"),
}
export type ShortcutIconKey = keyof typeof icons
export const presetShortcutIcons = (Object.keys(icons) as ShortcutIconKey[]).filter(key => key !== "folder")
export type ShortcutIcon = {icon: string; color: string}

function hashIdentity(identity: string) {
  let hash = 2166136261
  for (const char of identity) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16777619) >>> 0
  return hash
}

export function defaultShortcutIcon(identity: string): ShortcutIcon {
  const index = hashIdentity(identity) % presetShortcutIcons.length
  return {icon: presetShortcutIcons[index], color: "theme"}
}

export function resolveShortcutIcon(identity: string, appearance?: ShortcutIcon): ShortcutIcon {
  const fallback = defaultShortcutIcon(identity)
  const icon = appearance?.icon && appearance.icon in icons ? appearance.icon : fallback.icon
  return {icon, color: "theme"}
}

export function ShortcutBadge({identity, appearance}: {name?: string; identity: string; appearance?: ShortcutIcon}) {
  const value = resolveShortcutIcon(identity, appearance)
  const Icon = icons[value.icon as ShortcutIconKey] || Folder
  const tone = identity === "independent" ? "neutral" : "theme"
  return <span className="shortcut-badge" data-icon={value.icon} data-tone={tone} aria-hidden="true"><Icon /></span>
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
  const [value, setValue] = useState<ShortcutIcon>(() => resolveShortcutIcon(entry.key, entry.appearance))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const pickRandom = () => {
    const candidates = presetShortcutIcons.filter(key => key !== value.icon)
    const next = candidates[Math.floor(Math.random() * candidates.length)] || presetShortcutIcons[0]
    setValue({icon: next, color: "theme"})
  }
  return <form onSubmit={async event => {
    event.preventDefault()
    if (pending) return
    setPending(true); setError("")
    try { await save({icon: value.icon, color: "theme"}); close() } catch (error) { setError((error as Error).message) } finally { setPending(false) }
  }} aria-busy={pending}>
    <h2 id="shortcutIconTitle">{uiText("编辑图标")}</h2>
    <div className="shortcut-icon-preview"><ShortcutBadge name={entry.name} identity={entry.key} appearance={value} /><span>{entry.name}</span><button type="button" className="shortcut-icon-random" disabled={pending} onClick={pickRandom}><Shuffle aria-hidden="true" />{uiText("随机图标")}</button></div>
    <fieldset disabled={pending}><legend>{uiText("图标")}</legend><div className="shortcut-icon-options">{(Object.entries(icons) as [ShortcutIconKey, typeof Folder][]).map(([key, Icon]) => <button key={key} type="button" aria-label={iconNames[key]} title={iconNames[key]} aria-pressed={value.icon === key} onClick={() => setValue({icon: key, color: "theme"})}><Icon aria-hidden="true" /></button>)}</div></fieldset>
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
    const {resourceIcon:key, resourceName:name, environment} = button.dataset
    if (key === undefined || name === undefined || environment === undefined) return
    const entry: Entry = {key, name, environment, appearance:JSON.parse(button.dataset.resourceAppearance || "{}")}
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
