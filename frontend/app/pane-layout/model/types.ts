export type SplitDirection = "horizontal" | "vertical"

export type SplitPlacement = "left" | "right" | "up" | "down"

export type FocusDirection = "left" | "right" | "up" | "down"

export type DropZone = "left" | "right" | "top" | "bottom" | "center"

export interface DropTarget {
  targetPaneId: string
  zone: DropZone
  previewRect: NormalizedRect
}

export interface PaneContextHint {
  environment?: string
  projectId?: string
  cwd?: string
  sessionId?: string
  bindingId?: string
  git?: boolean
  scope?: {
    kind: string
    id?: string
    cwd?: string
    environment?: string
  }
}

/** Resource descriptors contain identity/restoration data, never feature runtime state.
 * Add future content kinds (for example workflows) with a matching validated adapter.
 */
export type PaneContent =
  | {
      type: "empty"
      context?: PaneContextHint
    }
  | {
      type: "conversation"
      conversationId: string
    }
  | {
      type: "project"
      route: string
      environment: string
      title?: string
    }
  | {
      type: "file"
      environment: string
      title?: string
      cwd: string
      path?: string
      projectId?: string
      sessionId?: string
      bindingId?: string
      line?: number
      git?: boolean
      mode?: "all" | "working" | "index"
    }

export interface PaneNode {
  type: "pane"
  id: string
  content: PaneContent
}

export interface SplitNode {
  type: "split"
  id: string
  direction: SplitDirection
  /** Fraction of space allocated to children[0], strictly between 0 and 1. */
  ratio: number
  children: [LayoutNode, LayoutNode]
}

export type LayoutNode = PaneNode | SplitNode

export interface PaneLayout {
  version: number
  root: LayoutNode
  activePaneId: string | null
}

/** Normalized rectangle in [0, 1] layout coordinates. */
export interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DividerRect {
  splitId: string
  direction: SplitDirection
  ratio: number
  /** Split line coordinate and span in normalized [0, 1] layout space. */
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutGeometry {
  panes: Map<string, NormalizedRect>
  dividers: DividerRect[]
}

export interface LayoutConstraints {
  maxPanes: number
  minPaneWidth: number
  minPaneHeight: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface RatioBounds {
  min: number
  max: number
}

export const PANE_LAYOUT_VERSION = 1

export const DEFAULT_LAYOUT_CONSTRAINTS: LayoutConstraints = {
  maxPanes: 6,
  minPaneWidth: 360,
  minPaneHeight: 280,
}

export const DEFAULT_SPLIT_RATIO = 0.5
export const MIN_SPLIT_RATIO = 0.1
export const MAX_SPLIT_RATIO = 0.9
export const MAX_LAYOUT_DEPTH = 16
