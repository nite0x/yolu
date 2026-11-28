import {
  clampRatio,
  countPanes,
  findFirstPane,
  findLastPane,
  findPane,
  findParentSplit,
  listPanes,
} from "./tree"
import {
  DEFAULT_SPLIT_RATIO,
  PANE_LAYOUT_VERSION,
  type DropZone,
  type LayoutNode,
  type PaneContent,
  type PaneLayout,
  type PaneNode,
  type RatioBounds,
  type SplitDirection,
  type SplitNode,
  type SplitPlacement,
} from "./types"

export type IdGenerator = () => string

let fallbackCounter = 0

export const defaultIdGenerator: IdGenerator = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }
  fallbackCounter += 1
  return `pane-${Date.now().toString(36)}-${fallbackCounter}`
}

export function createPaneNode(
  content: PaneContent = { type: "empty" },
  id: string = defaultIdGenerator(),
): PaneNode {
  return { type: "pane", id, content }
}

export function createInitialLayout(
  content: PaneContent = { type: "empty" },
  paneId: string = defaultIdGenerator(),
): PaneLayout {
  const root = createPaneNode(content, paneId)
  return {
    version: PANE_LAYOUT_VERSION,
    root,
    activePaneId: root.id,
  }
}

export interface SplitPaneOptions {
  content?: PaneContent
  ratio?: number
  newPaneId?: string
  splitId?: string
  maxPanes?: number
  focusNewPane?: boolean
  generateId?: IdGenerator
}

export function splitPane(
  layout: PaneLayout,
  targetPaneId: string,
  placement: SplitPlacement,
  options: SplitPaneOptions = {},
): PaneLayout {
  const maxPanes = options.maxPanes
  if (typeof maxPanes === "number" && countPanes(layout.root) >= maxPanes) {
    return layout
  }
  if (!findPane(layout.root, targetPaneId)) {
    return layout
  }

  const generateId = options.generateId ?? defaultIdGenerator
  const newPaneId = options.newPaneId ?? generateId()
  const splitId = options.splitId ?? generateId()
  const direction: SplitDirection =
    placement === "left" || placement === "right" ? "horizontal" : "vertical"
  const newFirst = placement === "left" || placement === "up"
  const ratio = clampRatio(options.ratio ?? DEFAULT_SPLIT_RATIO)
  const newPane = createPaneNode(options.content ?? { type: "empty" }, newPaneId)

  const replace = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") {
      if (node.id !== targetPaneId) return node
      const split: SplitNode = {
        type: "split",
        id: splitId,
        direction,
        ratio,
        children: newFirst ? [newPane, node] : [node, newPane],
      }
      return split
    }
    const left = replace(node.children[0])
    const right = replace(node.children[1])
    if (left === node.children[0] && right === node.children[1]) return node
    return { ...node, children: [left, right] }
  }

  const nextRoot = replace(layout.root)
  if (nextRoot === layout.root) return layout
  return {
    ...layout,
    root: nextRoot,
    activePaneId: options.focusNewPane === false ? layout.activePaneId : newPane.id,
  }
}

/** Removes a pane node and collapses its parent split container. Returns null if removing the root pane. */
function removePaneFromTree(root: LayoutNode, targetPaneId: string): LayoutNode | null {
  if (root.type === "pane") {
    return root.id === targetPaneId ? null : root
  }
  const [first, second] = root.children
  if (first.type === "pane" && first.id === targetPaneId) return second
  if (second.type === "pane" && second.id === targetPaneId) return first

  const nextFirst = removePaneFromTree(first, targetPaneId)
  if (nextFirst !== first) {
    return nextFirst ? { ...root, children: [nextFirst, second] } : second
  }
  const nextSecond = removePaneFromTree(second, targetPaneId)
  if (nextSecond !== second) {
    return nextSecond ? { ...root, children: [first, nextSecond] } : first
  }
  return root
}

function chooseCloseFallbackFocus(root: LayoutNode, closingPaneId: string): string | null {
  const parentInfo = findParentSplit(root, closingPaneId)
  if (parentInfo) {
    const sibling = parentInfo.parent.children[parentInfo.childIndex === 0 ? 1 : 0]
    // Prefer the leaf adjacent to the shared split edge.
    const preferred =
      parentInfo.childIndex === 0 ? findFirstPane(sibling) : findLastPane(sibling)
    return preferred.id
  }
  const remaining = listPanes(root).filter(pane => pane.id !== closingPaneId)
  return remaining[0]?.id ?? null
}

export function closePane(layout: PaneLayout, targetPaneId: string): PaneLayout {
  const target = findPane(layout.root, targetPaneId)
  if (!target) return layout

  // Closing the last remaining pane displays the default empty conversation view.
  if (layout.root.type === "pane") {
    if (layout.root.content.type === "empty" && layout.activePaneId === layout.root.id) {
      return layout
    }
    return {
      ...layout,
      root: {
        ...layout.root,
        content: { type: "empty" },
      },
      activePaneId: layout.root.id,
    }
  }

  const fallbackFocus =
    layout.activePaneId === targetPaneId
      ? chooseCloseFallbackFocus(layout.root, targetPaneId)
      : layout.activePaneId

  const nextRoot = removePaneFromTree(layout.root, targetPaneId)
  if (!nextRoot) return layout

  const activePaneId =
    fallbackFocus && findPane(nextRoot, fallbackFocus)
      ? fallbackFocus
      : findFirstPane(nextRoot).id

  return {
    ...layout,
    root: nextRoot,
    activePaneId,
  }
}

export function swapPanes(
  layout: PaneLayout,
  paneAId: string,
  paneBId: string,
): PaneLayout {
  if (paneAId === paneBId) return layout
  const paneA = findPane(layout.root, paneAId)
  const paneB = findPane(layout.root, paneBId)
  if (!paneA || !paneB) return layout

  const replace = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") {
      if (node.id === paneAId) return paneB
      if (node.id === paneBId) return paneA
      return node
    }
    const left = replace(node.children[0])
    const right = replace(node.children[1])
    if (left === node.children[0] && right === node.children[1]) return node
    return { ...node, children: [left, right] }
  }

  return {
    ...layout,
    root: replace(layout.root),
  }
}

export interface MovePaneOptions {
  splitId?: string
  ratio?: number
  generateId?: IdGenerator
}

export function movePane(
  layout: PaneLayout,
  sourcePaneId: string,
  targetPaneId: string,
  zone: DropZone,
  options: MovePaneOptions = {},
): PaneLayout {
  if (sourcePaneId === targetPaneId) return layout
  const sourcePane = findPane(layout.root, sourcePaneId)
  const targetPane = findPane(layout.root, targetPaneId)
  if (!sourcePane || !targetPane) return layout

  if (zone === "center") {
    return {
      ...swapPanes(layout, sourcePaneId, targetPaneId),
      activePaneId: sourcePaneId,
    }
  }

  const withoutSource = removePaneFromTree(layout.root, sourcePaneId)
  if (!withoutSource) return layout

  const placement: SplitPlacement =
    zone === "top" ? "up" : zone === "bottom" ? "down" : zone
  const direction: SplitDirection =
    placement === "left" || placement === "right" ? "horizontal" : "vertical"
  const sourceFirst = placement === "left" || placement === "up"
  const splitId = options.splitId ?? (options.generateId ?? defaultIdGenerator)()
  const ratio = clampRatio(options.ratio ?? DEFAULT_SPLIT_RATIO)

  const insert = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") {
      if (node.id !== targetPaneId) return node
      return {
        type: "split",
        id: splitId,
        direction,
        ratio,
        children: sourceFirst ? [sourcePane, node] : [node, sourcePane],
      }
    }
    const left = insert(node.children[0])
    const right = insert(node.children[1])
    if (left === node.children[0] && right === node.children[1]) return node
    return { ...node, children: [left, right] }
  }

  return {
    ...layout,
    root: insert(withoutSource),
    activePaneId: sourcePaneId,
  }
}

export function resizeSplit(
  layout: PaneLayout,
  splitId: string,
  ratio: number,
  bounds?: RatioBounds,
): PaneLayout {
  const nextRatio = clampRatio(ratio, bounds)
  const update = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") return node
    if (node.id === splitId) {
      if (Math.abs(node.ratio - nextRatio) < 1e-6) return node
      return { ...node, ratio: nextRatio }
    }
    const left = update(node.children[0])
    const right = update(node.children[1])
    if (left === node.children[0] && right === node.children[1]) return node
    return { ...node, children: [left, right] }
  }

  const nextRoot = update(layout.root)
  return nextRoot === layout.root ? layout : { ...layout, root: nextRoot }
}

export function resetSplitRatio(layout: PaneLayout, splitId: string): PaneLayout {
  return resizeSplit(layout, splitId, DEFAULT_SPLIT_RATIO)
}

function paneContentEquals(a: PaneContent, b: PaneContent): boolean {
  if (a === b) return true
  if (a.type !== b.type) return false
  if (a.type === "conversation" && b.type === "conversation") {
    return a.conversationId === b.conversationId
  }
  if (a.type === "empty" && b.type === "empty") {
    if (!a.context && !b.context) return true
    if (!a.context || !b.context) return false
    return (
      a.context.environment === b.context.environment &&
      a.context.projectId === b.context.projectId &&
      a.context.cwd === b.context.cwd &&
      a.context.scope?.kind === b.context.scope?.kind &&
      a.context.scope?.id === b.context.scope?.id &&
      a.context.scope?.cwd === b.context.scope?.cwd &&
      a.context.scope?.environment === b.context.scope?.environment
    )
  }
  return false
}

export function bindPaneContent(
  layout: PaneLayout,
  paneId: string,
  content: PaneContent,
): PaneLayout {
  const update = (node: LayoutNode): LayoutNode => {
    if (node.type === "pane") {
      if (node.id !== paneId) return node
      if (paneContentEquals(node.content, content)) return node
      return { ...node, content }
    }
    const left = update(node.children[0])
    const right = update(node.children[1])
    if (left === node.children[0] && right === node.children[1]) return node
    return { ...node, children: [left, right] }
  }

  const nextRoot = update(layout.root)
  return nextRoot === layout.root ? layout : { ...layout, root: nextRoot }
}

export function setActivePane(layout: PaneLayout, paneId: string): PaneLayout {
  if (layout.activePaneId === paneId) return layout
  if (!findPane(layout.root, paneId)) return layout
  return { ...layout, activePaneId: paneId }
}

export function normalizeLayout(
  layout: PaneLayout,
  generateId: IdGenerator = defaultIdGenerator,
): PaneLayout {
  const seenIds = new Set<string>()
  const uniqueId = (candidate: string): string => {
    let id = typeof candidate === "string" && candidate.trim() ? candidate : generateId()
    while (seenIds.has(id)) id = generateId()
    seenIds.add(id)
    return id
  }

  const idMap = new Map<string, string>()

  const normalizeNode = (node: LayoutNode): LayoutNode => {
    const id = uniqueId(node.id)
    if (!idMap.has(node.id)) idMap.set(node.id, id)

    if (node.type === "pane") {
      let content: PaneContent
      switch (node.content.type) {
        case "conversation":
          content = node.content.conversationId.trim()
            ? { type: "conversation", conversationId: node.content.conversationId }
            : { type: "empty" }
          break
        case "file":
        case "project":
          content = {...node.content}
          break
        case "empty":
          content = node.content.context
            ? { type: "empty", context: node.content.context }
            : { type: "empty" }
          break
        default: {
          const _exhaustive: never = node.content
          content = _exhaustive
        }
      }
      return { type: "pane", id, content }
    }

    const direction: SplitDirection =
      node.direction === "vertical" ? "vertical" : "horizontal"
    return {
      type: "split",
      id,
      direction,
      ratio: clampRatio(node.ratio),
      children: [normalizeNode(node.children[0]), normalizeNode(node.children[1])],
    }
  }

  const root = normalizeNode(layout.root)
  const mappedActive = layout.activePaneId
    ? idMap.get(layout.activePaneId) ?? layout.activePaneId
    : null
  const activePaneId =
    mappedActive && findPane(root, mappedActive)
      ? mappedActive
      : findFirstPane(root).id

  return {
    version: PANE_LAYOUT_VERSION,
    root,
    activePaneId,
  }
}
