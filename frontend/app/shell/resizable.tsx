import {uiText} from "@/shared/i18n"
import {useLayoutEffect, useRef} from "react"
import type {Root} from "react-dom/client"
import {createRecoverableRoot as createRoot} from "@/shared/ui/feedback/root"
import {flushSync} from "react-dom"
import {Group, Panel, Separator} from "react-resizable-panels"

// The panel library owns sizing and keyboard navigation. Existing controllers
// still own the content nodes inside each stable panel boundary.
function NativePanel({ node, className = "" }: { node: HTMLElement; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { ref.current?.append(node); return () => node.remove() }, [node])
  return <div ref={ref} className={`ui-panel-node ${className}`} />
}
type PanelPair = { container: HTMLElement; list: HTMLElement; detail: HTMLElement; legacy: HTMLElement; width: number }
const desktop = () => document.documentElement.hasAttribute("data-workhub-desktop")
const narrowLayout = (width: number) => {
  if (document.documentElement.hasAttribute("data-workspace-pane") || document.documentElement.hasAttribute("data-workspace-conversation") || document.documentElement.hasAttribute("data-workspace-navigation")) return true
  return desktop() ? window.innerWidth <= 760 : width < 620
}
function Panels({ container, list, detail, legacy, width }: PanelPair) {
  const key = "workhub:conversation-list-width:v1"
  let saved = 280
  try { const value = Number(localStorage.getItem(key)); if (Number.isFinite(value) && value >= 200) saved = value } catch { /* Persistence is optional. */ }
  const narrow = narrowLayout(width)
  return <>
    {narrow ? <div className="ui-narrow-panels"><NativePanel node={list} className="ui-narrow-list" /><NativePanel node={detail} className="ui-narrow-detail" /></div> : <Group orientation="horizontal" className="ui-panel-group"
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) return
        // The callback precedes the browser's layout pass; use the library's
        // completed percentages rather than reading the previous DOM width.
        const available = container.getBoundingClientRect().width - 8
        const percentage = layout["conversation-list-frame"]
        if (available > 0 && Number.isFinite(percentage)) { try { localStorage.setItem(key, String(Math.round(available * percentage / 100))) } catch { /* Persistence is optional. */ } }
      }}>
      <Panel id="conversation-list-frame" defaultSize={saved} minSize={220} maxSize={520} groupResizeBehavior="preserve-pixel-size" className="ui-panel"
        onResize={size => { if (!size.inPixels) return; container.style.setProperty("--conversation-list-width", `${Math.round(size.inPixels)}px`) }}>
        <NativePanel node={list} />
      </Panel>
      <Separator className="ui-resizable-separator" aria-label={uiText("调整对话列表宽度")} />
      <Panel id="conversation-detail-frame" minSize={328} className="ui-panel"><NativePanel node={detail} /></Panel>
    </Group>}
    <NativePanel node={legacy} className="ui-legacy-resizer" />
  </>
}

export function setupWorkspacePanels() {
  // Without layout measurements (e.g. a DOM-only host), retain native resizing.
  if (typeof ResizeObserver === "undefined") return
  const roots = new Map<HTMLElement, { root: Root; observer: ResizeObserver; width: number; pair: PanelPair }>()
  let queued = false, disposed = false
  const scan = () => {
    queued = false
    if (disposed) return
    for (const [container, entry] of roots) if (!container.isConnected) { entry.observer.disconnect(); entry.root.unmount(); roots.delete(container) }
    for (const container of document.querySelectorAll<HTMLElement>(".session-browser-body")) {
      if (roots.has(container)) continue
      const list = container.querySelector<HTMLElement>(".session-browser-list")
      const detail = container.querySelector<HTMLElement>(".session-browser-detail")
      const legacy = container.querySelector<HTMLElement>("#sessionBrowserResize")
      if (!list || !detail || !legacy) continue
      const host = document.createElement("div"); host.className = "ui-panels-host"
      const root = createRoot(host), width = container.getBoundingClientRect().width
      const pair = { container, list, detail, legacy, width }
      container.dataset.reactPanels = narrowLayout(width) ? "narrow" : "wide"
      const observer = new ResizeObserver(() => {
        const entry = roots.get(container), next = Math.round(container.getBoundingClientRect().width)
        if (!entry || next === entry.width || !next) return
        const mode = narrowLayout(next) ? "narrow" : "wide"
        const switching = container.dataset.reactPanels !== mode
        const focused = switching && container.contains(document.activeElement) ? document.activeElement as HTMLElement : null
        entry.width = next; entry.pair.width = next; container.dataset.reactPanels = mode
        if (switching) { flushSync(() => entry.root.render(<Panels {...entry.pair} />)); if (focused?.isConnected) focused.focus({ preventScroll: true }) }
        else entry.root.render(<Panels {...entry.pair} />)
      })
      roots.set(container, { root, observer, width, pair })
      const focused = container.contains(document.activeElement) ? document.activeElement as HTMLElement : null
      container.replaceChildren(host)
      flushSync(() => root.render(<Panels {...pair} />))
      focused?.focus({ preventScroll: true })
      observer.observe(container)
    }
  }
  const changes = new MutationObserver(() => { if (!queued && !disposed) { queued = true; queueMicrotask(scan) } })
  changes.observe(document.body, { childList: true, subtree: true })
  scan()
  window.addEventListener("pagehide", () => { disposed = true; changes.disconnect(); for (const entry of roots.values()) { entry.observer.disconnect(); entry.root.unmount() } roots.clear() }, { once: true })
}
