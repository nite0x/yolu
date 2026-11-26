import {uiText} from "../i18n"
import type {ShortcutIcon} from "../ui/resource-icons"

type Request = <T>(path: string, options: {environment: string; method?: string; body?: string}) => Promise<T>
type Icons = Record<string, ShortcutIcon>

// Appearance is independent of navigation membership. The server merges one
// resource per write so separate detail panes cannot overwrite each other.
export function createResourceIcons({request, changed, failed}: {
  request: Request; changed: () => void; failed: (message: string) => void
}) {
  const states = new Map<string, {icons: Icons; loaded: boolean; pending?: Promise<void>; write: Promise<void>}>()
  function stateFor(environment: string) {
    let state = states.get(environment)
    if (!state) { state = {icons: {}, loaded: false, write: Promise.resolve()}; states.set(environment, state) }
    return state
  }
  const url = (environment: string) => `/api/resource-icons?environment=${encodeURIComponent(environment)}`
  async function load(environment: string): Promise<void> {
    const state = stateFor(environment)
    if (state.loaded) return
    if (state.pending) return state.pending
    state.pending = request<{icons: Icons}>(url(environment), {environment: "local"}).then(result => {
      state.icons = result.icons || {}; state.loaded = true; changed()
    }).finally(() => { state.pending = undefined })
    return state.pending
  }
  return {
    load,
    icons: (environment: string) => stateFor(environment).icons,
    async save(environment: string, id: string, appearance: ShortcutIcon) {
      const state = stateFor(environment)
      const operation = state.write.then(async () => {
        await load(environment)
        const result = await request<{icons: Icons}>(url(environment), {environment: "local", method: "PUT", body: JSON.stringify({id, appearance})})
        state.icons = result.icons; changed()
        try { localStorage.setItem(`workhub:resource-icons-updated:${environment}`, `${Date.now()}:${Math.random()}`) } catch { /* Storage is optional. */ }
      })
      state.write = operation.catch(() => {})
      try { await operation } catch (error) { failed(uiText("保存图标失败：") + (error as Error).message); throw error }
    },
    async reload(environment: string) {
      const state = stateFor(environment)
      await state.write; await state.pending
      state.loaded = false
      return load(environment)
    },
  }
}
