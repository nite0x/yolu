import {setupSplitResize} from "@/shared/lib/split-resize"

// The list owns its preference; pointer capture, keyboard controls and listener
// lifetime belong to the same splitter used by files and the application shell.
export function setupConversationResize(conversationHost: HTMLElement, window: Window) {
  const handle = conversationHost.querySelector<HTMLElement>('#sessionBrowserResize')
  const list = conversationHost.querySelector<HTMLElement>('#sessionBrowserListPane')
  const body = conversationHost.querySelector<HTMLElement>('.session-browser-body')
  if (!handle || !list || !body) return () => {}
  const storageKey = 'workhub:conversation-list-width:v1'
  try {
    const saved = Number(window.localStorage.getItem(storageKey))
    if (Number.isFinite(saved) && saved >= 220 && saved <= 520) conversationHost.style.setProperty('--conversation-list-width', `${saved}px`)
  } catch { /* Storage is optional. */ }
  const disposeResize = setupSplitResize({
    handle, container: body, panel: list, axis: 'x',
    bounds: () => {
      const width = body.getBoundingClientRect().width
      return width > 620 ? {min: 220, max: Math.min(520, width - 328)} : null
    },
    resize: width => conversationHost.style.setProperty('--conversation-list-width', `${width}px`),
    commit: () => {
      const width = conversationHost.style.getPropertyValue('--conversation-list-width')
      if (!width) return
      try { window.localStorage.setItem(storageKey, String(parseFloat(width))) } catch { /* Keep the in-memory size. */ }
    },
    before: () => conversationHost.setAttribute('data-resizing', ''),
    after: () => conversationHost.removeAttribute('data-resizing'),
  })
  const dispose = () => {
    window.removeEventListener('pagehide', dispose)
    disposeResize()
  }
  window.addEventListener('pagehide', dispose, {once:true})
  return dispose
}
