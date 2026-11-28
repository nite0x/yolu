import { uiText } from "@/shared/i18n"
import { useCallback, useEffect, useRef, type ReactNode } from "react"
import {
  DEFAULT_LAYOUT_CONSTRAINTS,
  type LayoutConstraints,
  type PaneLayout,
  type PaneNode,
  type SplitPlacement,
  type ViewportSize,
} from "../model/types"
import type { PaneInteractionState } from "../state/layout-store"
import {
  computeLayoutView,
  getPaneCapabilities,
  type PaneCapabilities,
} from "../state/selectors"
import type { RecentConversationItem } from "./empty-pane"
import { LayoutNodeView } from "./layout-node"
import { PaneContainer } from "./pane-container"

export interface NarrowPaneOption {
  paneId: string
  label: string
}

export interface LayoutRootProps {
  layout: PaneLayout
  interaction: PaneInteractionState
  viewport: ViewportSize
  container: HTMLElement | null
  constraints?: LayoutConstraints
  recentConversations: readonly RecentConversationItem[]
  canCreateConversation: boolean
  narrowPaneOptions?: readonly NarrowPaneOption[]
  renderPaneContent?: (pane: PaneNode, capabilities: PaneCapabilities) => ReactNode
  onCreateConversation: (
    paneId: string,
    context?: Extract<PaneNode["content"], { type: "empty" }>["context"],
  ) => void
  onPickConversation: (paneId: string, trigger?: HTMLButtonElement) => void
  onPickResource?: (paneId: string, kind: "file" | "project", trigger?: HTMLButtonElement) => void
  onSelectFile?: (paneId: string, path: string, mode: string) => void
  onOpenRecentConversation: (paneId: string, item: RecentConversationItem) => void
  onSplit: (paneId: string, placement: SplitPlacement) => void
  onToggleMaximize: (paneId: string) => void
  onClose: (paneId: string) => void
  onFocus: (paneId: string) => void
  onSelectNarrowPane?: (paneId: string) => void
  onResizeStart: (splitId: string) => void
  onResize: (splitId: string, ratio: number) => void
  onResizeCommit: (splitId: string) => void
  onResetRatio: (splitId: string) => void
  onDragStart?: (paneId: string) => void
  onDragMove?: (clientX: number, clientY: number) => void
  onDragEnd?: () => void
  onDragCancel?: () => void
}

const DRAG_THRESHOLD_PX = 6

export function LayoutRoot(props: LayoutRootProps) {
  const constraints = props.constraints ?? DEFAULT_LAYOUT_CONSTRAINTS
  const view = computeLayoutView(props.layout, props.interaction, props.viewport, constraints)
  const dropTarget = props.interaction.dropTarget
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const narrowSelectRef = useRef<HTMLSelectElement | null>(null)
  const dragCallbacksRef = useRef({
    onDragStart: props.onDragStart,
    onDragMove: props.onDragMove,
    onDragEnd: props.onDragEnd,
    onDragCancel: props.onDragCancel,
  })
  dragCallbacksRef.current = {
    onDragStart: props.onDragStart,
    onDragMove: props.onDragMove,
    onDragEnd: props.onDragEnd,
    onDragCancel: props.onDragCancel,
  }
  const selectNarrowRef = useRef(props.onSelectNarrowPane)
  selectNarrowRef.current = props.onSelectNarrowPane

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
    }
  }, [])

  const showNarrowSwitcher = view.isCompactFocusMode && view.isSplit && !!props.narrowPaneOptions
  useEffect(() => {
    if (!showNarrowSwitcher) return
    const select = narrowSelectRef.current
    if (!select) return
    const handleNativeChange = () => {
      selectNarrowRef.current?.(select.value)
    }
    select.addEventListener("change", handleNativeChange)
    return () => select.removeEventListener("change", handleNativeChange)
  }, [showNarrowSwitcher])

  const handleStartHeaderDrag = useCallback(
    (paneId: string, downEvent: React.PointerEvent<HTMLElement>) => {
      const cbs = dragCallbacksRef.current
      if (!cbs.onDragStart || !cbs.onDragMove || !cbs.onDragEnd || !cbs.onDragCancel) {
        return
      }
      const captureTarget = downEvent.currentTarget
      const ownerDocument = captureTarget.ownerDocument
      const ownerWindow = ownerDocument.defaultView
      if (!ownerWindow) return

      dragCleanupRef.current?.()

      const startX = downEvent.clientX
      const startY = downEvent.clientY
      const pointerId = downEvent.pointerId
      let started = false

      const cleanup = () => {
        if (captureTarget.hasPointerCapture?.(pointerId)) {
          captureTarget.releasePointerCapture(pointerId)
        }
        ownerDocument.removeEventListener("pointermove", onMove)
        ownerDocument.removeEventListener("pointerup", onUp)
        ownerDocument.removeEventListener("pointercancel", onCancel)
        captureTarget.removeEventListener("lostpointercapture", onCancel)
        ownerDocument.removeEventListener("keydown", onKeyDown, true)
        ownerWindow.removeEventListener("blur", onCancel)
        if (dragCleanupRef.current === cancelOnUnmount) {
          dragCleanupRef.current = null
        }
      }

      const cancelOnUnmount = () => {
        cleanup()
        if (started) dragCallbacksRef.current.onDragCancel?.()
      }

      const onMove = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return
        if (!started) {
          if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD_PX) {
            return
          }
          started = true
          try {
            captureTarget.setPointerCapture?.(pointerId)
          } catch {
            /* Pointer capture is optional in synthetic environments. */
          }
          dragCallbacksRef.current.onDragStart?.(paneId)
        }
        dragCallbacksRef.current.onDragMove?.(event.clientX, event.clientY)
      }

      const onUp = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return
        cleanup()
        if (started) dragCallbacksRef.current.onDragEnd?.()
      }

      const onCancel = () => {
        cleanup()
        if (started) dragCallbacksRef.current.onDragCancel?.()
      }

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }

      dragCleanupRef.current = cancelOnUnmount
      ownerDocument.addEventListener("pointermove", onMove)
      ownerDocument.addEventListener("pointerup", onUp)
      ownerDocument.addEventListener("pointercancel", onCancel)
      captureTarget.addEventListener("lostpointercapture", onCancel)
      ownerDocument.addEventListener("keydown", onKeyDown, true)
      ownerWindow.addEventListener("blur", onCancel)
    },
    [],
  )

  const singlePaneOnly =
    view.maximizedPaneId !== null || view.isCompactFocusMode
      ? view.visiblePanes[0] ?? null
      : null

  return (
    <div
      className="pane-layout-root shadcn-scope"
      data-split={view.isSplit || undefined}
      data-compact={view.isCompactFocusMode || undefined}
      data-maximized={view.maximizedPaneId !== null || undefined}
      data-dragging={props.interaction.draggingPaneId !== null || undefined}
    >
      {showNarrowSwitcher && props.narrowPaneOptions && (
        <select
          ref={narrowSelectRef}
          id="workspaceNarrowPanes"
          aria-label={uiText("查看并列组合中的页面")}
          value={view.activePaneId}
          onChange={() => {}}
        >
          {props.narrowPaneOptions.map(option => (
            <option key={option.paneId} value={option.paneId}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      <div className="pane-layout-stage">
        {singlePaneOnly ? (
          <PaneContainer
            pane={singlePaneOnly}
            capabilities={getPaneCapabilities(
              props.layout,
              props.interaction,
              singlePaneOnly.id,
              props.viewport,
              constraints,
            )}
            isDraggingSource={false}
            recentConversations={props.recentConversations}
            canCreateConversation={props.canCreateConversation}
            renderPaneContent={props.renderPaneContent}
            onCreateConversation={props.onCreateConversation}
            onPickConversation={props.onPickConversation}
            onPickResource={props.onPickResource}
            onSelectFile={props.onSelectFile}
            onOpenRecentConversation={props.onOpenRecentConversation}
            onSplit={props.onSplit}
            onToggleMaximize={props.onToggleMaximize}
            onClose={props.onClose}
            onFocus={props.onFocus}
          />
        ) : (
          <LayoutNodeView
            node={props.layout.root}
            layout={props.layout}
            interaction={props.interaction}
            viewport={props.viewport}
            container={props.container}
            constraints={constraints}
            recentConversations={props.recentConversations}
            canCreateConversation={props.canCreateConversation}
            renderPaneContent={props.renderPaneContent}
            onCreateConversation={props.onCreateConversation}
            onPickConversation={props.onPickConversation}
            onPickResource={props.onPickResource}
            onSelectFile={props.onSelectFile}
            onOpenRecentConversation={props.onOpenRecentConversation}
            onSplit={props.onSplit}
            onToggleMaximize={props.onToggleMaximize}
            onClose={props.onClose}
            onFocus={props.onFocus}
            onResizeStart={props.onResizeStart}
            onResize={props.onResize}
            onResizeCommit={props.onResizeCommit}
            onResetRatio={props.onResetRatio}
            onStartHeaderDrag={handleStartHeaderDrag}
          />
        )}
        {dropTarget && (
          <div
            className="pane-layout-drop-preview"
            data-zone={dropTarget.zone}
            aria-hidden="true"
            style={{
              left: `${(dropTarget.previewRect.x * 100).toFixed(4)}%`,
              top: `${(dropTarget.previewRect.y * 100).toFixed(4)}%`,
              width: `${(dropTarget.previewRect.width * 100).toFixed(4)}%`,
              height: `${(dropTarget.previewRect.height * 100).toFixed(4)}%`,
            }}
          >
            <span className="pane-layout-drop-badge">
              {dropTarget.zone === "center"
                ? uiText("交换位置")
                : dropTarget.zone === "left"
                  ? uiText("移到左侧")
                  : dropTarget.zone === "right"
                    ? uiText("移到右侧")
                    : dropTarget.zone === "top"
                      ? uiText("移到上方")
                      : uiText("移到下方")}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
