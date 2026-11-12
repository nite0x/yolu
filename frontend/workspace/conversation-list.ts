import type {Session} from "./sessions"
import type {ConversationTreeRow} from "./conversation-tree"

interface ListState {
  listItems?: Session[]
  listRows?: ConversationTreeRow[]
  loadedCount: number
  windowStart: number
  listHeights?: Map<string, number>
  locateSelection?: string | null
  loading?: boolean
  checkedAt?: number
}

export function conversationStatusMatches(session: Session, status: string) {
  if (status === "running") return ["starting", "running", "stopping", "handoff"].includes(session.chat_status || "")
  if (status === "waiting") return session.chat_status === "waiting"
  if (status === "unread") return !!session.unread
  return true
}

// List mechanics depend on one DOM container and explicit view callbacks. They
// do not own conversation requests, filters or the selected runtime environment.
export function createConversationList({list, sessionKey, render, remember}: {
  list: HTMLElement
  sessionKey: (session: Session) => string
  render: () => void
  remember: () => void
}) {
  const batchSize = 20, windowSize = 60
  const rows = (view: ListState) => view.listRows || view.listItems || []
  const rowKey = (row: ConversationTreeRow | Session) => "kind" in row ? row.key : sessionKey(row)
  const elements = () => [...list.querySelectorAll<HTMLElement>("[data-conversation-list-row], [data-conversation-session]:not([data-conversation-list-row])")]
  const elementKey = (element: HTMLElement) => element.dataset.conversationListRow || element.dataset.conversationSession
  function height(view: ListState, start: number, end: number) {
    const items = rows(view)
    let height = 0
    for (let i = start; i < end; i++) {
      const item = items[i]
      const estimate = "kind" in item && item.kind !== "session" ? 38 : 88
      height += view.listHeights?.get(rowKey(item)) || estimate
    }
    return height
  }
  function range(view: ListState) {
    const items = rows(view)
    view.listHeights ||= new Map()
    let scrollTarget: string | undefined
    if (view.locateSelection) {
      const index = items.findIndex(item => "kind" in item ? item.kind === "session" && sessionKey(item.session) === view.locateSelection : sessionKey(item) === view.locateSelection)
      if (index >= 0) {
        view.loadedCount = Math.max(view.loadedCount, Math.ceil((index + 1) / batchSize) * batchSize)
        view.windowStart = Math.max(0, Math.floor(index / batchSize) * batchSize - batchSize)
        scrollTarget = view.locateSelection
        if (!view.loading) view.locateSelection = null
      }
    }
    // Partial results must not erase a restored scroll window.
    if (!view.loading && view.checkedAt) {
      view.loadedCount = Math.max(batchSize, Math.min(view.loadedCount, items.length))
      view.windowStart = Math.min(view.windowStart, Math.max(0, Math.ceil(items.length / batchSize) * batchSize - batchSize))
    }
    const loaded = Math.min(view.loadedCount, items.length)
    const start = Math.min(view.windowStart, Math.max(0, Math.ceil(loaded / batchSize) * batchSize - batchSize))
    const end = Math.min(loaded, start + windowSize)
    return {loaded, start, end, before: height(view, 0, start), after: height(view, end, loaded), scrollTarget}
  }
  return {
    batchSize, range,
    reset(view: ListState) {
      view.loadedCount = batchSize
      view.windowStart = 0
      view.listHeights = new Map()
      view.locateSelection = null
      list.scrollTop = 0
    },
    sync(view: ListState | null) {
      if (!view || !rows(view).length || !list.clientHeight) return
      const previousLoadedCount = view.loadedCount
      const items = rows(view)
      const loaded = Math.min(view.loadedCount, items.length)
      const append = list.scrollTop + list.clientHeight >= list.scrollHeight - 100 && loaded < items.length
      if (append) view.loadedCount = Math.min(loaded + batchSize, items.length)
      const bounds = list.getBoundingClientRect()
      const mounted = elements()
      const mountedStart = Number(list.dataset.windowStart) || 0
      const mountedEnd = Number(list.dataset.windowEnd) || 0
      const visible = mounted.map((el, index) => ({index: mountedStart + index, rect: el.getBoundingClientRect()}))
        .filter(item => item.rect.bottom > bounds.top && item.rect.top < bounds.top + list.clientHeight)
      let start = view.windowStart
      if (append) {
        // Mount the new batch immediately without briefly exposing a spacer.
        start = Math.max(0, Math.ceil((view.loadedCount - windowSize) / batchSize) * batchSize)
      } else if (visible.length) {
        // Keep a buffer on both sides to avoid bouncing at batch boundaries.
        if (mountedEnd < loaded && visible.at(-1)!.index >= mountedEnd - 5) start += batchSize
        else if (mountedStart > 0 && visible[0].index < mountedStart + 5) start = Math.max(0, start - batchSize)
      } else {
        // A scrollbar jump can land entirely inside a spacer.
        let first = 0, offset = 0
        while (first < loaded && offset + height(view, first, first + 1) <= list.scrollTop) {
          offset += height(view, first, first + 1)
          first++
        }
        start = Math.max(0, Math.floor(first / batchSize) * batchSize - batchSize)
      }
      if (view.windowStart !== start || view.loadedCount !== previousLoadedCount) {
        view.windowStart = start
        render()
        remember()
      }
    },
    focus(view: ListState | null, index: number) {
      if (!view || !rows(view).length) return
      const items = rows(view)
      index = Math.max(0, Math.min(index, items.length - 1))
      view.loadedCount = Math.max(view.loadedCount, Math.ceil((index + 1) / batchSize) * batchSize)
      view.windowStart = Math.max(0, Math.floor(index / batchSize) * batchSize - batchSize)
      view.locateSelection = null
      render()
      const target = elements().find(el => elementKey(el) === rowKey(items[index]))
      target?.focus({preventScroll: true})
      target?.scrollIntoView({block: "nearest"})
    },
  }
}

export function patchConversationList(list: HTMLElement, markup: string) {
  const template = list.ownerDocument.createElement("template")
  template.innerHTML = markup
  const key = (node: HTMLElement) => {
    if (node.matches(".session-browser-group")) return "group:" + (node.dataset.conversationGroup || node.getAttribute("aria-label"))
    if (node.tagName === "LI") return "session:" + node.querySelector<HTMLElement>("[data-conversation-session]")?.dataset.conversationSession
    return node.dataset.listSpacer || node.className || node.tagName
  }
  // Action-menu islands are owned by interactions.tsx. Keep their hosts and
  // native sources mounted when a surviving conversation row is unchanged.
  const children = (node: ParentNode) => ([...node.children] as HTMLElement[]).filter(child => !child.classList.contains("ui-action-host"))
  function sync(parent: HTMLElement, desired: ParentNode) {
    const next = children(desired), existing = new Map(children(parent).map(node => [key(node), node]))
    const keys = new Set(next.map(key))
    // Keep surviving rows mounted so window shifts retain keyboard focus.
    for (const node of children(parent)) if (!keys.has(key(node))) node.remove()
    next.forEach((incoming, index) => {
      let node = existing.get(key(incoming)) || incoming
      if (node.matches("details.session-item-menu") && incoming.matches("details.session-item-menu")) {
        const menu = incoming as HTMLDetailsElement
        menu.classList.toggle("ui-native-menu", node.classList.contains("ui-native-menu"))
        menu.open = (node as HTMLDetailsElement).open
      }
      if (node !== incoming && !node.isEqualNode(incoming)) {
        if (node.matches(".session-browser-groups,.session-browser-group,.session-browser-items,li")) {
          node.className = incoming.className
          sync(node, incoming)
        }
        else if (node.hasAttribute("data-list-spacer")) node.style.height = incoming.style.height
        else { node.replaceWith(incoming); node = incoming }
      }
      const at = children(parent)[index]
      if (at !== node) parent.insertBefore(node, at || null)
    })
  }
  sync(list, template.content)
}
