import { uiText } from "../i18n"
import type { Session } from "./sessions"
import type { ShortcutIcon } from "./shortcut-icons"
import { conversationEnvironmentKey, conversationPathKey } from "./conversation-runtime"

type CollectionKind = "project" | "independent"

export interface ConversationGroup {
  key: string
  name: string
  environment: string
  environmentName?: string
  href?: string
  icon?: ShortcutIcon
  identity?: string
  iconName?: string
  collection?: CollectionKind
  collapsed: boolean
  total: number
  shown: number
  showContext: boolean
}
export type ConversationTreeRow = { key: string; group: ConversationGroup } & (
  { kind: "section"; section: CollectionKind; divided: boolean } |
  { kind: "group" } | { kind: "session"; session: Session; projectName?: string } | { kind: "more" }
)
interface TreeOptions {
  selected?: string | null
  reveal?: string | null
  limits: Record<string, number>
  collapsed: string[]
  filtered: boolean
  recent?: boolean
  navigator?: {
    includeEmpty?: boolean
    directories: {cwd: string; key: string; environment: string; environmentName?: string; name: string; projectID?: string; projectName?: string; projectRoot?: boolean; appearance?: ShortcutIcon}[]
  }
}

const sessionIdentity = (session: Session) => session.browser_key || conversationEnvironmentKey(session.environment_id || "local", session.id)

export function conversationTree(sessions: Session[], options: TreeOptions): ConversationTreeRow[] {
  if (options.recent) {
    const group = {key: "recent", name: "", environment: "", showContext: false, collapsed: false, total: sessions.length, shown: sessions.length}
    return sessions.map(session => ({key: JSON.stringify(["recent", sessionIdentity(session)]), group, kind: "session", session, projectName: session.context?.project}))
  }
  const groups = new Map<string, { group: ConversationGroup; sessions: Session[] }>()
  const filed = new Set<string>()
  for (const directory of options.navigator?.directories || []) {
    const {cwd, environment, projectID, projectName, projectRoot} = directory
    const path = conversationPathKey(cwd)
    const matching = sessions.filter(session => {
      if ((session.environment_id || "local") !== environment || filed.has(sessionIdentity(session))) return false
      const owner = session.primary_project_id || session.terminal?.projectID || session.context?.projectID
      return owner ? owner === projectID && (!!projectRoot || conversationPathKey(session.cwd) === path) : conversationPathKey(session.cwd) === path
    })
    for (const session of matching) filed.add(sessionIdentity(session))
    if (!matching.length && (options.filtered || options.navigator?.includeEmpty === false)) continue
    const key = JSON.stringify([environment, "project", projectID || path])
    const name = projectName || directory.name
    const href = projectID ? `#/projects/${encodeURIComponent(projectID)}` : undefined
    groups.set(key, {group: {key, name, environment, environmentName:directory.environmentName, collapsed:options.collapsed.includes(key), total:0, shown:0, showContext:false,
      collection:"project", href, icon:directory.appearance, identity:projectID ? `project:${projectID}` : directory.key, iconName:directory.name}, sessions:matching})
  }
  if (options.navigator) {
    const independent = sessions.filter(session => !filed.has(sessionIdentity(session)))
    if (independent.length) {
      const key = "independent"
      groups.set(key, {group:{key, name:uiText("独立对话"), collection:"independent", environment:"", collapsed:false, total:0, shown:0, showContext:true}, sessions:independent})
    }
  } else {
    for (const session of sessions) {
      const environment = session.environment_id || "local"
      const projectID = session.primary_project_id || session.terminal?.projectID || session.context?.projectID
      const key = JSON.stringify(projectID ? [environment,"project",projectID] : [environment,""])
      let entry = groups.get(key)
      if (!entry) {
        entry = {group:{key,name:session.context?.project || uiText("其他对话"),environment,environmentName:session.environment_name,
          collapsed:options.collapsed.includes(key),total:0,shown:0,showContext:false},sessions:[]}
        groups.set(key,entry)
      }
      entry.sessions.push(session)
    }
  }
  const rows: ConversationTreeRow[] = []
  let previousCollection: CollectionKind | undefined
  for (const { group, sessions } of groups.values()) {
    if (group.collection && group.collection !== previousCollection) {
      rows.push({key: JSON.stringify(["section", group.collection]), group, kind: "section", section: group.collection, divided: !!previousCollection})
      previousCollection = group.collection
    }
    if (options.filtered || options.reveal && sessions.some(session => sessionIdentity(session) === options.reveal)) group.collapsed = false
    const limit = options.limits[group.key] || 3
    const visible = sessions.filter((session, index) => group.collection === "independent" || options.filtered || index < limit || session.pinned || session.unread || sessionIdentity(session) === options.selected || ["starting", "running", "waiting", "stopping", "handoff"].includes(session.chat_status || ""))
    group.total = sessions.length
    group.shown = visible.length
    group.showContext = group.collection === "independent" || new Set(sessions.map(session => conversationPathKey(session.cwd))).size > 1
    if (group.collection !== "independent") rows.push({ key: JSON.stringify(["group", group.key]), kind: "group", group })
    if (group.collapsed) continue
    for (const session of visible) rows.push({ key: JSON.stringify(["session", group.key, sessionIdentity(session)]), kind: "session", group, session })
    if (visible.length < sessions.length) rows.push({ key: JSON.stringify(["more", group.key]), kind: "more", group })
  }
  return rows
}
