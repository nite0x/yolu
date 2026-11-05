import { uiText } from "../i18n";
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { flushSync } from "react-dom"
import { Folder, Code2, Terminal, Rocket, Bug, Sparkles, Database, Globe, Layers, Briefcase, FlaskConical, Palette } from "lucide-react"

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
export function ShortcutIconSettingsButton() {
  return <button type="button" id="shortcutIconSettings" className="shortcut-icon-settings" data-shortcut-icon-settings aria-label={uiText("设置固定入口图标")} title={uiText("设置固定入口图标")}><Palette aria-hidden="true" /></button>
}
type Entry = {key: string; name: string; title: string; appearance: ShortcutIcon}
function IconEditor({entries, close, save}: {entries: Entry[]; close: () => void; save: (entry: Entry, value: ShortcutIcon) => void}) {
  const [selected, setSelected] = useState(entries[0]?.key || "")
  const entry = entries.find(item => item.key === selected)
  const [value, setValue] = useState(entry?.appearance || defaultShortcutIcon(""))
  if (!entry) return <><h2 id="shortcutIconTitle">{uiText("设置固定入口图标")}</h2><p>{uiText("先固定一个任务或项目目录，再为它设置图标。")}</p><button type="button" onClick={close}>{uiText("关闭")}</button></>
  return <form onSubmit={event => {event.preventDefault(); save(entry, value)}}>
    <h2 id="shortcutIconTitle">{uiText("设置固定入口图标")}</h2>
    <label htmlFor="shortcutIconEntry">{uiText("固定入口")}</label>
    <select id="shortcutIconEntry" value={selected} onChange={event => {const next = entries.find(item => item.key === event.target.value)!; setSelected(next.key); setValue(next.appearance)}}>{entries.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select>
    <div className="shortcut-icon-preview"><ShortcutBadge name={entry.name} identity={entry.key} appearance={value} /><span>{entry.name}</span></div>
    <fieldset><legend>{uiText("图标")}</legend><div className="shortcut-icon-options"><button type="button" aria-label={uiText("名称缩写")} aria-pressed={value.icon === "auto"} onClick={() => setValue(current => ({...current, icon:"auto"}))}>{uiText("自动")}</button>{Object.entries(icons).map(([key, Icon]) => <button key={key} type="button" aria-label={iconNames[key as keyof typeof iconNames]} aria-pressed={value.icon === key} onClick={() => setValue(current => ({...current, icon:key}))}><Icon aria-hidden="true" /></button>)}</div></fieldset>
    <fieldset><legend>{uiText("颜色")}</legend><div className="shortcut-icon-options">{Object.entries(colors).map(([key, label]) => <button key={key} type="button" aria-label={label} aria-pressed={value.color === key} onClick={() => setValue(current => ({...current, color:key}))}><span className="shortcut-color-swatch shortcut-badge" data-color={key} aria-hidden="true" /></button>)}</div></fieldset>
    <div className="shortcut-icon-actions"><button type="button" onClick={() => setValue(defaultShortcutIcon(entry.key))}>{uiText("恢复默认")}</button><span /><button type="button" onClick={close}>{uiText("取消")}</button><button type="submit">{uiText("保存")}</button></div>
  </form>
}
export function setupShortcutIcons(sidebar: HTMLElement) {
  // The shared navigation iframe is clipped to the rail and list. Put modal
  // settings in the same-origin workspace document so the whole window can show it.
  let hostDocument = document
  try { if (window.parent !== window && window.parent.location?.origin === window.location.origin && window.parent.document?.body) hostDocument = window.parent.document } catch { /* Standalone or externally embedded page. */ }
  const dialog = hostDocument.createElement("dialog")
  dialog.className = "shortcut-icon-dialog"
  dialog.setAttribute("aria-labelledby", "shortcutIconTitle")
  hostDocument.body.append(dialog)
  const root = createRoot(dialog)
  let trigger: HTMLElement | null = null
  const close = () => {dialog.close(); root.render(null); if (trigger?.isConnected) trigger.focus({preventScroll:true})}
  const click = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-shortcut-icon-settings]")) return
    trigger = event.target.closest<HTMLElement>("[data-shortcut-icon-settings]")
    const entries = [...sidebar.querySelectorAll<HTMLElement>("[data-shortcut-icon-key]")].map(node => ({key: node.dataset.shortcutIconKey!, name: node.dataset.shortcutName!, title: node.title.replace(/\n/g, " · "), appearance: JSON.parse(node.dataset.shortcutIcon || "{}") as ShortcutIcon}))
    flushSync(() => root.render(<IconEditor entries={entries} close={close} save={(entry, value) => {
      window.dispatchEvent(new CustomEvent("workhub:shortcut-icon-save", {detail:{key:entry.key, value}})); close()
    }} />))
    dialog.showModal()
  }
  const cancel = (event: Event) => {event.preventDefault(); close()}
  dialog.addEventListener("cancel", cancel)
  sidebar.addEventListener("click", click)
  return () => {sidebar.removeEventListener("click", click); dialog.removeEventListener("cancel", cancel); root.unmount(); dialog.remove()}
}
