import {setupHelpTips} from "@/shared/ui/help-tip"

// Navigation observes the shared settings surface without owning form state.
export function setupSettingsNavigation() {
  const page = document.getElementById("settingsPage")
  if (page) setupHelpTips(page)
  const scroller = page?.querySelector<HTMLElement>(".settings-sections") || page?.closest("main")
  let frame = 0
  const mark = (id: string) =>
    page?.querySelectorAll<HTMLElement>("[data-settings-section]").forEach((button) => {
      if (button.dataset.settingsSection === id) button.setAttribute("aria-current", "location")
      else button.removeAttribute("aria-current")
    })
  const track = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const sections = [...(page?.querySelectorAll<HTMLElement>(".settings-section") || [])]
      if (!sections.length) return
      if (
        scroller &&
        scroller.scrollHeight > scroller.clientHeight + 24 &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 24
      ) {
        const last = sections.at(-1)
        if (last) mark(last.id)
        return
      }
      const edge = (scroller?.getBoundingClientRect().top || 0) + 96
      const current =
        sections.filter((section) => section.getBoundingClientRect().top <= edge).at(-1) || sections[0]
      if (current) mark(current.id)
    })
  }
  const jump = (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-settings-section]")
    if (!button || !page?.contains(button)) return
    const heading = document.getElementById(`${button.dataset.settingsSection}-title`)
    heading?.scrollIntoView({block: "start"})
    heading?.focus({preventScroll: true})
    const section = button.dataset.settingsSection
    if (section) mark(section)
  }
  page?.addEventListener("click", jump)
  scroller?.addEventListener("scroll", track, {passive: true})
  window.addEventListener(
    "pagehide",
    () => {
      page?.removeEventListener("click", jump)
      scroller?.removeEventListener("scroll", track)
      cancelAnimationFrame(frame)
    },
    {once: true},
  )
}
