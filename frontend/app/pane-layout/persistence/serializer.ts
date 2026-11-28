import {
  createInitialRightPanelState,
  deriveRightTabTitle,
  rightTabIdentity,
  sanitizeRightPanelState,
  serializeRightPanelState,
} from "@/app/right-panel/store"
import {
  MAX_RIGHT_PANEL_TABS,
  type PersistedRightPanelState,
  type RightPanelState,
  type RightPanelTab,
} from "@/app/right-panel/types"
import {
  sanitizePaneGroups,
  stripNonConversationPanes,
  type PaneGroupMap,
} from "../model/groups"
import { createInitialLayout, defaultIdGenerator, normalizeLayout } from "../model/operations"
import { listPanes } from "../model/tree"
import { PANE_LAYOUT_VERSION, type PaneContent, type PaneLayout } from "../model/types"
import { migrateSavedLayout } from "./migration"

export interface PersistedConversationMeta {
  environment: string
  route: string
  title: string
  selected?: string | null
}

export interface PersistedPaneLayoutRecord {
  version: number
  context: string
  updatedAt?: number
  layout: PaneLayout
  /** Implicit multi-pane conversation layout groups (>= 2 panes each). */
  groups?: PaneGroupMap
  activeGroupId?: string | null
  /** Independent right multi-tab file/diff workbench panel state. */
  rightPanel?: PersistedRightPanelState
  /** Minimal metadata per conversationId so panes restore with environment and title immediately. */
  conversations?: Record<string, PersistedConversationMeta>
}

export const DEFAULT_LAYOUT_CONTEXT = "default"
const STORAGE_KEY_PREFIX = "workhub:pane-layout:v1:"

function normalizeLayoutContext(context: string): string {
  return context.trim() || DEFAULT_LAYOUT_CONTEXT
}

export function layoutStorageKey(context: string = DEFAULT_LAYOUT_CONTEXT): string {
  return `${STORAGE_KEY_PREFIX}${normalizeLayoutContext(context)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function sanitizeConversationsMeta(
  layout: PaneLayout,
  groups?: PaneGroupMap,
  meta?: Record<string, PersistedConversationMeta>,
): Record<string, PersistedConversationMeta> | undefined {
  if (!meta) return undefined
  const activeIds = new Set<string>()
  const collect = (target: PaneLayout) => {
    for (const pane of listPanes(target.root)) {
      if (pane.content.type === "conversation" && pane.content.conversationId.trim()) {
        activeIds.add(pane.content.conversationId)
      }
    }
  }
  collect(layout)
  if (groups) {
    for (const groupLayout of Object.values(groups)) collect(groupLayout)
  }

  const result: Record<string, PersistedConversationMeta> = {}
  for (const id of activeIds) {
    const entry = meta[id]
    if (
      !entry ||
      typeof entry.environment !== "string" ||
      typeof entry.route !== "string" ||
      typeof entry.title !== "string"
    ) {
      continue
    }
    result[id] = {
      environment: entry.environment,
      route: entry.route,
      title: entry.title.slice(0, 200),
      ...(typeof entry.selected === "string" ? { selected: entry.selected } : {}),
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function mergeMigratedFilesIntoRightPanel(
  base: RightPanelState,
  extractedFiles: Extract<PaneContent, { type: "file" }>[],
): RightPanelState {
  if (!extractedFiles.length) return base
  const tabs: RightPanelTab[] = [...base.tabs]
  const seenKeys = new Set(tabs.map(rightTabIdentity))
  for (const file of extractedFiles) {
    if (tabs.length >= MAX_RIGHT_PANEL_TABS) break
    if (!file.cwd?.trim() || (!file.projectId && !file.sessionId)) continue
    const tab: RightPanelTab = {
      id: defaultIdGenerator(),
      kind: "file",
      environment: file.environment || "local",
      title: deriveRightTabTitle({
        title: file.title,
        path: file.path,
        cwd: file.cwd,
        mode: file.mode,
      }),
      cwd: file.cwd,
      ...(file.path ? { path: file.path } : {}),
      ...(file.projectId ? { projectId: file.projectId } : {}),
      ...(file.sessionId ? { sessionId: file.sessionId } : {}),
      ...(file.bindingId ? { bindingId: file.bindingId } : {}),
      ...(file.line ? { line: file.line } : {}),
      ...(typeof file.git === "boolean" ? { git: file.git } : {}),
      mode: file.mode || "all",
      version: 1,
    }
    const key = rightTabIdentity(tab)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    tabs.push(tab)
  }
  return {
    ...base,
    open: base.open || tabs.length > base.tabs.length,
    activeTabId: base.activeTabId ?? tabs[0]?.id ?? null,
    tabs,
  }
}

export interface SerializePaneLayoutExtras {
  groups?: PaneGroupMap
  activeGroupId?: string | null
  rightPanel?: RightPanelState
}

/**
 * Serializes ONLY durable LayoutState (active tree, implicit multi-pane groups,
 * right-panel tabs, conversation metadata, context).
 * Transient InteractionState (maximizedPaneId, drag, resize) is never included.
 */
export function serializePaneLayout(
  layout: PaneLayout,
  context: string = DEFAULT_LAYOUT_CONTEXT,
  conversations?: Record<string, PersistedConversationMeta>,
  updatedAt?: number,
  extras?: SerializePaneLayoutExtras,
): string {
  const normalized = normalizeLayout(stripNonConversationPanes(layout).layout)
  const sanitizedGroups = sanitizePaneGroups(
    extras?.groups ?? {},
    normalized,
    extras?.activeGroupId ?? null,
  )
  const serializedRightPanel = extras?.rightPanel
    ? serializeRightPanelState(extras.rightPanel)
    : undefined
  const record: PersistedPaneLayoutRecord = {
    version: PANE_LAYOUT_VERSION,
    context: normalizeLayoutContext(context),
    ...(typeof updatedAt === "number" && Number.isFinite(updatedAt) ? { updatedAt } : {}),
    layout: normalized,
    ...(Object.keys(sanitizedGroups.groups).length > 0
      ? { groups: sanitizedGroups.groups }
      : {}),
    ...(sanitizedGroups.activeGroupId ? { activeGroupId: sanitizedGroups.activeGroupId } : {}),
    ...(serializedRightPanel ? { rightPanel: serializedRightPanel } : {}),
    ...(conversations
      ? { conversations: sanitizeConversationsMeta(normalized, sanitizedGroups.groups, conversations) }
      : {}),
  }
  return JSON.stringify(record)
}

export interface DeserializedPaneLayout {
  layout: PaneLayout
  groups: PaneGroupMap
  activeGroupId: string | null
  rightPanel: RightPanelState
  conversations: Record<string, PersistedConversationMeta>
  updatedAt: number
  migrated: boolean
  degraded: boolean
}

function emptyDeserialized(degraded: boolean): DeserializedPaneLayout {
  return {
    layout: createInitialLayout(),
    groups: {},
    activeGroupId: null,
    rightPanel: createInitialRightPanelState(),
    conversations: {},
    updatedAt: 0,
    migrated: false,
    degraded,
  }
}

export function deserializePaneLayout(
  raw: string | unknown,
  expectedContext: string = DEFAULT_LAYOUT_CONTEXT,
): DeserializedPaneLayout {
  let parsed: unknown = raw
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) return emptyDeserialized(false)
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return emptyDeserialized(true)
    }
  }

  if (!isRecord(parsed)) return emptyDeserialized(true)

  const payload = parsed.layout !== undefined ? parsed.layout : parsed
  const isLegacy =
    isRecord(payload) &&
    payload.root === undefined &&
    (Array.isArray(payload.pages) || Array.isArray(payload.sessions))

  if (
    typeof parsed.context === "string" &&
    normalizeLayoutContext(parsed.context) !== normalizeLayoutContext(expectedContext)
  ) {
    return emptyDeserialized(true)
  }

  const migrated = migrateSavedLayout(payload)
  if (!migrated) return emptyDeserialized(true)

  const strippedMain = stripNonConversationPanes(migrated)
  const extractedFiles = [...strippedMain.extractedFiles]

  const rawGroups: PaneGroupMap = {}
  if (isRecord(parsed.groups)) {
    for (const [groupId, candidate] of Object.entries(parsed.groups)) {
      if (!groupId.trim()) continue
      const validGroup = migrateSavedLayout(candidate)
      if (!validGroup) continue
      const strippedGroup = stripNonConversationPanes(validGroup)
      extractedFiles.push(...strippedGroup.extractedFiles)
      rawGroups[groupId] = strippedGroup.layout
    }
  }

  const requestedActiveGroupId =
    typeof parsed.activeGroupId === "string" && parsed.activeGroupId.trim()
      ? parsed.activeGroupId
      : null
  const sanitizedGroups = sanitizePaneGroups(
    rawGroups,
    strippedMain.layout,
    requestedActiveGroupId,
  )

  const baseRightPanel = sanitizeRightPanelState(parsed.rightPanel)
  const rightPanel = mergeMigratedFilesIntoRightPanel(baseRightPanel, extractedFiles)

  const rawMeta = isRecord(parsed.conversations)
    ? (parsed.conversations as Record<string, PersistedConversationMeta>)
    : undefined
  const conversations =
    sanitizeConversationsMeta(strippedMain.layout, sanitizedGroups.groups, rawMeta) ?? {}
  const updatedAt =
    typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
      ? parsed.updatedAt
      : 0

  return {
    layout: strippedMain.layout,
    groups: sanitizedGroups.groups,
    activeGroupId: sanitizedGroups.activeGroupId,
    rightPanel,
    conversations,
    updatedAt,
    migrated: isLegacy || strippedMain.changed,
    degraded: false,
  }
}

export interface SaveRemoteOptions {
  keepalive?: boolean
}

export interface PaneLayoutPersistenceOptions {
  context?: string
  debounceMs?: number
  now?: () => number
  readLocal?: (key: string) => string | null
  writeLocal?: (key: string, value: string) => void
  saveRemote?: (
    context: string,
    payload: PersistedPaneLayoutRecord,
    options?: SaveRemoteOptions,
  ) => Promise<void>
}

export interface PaneLayoutPersistence {
  load: (bootstrapRaw?: string | null) => {
    layout: PaneLayout
    groups: PaneGroupMap
    activeGroupId: string | null
    rightPanel: RightPanelState
    conversations: Record<string, PersistedConversationMeta>
    restored: boolean
    degraded: boolean
  }
  scheduleSave: (
    layout: PaneLayout,
    conversations?: Record<string, PersistedConversationMeta>,
    extras?: SerializePaneLayoutExtras,
  ) => void
  flush: () => void
  dispose: () => void
}

/**
 * Coordinates debounced persistence to localStorage + backend SQLite without
 * writing on every pointermove during resize drags.
 */
export function createPaneLayoutPersistence(
  options: PaneLayoutPersistenceOptions = {},
): PaneLayoutPersistence {
  const context = normalizeLayoutContext(options.context ?? DEFAULT_LAYOUT_CONTEXT)
  const debounceMs = options.debounceMs ?? 250
  const now = options.now ?? (() => Date.now())
  const key = layoutStorageKey(context)

  const readLocal =
    options.readLocal ??
    ((storageKey: string) => {
      try {
        return globalThis.localStorage?.getItem(storageKey) ?? null
      } catch {
        return null
      }
    })
  const writeLocal =
    options.writeLocal ??
    ((storageKey: string, value: string) => {
      try {
        globalThis.localStorage?.setItem(storageKey, value)
      } catch {
        /* Storage is optional. */
      }
    })

  let timer: ReturnType<typeof setTimeout> | undefined
  let pending: {
    layout: PaneLayout
    conversations?: Record<string, PersistedConversationMeta>
    extras?: SerializePaneLayoutExtras
  } | null = null
  let lastLocalSignature = ""
  let lastRemoteSignature = ""
  let lastRemoteTimestamp = 0
  let latestRemoteTimestamp = 0
  let lastTimestamp = 0
  let writeChain = Promise.resolve()

  function nextTimestamp(): number {
    const candidate = now()
    lastTimestamp = candidate > lastTimestamp ? candidate : lastTimestamp + 1
    return lastTimestamp
  }

  function commitNow(
    layout: PaneLayout,
    conversations?: Record<string, PersistedConversationMeta>,
    extras?: SerializePaneLayoutExtras,
    keepalive = false,
  ) {
    const signature = serializePaneLayout(layout, context, conversations, undefined, extras)
    const needsLocal = signature !== lastLocalSignature
    const needsRemote =
      !!options.saveRemote &&
      (signature !== lastRemoteSignature || latestRemoteTimestamp > lastRemoteTimestamp)
    if (!needsLocal && !needsRemote) return

    const timestamp = nextTimestamp()
    const serialized = serializePaneLayout(layout, context, conversations, timestamp, extras)
    if (needsLocal) {
      lastLocalSignature = signature
      writeLocal(key, serialized)
    }
    if (needsRemote && options.saveRemote) {
      const parsed = JSON.parse(serialized) as PersistedPaneLayoutRecord
      const saveFn = options.saveRemote
      latestRemoteTimestamp = timestamp
      const acknowledge = () => {
        if (timestamp <= lastRemoteTimestamp) return
        lastRemoteTimestamp = timestamp
        lastRemoteSignature = signature
      }
      if (keepalive) {
        void saveFn(context, parsed, { keepalive: true }).then(
          acknowledge,
          () => {
            /* Keep lastRemoteSignature unset so a future save retries. */
          },
        )
      } else {
        writeChain = writeChain.then(async () => {
          if (timestamp < latestRemoteTimestamp) return
          try {
            await saveFn(context, parsed, { keepalive: false })
            acknowledge()
          } catch {
            /* Local cache retains layout; next change will retry backend persistence. */
          }
        })
      }
    }
  }

  return {
    load(bootstrapRaw?: string | null) {
      const candidates = [
        { source: "bootstrap" as const, raw: bootstrapRaw },
        { source: "local" as const, raw: readLocal(key) },
      ].filter(
        (entry): entry is { source: "bootstrap" | "local"; raw: string } =>
          typeof entry.raw === "string" && entry.raw.trim().length > 0,
      )

      const valid = candidates
        .map(entry => ({ ...entry, parsed: deserializePaneLayout(entry.raw, context) }))
        .filter(entry => !entry.parsed.degraded)

      if (valid.length > 0) {
        valid.sort((a, b) => {
          if (b.parsed.updatedAt !== a.parsed.updatedAt) {
            return b.parsed.updatedAt - a.parsed.updatedAt
          }
          return a.source === "bootstrap" ? -1 : 1
        })
        const chosen = valid[0]
        const extras: SerializePaneLayoutExtras = {
          groups: chosen.parsed.groups,
          activeGroupId: chosen.parsed.activeGroupId,
          rightPanel: chosen.parsed.rightPanel,
        }
        const signature = serializePaneLayout(
          chosen.parsed.layout,
          context,
          chosen.parsed.conversations,
          undefined,
          extras,
        )
        lastTimestamp = Math.max(lastTimestamp, chosen.parsed.updatedAt)
        lastLocalSignature = signature
        if (chosen.source === "bootstrap") {
          lastRemoteSignature = signature
          lastRemoteTimestamp = chosen.parsed.updatedAt
          latestRemoteTimestamp = lastRemoteTimestamp
        }
        if (chosen.parsed.migrated) {
          writeLocal(
            key,
            serializePaneLayout(
              chosen.parsed.layout,
              context,
              chosen.parsed.conversations,
              nextTimestamp(),
              extras,
            ),
          )
        }
        return {
          layout: chosen.parsed.layout,
          groups: chosen.parsed.groups,
          activeGroupId: chosen.parsed.activeGroupId,
          rightPanel: chosen.parsed.rightPanel,
          conversations: chosen.parsed.conversations,
          restored: true,
          degraded: false,
        }
      }

      return {
        layout: createInitialLayout(),
        groups: {},
        activeGroupId: null,
        rightPanel: createInitialRightPanelState(),
        conversations: {},
        restored: false,
        degraded: candidates.length > 0,
      }
    },
    scheduleSave(layout, conversations, extras) {
      pending = { layout, conversations, extras }
      if (timer !== undefined) clearTimeout(timer)
      if (debounceMs <= 0) {
        const next = pending
        pending = null
        commitNow(next.layout, next.conversations, next.extras, false)
        return
      }
      timer = setTimeout(() => {
        timer = undefined
        if (!pending) return
        const next = pending
        pending = null
        commitNow(next.layout, next.conversations, next.extras, false)
      }, debounceMs)
    },
    flush() {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (!pending) return
      const next = pending
      pending = null
      commitNow(next.layout, next.conversations, next.extras, true)
    },
    dispose() {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      pending = null
    },
  }
}
