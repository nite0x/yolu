import {
  DEFAULT_LAYOUT_CONSTRAINTS,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  type DividerRect,
  type FocusDirection,
  type LayoutConstraints,
  type LayoutGeometry,
  type LayoutNode,
  type NormalizedRect,
  type PaneNode,
  type RatioBounds,
  type SplitNode,
  type SplitPlacement,
  type ViewportSize,
} from "./types"

export function findPane(root: LayoutNode, paneId: string): PaneNode | null {
  if (root.type === "pane") return root.id === paneId ? root : null
  return findPane(root.children[0], paneId) ?? findPane(root.children[1], paneId)
}

export function findNode(root: LayoutNode, nodeId: string): LayoutNode | null {
  if (root.id === nodeId) return root
  if (root.type === "pane") return null
  return findNode(root.children[0], nodeId) ?? findNode(root.children[1], nodeId)
}

export function findParentSplit(
  root: LayoutNode,
  childId: string,
): { parent: SplitNode; childIndex: 0 | 1 } | null {
  if (root.type === "pane") return null
  if (root.children[0].id === childId) return { parent: root, childIndex: 0 }
  if (root.children[1].id === childId) return { parent: root, childIndex: 1 }
  return (
    findParentSplit(root.children[0], childId) ??
    findParentSplit(root.children[1], childId)
  )
}

export function listPanes(root: LayoutNode): PaneNode[] {
  const result: PaneNode[] = []
  const visit = (node: LayoutNode) => {
    if (node.type === "pane") {
      result.push(node)
      return
    }
    visit(node.children[0])
    visit(node.children[1])
  }
  visit(root)
  return result
}

export function countPanes(root: LayoutNode): number {
  if (root.type === "pane") return 1
  return countPanes(root.children[0]) + countPanes(root.children[1])
}

export function findFirstPane(root: LayoutNode): PaneNode {
  let node: LayoutNode = root
  while (node.type === "split") node = node.children[0]
  return node
}

export function findLastPane(root: LayoutNode): PaneNode {
  let node: LayoutNode = root
  while (node.type === "split") node = node.children[1]
  return node
}

export function findPaneByConversationId(
  root: LayoutNode,
  conversationId: string,
): PaneNode | null {
  if (!conversationId) return null
  if (root.type === "pane") {
    return root.content.type === "conversation" &&
      root.content.conversationId === conversationId
      ? root
      : null
  }
  return (
    findPaneByConversationId(root.children[0], conversationId) ??
    findPaneByConversationId(root.children[1], conversationId)
  )
}

export function computeLayoutGeometry(root: LayoutNode): LayoutGeometry {
  const panes = new Map<string, NormalizedRect>()
  const dividers: DividerRect[] = []

  const walk = (node: LayoutNode, rect: NormalizedRect) => {
    if (node.type === "pane") {
      panes.set(node.id, rect)
      return
    }
    const ratio = clampRatio(node.ratio)
    if (node.direction === "horizontal") {
      const firstWidth = rect.width * ratio
      dividers.push({
        splitId: node.id,
        direction: "horizontal",
        ratio,
        x: rect.x + firstWidth,
        y: rect.y,
        width: 0,
        height: rect.height,
      })
      walk(node.children[0], {
        x: rect.x,
        y: rect.y,
        width: firstWidth,
        height: rect.height,
      })
      walk(node.children[1], {
        x: rect.x + firstWidth,
        y: rect.y,
        width: rect.width - firstWidth,
        height: rect.height,
      })
    } else {
      const firstHeight = rect.height * ratio
      dividers.push({
        splitId: node.id,
        direction: "vertical",
        ratio,
        x: rect.x,
        y: rect.y + firstHeight,
        width: rect.width,
        height: 0,
      })
      walk(node.children[0], {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: firstHeight,
      })
      walk(node.children[1], {
        x: rect.x,
        y: rect.y + firstHeight,
        width: rect.width,
        height: rect.height - firstHeight,
      })
    }
  }

  walk(root, { x: 0, y: 0, width: 1, height: 1 })
  return { panes, dividers }
}

export function computeLayoutRects(root: LayoutNode): Map<string, NormalizedRect> {
  return computeLayoutGeometry(root).panes
}

export function clampRatio(
  ratio: number,
  bounds: RatioBounds = { min: MIN_SPLIT_RATIO, max: MAX_SPLIT_RATIO },
): number {
  if (!Number.isFinite(ratio)) return 0.5
  const min = Math.max(0.01, Math.min(0.99, bounds.min))
  const max = Math.max(min, Math.min(0.99, bounds.max))
  return Math.max(min, Math.min(max, ratio))
}

/** Recursively computes minimum required width and height for a layout subtree. */
export function computeMinSubtreeSize(
  node: LayoutNode,
  constraints: Pick<LayoutConstraints, "minPaneWidth" | "minPaneHeight"> = DEFAULT_LAYOUT_CONSTRAINTS,
): ViewportSize {
  if (node.type === "pane") {
    return { width: constraints.minPaneWidth, height: constraints.minPaneHeight }
  }
  const first = computeMinSubtreeSize(node.children[0], constraints)
  const second = computeMinSubtreeSize(node.children[1], constraints)
  if (node.direction === "horizontal") {
    return {
      width: first.width + second.width,
      height: Math.max(first.height, second.height),
    }
  }
  return {
    width: Math.max(first.width, second.width),
    height: first.height + second.height,
  }
}

/**
 * Computes ratio bounds for a given SplitNode inside a viewport while honoring
 * every descendant pane's minimum width and height.
 */
export function computeSplitRatioBounds(
  root: LayoutNode,
  splitId: string,
  viewport: ViewportSize,
  constraints: Pick<LayoutConstraints, "minPaneWidth" | "minPaneHeight"> = DEFAULT_LAYOUT_CONSTRAINTS,
): RatioBounds {
  const split = findNode(root, splitId)
  if (split?.type !== "split") {
    return { min: MIN_SPLIT_RATIO, max: MAX_SPLIT_RATIO }
  }
  const splitRect = computeNodeRect(root, splitId)
  if (!splitRect) {
    return { min: MIN_SPLIT_RATIO, max: MAX_SPLIT_RATIO }
  }
  const axisPixels =
    split.direction === "horizontal"
      ? splitRect.width * viewport.width
      : splitRect.height * viewport.height
  if (!Number.isFinite(axisPixels) || axisPixels <= 0) {
    return { min: MIN_SPLIT_RATIO, max: MAX_SPLIT_RATIO }
  }
  const firstMin = computeMinSubtreeSize(split.children[0], constraints)
  const secondMin = computeMinSubtreeSize(split.children[1], constraints)
  const minFirstPx = split.direction === "horizontal" ? firstMin.width : firstMin.height
  const minSecondPx = split.direction === "horizontal" ? secondMin.width : secondMin.height
  const totalMinPx = minFirstPx + minSecondPx
  if (totalMinPx >= axisPixels) {
    // Viewport is smaller than the combined minimum; preserve proportional balance
    // around the natural minimum split without letting panes collapse to zero.
    const proportional = totalMinPx > 0 ? minFirstPx / totalMinPx : 0.5
    const clamped = clampRatio(proportional)
    return { min: clamped, max: clamped }
  }
  const min = Math.max(MIN_SPLIT_RATIO, minFirstPx / axisPixels)
  const max = Math.min(MAX_SPLIT_RATIO, 1 - minSecondPx / axisPixels)
  if (min > max) {
    const mid = clampRatio((min + max) / 2)
    return { min: mid, max: mid }
  }
  return { min, max }
}

export function computeNodeRect(root: LayoutNode, nodeId: string): NormalizedRect | null {
  const walk = (node: LayoutNode, rect: NormalizedRect): NormalizedRect | null => {
    if (node.id === nodeId) return rect
    if (node.type === "pane") return null
    const ratio = clampRatio(node.ratio)
    if (node.direction === "horizontal") {
      const firstWidth = rect.width * ratio
      return (
        walk(node.children[0], {
          x: rect.x,
          y: rect.y,
          width: firstWidth,
          height: rect.height,
        }) ??
        walk(node.children[1], {
          x: rect.x + firstWidth,
          y: rect.y,
          width: rect.width - firstWidth,
          height: rect.height,
        })
      )
    }
    const firstHeight = rect.height * ratio
    return (
      walk(node.children[0], {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: firstHeight,
      }) ??
      walk(node.children[1], {
        x: rect.x,
        y: rect.y + firstHeight,
        width: rect.width,
        height: rect.height - firstHeight,
      })
    )
  }
  return walk(root, { x: 0, y: 0, width: 1, height: 1 })
}

export function canSplitPaneInDirection(
  root: LayoutNode,
  paneId: string,
  placement: SplitPlacement,
  viewport: ViewportSize,
  constraints: LayoutConstraints = DEFAULT_LAYOUT_CONSTRAINTS,
): boolean {
  if (countPanes(root) >= constraints.maxPanes) return false
  const rect = computeLayoutRects(root).get(paneId)
  if (!rect) return false
  const paneWidth = rect.width * viewport.width
  const paneHeight = rect.height * viewport.height
  if (placement === "left" || placement === "right") {
    return paneWidth >= constraints.minPaneWidth * 2
  }
  return paneHeight >= constraints.minPaneHeight * 2
}

const EPSILON = 1e-6

/**
 * Finds the best geometrically adjacent pane in the requested cardinal direction
 * using Ghostty / iTerm2 / VS Code spatial navigation semantics.
 */
export function getAdjacentPane(
  root: LayoutNode,
  paneId: string,
  direction: FocusDirection,
): PaneNode | null {
  const rects = computeLayoutRects(root)
  const source = rects.get(paneId)
  if (!source) return null

  const sourceCenterX = source.x + source.width / 2
  const sourceCenterY = source.y + source.height / 2

  let bestId: string | null = null
  let bestScore: [number, number, number] | null = null

  for (const [candidateId, rect] of rects) {
    if (candidateId === paneId) continue

    let primaryGap = -1
    let overlap = 0
    let perpDistance = 0

    if (direction === "right") {
      if (rect.x + EPSILON < source.x + source.width) continue
      primaryGap = Math.max(0, rect.x - (source.x + source.width))
      overlap = intervalOverlap(source.y, source.y + source.height, rect.y, rect.y + rect.height)
      perpDistance = Math.abs(rect.y + rect.height / 2 - sourceCenterY)
    } else if (direction === "left") {
      if (rect.x + rect.width - EPSILON > source.x) continue
      primaryGap = Math.max(0, source.x - (rect.x + rect.width))
      overlap = intervalOverlap(source.y, source.y + source.height, rect.y, rect.y + rect.height)
      perpDistance = Math.abs(rect.y + rect.height / 2 - sourceCenterY)
    } else if (direction === "down") {
      if (rect.y + EPSILON < source.y + source.height) continue
      primaryGap = Math.max(0, rect.y - (source.y + source.height))
      overlap = intervalOverlap(source.x, source.x + source.width, rect.x, rect.x + rect.width)
      perpDistance = Math.abs(rect.x + rect.width / 2 - sourceCenterX)
    } else {
      if (rect.y + rect.height - EPSILON > source.y) continue
      primaryGap = Math.max(0, source.y - (rect.y + rect.height))
      overlap = intervalOverlap(source.x, source.x + source.width, rect.x, rect.x + rect.width)
      perpDistance = Math.abs(rect.x + rect.width / 2 - sourceCenterX)
    }

    // Prefer panes that share an overlapping edge band, then smallest gap, then closest center.
    const hasOverlapPenalty = overlap > EPSILON ? 0 : 1
    const score: [number, number, number] = [
      hasOverlapPenalty,
      Math.round(primaryGap * 10000),
      Math.round((perpDistance - overlap * 0.25) * 10000),
    ]

    if (!bestScore || compareTuples(score, bestScore) < 0) {
      bestScore = score
      bestId = candidateId
    }
  }

  return bestId ? findPane(root, bestId) : null
}

function intervalOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

function compareTuples(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2] - b[2]
}
