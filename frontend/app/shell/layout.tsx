import {uiText} from "@/shared/i18n"
import {useEffect, useState} from "react"
import type {Root} from "react-dom/client"
import {createRecoverableRoot as createRoot} from "@/shared/ui/feedback/root"
import {flushSync} from "react-dom"
import {ArrowLeft, ArrowRight, Ellipsis, FolderGit2, MessageSquare, Search, RefreshCw, Settings, SquarePen, SquareSplitHorizontal, Ticket} from "lucide-react"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/shared/ui/primitives/tooltip"
import {CodexUsage} from "@/features/conversations/usage/codex-usage"
import {setupSplitResize} from "@/shared/lib/split-resize"
import {LayoutRoot, type LayoutRootProps} from "@/app/pane-layout/components/layout-root"
import {resolveDropTarget} from "@/app/pane-layout/interactions/drag-and-drop"
import {matchPaneShortcut} from "@/app/pane-layout/interactions/shortcuts"
import {createInitialLayout} from "@/app/pane-layout/model/operations"
import {countPanes, findPane, findPaneByConversationId, listPanes} from "@/app/pane-layout/model/tree"
import {DEFAULT_LAYOUT_CONSTRAINTS} from "@/app/pane-layout/model/types"
import {createPaneLayoutPersistence} from "@/app/pane-layout/persistence/serializer"
import {createPaneLayoutStore} from "@/app/pane-layout/state/layout-store"
import {computeLayoutView, getPaneCapabilities} from "@/app/pane-layout/state/selectors"

export { setupSplitResize }
export { createGlobalSearch } from "./search"

const roots = new WeakMap<HTMLElement, Root>()
const destinations = [
  { view: "sessions", label: "对话", Icon: MessageSquare },
  { view: "projects", label: "项目", Icon: FolderGit2 },
  { view: "issues", label: "任务", Icon: Ticket },
  { view: "settings", label: "设置", Icon: Settings },
] as const
type Destination = typeof destinations[number]["view"]
type RefreshResult = "updated" | "pending" | "failed" | "cancelled"
interface WindowChromeProps {
  ready: boolean
  activeView?: string
  canGoBack?: boolean
  canGoForward?: boolean
  back?: () => void
  forward?: () => void
  navigate: (view: Destination) => void
  createConversation?: (placement: "current" | "split") => void
  canCreateConversation?: boolean
  canSplitConversation?: boolean
  search?: (trigger: HTMLButtonElement) => void
  appMenu?: (trigger: HTMLButtonElement) => void
  refresh?: () => Promise<RefreshResult>
}
function WindowChrome(props: WindowChromeProps) {
  const [refreshing, setRefreshing] = useState(false)
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null)
  useEffect(() => {
    if (!refreshResult) return
    const timeout = window.setTimeout(() => setRefreshResult(null), refreshResult === "failed" ? 5000 : 3500)
    return () => window.clearTimeout(timeout)
  }, [refreshResult])
  const refresh = async () => {
    if (refreshing || !props.refresh) return
    setRefreshing(true)
    setRefreshResult(null)
    try {
      setRefreshResult(await props.refresh())
    } catch {
      setRefreshResult("failed")
    } finally {
      setRefreshing(false)
    }
  }
  const refreshMessage = refreshing || refreshResult === "pending" ? uiText("正在更新 Git 状态…")
    : refreshResult === "updated" ? uiText("Git 状态已更新")
      : refreshResult === "failed" ? uiText("Git 状态刷新失败，请重试") : ""
  const appMenu = props.appMenu
  return <TooltipProvider delayDuration={450}><div className="window-header-row">
    <div className="window-header-start">
      <div className="window-header-leading">
        <nav className="window-destinations" aria-label={uiText("主导航")}>
          {destinations.map(({view, label, Icon}) => <Tooltip key={view}>
            <TooltipTrigger asChild><button type="button" className="window-utility-button"
              data-view={view} aria-label={uiText(label)} aria-current={props.activeView === view ? "page" : undefined}
              disabled={!props.ready} onClick={() => props.navigate(view)}><Icon aria-hidden="true" /></button></TooltipTrigger>
            <TooltipContent side="bottom" className="window-header-tooltip">{uiText(label)}</TooltipContent>
          </Tooltip>)}
        </nav>
        {props.createConversation && <div className="window-conversation-actions" role="group" aria-label={uiText("对话创建")}>
          <button type="button" className="window-utility-button" aria-label={uiText("新建对话")}
            title={uiText("在当前栏新建对话")} disabled={!props.canCreateConversation} onClick={() => props.createConversation?.("current")}>
            <SquarePen aria-hidden="true" />
          </button>
          <button type="button" className="window-utility-button" aria-label={uiText("在右侧分栏新建")}
            title={props.canCreateConversation && !props.canSplitConversation ? uiText("已达到最大分屏数量或空间不足") : uiText("在右侧分栏新建")}
            disabled={!props.canCreateConversation || !props.canSplitConversation} onClick={() => props.createConversation?.("split")}>
            <SquareSplitHorizontal aria-hidden="true" />
          </button>
        </div>}
      </div>
      <div className="window-history" role="group" aria-label={uiText("页面导航")}>
        <button type="button" className="window-utility-button" aria-label={uiText("后退")} title={uiText("后退")} aria-keyshortcuts="Alt+ArrowLeft Meta+[" disabled={!props.canGoBack} onClick={props.back}><ArrowLeft aria-hidden="true" /></button>
        <button type="button" className="window-utility-button" aria-label={uiText("前进")} title={uiText("前进")} aria-keyshortcuts="Alt+ArrowRight Meta+]" disabled={!props.canGoForward} onClick={props.forward}><ArrowRight aria-hidden="true" /></button>
      </div>
    </div>
    {props.search && <Tooltip>
      <TooltipTrigger asChild><button type="button" className="window-search-trigger" aria-label={uiText("全局搜索")} aria-haspopup="dialog" aria-controls="globalSearch"
        aria-keyshortcuts="Meta+K Control+K" onClick={event => props.search?.(event.currentTarget)}>
        <Search size={16} aria-hidden="true" /><span>{uiText("搜索或跳转…")}</span><kbd>{navigator.platform.startsWith("Mac") ? "⌘ K" : "Ctrl K"}</kbd>
      </button></TooltipTrigger>
      <TooltipContent side="bottom" className="window-header-tooltip">{uiText("搜索项目和对话…")}</TooltipContent>
    </Tooltip>}
    <div className="window-utilities" role="group" aria-label={uiText("工作台工具")}>
      <Tooltip>
        <TooltipTrigger asChild><button type="button" className="window-utility-button" aria-label={uiText("刷新 Git 状态")}
          disabled={!props.ready || !props.refresh} aria-disabled={refreshing || undefined} onClick={refresh}>
          <RefreshCw className={refreshing ? "codex-quota-spinning" : undefined} aria-hidden="true" />
        </button></TooltipTrigger>
        <TooltipContent side="bottom" className="window-header-tooltip">{uiText("刷新 Git 状态")}</TooltipContent>
      </Tooltip>
      <span className="window-refresh-status" role="status" data-result={refreshResult || undefined}>{refreshMessage}</span>
      <CodexUsage portal={document.body} placement="header" />
      {appMenu && <button type="button" className="window-utility-button window-app-menu" aria-label={uiText("应用菜单")} title={uiText("应用菜单")} aria-haspopup="menu"
        onClick={event => appMenu(event.currentTarget)} onKeyDown={event => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          event.preventDefault()
          appMenu(event.currentTarget)
        }}><Ellipsis aria-hidden="true" /></button>}
    </div>
  </div></TooltipProvider>
}
export function renderChrome(container: HTMLElement, props: WindowChromeProps) {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  flushSync(() => root.render(<WindowChrome {...props} />))
}

export function renderPaneLayout(container: HTMLElement, props: LayoutRootProps | null) {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  flushSync(() => root.render(props ? <LayoutRoot {...props} /> : null))
}

export const paneLayout = {
  constraints: DEFAULT_LAYOUT_CONSTRAINTS,
  createInitialLayout,
  createStore: createPaneLayoutStore,
  createPersistence: createPaneLayoutPersistence,
  computeLayoutView,
  getPaneCapabilities,
  findPane,
  findPaneByConversationId,
  listPanes,
  countPanes,
  resolveDropTarget,
  matchPaneShortcut,
  render: renderPaneLayout,
}

export { conversationDefaults } from "@/shared/lib/preferences"
