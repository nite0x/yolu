// Keep the native scroll container and draw the draggable thumb above its edge.
export function setupConversationScrollbar(viewport: HTMLElement) {
  const track = viewport.ownerDocument.createElement("div")
  const thumb = viewport.ownerDocument.createElement("div")
  track.className = "conversation-scrollbar"
  track.setAttribute("aria-hidden", "true")
  track.append(thumb)
  viewport.after(track)
  viewport.setAttribute("data-conversation-scroll-viewport", "")

  let hideTimer: ReturnType<typeof setTimeout> | undefined
  let dragOffset: number | undefined
  let hovering = false
  let lastTop = viewport.scrollTop
  const hide = () => {
    hovering = false
    track.removeAttribute("data-visible")
  }
  const hideLater = () => {
    clearTimeout(hideTimer)
    if (dragOffset === undefined && !hovering) hideTimer = setTimeout(hide, 700)
  }
  const measure = () => {
    const {clientHeight, scrollHeight, scrollTop} = viewport
    const range = scrollHeight - clientHeight
    const height = track.clientHeight
    const size = range > 0 ? Math.min(height, Math.max(22, height * clientHeight / scrollHeight)) : height
    return {range, size, travel: height - size, scrollTop}
  }
  const update = () => {
    const {range, size, travel, scrollTop} = measure()
    if (range <= 0 || travel <= 0) {
      hide()
      return false
    }
    thumb.style.height = `${size}px`
    thumb.style.transform = `translateY(${Math.min(1, Math.max(0, scrollTop / range)) * travel}px)`
    return true
  }
  const refresh = () => {
    if (track.hasAttribute("data-visible")) update()
  }
  const listeners = new AbortController()
  const {signal} = listeners
  viewport.addEventListener("scroll", () => {
    const top = viewport.scrollTop
    if (top === lastTop) return
    lastTop = top
    if (!update()) return
    track.setAttribute("data-visible", "")
    hideLater()
  }, {passive: true, signal})
  thumb.addEventListener("pointerenter", event => {
    if (event.pointerType === "touch") return
    hovering = true
    clearTimeout(hideTimer)
  }, {signal})
  thumb.addEventListener("pointerleave", () => {
    hovering = false
    hideLater()
  }, {signal})
  thumb.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return
    event.preventDefault()
    dragOffset = event.clientY - thumb.getBoundingClientRect().top
    thumb.setPointerCapture(event.pointerId)
    clearTimeout(hideTimer)
  }, {signal})
  thumb.addEventListener("pointermove", event => {
    if (dragOffset === undefined || !thumb.hasPointerCapture(event.pointerId)) return
    const {range, travel} = measure()
    if (travel > 0) viewport.scrollTop = (event.clientY - track.getBoundingClientRect().top - dragOffset) * range / travel
  }, {signal})
  thumb.addEventListener("lostpointercapture", event => {
    dragOffset = undefined
    hovering = event.pointerType !== "touch" && thumb.matches(":hover")
    hideLater()
  }, {signal})
  thumb.addEventListener("wheel", event => {
    event.preventDefault()
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? viewport.clientHeight : event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
    viewport.scrollBy({top: event.deltaY * unit, behavior: "instant"})
  }, {passive: false, signal})
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(refresh)
  resize?.observe(track)
  const content = new MutationObserver(refresh)
  content.observe(viewport, {childList: true, subtree: true, characterData: true})

  return () => {
    listeners.abort()
    clearTimeout(hideTimer)
    resize?.disconnect()
    content.disconnect()
    track.remove()
    viewport.removeAttribute("data-conversation-scroll-viewport")
  }
}
