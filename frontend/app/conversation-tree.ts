import { uiText } from "../i18n"
import type { Session } from "./sessions"
import { defaultShortcutIcon, presetShortcutIcons, type ShortcutIcon } from "./shortcut-icons"
import { conversationStatusMatches } from "./conversation-list"
import { conversationEnvironmentKey, conversationPathKey } from "./conversation-runtime"

type CollectionKind = "project" | "independent" | "cloud"
export const projectConversationPreview = 2
export const projectConversationStep = 5

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
  projectID?: string
  projectPath?: string
  containsSelection?: boolean
  running?: boolean
  collapsed: boolean
  total: number
  shown: number
  showContext: boolean
}
export type ConversationTreeRow = { key: string; group: ConversationGroup } & (
  { kind: "group" } | { kind: "session"; session: Session; projectName?: string } | { kind: "more"; showLess: boolean }
)
type NavigatorDirectory = {cwd: string; key: string; environment: string; environmentName?: string; name: string; projectID?: string; projectName?: string; projectRoot?: boolean; appearance?: ShortcutIcon}
interface TreeOptions {
  selected?: string | null
  selectedSession?: Session
  reveal?: string | null
  limits: Record<string, number>
  collapsed: string[]
  filtered: boolean
  recent?: boolean
  navigator?: {
    directories: NavigatorDirectory[]
  }
}

const sessionIdentity = (session: Session) => session.browser_key || conversationEnvironmentKey(session.environment_id || "local", session.id)

function distinguishProjectBadges(directories: NavigatorDirectory[]) {
  const appearances = new Map<NavigatorDirectory, ShortcutIcon>()
  const used = new Set<string>()
  for (const directory of directories) {
    if (directory.appearance?.icon && directory.appearance.icon !== "auto") used.add(directory.appearance.icon)
  }
  const defaults = directories.filter(directory => !directory.appearance?.icon || directory.appearance.icon === "auto")
    .sort((a, b) => a.key.localeCompare(b.key))
  for (const directory of defaults) {
    const identity = directory.projectID ? `project:${directory.projectID}` : directory.key
    const preferred = defaultShortcutIcon(identity).icon
    let chosen = preferred
    if (used.has(chosen)) {
      const start = Math.max(0, presetShortcutIcons.indexOf(preferred as typeof presetShortcutIcons[number]))
      for (let offset = 1; offset < presetShortcutIcons.length; offset++) {
        const candidate = presetShortcutIcons[(start + offset) % presetShortcutIcons.length]
        if (!used.has(candidate)) { chosen = candidate; break }
      }
    }
    used.add(chosen)
    appearances.set(directory, {icon: chosen, color: "theme"})
  }
  return appearances
}

export function conversationTree(sessions: Session[], options: TreeOptions): ConversationTreeRow[] {
  if (options.recent) {
    const group = {key: "recent", name: "", environment: "", showContext: false, collapsed: false, total: sessions.length, shown: sessions.length}
    return sessions.map(session => ({key: JSON.stringify(["recent", sessionIdentity(session)]), group, kind: "session", session, projectName: session.context?.project}))
  }
  const groups = new Map<string, { group: ConversationGroup; sessions: Session[] }>()
  const filed = new Set<string>()
  const cloud = sessions.filter(session => session.provider === "codex-cloud")
  if (cloud.length) {
    const key = "codex-cloud"
    for (const session of cloud) filed.add(sessionIdentity(session))
    groups.set(key, { group: {
      key, name: "Codex Cloud", collection: "cloud", environment: "",
      containsSelection: cloud.some(session => sessionIdentity(session) === options.selected),
      collapsed: options.collapsed.includes(key), total: 0, shown: 0, showContext: false,
    }, sessions: cloud })
  }
  const directories = options.navigator?.directories || []
  const appearances = distinguishProjectBadges(directories)
  let selectedInProject = false
  for (const directory of directories) {
    const {cwd, environment, projectID, projectName, projectRoot} = directory
    const path = conversationPathKey(cwd)
    const matchesDirectory = (session: Session) => {
      if (session.provider === "codex-cloud") return false
      if ((session.environment_id || "local") !== environment) return false
      const owner = session.primary_project_id || session.terminal?.projectID || session.context?.projectID
      return owner ? owner === projectID && (!!projectRoot || conversationPathKey(session.cwd) === path) : conversationPathKey(session.cwd) === path
    }
    const matching = sessions.filter(session => !filed.has(sessionIdentity(session)) && matchesDirectory(session))
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    for (const session of matching) filed.add(sessionIdentity(session))
    if (options.selectedSession && matchesDirectory(options.selectedSession)) selectedInProject = true
    if (!matching.length) continue
    const key = JSON.stringify([environment, "project", projectID || path])
    const name = projectName || directory.name
    const href = projectID ? `#/projects/${encodeURIComponent(projectID)}` : undefined
    groups.set(key, {group: {key, name, environment, environmentName:directory.environmentName, collapsed:options.collapsed.includes(key), total:0, shown:0, showContext:false,
      collection:"project", projectID, projectPath:cwd, href, icon:appearances.get(directory) || directory.appearance, identity:projectID ? `project:${projectID}` : directory.key, iconName:directory.name,
      containsSelection:options.selectedSession ? matchesDirectory(options.selectedSession) : matching.some(session => sessionIdentity(session) === options.selected)}, sessions:matching})
  }
  if (options.navigator) {
    const independent = sessions.filter(session => !filed.has(sessionIdentity(session)))
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    if (independent.length) {
      const key = "independent"
      const name = uiText("未绑定项目")
      groups.set(key, {group:{key, name, collection:"independent", environment:"", icon:{icon:"folder", color:"slate"}, identity:key, iconName:name,
        containsSelection:options.selectedSession ? options.selectedSession.provider !== "codex-cloud" && !selectedInProject : independent.some(session => sessionIdentity(session) === options.selected),
        collapsed:options.collapsed.includes(key), total:0, shown:0, showContext:true}, sessions:independent})
    }
  } else {
    for (const session of sessions) {
      if (filed.has(sessionIdentity(session))) continue
      const environment = session.environment_id || "local"
      const projectID = session.primary_project_id || session.terminal?.projectID || session.context?.projectID
      const key = projectID ? JSON.stringify([environment,"project",projectID]) : "independent"
      let entry = groups.get(key)
      if (!entry) {
        entry = {group:{key,name:projectID ? (session.context?.project || uiText("未绑定项目")) : uiText("未绑定项目"),environment:projectID ? environment : "",environmentName:projectID ? session.environment_name : undefined,
          collapsed:options.collapsed.includes(key),total:0,shown:0,showContext:!projectID},sessions:[]}
        groups.set(key,entry)
      }
      entry.sessions.push(session)
    }
  }
  const rows: ConversationTreeRow[] = []
  for (const { group, sessions } of groups.values()) {
    group.running = sessions.some(session => conversationStatusMatches(session, "running"))
    if (options.reveal && sessions.some(session => sessionIdentity(session) === options.reveal)) group.collapsed = false
    const limit = options.limits[group.key] || projectConversationPreview
    const preview = new Set(sessions.filter(session => {
      const identity = sessionIdentity(session)
      return identity === options.selected || identity === options.reveal || conversationStatusMatches(session, "running")
    }))
    const previewSize = Math.max(projectConversationPreview, preview.size)
    const showAll = options.filtered
    if (!showAll) {
      for (const session of sessions) {
        if (preview.size >= limit) break
        preview.add(session)
      }
    }
    const visible = showAll ? sessions : sessions.filter(session => preview.has(session))
    group.total = sessions.length
    group.shown = visible.length
    group.showContext = group.collection === "independent" || new Set(sessions.map(session => conversationPathKey(session.cwd))).size > 1
    rows.push({ key: JSON.stringify(["group", group.key]), kind: "group", group })
    if (group.collapsed) continue
    for (const session of visible) rows.push({ key: JSON.stringify(["session", group.key, sessionIdentity(session)]), kind: "session", group, session })
    const showLess = !showAll && visible.length > previewSize
    if (visible.length < sessions.length || showLess) rows.push({ key: JSON.stringify(["more", group.key]), kind: "more", group, showLess })
  }
  return rows
}
