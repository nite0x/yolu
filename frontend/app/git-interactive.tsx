import { uiText } from "../i18n";
import { flushSync } from "react-dom"
import { createRoot, type Root } from "react-dom/client"
import { GitView } from "./git"
import type { GitOverview } from "./types"

interface GitMount { root: Root }
const mounts = new WeakMap<HTMLElement, GitMount>()

function getMount(container: HTMLElement): GitMount {
  const existing = mounts.get(container)
  if (existing) return existing
  const mounted = { root: createRoot(container) }
  mounts.set(container, mounted)
  return mounted
}

/** The legacy controller can read its native fields immediately after mounting. */
export function mountGitView(container: HTMLElement, overview: GitOverview) {
  const mounted = getMount(container)
  flushSync(() => mounted.root.render(<GitView overview={overview} />))
}

/** Loading and error states keep the same React owner; never write innerHTML. */
export function resetGitView(container: HTMLElement, message = uiText("正在读取分支与远端…")) {
  const mounted = getMount(container)
  flushSync(() => mounted.root.render(message ? <div className="git-loading" role="status">{message}</div> : null))
}

export function scrollToGitSection(container: HTMLElement, section: string) {
  const target = container.querySelector<HTMLElement>(`#git-${section}`)
  if (!target) return
  container.querySelectorAll(".git-section-navigation a").forEach(link => {
    if (link.getAttribute("href") === `#${target.id}`) link.setAttribute("aria-current", "location")
    else link.removeAttribute("aria-current")
  })
  target.scrollIntoView({block: "start"})
}
