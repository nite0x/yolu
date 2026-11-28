import { createInitialLayout, normalizeLayout } from "../model/operations"
import { listPanes } from "../model/tree"
import { PANE_LAYOUT_VERSION, type PaneLayout } from "../model/types"
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
  meta?: Record<string, PersistedConversationMeta>,
): Record<string, PersistedConversationMeta> | undefined {
  if (!meta) return undefined
  const activeIds = new Set(
    listPanes(layout.root).flatMap(pane =>
      pane.content.type === "conversation" ? [pane.content.conversationId] : [],
    ),
  )
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

/**
 * Serializes ONLY durable LayoutState (tree, ratios, bindings, activePaneId, context).
 * Transient InteractionState (maximizedPaneId, drag, resize) is never included.
 */
export function serializePaneLayout(
  layout: PaneLayout,
  context: string = DEFAULT_LAYOUT_CONTEXT,
  conversations?: Record<string, PersistedConversationMeta>,
  updatedAt?: number,
): string {
  const normalized = normalizeLayout(layout)
  const record: PersistedPaneLayoutRecord = {
    version: PANE_LAYOUT_VERSION,
    context: normalizeLayoutContext(context),
    ...(typeof updatedAt === "number" && Number.isFinite(updatedAt) ? { updatedAt } : {}),
    layout: normalized,
    ...(conversations ? { conversations: sanitizeConversationsMeta(normalized, conversations) } : {}),
  }
  return JSON.stringify(record)
}

export function deserializePaneLayout(
  raw: string | unknown,
  expectedContext: string = DEFAULT_LAYOUT_CONTEXT,
): {
  layout: PaneLayout
  conversations: Record<string, PersistedConversationMeta>
  updatedAt: number
  migrated: boolean
  degraded: boolean
} {
  let parsed: unknown = raw
  if (typeof raw === "string") {
    const trimmed = raw.trim()
    if (!trimmed) {
      return {
        layout: createInitialLayout(),
        conversations: {},
        updatedAt: 0,
        migrated: false,
        degraded: false,
      }
    }
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return {
        layout: createInitialLayout(),
        conversations: {},
        updatedAt: 0,
        migrated: false,
        degraded: true,
      }
    }
  }

  if (!isRecord(parsed)) {
    return {
      layout: createInitialLayout(),
      conversations: {},
      updatedAt: 0,
      migrated: false,
      degraded: true,
    }
  }

  const payload = parsed.layout !== undefined ? parsed.layout : parsed
  const isLegacy =
    isRecord(payload) &&
    payload.root === undefined &&
    (Array.isArray(payload.pages) || Array.isArray(payload.sessions))

  if (
    typeof parsed.context === "string" &&
    normalizeLayoutContext(parsed.context) !== normalizeLayoutContext(expectedContext)
  ) {
    return {
      layout: createInitialLayout(),
      conversations: {},
      updatedAt: 0,
      migrated: false,
      degraded: true,
    }
  }

  const migrated = migrateSavedLayout(payload)
  if (!migrated) {
    return {
      layout: createInitialLayout(),
      conversations: {},
      updatedAt: 0,
      migrated: false,
      degraded: true,
    }
  }

  const rawMeta = isRecord(parsed.conversations)
    ? (parsed.conversations as Record<string, PersistedConversationMeta>)
    : undefined
  const conversations = sanitizeConversationsMeta(migrated, rawMeta) ?? {}
  const updatedAt =
    typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
      ? parsed.updatedAt
      : 0

  return {
    layout: migrated,
    conversations,
    updatedAt,
    migrated: isLegacy,
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
    conversations: Record<string, PersistedConversationMeta>
    restored: boolean
    degraded: boolean
  }
  scheduleSave: (
    layout: PaneLayout,
    conversations?: Record<string, PersistedConversationMeta>,
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
  let pending: { layout: PaneLayout; conversations?: Record<string, PersistedConversationMeta> } | null =
    null
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
    keepalive = false,
  ) {
    const signature = serializePaneLayout(layout, context, conversations)
    const needsLocal = signature !== lastLocalSignature
    const needsRemote = !!options.saveRemote &&
      (signature !== lastRemoteSignature || latestRemoteTimestamp > lastRemoteTimestamp)
    if (!needsLocal && !needsRemote) return

    const timestamp = nextTimestamp()
    const serialized = serializePaneLayout(layout, context, conversations, timestamp)
    if (needsLocal) {
      lastLocalSignature = signature
      writeLocal(key, serialized)
    }
    if (needsRemote && options.saveRemote) {
      const parsed = JSON.parse(serialized) as PersistedPaneLayoutRecord
      const saveFn = options.saveRemote
      latestRemoteTimestamp = timestamp
      const acknowledge = () => {
        // An older request can complete after the synchronous keepalive save.
        if (timestamp <= lastRemoteTimestamp) return
        lastRemoteTimestamp = timestamp
        lastRemoteSignature = signature
      }
      if (keepalive) {
        // Dispatch synchronously on unload/pagehide so keepalive requests start immediately.
        void saveFn(context, parsed, { keepalive: true }).then(
          acknowledge,
          () => {
            /* Keep lastRemoteSignature unset so a future save retries. */
          },
        )
      } else {
        writeChain = writeChain.then(async () => {
          // Keepalive has already dispatched a newer snapshot; do not send queued old ones.
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
        // Prefer the fresher record when timestamps exist; otherwise prefer SQLite bootstrap.
        valid.sort((a, b) => {
          if (b.parsed.updatedAt !== a.parsed.updatedAt) {
            return b.parsed.updatedAt - a.parsed.updatedAt
          }
          return a.source === "bootstrap" ? -1 : 1
        })
        const chosen = valid[0]
        const signature = serializePaneLayout(
          chosen.parsed.layout,
          context,
          chosen.parsed.conversations,
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
            ),
          )
        }
        return {
          layout: chosen.parsed.layout,
          conversations: chosen.parsed.conversations,
          restored: true,
          degraded: false,
        }
      }

      return {
        layout: createInitialLayout(),
        conversations: {},
        restored: false,
        degraded: candidates.length > 0,
      }
    },
    scheduleSave(layout, conversations) {
      pending = { layout, conversations }
      if (timer !== undefined) clearTimeout(timer)
      if (debounceMs <= 0) {
        const next = pending
        pending = null
        commitNow(next.layout, next.conversations, false)
        return
      }
      timer = setTimeout(() => {
        timer = undefined
        if (!pending) return
        const next = pending
        pending = null
        commitNow(next.layout, next.conversations, false)
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
      commitNow(next.layout, next.conversations, true)
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
