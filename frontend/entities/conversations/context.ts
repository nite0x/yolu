import {uiText} from "@/shared/i18n"
import {conversationPathKey} from "@/shared/lib/workspace-identity"

export interface ConversationOverview {
  projects: {id: string; name: string; path: string; worktrees: {path: string; branch?: string; detached?: boolean; missing?: boolean}[]}[]
}

export function conversationContext(cwd: string, overview?: ConversationOverview, primaryProjectID?: string) {
  const matches = (path: string) => !!cwd && conversationPathKey(path) === conversationPathKey(cwd)
  const project = overview?.projects.find(p => p.id === primaryProjectID)
    || overview?.projects.find(p => matches(p.path) || p.worktrees.some(t => matches(t.path)))
  const tree = project?.worktrees.find(t => matches(t.path))
  const kind = project ? matches(project.path) ? uiText("项目目录") : "Worktree" : uiText("工作目录")
  return {project: project?.name, projectID: project?.id, branch: tree?.detached ? "detached HEAD" : tree?.branch, kind, cwd}
}

// The host gives general conversations an application-owned sandbox directory.
export function isGeneralConversationDirectory(path?: string) {
  return /(?:^|[\\/])conversation-directories[\\/][0-9a-f]{64}$/i.test(path || "")
}
