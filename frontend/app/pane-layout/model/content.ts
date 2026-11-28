import { isPageSnapshot, type PageSnapshot } from "@/core/page-protocol"
import type { PaneContent } from "./types"

export type ResourcePaneContent = Extract<PaneContent, { type: "file" | "project" }>

export function resourceContent(snapshot: PageSnapshot): ResourcePaneContent | null {
  if (!isPageSnapshot(snapshot)) return null
  const environment = snapshot.environment || "local"
  if (/^\/projects\/[\w-]+(?:\/(?:git|worktrees))?(?:\?[^#]*)?$/.test(snapshot.route)) {
    return { type: "project", route: snapshot.route, environment, title: snapshot.title }
  }
  if (snapshot.route === "/files" && snapshot.file) {
    const {cwd, path, projectId, sessionId, bindingId, line, git, mode} = snapshot.file
    return { type: "file", cwd, path, projectId, sessionId, bindingId, line, git, mode, environment, title: snapshot.title }
  }
  return null
}

export function resourceSnapshot(content: PaneContent): PageSnapshot | null {
  if (content.type === "project") {
    return { route: content.route, environment: content.environment, title: content.title }
  }
  if (content.type === "file") {
    const { type: _type, environment, title, ...file } = content
    return { route: "/files", environment, title, file }
  }
  return null
}

export function resourceIdentity(snapshot: PageSnapshot): string {
  const content = resourceContent(snapshot)
  if (!content) return ""
  return content.type === "project"
    ? JSON.stringify(["project", content.environment, content.route])
    : JSON.stringify(["file", content.environment, content.sessionId || "", content.projectId || "", content.bindingId || "", content.cwd, content.path || "", content.mode || "all"])
}
