import {uiText} from "@/shared/i18n"
import type {ConversationGroup} from "./tree"

const signalKey = "workhub:conversation-project-order:v1"
const titleSelector = "[data-project-reorder]"
const projectSelector = '[data-collection="project"]'
const dragThreshold = 6
const scrollEdge = 32

type DropTarget = {section: HTMLElement; key: string; after: boolean}
type Point = Pick<PointerEvent, "clientX" | "clientY">

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
  const ownerWindow = list.ownerDocument.defaultView
  if (!ownerWindow) throw new Error("Project ordering requires an attached document")
  const window = ownerWindow
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

  list.addEventListener("keydown", event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return
    const title = (event.target as HTMLElement).closest<HTMLElement>(titleSelector)
    const key = title?.dataset.conversationGroupToggle
    if (!key) return
    event.preventDefault()
    const {visible} = groups()
    const index = visible.findIndex(group => group.key === key)
    const down = event.key === "ArrowDown"
    const adjacent = index >= 0 && visible[index + (down ? 1 : -1)]
    if (adjacent) move(key, adjacent.key, down, true)
  })

  let drag: {pointerId: number; key: string; section: HTMLElement; point: Point; started: boolean} | undefined
  let destination: DropTarget | undefined
  let scrollFrame = 0
  let suppressClick = false
  list.addEventListener("click", event => {
    if (!suppressClick || event.detail === 0) return
    suppressClick = false
    event.preventDefault()
    event.stopPropagation()
  }, true)
  function showDropTarget(target?: DropTarget) {
    if (target?.section === destination?.section && target?.after === destination?.after) return
    destination?.section.removeAttribute("data-project-drop")
    destination = target
    if (target) target.section.dataset.projectDrop = target.after ? "after" : "before"
  }
  function dropTarget({clientX, clientY}: Point, source: string): DropTarget | undefined {
    const {left, right, top, bottom} = list.getBoundingClientRect()
    if (clientX < left || clientX >= right || clientY < top || clientY >= bottom) return
    const hit = list.ownerDocument.elementFromPoint?.(clientX, clientY)
    if (hit && (!list.contains(hit) || hit.closest(`.session-browser-group:not(${projectSelector})`))) return
    const projects = [...list.querySelectorAll<HTMLElement>(projectSelector)]
    // Each group owns half of the space above and below its midpoint. This
    // includes the gaps and the blank list area after the final project.
    const next = projects.findIndex(section => {
      const bounds = section.getBoundingClientRect()
      return clientY < bounds.top + bounds.height / 2
    })
    const after = next < 0
    const section = after ? projects.at(-1) : projects[next]
    const key = section?.dataset.conversationGroup
    if (!section || !key || key === source || (!after && projects[next - 1]?.dataset.conversationGroup === source)) return
    return {section, key, after}
  }
  function scrollNearEdge() {
    scrollFrame = 0
    if (!drag?.started) return
    const {clientX, clientY} = drag.point
    const {left, right, top, bottom} = list.getBoundingClientRect()
    if (clientX < left || clientX >= right || clientY < top || clientY >= bottom) return
    const offset = Math.max(0, scrollEdge - (bottom - clientY)) - Math.max(0, scrollEdge - (clientY - top))
    const previous = list.scrollTop
    list.scrollTop += Math.round(offset / 3)
    if (list.scrollTop !== previous) scrollFrame = window.requestAnimationFrame(scrollNearEdge)
  }
  function endDrag() {
    if (!drag) return
    const current = drag
    drag = undefined
    current.section.removeAttribute("data-project-dragging")
    showDropTarget()
    window.cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
    if (list.hasPointerCapture?.(current.pointerId)) list.releasePointerCapture(current.pointerId)
  }
  list.addEventListener("pointerdown", event => {
    if (event.button !== 0 || drag) return
    suppressClick = false
    const title = (event.target as Element).closest(titleSelector)
    const section = title?.closest<HTMLElement>(projectSelector)
    const key = section?.dataset.conversationGroup
    if (section && key) drag = {pointerId: event.pointerId, key, section, point: event, started: false}
  })
  window.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.point.clientX, event.clientY - drag.point.clientY) < dragThreshold) return
      drag.started = true
      suppressClick = true
      drag.section.setAttribute("data-project-dragging", "")
      list.setPointerCapture?.(event.pointerId)
    }
    drag.point = event
    showDropTarget(dropTarget(event, drag.key))
    if (!scrollFrame) scrollFrame = window.requestAnimationFrame(scrollNearEdge)
  })
  list.addEventListener("scroll", () => {
    if (drag?.started) showDropTarget(dropTarget(drag.point, drag.key))
  })
  window.addEventListener("pointerup", event => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const {key, started} = drag
    const target = started ? dropTarget(event, key) : undefined
    endDrag()
    if (target) move(key, target.key, target.after)
  })
  window.addEventListener("pointercancel", event => {
    if (event.pointerId === drag?.pointerId) endDrag()
  })
  list.addEventListener("lostpointercapture", event => {
    if (event.target === list && event.pointerId === drag?.pointerId) endDrag()
  })
  window.addEventListener("keydown", event => {
    if (event.key === "Escape") endDrag()
  })
  window.addEventListener("blur", endDrag)
  window.addEventListener("pagehide", endDrag)

  return { get order() { return saved } }
}
