import { uiText } from "../i18n";
import { mountFileBrowser } from "./file-browser"
import type { CleanupCandidate } from "./workspace-review"

interface Ports {
  document: Document
  environment: () => string
  request: <T>(path: string, options?: RequestInit & {environment?: string}) => Promise<T>
  mutation: (title: string, run: () => Promise<void>, error: HTMLElement, options?: {key?: string; project?: string; isCurrent?: () => boolean}) => Promise<void>
  toast: (message: string, error?: boolean) => void
  reviewMarkup: (items: CleanupCandidate[]) => string
}

export function createWorkspaceReviewController(ports: Ports) {
  const document = ports.document
  const window = document.defaultView!
  const node = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector(`#${id}`) as T
  const reviewDialog = node<HTMLDialogElement>("workspaceReviewDialog")
  const changesDialog = node<HTMLDialogElement>("changesDialog")
  let review: {id: string; environment: string; revision: number; items: CleanupCandidate[]} | undefined
  let reviewRevision = 0
  const showError = (id: string, error: unknown) => { node(id).textContent = error instanceof Error ? error.message : String(error); node(id).hidden = false }
  const reviewCurrent = (context: NonNullable<typeof review>) => review === context && reviewDialog.open

  function syncSelection() {
    node<HTMLButtonElement>("workspaceReviewClean").disabled = !reviewDialog.querySelector('input[data-cleanup-index]:checked')
  }
  async function loadReview() {
    const context = review
    if (!context) return
    const revision = ++context.revision
    node("workspaceReviewError").hidden = true
    node("workspaceReviewItems").textContent = uiText("正在检查当前项目和保留目录…")
    node<HTMLButtonElement>("workspaceReviewClean").disabled = true
    try {
      const result = await ports.request<{workspace: {name: string; state: string}; items: CleanupCandidate[]}>(`/api/workspaces/${encodeURIComponent(context.id)}/review`, {environment: context.environment})
      if (!reviewCurrent(context) || context.revision !== revision) return
      context.items = result.items
      node("workspaceReviewTitle").textContent = uiText("收尾检查 · ") + result.workspace.name
      node("workspaceReviewItems").innerHTML = ports.reviewMarkup(result.items)
      node<HTMLButtonElement>("workspaceReviewArchive").hidden = result.workspace.state === "archived"
      syncSelection()
    } catch (error) {
      if (reviewCurrent(context) && context.revision === revision) {node("workspaceReviewItems").textContent = uiText("检查未完成。"); showError("workspaceReviewError", error)}
    }
  }
  async function cleanSelected() {
    const context = review
    if (!context) return
    const selected = [...reviewDialog.querySelectorAll<HTMLInputElement>('input[data-cleanup-index]:checked')].map(input => context.items[Number(input.dataset.cleanupIndex)]).filter(item => item?.cleanable)
    if (!selected.length || !window.confirm(uiText("清理以下 {0} 个 Worktree 目录？\n\n{1}\n\n目录会被移除，分支和对话记录保留。", selected.length, selected.map(item => item.path + uiText("\n分支：") + item.branch).join("\n\n")))) return
    const failures: string[] = []
    const warnings: string[] = []
    let cleaned = 0
    await ports.mutation(uiText("正在清理所选 Worktree"), async () => {
      for (const item of selected) {
        try {
          const result = await ports.request<{context_warning?: string}>(`/api/workspaces/${encodeURIComponent(context.id)}/cleanup/${encodeURIComponent(item.project_id)}`, {environment: context.environment, method: "POST", body: JSON.stringify({path: item.path, fingerprint: item.fingerprint})})
          if (result.context_warning) warnings.push(item.path + "：" + result.context_warning)
          cleaned++
        } catch (error) { failures.push(item.path + "：" + (error instanceof Error ? error.message : String(error))) }
      }
      if (reviewCurrent(context)) await loadReview()
      ports.toast(uiText("已清理 {0} 个目录{1}", cleaned, failures.length ? uiText("，{0} 个未完成", failures.length) : uiText("，分支和对话记录保留")), !!failures.length || !!warnings.length)
      if (failures.length || warnings.length) throw new Error([...failures,...warnings].join("\n"))
    }, node("workspaceReviewError"), {key: `workspace:${context.id}`, isCurrent: () => reviewCurrent(context)})
    syncSelection()
  }
  async function archiveReview() {
    const context = review
    if (!context) return
    await ports.mutation(uiText("正在归档工作区"), async () => {
      await ports.request(`/api/workspaces/${encodeURIComponent(context.id)}/archive`, {environment: context.environment, method: "POST", body: JSON.stringify({archived: true})})
      if (reviewCurrent(context)) await loadReview()
    }, node("workspaceReviewError"), {key: `workspace:${context.id}`, isCurrent: () => reviewCurrent(context)})
    syncSelection()
  }
  node("workspaceReviewRefresh").addEventListener("click", () => void loadReview())
  node("workspaceReviewItems").addEventListener("change", syncSelection)
  node("workspaceReviewClean").addEventListener("click", () => void cleanSelected())
  node("workspaceReviewArchive").addEventListener("click", () => void archiveReview())
  reviewDialog.addEventListener("close", () => {review = undefined})
  changesDialog.addEventListener("close", () => mountFileBrowser(node("changesBrowser")))
  return {
    openReview(id: string) {review = {id, environment: ports.environment(), revision: ++reviewRevision, items: []}; if (!reviewDialog.open) reviewDialog.showModal(); void loadReview()},
    openChanges(project: string, path: string) {
      if (!changesDialog.open) changesDialog.showModal()
      mountFileBrowser(node("changesBrowser"))
      mountFileBrowser(node("changesBrowser"), { project, path, environment: ports.environment(), request: ports.request })
    },
  }
}
