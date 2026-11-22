import { uiText } from "../i18n";
import { useLayoutEffect, useRef, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { flushSync } from "react-dom"
import { ArrowLeft, ArrowRight, ChevronDown, ListTodo, Search, CircleDot, RefreshCw } from "lucide-react"
import { DropdownMenu } from "radix-ui"
import { CodexUsage } from "./codex-usage"
import { setupSplitResize } from "./split-resize"

export { setupSplitResize }
export { createGlobalSearch } from "./global-search"

interface PaneProps {
  count: number
  resize: (index: number, width: number) => void
  frames: HTMLIFrameElement[]; container: HTMLElement
}
function PaneSeparator({ index, frames, container, resize }: PaneProps & {index: number}) {
  const ref = useRef<HTMLDivElement>(null)
  const frame = frames[index], adjacent = frames[index + 1]
  useLayoutEffect(() => setupSplitResize({
    handle:ref.current!, container, panel:frame, axis:"x",
    bounds:() => {
      const pair = frame.getBoundingClientRect().width + adjacent.getBoundingClientRect().width
      return pair > 0 ? {min:Math.min(280, pair / 2), max:pair - Math.min(280, pair / 2)} : null
    },
    resize:width => resize(index, width),
  }), [index, frame, adjacent, container, resize])
  return <div ref={ref} role="separator" tabIndex={0} aria-orientation="vertical" aria-label={uiText("调整第 {0} 栏宽度", index + 1)} className="workspace-pane-resize" style={{gridColumn:index * 2 + 2, gridRow:1}} />
}
function PaneHeaders(props: PaneProps) {
  return <>{Array.from({length:props.count - 1}, (_, index) => <PaneSeparator key={`resize-${index}`} {...props} index={index} />)}</>
}

const roots = new WeakMap<HTMLElement, Root>()
interface WindowChromeProps {
  ready: boolean
  canGoBack?: boolean
  canGoForward?: boolean
  back?: () => void
  forward?: () => void
  home: () => void
  search?: (trigger: HTMLButtonElement) => void
  appMenu?: () => void
  issues?: () => void
  issuesActive?: boolean
  refresh?: () => Promise<void>
}
function WindowChrome(props: WindowChromeProps) {
  const [refreshing, setRefreshing] = useState(false)
  const appMenu = props.appMenu
  const trigger = <button type="button" className="window-brand-trigger" aria-label={uiText("Yolu 菜单")} title={uiText("Yolu 菜单")} aria-haspopup="menu" onClick={appMenu} onKeyDown={appMenu ? event => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    appMenu()
  } : undefined}>
    <img src="/yolu.svg" width="16" height="16" alt="" />
    <span>Yolu</span>
    <ChevronDown size={12} aria-hidden="true" />
  </button>
  const brand = appMenu ? trigger : <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      {trigger}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="window-brand-menu shadcn-scope" side="bottom" align="start" sideOffset={6} collisionPadding={8}>
        <DropdownMenu.Item className="window-brand-menu-item" disabled={!props.ready} onSelect={props.home}>
          <ListTodo aria-hidden="true" /><span>{uiText("工作区首页")}</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
  return <>{brand}<div className="window-history" role="group" aria-label={uiText("页面导航")}>
    <button type="button" className="window-utility-button" aria-label={uiText("后退")} title={uiText("后退")} aria-keyshortcuts="Alt+ArrowLeft Meta+[" disabled={!props.canGoBack} onClick={props.back}><ArrowLeft aria-hidden="true" /></button>
    <button type="button" className="window-utility-button" aria-label={uiText("前进")} title={uiText("前进")} aria-keyshortcuts="Alt+ArrowRight Meta+]" disabled={!props.canGoForward} onClick={props.forward}><ArrowRight aria-hidden="true" /></button>
  </div>{props.search && <button type="button" className="window-search-trigger" aria-label={uiText("全局搜索")} title={uiText("全局搜索")} aria-haspopup="dialog" aria-controls="globalSearch" aria-keyshortcuts="Meta+K Control+K" onClick={event => props.search?.(event.currentTarget)}>
    <Search size={14} aria-hidden="true" /><span>{uiText("搜索或跳转…")}</span><kbd aria-hidden="true">{navigator.platform.startsWith("Mac") ? "⌘ K" : "Ctrl K"}</kbd>
  </button>}
    <div className="window-utilities" role="toolbar" aria-label={uiText("工作台工具")}>
      <button type="button" className="window-utility-button window-issues" aria-label="Issues" title="Issues" aria-current={props.issuesActive ? "page" : undefined} disabled={!props.ready} onClick={props.issues}><CircleDot aria-hidden="true" /><span>Issues</span></button>
      <button type="button" className="window-utility-button" aria-label={uiText("刷新 Git 状态")} title={uiText("刷新 Git 状态")} disabled={!props.ready || refreshing} onClick={async () => {
        if (refreshing) return
        setRefreshing(true)
        try { await props.refresh?.() } finally { setRefreshing(false) }
      }}><RefreshCw className={refreshing ? "codex-quota-spinning" : undefined} aria-hidden="true" /></button>
      <CodexUsage portal={document.body} />
    </div>
  </>
}
export function renderChrome(container: HTMLElement, props: WindowChromeProps) {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  flushSync(() => root.render(<WindowChrome {...props} />))
}
export function renderPanes(container: HTMLElement, props: PaneProps | null) {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  flushSync(() => root.render(props ? <PaneHeaders {...props} /> : null))
}

export { conversationDefaults } from "./conversation-defaults"
