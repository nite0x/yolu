import {
  canSplitPaneInDirection,
  computeLayoutGeometry,
  computeMinSubtreeSize,
  countPanes,
  findFirstPane,
  findPane,
  listPanes,
} from "../model/tree"
import {
  DEFAULT_LAYOUT_CONSTRAINTS,
  type DividerRect,
  type LayoutConstraints,
  type NormalizedRect,
  type PaneLayout,
  type PaneNode,
  type ViewportSize,
} from "../model/types"
import type { PaneInteractionState } from "./layout-store"

export interface PaneCapabilities {
  split: boolean
  focused: boolean
  zoomed: boolean
  canZoom: boolean
  canSplitRight: boolean
  canSplitDown: boolean
  canSplitLeft: boolean
  canSplitUp: boolean
  canSplit: boolean
  canClose: boolean
  paneCount: number
}

export interface ComputedLayoutView {
  isSplit: boolean
  isCompactFocusMode: boolean
  maximizedPaneId: string | null
  activePaneId: string
  allPanes: PaneNode[]
  visiblePanes: PaneNode[]
  paneRects: Map<string, NormalizedRect>
  dividers: DividerRect[]
}

export function isSplitLayout(layout: PaneLayout): boolean {
  return layout.root.type === "split"
}

export function getActivePane(layout: PaneLayout): PaneNode {
  if (layout.activePaneId) {
    const found = findPane(layout.root, layout.activePaneId)
    if (found) return found
  }
  return findFirstPane(layout.root)
}

/**
 * Determines whether the viewport is too narrow/short to render multiple split
 * panes simultaneously. Preserves the underlying tree without mutating it.
 */
export function isCompactFocusViewport(
  layout: PaneLayout,
  viewport: ViewportSize,
  constraints: LayoutConstraints = DEFAULT_LAYOUT_CONSTRAINTS,
): boolean {
  if (layout.root.type !== "split") return false
  if (viewport.width <= 0 || viewport.height <= 0) return false
  const minRequired = computeMinSubtreeSize(layout.root, constraints)
  // Switch to focus mode when the viewport cannot comfortably fit the minimum
  // dimensions of the split tree (allowing slight grace before collapsing to focus mode).
  return (
    viewport.width < Math.min(minRequired.width, constraints.minPaneWidth * 2) ||
    viewport.height < Math.min(minRequired.height, constraints.minPaneHeight * 2)
  )
}

export function computeLayoutView(
  layout: PaneLayout,
  interaction: PaneInteractionState,
  viewport: ViewportSize,
  constraints: LayoutConstraints = DEFAULT_LAYOUT_CONSTRAINTS,
): ComputedLayoutView {
  const allPanes = listPanes(layout.root)
  const activePane = getActivePane(layout)
  const isSplit = layout.root.type === "split"
  const compact = isCompactFocusViewport(layout, viewport, constraints)
  const effectiveMax =
    interaction.maximizedPaneId && findPane(layout.root, interaction.maximizedPaneId)
      ? interaction.maximizedPaneId
      : null

  if (!isSplit || compact || effectiveMax) {
    const shownId = effectiveMax ?? activePane.id
    const shownPane = findPane(layout.root, shownId) ?? activePane
    const paneRects = new Map<string, NormalizedRect>([
      [shownPane.id, { x: 0, y: 0, width: 1, height: 1 }],
    ])
    return {
      isSplit,
      isCompactFocusMode: compact,
      maximizedPaneId: effectiveMax,
      activePaneId: activePane.id,
      allPanes,
      visiblePanes: [shownPane],
      paneRects,
      dividers: [],
    }
  }

  const geometry = computeLayoutGeometry(layout.root)
  return {
    isSplit,
    isCompactFocusMode: false,
    maximizedPaneId: null,
    activePaneId: activePane.id,
    allPanes,
    visiblePanes: allPanes,
    paneRects: geometry.panes,
    dividers: geometry.dividers,
  }
}

export function getPaneCapabilities(
  layout: PaneLayout,
  interaction: PaneInteractionState,
  paneId: string,
  viewport: ViewportSize,
  constraints: LayoutConstraints = DEFAULT_LAYOUT_CONSTRAINTS,
): PaneCapabilities {
  const paneCount = countPanes(layout.root)
  const split = paneCount > 1
  const compact = isCompactFocusViewport(layout, viewport, constraints)
  const zoomed = interaction.maximizedPaneId === paneId
  const canZoom = split && !compact
  const activePane = getActivePane(layout)
  const canSplitRight =
    !compact && canSplitPaneInDirection(layout.root, paneId, "right", viewport, constraints)
  const canSplitDown =
    !compact && canSplitPaneInDirection(layout.root, paneId, "down", viewport, constraints)
  const canSplitLeft =
    !compact && canSplitPaneInDirection(layout.root, paneId, "left", viewport, constraints)
  const canSplitUp =
    !compact && canSplitPaneInDirection(layout.root, paneId, "up", viewport, constraints)

  return {
    split,
    focused: activePane.id === paneId,
    zoomed,
    canZoom,
    canSplitRight,
    canSplitDown,
    canSplitLeft,
    canSplitUp,
    canSplit: canSplitRight || canSplitDown || canSplitLeft || canSplitUp,
    canClose: split || (findPane(layout.root, paneId)?.content.type !== "empty"),
    paneCount,
  }
}
