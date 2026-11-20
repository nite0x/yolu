import { uiText } from "../i18n";
import {conversationPathKey} from "./conversation-runtime"
import type {ShortcutIcon} from "./shortcut-icons"

interface ShortcutPins {
  workspaces: string[]
  directories: string[]
  icons?: Record<string, ShortcutIcon>
  initialized?: boolean
}
type Request = <T>(path: string, options: {environment: string; method?: string; body?: string}) => Promise<T>
interface PinState {
  workspaces?: string[]
  directories?: string[]
  icons: Record<string, ShortcutIcon>
  loaded: boolean
  pending?: Promise<void>
  write: Promise<void>
  revision: number
  error: string
  saved?: ShortcutPins
}

// Own persistence and write ordering independently of sidebar rendering. The
// database is authoritative; browser storage only seeds older installations.
export function createShortcutPins({request, storage, changed, failed}: {
  request: Request
  storage: () => Pick<Storage, "getItem" | "setItem">
  changed: () => void
  failed: (message: string) => void
}) {
  const states = new Map<string, PinState>()
  function stateFor(environment: string) {
    let state = states.get(environment)
    if (!state) {
      state = {icons: {}, loaded: false, write: Promise.resolve(), revision: 0, error: ""}
      states.set(environment, state)
    }
    return state
  }
  const key = (kind: string, environment: string) => `workhub:pinned-${kind}:v1:${environment}`
  function read(kind: string, environment: string): unknown {
    try { return JSON.parse(storage().getItem(key(kind, environment)) || "null") } catch { return null }
  }
  function cache(kind: string, environment: string, values: string[], onlyExisting = false) {
    try {
      const store = storage(), name = key(kind, environment)
      if (!onlyExisting || values.length || store.getItem(name) !== null) store.setItem(name, JSON.stringify(values))
    } catch { /* Storage is optional, including when its getter throws. */ }
  }
  function workspaces(environment: string): string[] {
    const state = stateFor(environment)
    if (!state.workspaces) {
      const saved = read("workspaces", environment)
      state.workspaces = Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === "string"))] : []
    }
    return state.workspaces
  }
  function directories(environment: string): string[] {
    const state = stateFor(environment)
    if (!state.directories) {
      const saved = read("directories", environment)
      state.directories = Array.isArray(saved)
        ? [...new Map(saved.filter((path): path is string => typeof path === "string" && !!path.trim()).map(path => [conversationPathKey(path), path])).values()]
        : []
    }
    return state.directories
  }
  function apply(environment: string, pins: ShortcutPins) {
    Object.assign(stateFor(environment), {workspaces: pins.workspaces, directories: pins.directories, icons: pins.icons || {}})
    cache("workspaces", environment, pins.workspaces, true)
    cache("directories", environment, pins.directories, true)
  }
  const url = (environment: string) => "/api/shortcut-pins?environment=" + encodeURIComponent(environment)
  function load(environment: string): Promise<void> {
    const state = stateFor(environment)
    if (state.loaded) return Promise.resolve()
    if (state.pending) return state.pending
    state.pending = (async () => {
      try {
        let pins = await request<ShortcutPins>(url(environment), {environment: "local"})
        if (!pins.initialized) {
          pins = await request<ShortcutPins>(url(environment), {environment: "local", method: "PUT", body: JSON.stringify({workspaces: workspaces(environment), directories: directories(environment), initialize: true})})
        }
        apply(environment, pins)
        state.saved = pins
        state.loaded = true
        state.error = ""
        changed()
      } catch (error) {
        const message = (error as Error).message
        if (state.error !== message) failed(uiText("读取固定入口失败：") + message)
        state.error = message
        throw error
      } finally { state.pending = undefined }
    })()
    return state.pending
  }
  function save(environment: string): Promise<void> {
    const state = stateFor(environment)
    const pins = {workspaces: [...workspaces(environment)], directories: [...directories(environment)], icons: {...state.icons}}
    const revision = ++state.revision
    // A failed older write must never roll back a newer optimistic selection.
    state.write = state.write.then(async () => {
      try {
        state.saved = await request<ShortcutPins>(url(environment), {environment: "local", method: "PUT", body: JSON.stringify(pins)})
        try { storage().setItem("workhub:shortcut-pins-updated:" + environment, Date.now() + ":" + Math.random()) } catch { /* Refresh on reopen. */ }
      } catch (error) { failed(uiText("保存固定入口失败：") + (error as Error).message) }
      if (state.revision === revision && state.saved) {
        apply(environment, state.saved)
        changed()
      }
    })
    return state.write
  }
  return {
    workspaces, directories, load, save,
    loaded: (environment: string) => stateFor(environment).loaded,
    icons: (environment: string) => stateFor(environment).icons,
    setWorkspaces(environment: string, values: string[]) { stateFor(environment).workspaces = values; cache("workspaces", environment, values) },
    setDirectories(environment: string, values: string[]) { stateFor(environment).directories = values; cache("directories", environment, values) },
    setIcon(environment: string, id: string, value: ShortcutIcon) {
      const state = stateFor(environment)
      state.icons = {...state.icons, [id]: value}
    },
    async reload(environment: string) {
      const state = states.get(environment)
      if (!state) return
      await state.write
      state.loaded = false
      return load(environment)
    },
  }
}
