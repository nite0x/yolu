import {uiText} from "../i18n"
import {Info} from "lucide-react"
import {type ReactNode} from "react"

// Static markup keeps controller-owned help text available while the tip is closed.
export function HelpTip({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <span className="help-tip">
    <button type="button" className="help-tip-trigger" aria-label={uiText("{0}说明", label)} aria-describedby={id}><Info aria-hidden="true" /></button>
    <span id={id} className="help-tip-content" role="tooltip" popover="manual" hidden>{children}</span>
  </span>
}

export function setupHelpTips(root: HTMLElement) {
  let active: HTMLElement | null = null
  let dismissed: Element | null = null
  let closeTimer = 0
  const close = () => {
    window.clearTimeout(closeTimer)
    if (!active) return
    const tip = active.querySelector<HTMLElement>(".help-tip-content")!
    tip.hidePopover?.()
    tip.hidden = true
    active = null
  }
  const open = (wrapper: HTMLElement) => {
    window.clearTimeout(closeTimer)
    if (active === wrapper || dismissed === wrapper) return
    close()
    const tip = wrapper.querySelector<HTMLElement>(".help-tip-content")!
    if (!tip.textContent?.trim()) return
    active = wrapper
    tip.hidden = false
    tip.showPopover?.()
    const anchor = wrapper.getBoundingClientRect()
    const bounds = tip.getBoundingClientRect()
    tip.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`
    tip.style.top = `${anchor.bottom + bounds.height + 8 < window.innerHeight ? anchor.bottom + 4 : Math.max(8, anchor.top - bounds.height - 4)}px`
  }
  const wrapper = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(".help-tip") : null
  root.addEventListener("pointerover", event => { const tip = wrapper(event.target); if (tip) open(tip) })
  root.addEventListener("pointerout", event => {
    const tip = wrapper(event.target)
    if (tip && !tip.contains(event.relatedTarget as Node | null)) {
      dismissed = null
      if (!tip.contains(document.activeElement)) closeTimer = window.setTimeout(close, 120)
    }
  })
  root.addEventListener("focusin", event => { const tip = wrapper(event.target); if (tip) open(tip) })
  root.addEventListener("focusout", event => {
    const tip = wrapper(event.target)
    if (tip && !tip.contains(event.relatedTarget as Node | null)) { dismissed = null; close() }
  })
  root.addEventListener("click", event => {
    const tip = wrapper(event.target)
    if (tip) { dismissed = null; open(tip) }
    else close()
  })
  const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && active) { dismissed = active; close() } }
  const outside = (event: PointerEvent) => { if (active && !active.contains(event.target as Node)) close() }
  document.addEventListener("keydown", escape)
  document.addEventListener("pointerdown", outside)
  root.addEventListener("scroll", close, true)
  window.addEventListener("resize", close)
  window.addEventListener("pagehide", () => {
    close()
    document.removeEventListener("keydown", escape)
    document.removeEventListener("pointerdown", outside)
    window.removeEventListener("resize", close)
  }, { once: true })
}
