import { defaultIdGenerator, type IdGenerator } from "@/app/pane-layout/model/operations"
import {
  DEFAULT_RIGHT_PANEL_WIDTH,
  MAX_RIGHT_PANEL_TABS,
  MAX_RIGHT_PANEL_WIDTH,
  MIN_RIGHT_PANEL_WIDTH,
  type PersistedRightPanelState,
  type RightPanelFileMode,
  type RightPanelState,
  type RightPanelTab,
  type RightPanelTabInput,
} from "./types"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim()
  if (normalized === "/") return "/"
  return normalized.replace(/\/+$/, "")
}

export function clampRightPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_RIGHT_PANEL_WIDTH
  return Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, Math.round(width)))
}

export function deriveRightTabTitle(input: Pick<RightPanelTabInput, "title" | "path" | "cwd" | "mode">): string {
  if (typeof input.title === "string" && input.title.trim()) {
    return input.title.trim().slice(0, 120)
  }
  if (input.path?.trim()) {
    const leaf = normalizePath(input.path).split("/").pop()
    if (leaf) return leaf.slice(0, 120)
  }
  const dirLeaf = normalizePath(input.cwd).split("/").pop() || input.cwd
  return dirLeaf.slice(0, 120)
}

/**
 * Computes a deduplication key for a right-panel tab so reopening the same file
 * or directory explorer focuses the existing tab instead of creating duplicates.
 */
export function rightTabIdentity(
  tab: Pick<RightPanelTab, "kind" | "environment" | "cwd" | "path" | "projectId" | "sessionId" | "bindingId" | "mode">,
): string {
  const env = tab.environment || "local"
  const cwd = normalizePath(tab.cwd)
  const filePath = tab.path ? normalizePath(tab.path) : ""
  const mode = tab.mode || "all"
  return JSON.stringify([
    tab.kind,
    env,
    cwd,
    tab.sessionId || "",
    tab.projectId || "",
    tab.bindingId || "",
    filePath,
    filePath ? mode : mode === "all" ? "all" : "changes",
  ])
}

export function createInitialRightPanelState(): RightPanelState {
  return {
    open: false,
    width: DEFAULT_RIGHT_PANEL_WIDTH,
    activeTabId: null,
    tabs: [],
  }
}

export function sanitizeRightPanelState(raw: unknown): RightPanelState {
  if (!isRecord(raw)) return createInitialRightPanelState()
  const width = clampRightPanelWidth(typeof raw.width === "number" ? raw.width : DEFAULT_RIGHT_PANEL_WIDTH)
  const rawTabs = Array.isArray(raw.tabs) ? raw.tabs : []
  const tabs: RightPanelTab[] = []
  const seenIds = new Set<string>()
  const seenKeys = new Set<string>()

  for (const item of rawTabs) {
    if (tabs.length >= MAX_RIGHT_PANEL_TABS) break
    if (!isRecord(item)) continue
    if (item.kind !== "file") continue
    if (typeof item.cwd !== "string" || !item.cwd.trim()) continue
    const projectId = typeof item.projectId === "string" && item.projectId.trim() ? item.projectId : undefined
    const sessionId = typeof item.sessionId === "string" && item.sessionId.trim() ? item.sessionId : undefined
    if (!projectId && !sessionId) continue
    const mode: RightPanelFileMode =
      item.mode === "working" || item.mode === "index" ? item.mode : "all"
    const path = typeof item.path === "string" && item.path.trim() ? item.path : undefined
    const bindingId = typeof item.bindingId === "string" && item.bindingId.trim() ? item.bindingId : undefined
    const line =
      typeof item.line === "number" && Number.isSafeInteger(item.line) && item.line > 0
        ? item.line
        : undefined
    const environment = typeof item.environment === "string" && item.environment.trim() ? item.environment : "local"
    const tab: RightPanelTab = {
      id: typeof item.id === "string" && item.id.trim() && !seenIds.has(item.id)
        ? item.id
        : defaultIdGenerator(),
      kind: "file",
      environment,
      title: deriveRightTabTitle({
        title: typeof item.title === "string" ? item.title : undefined,
        path,
        cwd: item.cwd,
        mode,
      }),
      cwd: item.cwd,
      ...(path ? { path } : {}),
      ...(projectId ? { projectId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(bindingId ? { bindingId } : {}),
      ...(line ? { line } : {}),
      ...(typeof item.git === "boolean" ? { git: item.git } : {}),
      mode,
      version: 1,
    }
    const key = rightTabIdentity(tab)
    if (seenKeys.has(key)) continue
    seenIds.add(tab.id)
    seenKeys.add(key)
    tabs.push(tab)
  }

  const activeTabId =
    typeof raw.activeTabId === "string" && tabs.some(tab => tab.id === raw.activeTabId)
      ? raw.activeTabId
      : tabs[0]?.id ?? null

  return {
    open: Boolean(raw.open) && tabs.length > 0,
    width,
    activeTabId,
    tabs,
  }
}

export function serializeRightPanelState(state: RightPanelState): PersistedRightPanelState | undefined {
  if (!state.tabs.length && !state.open && state.width === DEFAULT_RIGHT_PANEL_WIDTH) {
    return undefined
  }
  return {
    open: state.open && state.tabs.length > 0,
    width: clampRightPanelWidth(state.width),
    activeTabId: state.activeTabId && state.tabs.some(t => t.id === state.activeTabId)
      ? state.activeTabId
      : state.tabs[0]?.id ?? null,
    tabs: state.tabs.slice(0, MAX_RIGHT_PANEL_TABS).map(({ version: _version, ...rest }) => rest),
  }
}

export interface RightPanelStore {
  getState: () => RightPanelState
  subscribe: (listener: (state: RightPanelState) => void) => () => void
  replaceState: (next: RightPanelState) => void
  openTab: (input: RightPanelTabInput) => RightPanelTab | null
  activateTab: (tabId: string) => void
  updateTab: (tabId: string, patch: Partial<Pick<RightPanelTab, "path" | "mode" | "line" | "title">>) => void
  closeTab: (tabId: string) => void
  closeOtherTabs: (tabId: string) => void
  closeAllTabs: () => void
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setWidth: (width: number) => void
}

export function createRightPanelStore(
  initialState: RightPanelState = createInitialRightPanelState(),
  generateId: IdGenerator = defaultIdGenerator,
): RightPanelStore {
  let state: RightPanelState = sanitizeRightPanelState(initialState)
  const listeners = new Set<(next: RightPanelState) => void>()

  function commit(next: RightPanelState) {
    if (next === state) return
    state = next
    for (const listener of listeners) listener(state)
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    replaceState(next) {
      commit(sanitizeRightPanelState(next))
    },
    openTab(input) {
      if (!input || typeof input.cwd !== "string" || !input.cwd.trim()) return null
      if (!input.projectId && !input.sessionId) return null
      const mode: RightPanelFileMode =
        input.mode === "working" || input.mode === "index" ? input.mode : "all"
      const path = typeof input.path === "string" && input.path.trim() ? input.path : undefined
      const line =
        typeof input.line === "number" && Number.isSafeInteger(input.line) && input.line > 0
          ? input.line
          : undefined
      const environment = input.environment?.trim() || "local"
      const candidate: RightPanelTab = {
        id: generateId(),
        kind: "file",
        environment,
        title: deriveRightTabTitle({ title: input.title, path, cwd: input.cwd, mode }),
        cwd: input.cwd,
        ...(path ? { path } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.bindingId ? { bindingId: input.bindingId } : {}),
        ...(line ? { line } : {}),
        ...(typeof input.git === "boolean" ? { git: input.git } : {}),
        mode,
        version: 1,
      }
      const key = rightTabIdentity(candidate)
      const existing = state.tabs.find(tab => rightTabIdentity(tab) === key)
      if (existing) {
        const updated: RightPanelTab = {
          ...existing,
          title: input.title?.trim() ? deriveRightTabTitle(input) : existing.title,
          mode,
          ...(line !== undefined ? { line } : {}),
          version: (existing.version ?? 1) + 1,
        }
        commit({
          ...state,
          open: true,
          activeTabId: existing.id,
          tabs: state.tabs.map(tab => (tab.id === existing.id ? updated : tab)),
        })
        return updated
      }

      const nextTabs = [...state.tabs, candidate]
      if (nextTabs.length > MAX_RIGHT_PANEL_TABS) {
        nextTabs.shift()
      }
      commit({
        ...state,
        open: true,
        activeTabId: candidate.id,
        tabs: nextTabs,
      })
      return candidate
    },
    activateTab(tabId) {
      if (!state.tabs.some(tab => tab.id === tabId)) return
      if (state.open && state.activeTabId === tabId) return
      commit({ ...state, open: true, activeTabId: tabId })
    },
    updateTab(tabId, patch) {
      const current = state.tabs.find(tab => tab.id === tabId)
      if (!current) return
      const nextPath = patch.path !== undefined ? (patch.path || undefined) : current.path
      const nextMode = patch.mode ?? current.mode ?? "all"
      const nextLine = patch.line !== undefined ? patch.line : (patch.path !== undefined && patch.path !== current.path ? undefined : current.line)
      const nextTitle = patch.title !== undefined
        ? deriveRightTabTitle({ title: patch.title, path: nextPath, cwd: current.cwd, mode: nextMode })
        : deriveRightTabTitle({ path: nextPath, cwd: current.cwd, mode: nextMode })
      if (
        nextPath === current.path &&
        nextMode === (current.mode ?? "all") &&
        nextLine === current.line &&
        nextTitle === current.title
      ) {
        return
      }
      const updated: RightPanelTab = {
        ...current,
        title: nextTitle,
        mode: nextMode,
        path: nextPath,
        line: nextLine,
      }
      commit({
        ...state,
        tabs: state.tabs.map(tab => (tab.id === tabId ? updated : tab)),
      })
    },
    closeTab(tabId) {
      const index = state.tabs.findIndex(tab => tab.id === tabId)
      if (index < 0) return
      const nextTabs = state.tabs.filter(tab => tab.id !== tabId)
      let nextActive = state.activeTabId
      if (nextActive === tabId) {
        nextActive = nextTabs[Math.min(index, nextTabs.length - 1)]?.id ?? null
      }
      commit({
        ...state,
        open: nextTabs.length > 0 ? state.open : false,
        activeTabId: nextActive,
        tabs: nextTabs,
      })
    },
    closeOtherTabs(tabId) {
      const kept = state.tabs.find(tab => tab.id === tabId)
      if (!kept || state.tabs.length <= 1) return
      commit({
        ...state,
        open: true,
        activeTabId: kept.id,
        tabs: [kept],
      })
    },
    closeAllTabs() {
      if (!state.tabs.length && !state.open) return
      commit({
        ...state,
        open: false,
        activeTabId: null,
        tabs: [],
      })
    },
    setOpen(open) {
      if (state.open === open) return
      commit({ ...state, open })
    },
    toggleOpen() {
      commit({ ...state, open: !state.open })
    },
    setWidth(width) {
      const clamped = clampRightPanelWidth(width)
      if (clamped === state.width) return
      commit({ ...state, width: clamped })
    },
  }
}
