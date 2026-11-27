import {
  bindPaneContent,
  closePane,
  createInitialLayout,
  movePane,
  resetSplitRatio,
  resizeSplit,
  setActivePane,
  splitPane,
  swapPanes,
  type SplitPaneOptions,
} from "../model/operations"
import { findNode, findPane, getAdjacentPane } from "../model/tree"
import {
  DEFAULT_LAYOUT_CONSTRAINTS,
  type DropTarget,
  type DropZone,
  type FocusDirection,
  type LayoutConstraints,
  type PaneContent,
  type PaneLayout,
  type RatioBounds,
  type SplitPlacement,
} from "../model/types"

/**
 * Transient interaction state — strictly separated from durable LayoutState
 * and never persisted to storage.
 */
export interface PaneInteractionState {
  maximizedPaneId: string | null
  draggingPaneId: string | null
  dropTarget: DropTarget | null
  resizingSplitId: string | null
}

export interface PaneStoreSnapshot {
  layout: PaneLayout
  interaction: PaneInteractionState
}

export interface PaneLayoutStore {
  getSnapshot: () => PaneStoreSnapshot
  getLayout: () => PaneLayout
  getInteraction: () => PaneInteractionState
  subscribe: (listener: () => void) => () => void
  subscribeLayout: (listener: (layout: PaneLayout) => void) => () => void

  // Durable layout mutations
  replaceLayout: (layout: PaneLayout) => void
  split: (
    targetPaneId: string,
    placement: SplitPlacement,
    options?: SplitPaneOptions,
  ) => string | null
  close: (targetPaneId: string) => void
  bindContent: (paneId: string, content: PaneContent) => void
  focus: (paneId: string) => void
  focusDirection: (direction: FocusDirection) => string | null
  resize: (splitId: string, ratio: number, bounds?: RatioBounds) => void
  resetSplit: (splitId: string) => void
  move: (sourcePaneId: string, targetPaneId: string, zone: DropZone) => void
  swap: (paneAId: string, paneBId: string) => void

  // Transient interaction mutations
  toggleMaximize: (paneId?: string) => void
  setMaximized: (paneId: string | null) => void
  startDrag: (paneId: string) => void
  updateDropTarget: (target: DropTarget | null) => void
  commitDrag: () => boolean
  cancelDrag: () => void
  setResizingSplit: (splitId: string | null) => void
}

const INITIAL_INTERACTION: PaneInteractionState = {
  maximizedPaneId: null,
  draggingPaneId: null,
  dropTarget: null,
  resizingSplitId: null,
}

export function createPaneLayoutStore(
  initialLayout: PaneLayout = createInitialLayout(),
  constraints: LayoutConstraints = DEFAULT_LAYOUT_CONSTRAINTS,
): PaneLayoutStore {
  let snapshot: PaneStoreSnapshot = {
    layout: initialLayout,
    interaction: { ...INITIAL_INTERACTION },
  }
  const listeners = new Set<() => void>()
  const layoutListeners = new Set<(layout: PaneLayout) => void>()

  function emit(layoutChanged: boolean) {
    for (const listener of listeners) listener()
    if (layoutChanged) {
      for (const listener of layoutListeners) listener(snapshot.layout)
    }
  }

  function updateLayout(
    nextLayout: PaneLayout,
    interactionPatch?: Partial<PaneInteractionState>,
  ) {
    const layoutChanged = nextLayout !== snapshot.layout
    let nextInteraction = snapshot.interaction

    const merged = interactionPatch
      ? { ...nextInteraction, ...interactionPatch }
      : nextInteraction

    // Automatically clear stale transient IDs if referenced panes/splits disappeared
    // or if the layout collapsed back to a single pane.
    const isSplit = nextLayout.root.type === "split"
    const validMaximized =
      merged.maximizedPaneId && isSplit && findPane(nextLayout.root, merged.maximizedPaneId)
        ? merged.maximizedPaneId
        : null
    const validDragging =
      merged.draggingPaneId && isSplit && findPane(nextLayout.root, merged.draggingPaneId)
        ? merged.draggingPaneId
        : null
    const validDropTarget =
      validDragging &&
      merged.dropTarget &&
      findPane(nextLayout.root, merged.dropTarget.targetPaneId)
        ? merged.dropTarget
        : null
    const validResizing =
      merged.resizingSplitId &&
      isSplit &&
      findNode(nextLayout.root, merged.resizingSplitId)?.type === "split"
        ? merged.resizingSplitId
        : null

    if (
      interactionPatch ||
      validMaximized !== nextInteraction.maximizedPaneId ||
      validDragging !== nextInteraction.draggingPaneId ||
      validDropTarget !== nextInteraction.dropTarget ||
      validResizing !== nextInteraction.resizingSplitId
    ) {
      nextInteraction = {
        maximizedPaneId: validMaximized,
        draggingPaneId: validDragging,
        dropTarget: validDropTarget,
        resizingSplitId: validResizing,
      }
    }

    const interactionChanged = nextInteraction !== snapshot.interaction
    if (!layoutChanged && !interactionChanged) return

    snapshot = { layout: nextLayout, interaction: nextInteraction }
    emit(layoutChanged)
  }

  function updateInteraction(patch: Partial<PaneInteractionState>) {
    const next: PaneInteractionState = { ...snapshot.interaction, ...patch }
    if (
      next.maximizedPaneId === snapshot.interaction.maximizedPaneId &&
      next.draggingPaneId === snapshot.interaction.draggingPaneId &&
      next.resizingSplitId === snapshot.interaction.resizingSplitId &&
      next.dropTarget?.targetPaneId === snapshot.interaction.dropTarget?.targetPaneId &&
      next.dropTarget?.zone === snapshot.interaction.dropTarget?.zone
    ) {
      return
    }
    snapshot = { ...snapshot, interaction: next }
    emit(false)
  }

  return {
    getSnapshot: () => snapshot,
    getLayout: () => snapshot.layout,
    getInteraction: () => snapshot.interaction,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeLayout(listener) {
      layoutListeners.add(listener)
      return () => {
        layoutListeners.delete(listener)
      }
    },

    replaceLayout(layout) {
      updateLayout(layout, { ...INITIAL_INTERACTION })
    },

    split(targetPaneId, placement, options = {}) {
      const next = splitPane(snapshot.layout, targetPaneId, placement, {
        maxPanes: constraints.maxPanes,
        ...options,
      })
      if (next === snapshot.layout) return null
      // Splitting exits temporary maximize so the user sees the newly created pane.
      updateLayout(next, { maximizedPaneId: null })
      return next.activePaneId
    },

    close(targetPaneId) {
      const next = closePane(snapshot.layout, targetPaneId)
      if (next === snapshot.layout) return
      const clearMax =
        snapshot.interaction.maximizedPaneId === targetPaneId ||
        next.root.type === "pane"
      updateLayout(next, clearMax ? { maximizedPaneId: null } : undefined)
    },

    bindContent(paneId, content) {
      const next = bindPaneContent(snapshot.layout, paneId, content)
      updateLayout(next)
    },

    focus(paneId) {
      const next = setActivePane(snapshot.layout, paneId)
      if (next === snapshot.layout) return
      const nextMax = snapshot.interaction.maximizedPaneId ? paneId : null
      updateLayout(
        next,
        snapshot.interaction.maximizedPaneId ? { maximizedPaneId: nextMax } : undefined,
      )
    },

    focusDirection(direction) {
      const activeId = snapshot.layout.activePaneId
      if (!activeId) return null
      const neighbor = getAdjacentPane(snapshot.layout.root, activeId, direction)
      if (!neighbor) return null
      const next = setActivePane(snapshot.layout, neighbor.id)
      const nextMax = snapshot.interaction.maximizedPaneId ? neighbor.id : null
      updateLayout(
        next,
        snapshot.interaction.maximizedPaneId ? { maximizedPaneId: nextMax } : undefined,
      )
      return neighbor.id
    },

    resize(splitId, ratio, bounds) {
      const next = resizeSplit(snapshot.layout, splitId, ratio, bounds)
      updateLayout(next)
    },

    resetSplit(splitId) {
      const next = resetSplitRatio(snapshot.layout, splitId)
      updateLayout(next)
    },

    move(sourcePaneId, targetPaneId, zone) {
      const next = movePane(snapshot.layout, sourcePaneId, targetPaneId, zone)
      updateLayout(next, { draggingPaneId: null, dropTarget: null })
    },

    swap(paneAId, paneBId) {
      const next = swapPanes(snapshot.layout, paneAId, paneBId)
      updateLayout(next, { draggingPaneId: null, dropTarget: null })
    },

    toggleMaximize(paneId) {
      if (snapshot.layout.root.type !== "split") {
        updateInteraction({ maximizedPaneId: null })
        return
      }
      const target = paneId ?? snapshot.layout.activePaneId
      if (!target || !findPane(snapshot.layout.root, target)) return
      const nextMax = snapshot.interaction.maximizedPaneId === target ? null : target
      const nextLayout = setActivePane(snapshot.layout, target)
      updateLayout(nextLayout, { maximizedPaneId: nextMax })
    },

    setMaximized(paneId) {
      if (!paneId) {
        updateInteraction({ maximizedPaneId: null })
        return
      }
      if (snapshot.layout.root.type !== "split") return
      if (!findPane(snapshot.layout.root, paneId)) return
      const nextLayout = setActivePane(snapshot.layout, paneId)
      updateLayout(nextLayout, { maximizedPaneId: paneId })
    },

    startDrag(paneId) {
      if (snapshot.layout.root.type !== "split") return
      if (!findPane(snapshot.layout.root, paneId)) return
      updateInteraction({ draggingPaneId: paneId, dropTarget: null })
    },

    updateDropTarget(target) {
      if (!snapshot.interaction.draggingPaneId) return
      updateInteraction({ dropTarget: target })
    },

    commitDrag() {
      const { draggingPaneId, dropTarget } = snapshot.interaction
      if (!draggingPaneId || !dropTarget || draggingPaneId === dropTarget.targetPaneId) {
        updateInteraction({ draggingPaneId: null, dropTarget: null })
        return false
      }
      const previous = snapshot.layout
      const next = movePane(
        previous,
        draggingPaneId,
        dropTarget.targetPaneId,
        dropTarget.zone,
      )
      updateLayout(next, { draggingPaneId: null, dropTarget: null })
      return next !== previous
    },

    cancelDrag() {
      updateInteraction({ draggingPaneId: null, dropTarget: null })
    },

    setResizingSplit(splitId) {
      updateInteraction({ resizingSplitId: splitId })
    },
  }
}
