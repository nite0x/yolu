import {Command} from "cmdk"
import {FolderGit2, MessageSquare, Search, X} from "lucide-react"
import {useEffect, useState, useSyncExternalStore} from "react"
import {flushSync} from "react-dom"
import {createRecoverableRoot as createRoot} from "@/shared/ui/feedback/root"
import {Button} from "@/shared/ui/primitives/button"
import {uiText} from "@/shared/i18n"
import {isGeneralConversationDirectory} from "@/entities/conversations/context"
import {conversationEnvironmentKey} from "@/shared/lib/workspace-identity"

const kinds = ["project", "conversation"] as const
type Kind = typeof kinds[number]
type Identity = { kind: Kind; id: string; environment: string }
type NamedResource = { id: string; name: string }
type Project = NamedResource & { path: string }
type Session = NamedResource & { cwd: string; archived: boolean; provider?: string; additional_directories?: string[] }
type Result = Identity & { name: string; detail?: string; session?: Session }
type Inventory = {
  environments: { id: string; name: string; connected: boolean; error?: string }[]
}
type Snapshot = { route: string; environment: string; conversation?: { selected?: string } }
type Target = Snapshot & { title: string; conversation?: { scope: { kind: "all" }; selected: string; pane: "detail"; archived?: boolean; session?: Session } }
type Read = <T>(path: string, environment: string) => Promise<T>

const recentKey = "workhub:recent-search-resources:v1"
const identity = ({ kind, environment, id }: Identity) => JSON.stringify([kind, environment, id])
const names: Record<Kind, string> = { project: "项目", conversation: "对话" }
const icons = { project: FolderGit2, conversation: MessageSquare }

function readRecent(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(recentKey) || "null")
    if (Array.isArray(saved)) return saved.filter(key => typeof key === "string").slice(0, 12)
    const previous = JSON.parse(localStorage.getItem("workhub:recent-resources:v1") || "null")
    return (["project"] as const).flatMap(kind => {
      if (!Array.isArray(previous?.[kind])) return []
      return previous[kind].slice(0, 6).flatMap((entry: string) => {
        try {
          const [environment, id] = JSON.parse(entry)
          return typeof environment === "string" && typeof id === "string" ? [identity({ kind, environment, id })] : []
        } catch { return [] }
      })
    })
  } catch { return [] }
}

function snapshotIdentity(snapshot: Snapshot): Identity | undefined {
  const resource = snapshot.route.match(/^\/(projects)\/([\w-]+)(?=$|[/?])/)
  if (resource) return { kind: "project", id: resource[2], environment: snapshot.environment }
  if (snapshot.route !== "/sessions" || !snapshot.conversation?.selected) return
  let id = snapshot.conversation.selected
  let environment = snapshot.environment
  try {
    const pair = JSON.parse(id)
    if (Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === "string")) [environment, id] = pair
  } catch { /* Local conversation IDs are plain strings. */ }
  return { kind: "conversation", environment, id }
}

const sessionSearchPath = "/api/sessions/search"
const discoveryInterval = 30_000

function createCatalog(read: Read) {
  let state = {
    results: new Map<string, Result>(), environments: new Map<string, string>(), loading: true, incomplete: false,
    discovering: false, discovered: false, discoveryIncomplete: false,
  }
  let connected = ["local"]
  let loading: Promise<void> | undefined
  let discovery: Promise<void> | undefined
  let discoveredAt = 0
  const listeners = new Set<() => void>()

  function update(change: Partial<typeof state>) {
    state = { ...state, ...change }
    for (const listener of listeners) listener()
  }

  function replace(matches: (item: Result) => boolean, items: Result[]) {
    const results = new Map(state.results)
    for (const [key, item] of results) if (matches(item)) results.delete(key)
    for (const item of items) results.set(identity(item), item)
    update({ results })
  }

  async function readConversations(environment: string, provider?: "codex" | "agy" | "cursor") {
    const path = provider ? `${sessionSearchPath}?discover=${provider}` : sessionSearchPath
    const { sessions, error } = await read<{ sessions: Session[]; error?: string }>(path, environment)
    if (!connected.includes(environment)) return
    replace(item => item.kind === "conversation" && item.environment === environment && (!provider || item.session?.provider === provider), sessions.map(session => ({
      id: session.id,
      kind: "conversation",
      environment,
      name: session.name || uiText("对话详情"),
      detail: [session.archived ? uiText("已归档") : "", (isGeneralConversationDirectory(session.cwd) ? uiText("普通对话") : session.cwd)].filter(Boolean).join(" · "),
      session,
    })))
    if (error) update({ discoveryIncomplete: true })
  }

  function load() {
    if (loading) return loading
    update({ loading: true, incomplete: false })
    const readIndex = !discovery
    const failed = () => update({ incomplete: true })
    async function readEnvironment(environment: string, indexed = readIndex) {
      await Promise.all([
        read<{ projects: Project[] }>("/api/state", environment).then(({ projects }) => {
          replace(item => item.kind === "project" && item.environment === environment,
            projects.map(({ id, name, path }) => ({ id, name, kind: "project", environment, detail: path })))
        }).catch(failed),
        indexed ? readConversations(environment).catch(failed) : undefined,
      ])
    }
    loading = Promise.all([
      readEnvironment("local"),
      read<Inventory>("/api/environments", "local").then(async ({ environments }) => {
        const previous = connected
        const available = ["local", ...environments.filter(item => item.id !== "local" && item.connected).map(item => item.id)]
        if (previous.length !== available.length || previous.some(id => !available.includes(id))) {
          connected = available
          discoveredAt = 0
        }
        update({ environments: new Map(environments.map(item => [item.id, item.id === "local" ? uiText("本机") : uiText(item.name)])) })
        if (environments.some(item => !item.connected || !!item.error)) failed()
        replace(item => !connected.includes(item.environment), [])
        await Promise.all(connected.slice(1).map(environment => readEnvironment(environment, readIndex || !previous.includes(environment))))
      }).catch(failed),
    ]).then(() => {
      loading = undefined
      update({ loading: false })
    })
    return loading
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    load,
    async discover(force = false) {
      await loading
      if (discovery) await discovery
      if (discovery || (!force && Date.now() - discoveredAt < discoveryInterval)) return
      update({ discovering: true, discoveryIncomplete: false })
      const environments = connected
      const failed = () => update({ discoveryIncomplete: true })
      discovery = Promise.all(environments.flatMap(environment => [
        readConversations(environment, "codex").catch(failed),
        ...(environment === "local" ? [readConversations(environment, "agy").catch(failed), readConversations(environment, "cursor").catch(failed)] : []),
      ])).then(() => {
        discovery = undefined
        discoveredAt = environments === connected ? Date.now() : 0
        update({ discovering: false, discovered: true })
      })
    },
  }
}

function SearchItem({ result, showKind, environmentName, select }: { result: Result; showKind: boolean; environmentName?: string; select: (result: Result) => void }) {
  const Icon = icons[result.kind]
  const detail = [environmentName, result.detail].filter(Boolean).join(" · ")
  return <Command.Item className="global-search-result" value={identity(result)} onSelect={() => select(result)}>
    <Icon aria-hidden="true" />
    <span className="global-search-result-text">
      <strong title={result.name}>{result.name}</strong>
      {detail && <span title={detail}>{detail}</span>}
    </span>
    {showKind && <span className="global-search-result-kind">{uiText(names[result.kind])}</span>}
  </Command.Item>
}

function SearchPanel({ source, recent, close, select }: { source: ReturnType<typeof createCatalog>; recent: string[]; close: () => void; select: (result: Result) => void }) {
  const [query, setQuery] = useState("")
  const catalog = useSyncExternalStore(source.subscribe, source.getSnapshot)
  const term = query.trim().toLocaleLowerCase()
  const searching = !!term
  useEffect(() => { if (searching) void source.discover() }, [searching, source])

  const matches = term ? [...catalog.results.values()].flatMap(item => {
    const name = item.name.toLocaleLowerCase()
    const index = name.indexOf(term)
    return index < 0 ? [] : [{ item, rank: name === term ? 0 : index === 0 ? 1 : 2 }]
  }).sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name) || identity(a.item).localeCompare(identity(b.item))) : []
  const recentItems = term ? [] : recent.flatMap(key => catalog.results.get(key) || []).slice(0, 8)
  const sections = term ? kinds.map(kind => ({ key: kind, label: uiText(names[kind]), items: matches.filter(match => match.item.kind === kind).map(match => match.item) }))
    : [{ key: "recent", label: uiText("最近使用"), items: recentItems }]
  const hasResults = sections.some(section => section.items.length > 0)
  const loading = catalog.loading || searching && (!catalog.discovered || catalog.discovering)
  const incomplete = catalog.incomplete || searching && catalog.discoveryIncomplete
  const shortcut = navigator.platform.startsWith("Mac") ? "⌘ K" : "Ctrl K"

  return <Command label={uiText("全局搜索")} shouldFilter={false} loop vimBindings={false}>
    <div className="global-search-field">
      <Search aria-hidden="true" />
      <Command.Input placeholder={uiText("搜索项目和对话…")} value={query} onValueChange={setQuery} autoComplete="off" />
      <kbd>{shortcut}</kbd>
      <Button type="button" variant="ghost" size="icon-sm" onClick={close} aria-label={uiText("关闭")} title={uiText("关闭")}><X aria-hidden="true" /></Button>
    </div>
    <Command.List className="global-search-list" label={uiText("搜索结果")}>
      {sections.map(section => section.items.length > 0 && <Command.Group key={section.key} heading={section.label}>
        {section.items.map(result => <SearchItem key={identity(result)} result={result} showKind={!term} environmentName={catalog.environments.get(result.environment) || (result.environment === "local" ? undefined : result.environment)} select={select} />)}
      </Command.Group>)}
    </Command.List>
    {loading && !hasResults && <p role="status" className="global-search-status">{uiText("正在加载…")}</p>}
    {!loading && !incomplete && !hasResults && <p role="status" className="global-search-status">{uiText(term ? "没有匹配的结果" : "输入名称开始搜索")}</p>}
    {!loading && incomplete && <div className="global-search-status global-search-error" role="status">
      <span>{uiText("部分搜索结果暂不可用")}</span>
      <Button type="button" variant="ghost" size="sm" onClick={() => { void source.load(); if (searching) void source.discover(true) }}>{uiText("重试")}</Button>
    </div>}
  </Command>
}

export function createGlobalSearch(dialog: HTMLDialogElement, { read, navigate }: { read: Read; navigate: (target: Target) => void }) {
  const root = createRoot(dialog)
  const source = createCatalog(read)
  let recent = readRecent()
  let opener: HTMLElement | undefined
  let selected = false
  const close = () => dialog.close()
  dialog.addEventListener("close", () => {
    if (dialog.open) return
    root.render(null)
    if (!selected && opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true })
    opener = undefined
  })
  dialog.addEventListener("click", event => {
    if (event.target === dialog) close()
  })
  return {
    open(trigger?: HTMLElement) {
      if (dialog.open) {
        dialog.querySelector("input")?.focus()
        return
      }
      opener = trigger
      selected = false
      const select = ({ id, kind, name, environment, session }: Result) => {
        selected = true
        close()
        navigate(kind === "conversation"
          ? { route: "/sessions", environment, title: name, conversation: { scope: { kind: "all" }, selected: conversationEnvironmentKey(environment, id), pane: "detail", archived: session?.archived, session } }
          : { route: `/${kind}s/${encodeURIComponent(id)}`, environment, title: name })
      }
      void source.load()
      flushSync(() => root.render(<SearchPanel source={source} recent={recent} close={close} select={select} />))
      dialog.showModal()
      dialog.querySelector("input")?.focus()
    },
    remember(snapshot: Snapshot) {
      const resource = snapshotIdentity(snapshot)
      if (!resource) return
      const key = identity(resource)
      if (recent[0] === key) return
      recent = [key, ...recent.filter(item => item !== key)].slice(0, 12)
      try { localStorage.setItem(recentKey, JSON.stringify(recent)) } catch { /* Keep recent items in memory. */ }
    },
  }
}
