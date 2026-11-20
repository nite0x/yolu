import { uiText } from "../i18n"
import type { Session } from "./sessions"
import { conversationEnvironmentKey, conversationPathKey } from "./conversation-runtime"

export interface ConversationGroup {
  key: string
  name: string
  environment: string
  environmentName?: string
  workspaceID?: string
  collapsed: boolean
  total: number
  shown: number
  showContext: boolean
}
export type ConversationTreeRow = { key: string; group: ConversationGroup } & (
  { kind: "group" } | { kind: "session"; session: Session } | { kind: "more" }
)
interface TreeOptions {
  workspaces: { id: string; name: string; environment_id?: string }[]
  scope: { kind: string; id?: string }
  selected?: string | null
  reveal?: string | null
  limits: Record<string, number>
  collapsed: string[]
  filtered: boolean
}

// Shared directories do not establish membership. A session can be explicitly
// linked to several workspaces while keeping one environment-local runtime.
export function conversationTree(sessions: Session[], options: TreeOptions): ConversationTreeRow[] {
  const workspaces = new Map(options.workspaces.map(workspace => [JSON.stringify([workspace.environment_id || "local", workspace.id]), workspace]))
  const groups = new Map<string, { group: ConversationGroup; sessions: Session[] }>()
  for (const session of sessions) {
    const environment = session.environment_id || "local"
    let workspaceIDs = session.workspace_ids || []
    if (options.scope.kind === "workspace" && options.scope.id) workspaceIDs = [options.scope.id]
    else if (session.terminal) workspaceIDs = session.terminal.workspaceID ? [session.terminal.workspaceID] : []
    for (const workspaceID of workspaceIDs.length ? new Set(workspaceIDs) : [undefined]) {
      const key = JSON.stringify([environment, workspaceID || ""])
      let entry = groups.get(key)
      if (!entry) {
        const workspace = workspaceID ? workspaces.get(key) || session.context?.workspaces.find(workspace => workspace.id === workspaceID) : undefined
        entry = {
          group: {
            key, name: workspace?.name || workspaceID || uiText("其他对话"),
            environment, environmentName: session.environment_name, workspaceID,
            collapsed: options.collapsed.includes(key), total: 0, shown: 0, showContext: false,
          },
          sessions: [],
        }
        groups.set(key, entry)
      }
      entry.sessions.push(session)
    }
  }
  const rows: ConversationTreeRow[] = []
  for (const { group, sessions } of groups.values()) {
    const identity = (session: Session) => session.browser_key || conversationEnvironmentKey(session.environment_id || "local", session.id)
    if (options.filtered || options.reveal && sessions.some(session => identity(session) === options.reveal)) group.collapsed = false
    const limit = options.limits[group.key] || 3
    const visible = sessions.filter((session, index) => options.filtered || index < limit || session.pinned || session.unread || identity(session) === options.selected || ["starting", "running", "waiting", "stopping", "handoff"].includes(session.chat_status || ""))
    group.total = sessions.length
    group.shown = visible.length
    group.showContext = new Set(sessions.map(session => conversationPathKey(session.cwd))).size > 1
    rows.push({ key: JSON.stringify(["group", group.key]), kind: "group", group })
    if (group.collapsed) continue
    for (const session of visible) rows.push({ key: JSON.stringify(["session", group.key, identity(session)]), kind: "session", group, session })
    if (visible.length < sessions.length) rows.push({ key: JSON.stringify(["more", group.key]), kind: "more", group })
  }
  return rows
}
