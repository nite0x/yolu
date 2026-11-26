interface SplitOptions {
  handle: HTMLElement; container: HTMLElement; panel: HTMLElement
  axis: "x" | "y"; direction?: number
  bounds: () => {min: number; max: number} | null
  resize: (size: number) => void
  commit?: () => void
  before?: () => void
  after?: () => void
}

/** Native splitter for stable reading surfaces; pointer and keyboard share bounds. */
export function setupSplitResize(options: SplitOptions) {
  const {handle, container, panel, axis} = options
  const document = handle.ownerDocument
  const window = document.defaultView
  if (!window) return () => {}
  let drag: {id: number; start: number; size: number; moved: boolean} | undefined
  const measure = () => panel.getBoundingClientRect()[axis === "x" ? "width" : "height"]
  const coordinate = (event: PointerEvent) => axis === "x" ? event.clientX : event.clientY
  function sync() {
    const bounds = options.bounds()
    if (!bounds && drag) finish()
    if (!bounds) return
    handle.setAttribute("aria-valuemin", String(Math.round(bounds.min)))
    handle.setAttribute("aria-valuemax", String(Math.round(bounds.max)))
    handle.setAttribute("aria-valuenow", String(Math.round(measure())))
  }
  function resize(size: number) {
    const bounds = options.bounds()
    if (!bounds) return
    const next = Math.round(Math.max(bounds.min, Math.min(bounds.max, size)))
    options.resize(next)
    handle.setAttribute("aria-valuenow", String(next))
  }
  function finish(event?: {pointerId?: number}) {
    if (!drag || event?.pointerId != null && event.pointerId !== drag.id) return
    const current = drag
    drag = undefined
    container.removeAttribute("data-split-resizing")
    if (handle.hasPointerCapture?.(current.id)) handle.releasePointerCapture(current.id)
    if (current.moved) options.commit?.()
    options.after?.()
  }
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag || !options.bounds()) return
    event.preventDefault(); options.before?.()
    handle.focus({preventScroll:true})
    drag = {id:event.pointerId, start:coordinate(event), size:measure(), moved:false}
    container.dataset.splitResizing = axis
    handle.setPointerCapture?.(event.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return
    if (!options.bounds()) { finish(event); return }
    drag.moved = true
    resize(drag.size + (coordinate(event) - drag.start) * (options.direction || 1))
  }
  const keys = (event: KeyboardEvent) => {
    const previous = axis === "x" ? "ArrowLeft" : "ArrowUp"
    const next = axis === "x" ? "ArrowRight" : "ArrowDown"
    const bounds = options.bounds()
    if (!bounds || ![previous,next,"Home","End"].includes(event.key)) return
    event.preventDefault(); options.before?.()
    const delta = (event.key === previous ? -1 : 1) * (options.direction || 1) * (event.shiftKey ? 40 : 10)
    resize(event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max : measure() + delta)
    options.commit?.(); options.after?.()
  }
  const end = (event: Event) => finish(event as PointerEvent)
  const blur = () => finish()
  handle.addEventListener("pointerdown", down)
  handle.addEventListener("keydown", keys)
  document.addEventListener("pointermove", move)
  for (const type of ["pointerup","pointercancel","lostpointercapture"]) document.addEventListener(type,end)
  window.addEventListener("blur",blur)
  window.addEventListener("resize",sync)
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(sync)
  observer?.observe(container); observer?.observe(panel)
  sync()
  return () => {
    finish(); observer?.disconnect()
    handle.removeEventListener("pointerdown",down); handle.removeEventListener("keydown",keys)
    document.removeEventListener("pointermove",move)
    for (const type of ["pointerup","pointercancel","lostpointercapture"]) document.removeEventListener(type,end)
    window.removeEventListener("blur",blur)
    window.removeEventListener("resize",sync)
  }
}
