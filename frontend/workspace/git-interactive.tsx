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
  container.querySelector<HTMLElement>(`#git-${section}`)?.scrollIntoView({block: "start"})
}
