import { computeLayoutRects } from "../model/tree"
import type { DropTarget, DropZone, LayoutNode, NormalizedRect } from "../model/types"

export type { DropTarget }

export interface ContainerBox {
  left: number
  top: number
  width: number
  height: number
}

export interface ClientPoint {
  clientX: number
  clientY: number
}

const EDGE_THRESHOLD = 0.28

/**
 * Resolves the drop zone (left, right, top, bottom, or center swap) for a
 * dragged pane given pointer coordinates in host viewport space.
 */
export function resolveDropTarget(
  root: LayoutNode,
  containerBox: ContainerBox,
  point: ClientPoint,
  sourcePaneId: string,
): DropTarget | null {
  if (containerBox.width <= 0 || containerBox.height <= 0) return null
  const nx = (point.clientX - containerBox.left) / containerBox.width
  const ny = (point.clientY - containerBox.top) / containerBox.height
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null

  const rects = computeLayoutRects(root)
  for (const [paneId, rect] of rects) {
    if (
      nx < rect.x ||
      nx > rect.x + rect.width ||
      ny < rect.y ||
      ny > rect.y + rect.height
    ) {
      continue
    }
    if (paneId === sourcePaneId) return null

    const localX = rect.width > 0 ? (nx - rect.x) / rect.width : 0.5
    const localY = rect.height > 0 ? (ny - rect.y) / rect.height : 0.5
    const zone = classifyDropZone(localX, localY)
    return {
      targetPaneId: paneId,
      zone,
      previewRect: computeDropPreviewRect(rect, zone),
    }
  }

  return null
}

export function classifyDropZone(localX: number, localY: number): DropZone {
  const distLeft = localX
  const distRight = 1 - localX
  const distTop = localY
  const distBottom = 1 - localY

  const minEdge = Math.min(distLeft, distRight, distTop, distBottom)
  if (minEdge >= EDGE_THRESHOLD) return "center"

  if (minEdge === distLeft) return "left"
  if (minEdge === distRight) return "right"
  if (minEdge === distTop) return "top"
  return "bottom"
}

export function computeDropPreviewRect(
  paneRect: NormalizedRect,
  zone: DropZone,
): NormalizedRect {
  switch (zone) {
    case "left":
      return {
        x: paneRect.x,
        y: paneRect.y,
        width: paneRect.width * 0.5,
        height: paneRect.height,
      }
    case "right":
      return {
        x: paneRect.x + paneRect.width * 0.5,
        y: paneRect.y,
        width: paneRect.width * 0.5,
        height: paneRect.height,
      }
    case "top":
      return {
        x: paneRect.x,
        y: paneRect.y,
        width: paneRect.width,
        height: paneRect.height * 0.5,
      }
    case "bottom":
      return {
        x: paneRect.x,
        y: paneRect.y + paneRect.height * 0.5,
        width: paneRect.width,
        height: paneRect.height * 0.5,
      }
    case "center":
      return { ...paneRect }
  }
}
