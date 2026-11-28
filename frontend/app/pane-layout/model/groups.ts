import {
  closePane,
  createInitialLayout,
  defaultIdGenerator,
  normalizeLayout,
  type IdGenerator,
} from "./operations"
import { countPanes, findFirstPane, findPaneByConversationId, listPanes } from "./tree"
import type { LayoutNode, PaneContent, PaneLayout } from "./types"

export type PaneGroupMap = Record<string, PaneLayout>

export function isMultiPaneLayout(layout: PaneLayout): boolean {
  return countPanes(layout.root) >= 2
}

/** Lists all non-empty conversation IDs inside a layout tree. */
export function listLayoutConversationIds(layout: PaneLayout): string[] {
  const ids: string[] = []
  for (const pane of listPanes(layout.root)) {
    if (pane.content.type === "conversation" && pane.content.conversationId.trim()) {
      ids.push(pane.content.conversationId)
    }
  }
  return ids
}

export interface ConversationGroupMatch {
  groupId: string
  layout: PaneLayout
  paneId: string
}

/** Finds the unique multi-pane group containing `conversationId`, if any. */
export function findGroupForConversation(
  groups: PaneGroupMap,
  conversationId: string,
): ConversationGroupMatch | null {
  if (!conversationId) return null
  for (const [groupId, layout] of Object.entries(groups)) {
    if (!isMultiPaneLayout(layout)) continue
    const pane = findPaneByConversationId(layout.root, conversationId)
    if (pane) {
      return { groupId, layout, paneId: pane.id }
    }
  }
  return null
}

export interface RemoveConversationResult {
  groups: PaneGroupMap
  removedFromGroupId: string | null
  dissolvedGroupId: string | null
}

/**
 * Removes `conversationId` from any stored multi-pane group (except `excludeGroupId`).
 * If removing the conversation leaves that group with fewer than 2 panes, the group
 * automatically dissolves and is removed from the registry.
 */
export function removeConversationFromGroups(
  groups: PaneGroupMap,
  conversationId: string,
  excludeGroupId?: string | null,
): RemoveConversationResult {
  if (!conversationId) {
    return { groups, removedFromGroupId: null, dissolvedGroupId: null }
  }
  let changed = false
  let removedFromGroupId: string | null = null
  let dissolvedGroupId: string | null = null
  const nextGroups: PaneGroupMap = {}

  for (const [groupId, layout] of Object.entries(groups)) {
    if (groupId === excludeGroupId) {
      if (isMultiPaneLayout(layout)) nextGroups[groupId] = layout
      continue
    }
    const found = findPaneByConversationId(layout.root, conversationId)
    if (!found) {
      if (isMultiPaneLayout(layout)) nextGroups[groupId] = layout
      continue
    }
    changed = true
    removedFromGroupId = groupId
    const reduced = closePane(layout, found.id)
    if (isMultiPaneLayout(reduced)) {
      nextGroups[groupId] = reduced
    } else {
      dissolvedGroupId = groupId
    }
  }

  return {
    groups: changed ? nextGroups : groups,
    removedFromGroupId,
    dissolvedGroupId,
  }
}

export interface SyncActiveGroupResult {
  groups: PaneGroupMap
  activeGroupId: string | null
}

/**
 * Keeps the implicit multi-pane group registry synchronized with the active layout:
 * - When `activeLayout` has >= 2 panes, saves/updates its group and enforces 1:1
 *   exclusive membership by evicting its conversations from any other group
 *   (dissolving any other group that drops to 1 pane).
 * - When `activeLayout` has only 1 pane, dissolves `activeGroupId` if it was set.
 */
export function syncActiveGroup(
  groups: PaneGroupMap,
  activeGroupId: string | null,
  activeLayout: PaneLayout,
  generateId: IdGenerator = defaultIdGenerator,
): SyncActiveGroupResult {
  if (!isMultiPaneLayout(activeLayout)) {
    if (activeGroupId && Object.hasOwn(groups, activeGroupId)) {
      const nextGroups = { ...groups }
      delete nextGroups[activeGroupId]
      return { groups: nextGroups, activeGroupId: null }
    }
    return { groups, activeGroupId: null }
  }

  const groupId = activeGroupId?.trim() ? activeGroupId : generateId()
  let nextGroups: PaneGroupMap = groups
  for (const conversationId of listLayoutConversationIds(activeLayout)) {
    const result = removeConversationFromGroups(nextGroups, conversationId, groupId)
    nextGroups = result.groups
  }
  return {
    groups: { ...nextGroups, [groupId]: activeLayout },
    activeGroupId: groupId,
  }
}

/**
 * Strips legacy non-conversation panes (`file` and `project`) from a layout tree so
 * conversation splits remain pure conversations, returning any extracted `file`
 * contents so callers can migrate them into the independent right multi-tab panel.
 */
export function stripNonConversationPanes(
  layout: PaneLayout,
  generateId: IdGenerator = defaultIdGenerator,
): {
  layout: PaneLayout
  extractedFiles: Extract<PaneContent, { type: "file" }>[]
  changed: boolean
} {
  const extractedFiles: Extract<PaneContent, { type: "file" }>[] = []
  let changed = false

  const walk = (node: LayoutNode): LayoutNode | null => {
    if (node.type === "pane") {
      if (node.content.type === "file") {
        extractedFiles.push(node.content)
        changed = true
        return null
      }
      if (node.content.type === "project") {
        changed = true
        return null
      }
      return node
    }
    const left = walk(node.children[0])
    const right = walk(node.children[1])
    if (!left && !right) return null
    if (!left) return right
    if (!right) return left
    if (left === node.children[0] && right === node.children[1]) return node
    return { ...node, children: [left, right] }
  }

  const nextRoot = walk(layout.root)
  if (!changed) {
    return { layout, extractedFiles, changed: false }
  }
  if (!nextRoot) {
    return {
      layout: createInitialLayout({ type: "empty" }, generateId()),
      extractedFiles,
      changed: true,
    }
  }
  const activeStillExists =
    layout.activePaneId !== null &&
    listPanes(nextRoot).some(pane => pane.id === layout.activePaneId)
  return {
    layout: normalizeLayout(
      {
        ...layout,
        root: nextRoot,
        activePaneId: activeStillExists ? layout.activePaneId : findFirstPane(nextRoot).id,
      },
      generateId,
    ),
    extractedFiles,
    changed: true,
  }
}

/**
 * Sanitizes a raw group map: keeps only multi-pane pure-conversation layouts and
 * enforces 1:1 exclusive conversation membership across groups.
 */
export function sanitizePaneGroups(
  groups: PaneGroupMap,
  activeLayout: PaneLayout,
  activeGroupId: string | null,
  generateId: IdGenerator = defaultIdGenerator,
): { groups: PaneGroupMap; activeGroupId: string | null } {
  const claimed = new Set<string>()
  const result: PaneGroupMap = {}

  const claimLayout = (groupId: string, candidate: PaneLayout): boolean => {
    const stripped = stripNonConversationPanes(candidate, generateId).layout
    let working = stripped
    for (const pane of listPanes(stripped.root)) {
      if (pane.content.type === "conversation" && pane.content.conversationId.trim()) {
        if (claimed.has(pane.content.conversationId)) {
          working = closePane(working, pane.id)
        }
      }
    }
    if (!isMultiPaneLayout(working)) return false
    for (const id of listLayoutConversationIds(working)) claimed.add(id)
    result[groupId] = normalizeLayout(working, generateId)
    return true
  }

  let resolvedActiveGroupId: string | null = null
  if (isMultiPaneLayout(activeLayout)) {
    const id = activeGroupId?.trim() ? activeGroupId : generateId()
    if (claimLayout(id, activeLayout)) {
      resolvedActiveGroupId = id
    }
  }

  for (const [groupId, candidate] of Object.entries(groups)) {
    if (groupId === resolvedActiveGroupId) continue
    claimLayout(groupId, candidate)
  }

  return { groups: result, activeGroupId: resolvedActiveGroupId }
}
