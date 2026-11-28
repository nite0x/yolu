import {
  findGroupForConversation,
  removeConversationFromGroups,
  sanitizePaneGroups,
  syncActiveGroup,
  type ConversationGroupMatch,
  type PaneGroupMap,
} from "../model/groups"
import {
  bindPaneContent,
  closePane,
  createInitialLayout,
  defaultIdGenerator,
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

export interface ExternalDragInfo {
  label?: string
  conversationId?: string
}

/**
 * Transient interaction state — strictly separated from durable LayoutState
 * and never persisted to storage.
 */
export interface PaneInteractionState {
  maximizedPaneId: string | null
  draggingPaneId: string | null
  draggingExternal: ExternalDragInfo | null
  dropTarget: DropTarget | null
  resizingSplitId: string | null
}

export interface PaneStoreSnapshot {
  layout: PaneLayout
  groups: PaneGroupMap
  activeGroupId: string | null
  interaction: PaneInteractionState
}

export interface PaneLayoutStore {
  getSnapshot: () => PaneStoreSnapshot
  getLayout: () => PaneLayout
  getGroups: () => PaneGroupMap
  getActiveGroupId: () => string | null
  getInteraction: () => PaneInteractionState
  findGroupForConversation: (conversationId: string) => ConversationGroupMatch | null
  subscribe: (listener: () => void) => () => void
  subscribeLayout: (listener: (layout: PaneLayout) => void) => () => void

  // Durable layout mutations
  replaceLayout: (layout: PaneLayout) => void
  replaceWorkspace: (
    layout: PaneLayout,
    groups?: PaneGroupMap,
    activeGroupId?: string | null,
  ) => void
  activateGroup: (groupId: string, focusPaneId?: string) => boolean
  activateStandalone: (content: PaneContent, paneId?: string) => string
  removeConversationFromOtherGroups: (conversationId: string) => void
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
  startExternalDrag: (info?: ExternalDragInfo) => void
  updateDropTarget: (target: DropTarget | null) => void
  commitDrag: () => boolean
  cancelDrag: () => void
  setResizingSplit: (splitId: string | null) => void
}

const INITIAL_INTERACTION: PaneInteractionState = {
  maximizedPaneId: null,
  draggingPaneId: null,
  draggingExternal: null,
  dropTarget: null,
  resizingSplitId: null,
}

export interface CreatePaneLayoutStoreOptions {
  groups?: PaneGroupMap
  activeGroupId?: string | null
}

export function createPaneLayoutStore(
  initialLayout: PaneLayout = createInitialLayout(),
  constraints: LayoutConstraints = DEFAULT_LAYOUT_CONSTRAINTS,
  options: CreatePaneLayoutStoreOptions = {},
): PaneLayoutStore {
  const initialSanitized = sanitizePaneGroups(
    options.groups ?? {},
    initialLayout,
    options.activeGroupId ?? null,
  )
  let snapshot: PaneStoreSnapshot = {
    layout: initialLayout,
    groups: initialSanitized.groups,
    activeGroupId: initialSanitized.activeGroupId,
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

  function validateInteraction(
    nextLayout: PaneLayout,
    merged: PaneInteractionState,
  ): PaneInteractionState {
    const isSplit = nextLayout.root.type === "split"
    const validMaximized =
      merged.maximizedPaneId && isSplit && findPane(nextLayout.root, merged.maximizedPaneId)
        ? merged.maximizedPaneId
        : null
    const validDragging =
      merged.draggingPaneId && isSplit && findPane(nextLayout.root, merged.draggingPaneId)
        ? merged.draggingPaneId
        : null
    const validExternal = merged.draggingExternal
    const hasDrag = !!validDragging || !!validExternal
    const validDropTarget =
      hasDrag &&
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
      validMaximized === snapshot.interaction.maximizedPaneId &&
      validDragging === snapshot.interaction.draggingPaneId &&
      validExternal === snapshot.interaction.draggingExternal &&
      validDropTarget === snapshot.interaction.dropTarget &&
      validResizing === snapshot.interaction.resizingSplitId
    ) {
      return snapshot.interaction
    }
    return {
      maximizedPaneId: validMaximized,
      draggingPaneId: validDragging,
      draggingExternal: validExternal,
      dropTarget: validDropTarget,
      resizingSplitId: validResizing,
    }
  }

  function updateLayout(
    nextLayout: PaneLayout,
    interactionPatch?: Partial<PaneInteractionState>,
    groupOverride?: { groups: PaneGroupMap; activeGroupId: string | null },
  ) {
    const layoutChanged = nextLayout !== snapshot.layout
    const syncedGroups = groupOverride
      ? groupOverride
      : layoutChanged
        ? syncActiveGroup(snapshot.groups, snapshot.activeGroupId, nextLayout)
        : { groups: snapshot.groups, activeGroupId: snapshot.activeGroupId }
    const groupsChanged =
      syncedGroups.groups !== snapshot.groups ||
      syncedGroups.activeGroupId !== snapshot.activeGroupId

    const merged = interactionPatch
      ? { ...snapshot.interaction, ...interactionPatch }
      : snapshot.interaction
    const nextInteraction = validateInteraction(nextLayout, merged)
    const interactionChanged = nextInteraction !== snapshot.interaction

    if (!layoutChanged && !groupsChanged && !interactionChanged) return

    snapshot = {
      layout: nextLayout,
      groups: syncedGroups.groups,
      activeGroupId: syncedGroups.activeGroupId,
      interaction: nextInteraction,
    }
    emit(layoutChanged || groupsChanged)
  }

  function updateInteraction(patch: Partial<PaneInteractionState>) {
    const next: PaneInteractionState = { ...snapshot.interaction, ...patch }
    if (
      next.maximizedPaneId === snapshot.interaction.maximizedPaneId &&
      next.draggingPaneId === snapshot.interaction.draggingPaneId &&
      next.draggingExternal === snapshot.interaction.draggingExternal &&
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
    getGroups: () => snapshot.groups,
    getActiveGroupId: () => snapshot.activeGroupId,
    getInteraction: () => snapshot.interaction,
    findGroupForConversation: conversationId =>
      findGroupForConversation(snapshot.groups, conversationId),
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
      const sanitized = sanitizePaneGroups(snapshot.groups, layout, snapshot.activeGroupId)
      updateLayout(layout, { ...INITIAL_INTERACTION }, sanitized)
    },

    replaceWorkspace(layout, groups = {}, activeGroupId = null) {
      const sanitized = sanitizePaneGroups(groups, layout, activeGroupId)
      updateLayout(layout, { ...INITIAL_INTERACTION }, sanitized)
    },

    activateGroup(groupId, focusPaneId) {
      const targetGroup = snapshot.groups[groupId]
      if (targetGroup?.root.type !== "split") return false
      // Preserve current active multi-pane group before switching away.
      const savedCurrent = syncActiveGroup(snapshot.groups, snapshot.activeGroupId, snapshot.layout)
      const latestTarget = savedCurrent.groups[groupId]
      if (latestTarget?.root.type !== "split") return false
      const nextLayout =
        focusPaneId && findPane(latestTarget.root, focusPaneId)
          ? setActivePane(latestTarget, focusPaneId)
          : latestTarget
      const nextGroups =
        nextLayout === latestTarget
          ? savedCurrent.groups
          : { ...savedCurrent.groups, [groupId]: nextLayout }
      updateLayout(
        nextLayout,
        { ...INITIAL_INTERACTION },
        { groups: nextGroups, activeGroupId: groupId },
      )
      return true
    },

    activateStandalone(content, paneId = defaultIdGenerator()) {
      // Preserve current active multi-pane group untouched before opening standalone pane.
      const savedCurrent = syncActiveGroup(snapshot.groups, snapshot.activeGroupId, snapshot.layout)
      const standalone = createInitialLayout(content, paneId)
      updateLayout(
        standalone,
        { ...INITIAL_INTERACTION },
        { groups: savedCurrent.groups, activeGroupId: null },
      )
      return standalone.activePaneId ?? paneId
    },

    removeConversationFromOtherGroups(conversationId) {
      const result = removeConversationFromGroups(
        snapshot.groups,
        conversationId,
        snapshot.activeGroupId,
      )
      if (result.groups === snapshot.groups) return
      updateLayout(snapshot.layout, undefined, {
        groups: result.groups,
        activeGroupId: snapshot.activeGroupId,
      })
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
      updateLayout(next, { draggingPaneId: null, draggingExternal: null, dropTarget: null })
    },

    swap(paneAId, paneBId) {
      const next = swapPanes(snapshot.layout, paneAId, paneBId)
      updateLayout(next, { draggingPaneId: null, draggingExternal: null, dropTarget: null })
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
      updateInteraction({ draggingPaneId: paneId, draggingExternal: null, dropTarget: null })
    },

    startExternalDrag(info = {}) {
      updateInteraction({
        draggingPaneId: null,
        draggingExternal: { ...info },
        dropTarget: null,
      })
    },

    updateDropTarget(target) {
      if (!snapshot.interaction.draggingPaneId && !snapshot.interaction.draggingExternal) return
      updateInteraction({ dropTarget: target })
    },

    commitDrag() {
      const { draggingPaneId, dropTarget } = snapshot.interaction
      if (!draggingPaneId || !dropTarget || draggingPaneId === dropTarget.targetPaneId) {
        updateInteraction({ draggingPaneId: null, draggingExternal: null, dropTarget: null })
        return false
      }
      const previous = snapshot.layout
      const next = movePane(
        previous,
        draggingPaneId,
        dropTarget.targetPaneId,
        dropTarget.zone,
      )
      updateLayout(next, { draggingPaneId: null, draggingExternal: null, dropTarget: null })
      return next !== previous
    },

    cancelDrag() {
      updateInteraction({ draggingPaneId: null, draggingExternal: null, dropTarget: null })
    },

    setResizingSplit(splitId) {
      updateInteraction({ resizingSplitId: splitId })
    },
  }
}
