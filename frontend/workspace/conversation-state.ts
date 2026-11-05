import type {Session} from "./sessions"
import type {Project, Task} from "./types"
import type {SessionTarget} from "../chat/controller-types"

export interface ConversationScope {
  kind: "all" | "task" | "project" | "directory"
  id?: string
  environment?: string
  cwd?: string
  name?: string
}
export interface ConversationView {
  key: string
  environment: string
  environmentFilter: string
  scope: ConversationScope
  directory: string
  selected?: string | null
  requestedSession?: string | null
  locateSelection?: string | null
  archived: boolean
  search: string
  statusFilter: string
  pane: string
  sessions: Session[]
  loading: boolean
  error: string
  checkedAt: number
  scrollTop: number
  creating: boolean
  loadedCount: number
  windowStart: number
  listItems?: Session[]
  listHeights?: Map<string, number>
  requestID?: number
  requestKey?: string | null
  target?: SessionTarget | null
  targetEnvironment?: string
  creationDirectory?: string
  focusComposer?: boolean
  directSession?: Session
  followTarget?: unknown
}
interface CatalogLoad {loading: boolean; checkedAt: number; revision: number; error: string; pending?: Promise<void>}
interface Workspace {projects: Project[]; requirements: Task[]}

// One owner for page scope, cached metadata and query generations. Rendering and
// navigation supply dependencies rather than reaching into unrelated globals.
export function createConversationState({storage, scopeKey, sessionKey}: {
  storage: () => Pick<Storage, "getItem" | "setItem">
  scopeKey: (scope: ConversationScope) => string
  sessionKey: (session: Session) => string
}) {
  const views = new Map<string, ConversationView>()
  const index = new Map<string, Map<string, Session>>()
  const workspaces = new Map<string, Workspace>()
  const pageScopes = new Map<string, ConversationScope>()
  const catalogs = new Map<string, CatalogLoad>()
  function invalidate(view: ConversationView) {
    view.requestID = (view.requestID || 0) + 1
    view.requestKey = null
    view.loading = false
  }
  function record(environment: string, sessions: Session[], replace = false) {
    const items = !replace && index.get(environment) || new Map<string, Session>()
    for (const session of sessions) items.set(session.id, session)
    index.set(environment, items)
  }
  return {
    current: null as ConversationView | null,
    mode: "hidden",
    selection: 0,
    views: () => views.values(),
    invalidate,
    workspace: (environment: string) => workspaces.get(environment),
    rememberWorkspace: (environment: string, workspace: Workspace) => workspaces.set(environment, workspace),
    pageScope: (environment: string) => pageScopes.get(environment),
    rememberPageScope: (environment: string, scope: ConversationScope) => pageScopes.set(environment, scope),
    session: (environment: string, id: string) => index.get(environment)?.get(id),
    sessions: (environment: string) => [...(index.get(environment)?.values() || [])],
    record,
    viewFor(environment: string, scope: ConversationScope) {
      const key = scopeKey(scope)
      let view = views.get(key)
      if (!view) {
        let saved: Partial<ConversationView> | null = null
        try { saved = JSON.parse(storage().getItem("workhub:conversation-view:v1:" + key) || "null") } catch { /* Optional cache. */ }
        view = {key, environment, environmentFilter: "", scope, directory: typeof saved?.directory === "string" ? saved.directory : "", selected: typeof saved?.selected === "string" ? saved.selected : undefined, archived: !!saved?.archived, search: "", statusFilter: "all", pane: "list", sessions: [], loading: false, error: "", checkedAt: 0, scrollTop: 0, creating: false, loadedCount: Number.isSafeInteger(saved?.loadedCount) && saved!.loadedCount! >= 20 ? saved!.loadedCount! : 20, windowStart: Number.isSafeInteger(saved?.windowStart) && saved!.windowStart! >= 0 ? saved!.windowStart! : 0}
        views.set(key, view)
      }
      return view
    },
    remember(view: ConversationView, scrollTop: number, page: boolean, environment: string) {
      view.scrollTop = scrollTop
      try { storage().setItem("workhub:conversation-view:v1:" + view.key, JSON.stringify({directory: view.directory, selected: view.selected || null, archived: view.archived, loadedCount: view.loadedCount, windowStart: view.windowStart})) } catch { /* Keep memory fallback. */ }
      if (page) pageScopes.set(environment, view.scope)
    },
    catalog(environment: string) {
      let load = catalogs.get(environment)
      if (!load) { load = {loading: false, checkedAt: 0, revision: 0, error: ""}; catalogs.set(environment, load) }
      return load
    },
    invalidateCatalog(environment: string) {
      const load = catalogs.get(environment)
      if (load) { load.revision++; load.loading = false; load.checkedAt = 0 }
    },
    suspend() {
      for (const load of catalogs.values()) { load.revision++; load.loading = false; load.checkedAt = 0 }
      for (const view of views.values()) { view.requestID = (view.requestID || 0) + 1; view.loading = false }
      this.current = null
    },
    managed(session: Session, environment: string, action: string) {
      this.invalidateCatalog(environment)
      record(environment, [{...index.get(environment)?.get(session.id), ...session}])
      for (const view of views.values()) {
        view.sessions = view.sessions.map(s => sessionKey(s) === sessionKey(session) ? {...s, ...session} : s)
        if (action === "archive" || action === "restore") view.sessions = view.sessions.filter(s => !!s.archived === !!view.archived)
        view.checkedAt = 0
        invalidate(view)
      }
    },
    beginQuery(view: ConversationView, requestKey: string, environments: string[], activeEnvironment: () => string) {
      const sameScope = view.requestKey === requestKey
      const requestID = (view.requestID || 0) + 1
      Object.assign(view, {requestID, requestKey, loading: true, error: "", checkedAt: Date.now()})
      const results = new Map<string, Session[]>(), errors = new Map<string, string>()
      const previous = sameScope ? view.sessions : []
      const pending = new Set(environments)
      const current = () => view.requestID === requestID && view.requestKey === requestKey && view.environment === activeEnvironment()
      const selectionEnvironment = () => {
        const selected = previous.find(s => sessionKey(s) === view.selected)
        if (selected) return selected.environment_id
        try { const key = JSON.parse(view.selected || "null"); if (Array.isArray(key)) return key[0] as string } catch { /* Local IDs are plain strings. */ }
        return "local"
      }
      return {
        current, errors,
        receive(environment: string, sessions: Session[], error?: string) {
          if (!current()) return
          if (!error || sessions.length) results.set(environment, sessions)
          if (error) errors.set(environment, error)
          record(environment, sessions, view.scope.kind === "all" && !view.directory && !view.archived)
        },
        failed(environment: string, message: string) { if (current()) errors.set(environment, message) },
        settled(environment: string) { pending.delete(environment) },
        publish() {
          if (!current()) return false
          view.sessions = [...results.values()].flat().concat(previous.filter(s => pending.has(s.environment_id || "") || errors.has(s.environment_id || "") && !results.has(s.environment_id || ""))).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
          view.error = [...errors.values()].join("\n")
          if (view.requestedSession) {
            if (view.sessions.some(s => sessionKey(s) === view.requestedSession)) view.requestedSession = null
          } else if (!view.creating && !(view.selected && pending.has(selectionEnvironment() || "")) && !view.sessions.some(s => sessionKey(s) === view.selected)) view.selected = view.sessions[0] ? sessionKey(view.sessions[0]) : undefined
          return true
        },
      }
    },
  }
}

declare global {
  interface Window { WorkHubConversations: ReturnType<typeof createConversationState> }
}
