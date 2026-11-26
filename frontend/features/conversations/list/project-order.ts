import {uiText} from "@/shared/i18n"
import type {ConversationGroup} from "./tree"

const signalKey = "workhub:conversation-project-order:v1"
const gripSelector = "[data-project-reorder]"

function readOrder(saved: string | null) {
  try {
    const value: unknown = JSON.parse(saved || "null")
    if (Array.isArray(value)) return value.filter((key): key is string => typeof key === "string")
  } catch { /* A malformed preference falls back to the default order. */ }
  return []
}

export function createConversationProjectOrdering({list, status, initialOrder, groups, refresh, save, saveFailed}: {
  list: HTMLElement
  status: HTMLElement
  initialOrder: string | null
  groups: () => {order: string[]; visible: ConversationGroup[]}
  refresh: (focusKey?: string) => void
  save: (order: string[]) => Promise<unknown>
  saveFailed: () => void
}) {
  const window = list.ownerDocument.defaultView!
  let saved = readOrder(initialOrder)
  let writes = Promise.resolve()
  let pending = 0

  window.addEventListener("storage", event => {
    if (event.key !== signalKey || pending) return
    saved = readOrder(event.newValue)
    refresh()
  })
  function persist(order: string[]) {
    pending++
    writes = writes.then(async () => {
      try {
        await save(order)
        // The database is authoritative. Storage notifies other same-origin windows.
        try { window.localStorage.setItem(signalKey, JSON.stringify(order)) } catch {}
      } catch {
        saveFailed()
      } finally {
        pending--
      }
    })
  }

  const openGrip = () => list.querySelector<HTMLButtonElement>(`${gripSelector}[aria-expanded="true"]`)
  function closeControls() {
    openGrip()?.setAttribute("aria-expanded", "false")
  }
  function move(source: string, target: string, after: boolean, restoreFocus = false) {
    const {order, visible} = groups()
    const from = visible.findIndex(group => group.key === source)
    const to = visible.findIndex(group => group.key === target)
    if (from < 0 || to < 0 || from === to) return
    const position = to + Number(after) - Number(from < to)
    if (from === position) return
    const visibleKeys = visible.map(group => group.key)
    const visibleSet = new Set(visibleKeys)
    visibleKeys.splice(from, 1)
    visibleKeys.splice(position, 0, source)
    // Reorder only the visible slots so a filtered move preserves hidden projects.
    let index = 0
    saved = order.map(key => visibleSet.has(key) ? visibleKeys[index++] : key)
    persist(saved)
    refresh(restoreFocus ? source : undefined)
    status.textContent = uiText("已将 {0} 移到第 {1} 个项目位置", visible[from].name, position + 1)
  }

  list.ownerDocument.addEventListener("click", event => {
    const target = event.target as HTMLElement
    const grip = target.closest<HTMLButtonElement>(gripSelector)
    const control = target.closest<HTMLButtonElement>("[data-project-move]")
    const open = openGrip()
    if (grip && list.contains(grip)) {
      closeControls()
      if (open !== grip) grip.setAttribute("aria-expanded", "true")
    } else if (control && list.contains(control)) {
      const source = control.closest<HTMLElement>("[data-conversation-group]")?.dataset.conversationGroup
      const {visible} = groups()
      const direction = Number(control.dataset.projectMove)
      const index = visible.findIndex(group => group.key === source)
      const adjacent = index >= 0 && visible[index + direction]
      closeControls()
      if (source && adjacent) move(source, adjacent.key, direction > 0, true)
    } else {
      closeControls()
    }
  })
  list.addEventListener("keydown", event => {
    const grip = openGrip()
    if (event.key !== "Escape" || !grip) return
    closeControls()
    grip.focus()
    event.preventDefault()
    event.stopPropagation()
  })

  let source: HTMLElement | undefined
  let destination: HTMLElement | undefined
  const projectSection = (element: EventTarget | null) => (element as HTMLElement | null)?.closest<HTMLElement>('[data-collection="project"]')
  function clearDropTarget() {
    destination?.removeAttribute("data-project-drop")
    destination = undefined
  }
  function endDrag() {
    source?.removeAttribute("data-project-dragging")
    source = undefined
    clearDropTarget()
  }
  list.addEventListener("dragstart", event => {
    const grip = (event.target as HTMLElement).closest(gripSelector)
    const section = grip && projectSection(grip)
    if (!section?.dataset.conversationGroup || !event.dataTransfer) return
    endDrag()
    closeControls()
    source = section
    source.setAttribute("data-project-dragging", "")
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("application/x-yolu-project-group", section.dataset.conversationGroup)
  })
  function dropPosition(event: DragEvent, section: HTMLElement) {
    const heading = section.querySelector(".session-collection-heading")
    const bounds = (heading || section).getBoundingClientRect()
    return event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before"
  }
  list.addEventListener("dragover", event => {
    if (!source) return
    const section = projectSection(event.target)
    if (section !== destination) clearDropTarget()
    if (!section || section.dataset.conversationGroup === source.dataset.conversationGroup || !event.dataTransfer) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    destination = section
    section.dataset.projectDrop = dropPosition(event, section)
  })
  list.addEventListener("dragleave", event => {
    if (destination && !destination.contains(event.relatedTarget as Node | null) && projectSection(event.target) === destination) clearDropTarget()
  })
  list.addEventListener("drop", event => {
    if (!source) return
    const key = source.dataset.conversationGroup
    const section = projectSection(event.target)
    const target = section?.dataset.conversationGroup
    endDrag()
    if (!section || !key || !target) return
    event.preventDefault()
    move(key, target, dropPosition(event, section) === "after")
  })
  window.addEventListener("dragend", endDrag)
  window.addEventListener("drop", endDrag)

  return { get order() { return saved } }
}
