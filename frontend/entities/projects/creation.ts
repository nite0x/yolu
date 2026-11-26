import type {Project} from "./model"
import {conversationPathKey} from "@/shared/lib/workspace-identity"

export function isMainCreationPath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  return !!path && !/^\/(?:private\/)?(?:tmp|var\/(?:tmp|folders))(?:\/|$)/i.test(normalized)
    && !/(?:^|\/)(?:\.worktrees?|worktrees?|\.codex\/worktrees)(?:\/|$)/i.test(normalized)
}

// Creation starts at project roots. Existing readers and project tools retain
// their full directory inventory, including linked and detached worktrees.
export function mainCreationProjects(projects: Project[]) {
  return projects.filter(project => {
    if (project.error || !isMainCreationPath(project.path)) return false
    const key = conversationPathKey(project.path)
    const tree = project.worktrees?.find(tree => conversationPathKey(tree.path) === key)
    if (tree && (tree.bare || tree.missing || tree.prunable || tree.error || tree.detached || !tree.branch)) return false
    // Git's porcelain inventory always lists the main checkout first, even
    // when a linked checkout was separately registered as a project.
    return !project.worktrees?.length || conversationPathKey(project.worktrees[0].path) === key
  })
}
