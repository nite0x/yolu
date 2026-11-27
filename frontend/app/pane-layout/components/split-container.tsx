import { uiText } from "@/shared/i18n"
import { memo, useEffect, useRef, type ReactNode } from "react"
import {
  computeSplitPixelMetrics,
  ratioFromKeyboardDelta,
  ratioFromPointerCoordinate,
} from "../interactions/resize"
import type { LayoutConstraints, LayoutNode, SplitNode } from "../model/types"

export interface SplitContainerProps {
  node: SplitNode
  root: LayoutNode
  container: HTMLElement | null
  constraints: LayoutConstraints
  resizingSplitId: string | null
  onResizeStart: (splitId: string) => void
  onResize: (splitId: string, ratio: number) => void
  onResizeCommit: (splitId: string) => void
  onResetRatio: (splitId: string) => void
  first: ReactNode
  second: ReactNode
}

export const SplitContainer = memo(function SplitContainer({
  node,
  root,
  container,
  constraints,
  resizingSplitId,
  onResizeStart,
  onResize,
  onResizeCommit,
  onResetRatio,
  first,
  second,
}: SplitContainerProps) {
  const handleRef = useRef<HTMLDivElement>(null)
  const latestRoot = useRef(root)
  latestRoot.current = root
  const latestNode = useRef(node)
  latestNode.current = node
  const callbacksRef = useRef({
    onResizeStart,
    onResize,
    onResizeCommit,
    onResetRatio,
  })
  callbacksRef.current = {
    onResizeStart,
    onResize,
    onResizeCommit,
    onResetRatio,
  }

  const isHorizontal = node.direction === "horizontal"
  const firstPercent = `${(node.ratio * 100).toFixed(4)}%`
  const secondPercent = `${((1 - node.ratio) * 100).toFixed(4)}%`
  const activeResize = resizingSplitId === node.id

  useEffect(() => {
    const handle = handleRef.current
    if (!handle || !container) return
    const ownerDocument = handle.ownerDocument
    const ownerWindow = ownerDocument.defaultView
    if (!ownerWindow) return

    let drag:
      | {
          pointerId: number
          moved: boolean
          containerBox: { left: number; top: number; width: number; height: number }
        }
      | undefined
    let frameId = 0
    let pendingCoord: number | null = null

    const applyResize = (coord: number, box: { left: number; top: number; width: number; height: number }) => {
      const metrics = computeSplitPixelMetrics(
        latestRoot.current,
        latestNode.current.id,
        latestNode.current.direction,
        box,
        constraints,
      )
      if (!metrics) return false
      const nextRatio = ratioFromPointerCoordinate(coord, metrics)
      callbacksRef.current.onResize(latestNode.current.id, nextRatio)
      return true
    }

    const flushFrame = () => {
      frameId = 0
      if (!drag || pendingCoord === null) return
      const coord = pendingCoord
      pendingCoord = null
      if (!applyResize(coord, drag.containerBox)) {
        finish(drag.pointerId)
      }
    }

    const finish = (pointerId?: number) => {
      if (!drag || (pointerId !== undefined && pointerId !== drag.pointerId)) return
      if (frameId) {
        ownerWindow.cancelAnimationFrame?.(frameId)
        frameId = 0
      }
      if (pendingCoord !== null) {
        applyResize(pendingCoord, drag.containerBox)
        pendingCoord = null
      }
      const current = drag
      drag = undefined
      container.removeAttribute("data-split-resizing")
      if (handle.hasPointerCapture?.(current.pointerId)) {
        handle.releasePointerCapture(current.pointerId)
      }
      if (current.moved) callbacksRef.current.onResizeCommit(latestNode.current.id)
      else callbacksRef.current.onResizeCommit("")
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || drag) return
      const box = container.getBoundingClientRect()
      const metrics = computeSplitPixelMetrics(
        latestRoot.current,
        latestNode.current.id,
        latestNode.current.direction,
        box,
        constraints,
      )
      if (!metrics) return
      event.preventDefault()
      handle.focus({ preventScroll: true })
      drag = { pointerId: event.pointerId, moved: false, containerBox: box }
      container.dataset.splitResizing = latestNode.current.direction === "horizontal" ? "x" : "y"
      callbacksRef.current.onResizeStart(latestNode.current.id)
      handle.setPointerCapture?.(event.pointerId)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return
      drag.moved = true
      const coord =
        latestNode.current.direction === "horizontal" ? event.clientX : event.clientY
      if (typeof ownerWindow.requestAnimationFrame === "function") {
        pendingCoord = coord
        if (!frameId) frameId = ownerWindow.requestAnimationFrame(flushFrame)
      } else if (!applyResize(coord, drag.containerBox)) {
        finish(event.pointerId)
      }
    }

    const onPointerEnd = (event: PointerEvent) => finish(event.pointerId)
    const onBlur = () => finish()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      const horizontal = latestNode.current.direction === "horizontal"
      const decKey = horizontal ? "ArrowLeft" : "ArrowUp"
      const incKey = horizontal ? "ArrowRight" : "ArrowDown"
      if (![decKey, incKey, "Home", "End"].includes(event.key)) return
      const box = container.getBoundingClientRect()
      const metrics = computeSplitPixelMetrics(
        latestRoot.current,
        latestNode.current.id,
        latestNode.current.direction,
        box,
        constraints,
      )
      if (!metrics) return
      event.preventDefault()
      if (event.key === "Home") {
        callbacksRef.current.onResize(latestNode.current.id, metrics.bounds.min)
      } else if (event.key === "End") {
        callbacksRef.current.onResize(latestNode.current.id, metrics.bounds.max)
      } else {
        const step = (event.key === decKey ? -1 : 1) * (event.shiftKey ? 40 : 12)
        const nextRatio = ratioFromKeyboardDelta(latestNode.current.ratio, step, metrics)
        callbacksRef.current.onResize(latestNode.current.id, nextRatio)
      }
      callbacksRef.current.onResizeCommit(latestNode.current.id)
    }

    const onDoubleClick = (event: MouseEvent) => {
      event.preventDefault()
      callbacksRef.current.onResetRatio(latestNode.current.id)
    }

    handle.addEventListener("pointerdown", onPointerDown)
    handle.addEventListener("keydown", onKeyDown)
    handle.addEventListener("dblclick", onDoubleClick)
    ownerDocument.addEventListener("pointermove", onPointerMove)
    ownerDocument.addEventListener("pointerup", onPointerEnd)
    ownerDocument.addEventListener("pointercancel", onPointerEnd)
    handle.addEventListener("lostpointercapture", onPointerEnd)
    ownerWindow.addEventListener("blur", onBlur)

    return () => {
      finish()
      handle.removeEventListener("pointerdown", onPointerDown)
      handle.removeEventListener("keydown", onKeyDown)
      handle.removeEventListener("dblclick", onDoubleClick)
      ownerDocument.removeEventListener("pointermove", onPointerMove)
      ownerDocument.removeEventListener("pointerup", onPointerEnd)
      ownerDocument.removeEventListener("pointercancel", onPointerEnd)
      handle.removeEventListener("lostpointercapture", onPointerEnd)
      ownerWindow.removeEventListener("blur", onBlur)
    }
  }, [container, constraints])

  return (
    <div
      className="pane-layout-split"
      data-split-id={node.id}
      data-direction={node.direction}
    >
      <div className="pane-layout-branch" style={{ flexBasis: firstPercent }}>
        {first}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: Focusable resize separator adjusts split ratios via pointer and keyboard. */}
      <div
        ref={handleRef}
        role="separator"
        tabIndex={0}
        aria-orientation={isHorizontal ? "vertical" : "horizontal"}
        aria-valuemin={10}
        aria-valuemax={90}
        aria-valuenow={Math.round(node.ratio * 100)}
        aria-label={isHorizontal ? uiText("调整左右面板比例") : uiText("调整上下面板比例")}
        title={uiText("拖动调整面板比例，双击恢复默认")}
        className="pane-layout-divider"
        data-direction={node.direction}
        data-active={activeResize || undefined}
        style={isHorizontal ? { left: firstPercent } : { top: firstPercent }}
      />
      <div className="pane-layout-branch" style={{ flexBasis: secondPercent }}>
        {second}
      </div>
    </div>
  )
})
