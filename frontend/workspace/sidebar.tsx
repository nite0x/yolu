import { uiText } from "../i18n";
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { PanelLeftClose, PanelLeftOpen, ListTodo, FolderGit2, MessagesSquare, SquarePlus } from "lucide-react"
import { renderToStaticMarkup } from "react-dom/server"
import { setupSplitResize } from "./split-resize"
import { setupShortcutIcons } from "./shortcut-icons"
import { mountCodexUsage } from "./codex-usage"

const storageKey = "workhub:sidebar-collapsed:v1"
const widthStorageKey = "workhub:sidebar-width:v1"
const syncEvent = "workhub:sidebar-sync"

function setupSidebarResize(sidebar: HTMLElement) {
  const body = document.body
  const syncWidth = () => {
    try {
      const saved = Number(localStorage.getItem(widthStorageKey))
      if (Number.isFinite(saved) && saved >= 212 && saved <= 420) body.style.setProperty("--sidebar-width", `${saved}px`)
      else body.style.removeProperty("--sidebar-width")
    } catch { /* Keep the in-memory width when storage is unavailable. */ }
  }
  syncWidth()
  const handle = document.createElement("div")
  handle.className = "sidebar-resize"
  handle.tabIndex = 0
  handle.setAttribute("role", "separator")
  handle.setAttribute("aria-label", uiText("侧栏宽度"))
  handle.setAttribute("aria-orientation", "vertical")
  handle.setAttribute("aria-controls", sidebar.id)
  handle.title = uiText("拖动调整侧栏宽度，双击恢复默认")
  sidebar.after(handle)
  const dispose = setupSplitResize({
    handle, container: body, panel: sidebar, axis: "x",
    bounds: () => window.innerWidth > 760 && !body.classList.contains("sidebar-collapsed")
      ? {min: 212, max: Math.min(420, window.innerWidth - 480)} : null,
    resize: width => body.style.setProperty("--sidebar-width", `${width}px`),
    commit: () => {
      const width = body.style.getPropertyValue("--sidebar-width")
      if (!width) return
      try { localStorage.setItem(widthStorageKey, String(parseFloat(width))) } catch { /* Keep the in-memory size. */ }
    },
  })
  const reset = () => {
    body.style.removeProperty("--sidebar-width")
    try { localStorage.removeItem(widthStorageKey) } catch { /* Keep the in-memory size. */ }
    handle.setAttribute("aria-valuenow", String(Math.round(sidebar.getBoundingClientRect().width)))
  }
  handle.addEventListener("dblclick", reset)
  const storage = (event: StorageEvent) => { if (event.key === null || event.key === widthStorageKey) syncWidth() }
  window.addEventListener("storage", storage)
  window.addEventListener(syncEvent, syncWidth)
  return () => {
    dispose(); handle.removeEventListener("dblclick", reset); handle.remove()
    window.removeEventListener("storage", storage)
    window.removeEventListener(syncEvent, syncWidth)
  }
}

function preferredCollapse() {
  try { const saved = localStorage.getItem(storageKey); if (saved !== null) return saved === "true" } catch { /* Storage is optional. */ }
  return window.innerWidth > 760 && window.innerWidth < 1100
}
function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(preferredCollapse)
  useEffect(() => { document.body.classList.toggle("sidebar-collapsed", collapsed) }, [collapsed])
  useEffect(() => {
    const sync = () => {
      const next = preferredCollapse()
      // Apply geometry synchronously before the tab host reveals this page.
      document.body.classList.toggle("sidebar-collapsed", next)
      setCollapsed(next)
    }
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === storageKey) sync() }
    window.addEventListener("resize", sync)
    window.addEventListener("storage", storage)
    window.addEventListener(syncEvent, sync)
    return () => {
      window.removeEventListener("resize", sync)
      window.removeEventListener("storage", storage)
      window.removeEventListener(syncEvent, sync)
    }
  }, [])
  const label = collapsed ? uiText("展开侧栏") : uiText("收起侧栏")
  return <>
    {window.parent !== window && <button type="button" className="sidebar-control sidebar-new-tab" aria-label={uiText("新建标签页")} title={uiText("新建标签页（⌘/Ctrl+T）")} aria-keyshortcuts="Meta+T Control+T"
      onClick={() => window.dispatchEvent(new CustomEvent("workhub:tab-command", {detail:"new"}))}>
      <SquarePlus aria-hidden="true" />
    </button>}
    <button type="button" className="sidebar-control sidebar-toggle" aria-label={label} title={label} aria-expanded={!collapsed} aria-controls="workspaceSidebar"
    onClick={() => setCollapsed(current => { const next = !current; try { localStorage.setItem(storageKey, String(next)) } catch { /* Keep the current window preference. */ } return next })}>
    {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
  </button>
  </>
}
export function mountWorkspaceSidebar() {
  const sidebar = document.querySelector<HTMLElement>(".sidebar")
  if (!sidebar) return
  sidebar.id = "workspaceSidebar"
  for (const [view, Icon] of [["requirements", ListTodo], ["projects", FolderGit2], ["sessions", MessagesSquare]] as const) {
    const icon = sidebar.querySelector(`[data-view="${view}"] .nav-icon`)
    if (icon) icon.innerHTML = renderToStaticMarkup(<Icon aria-hidden="true" size={18} />)
  }
  document.body.classList.toggle("sidebar-collapsed", preferredCollapse())
  const host = document.createElement("div"); host.className = "sidebar-controls"
  sidebar.querySelector(".brand")?.after(host)
  const root = createRoot(host); root.render(<SidebarToggle />)
  const disposeResize = setupSidebarResize(sidebar)
  const disposePins = setupShortcutIcons(sidebar)
  const disposeUsage = mountCodexUsage(sidebar)
  window.addEventListener("pagehide", () => { disposeUsage(); disposePins(); disposeResize(); root.unmount() }, { once: true })
}
