import {uiText} from "@/shared/i18n"
import type {Session} from "@/entities/conversations/catalog"
import type {ShortcutIcon} from "@/shared/ui/resource-icons"
import {conversationStatusMatches} from "@/entities/conversations/status"
import {conversationEnvironmentKey, conversationPathKey} from "@/shared/lib/workspace-identity"

type CollectionKind = "project" | "independent" | "cloud" | "yolu-assistant" | "recent"
export const projectConversationPreview = 5
export const projectConversationStep = 5
export const recentConversationPreview = 10

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
  waiting?: boolean
  failed?: boolean
  unread?: boolean
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
  showRecent?: boolean
  showYoluAssistant?: boolean
  navigator?: {
    directories: NavigatorDirectory[]
    projectOrder?: string[]
  }
}

const sessionIdentity = (session: Session) => session.browser_key || conversationEnvironmentKey(session.environment_id || "local", session.id)
const projectGroupKey = (directory: NavigatorDirectory) => JSON.stringify([directory.environment, "project", directory.projectID || conversationPathKey(directory.cwd)])

export function conversationProjectOrder(directories: NavigatorDirectory[], saved: string[] = []) {
  const isYolu = (directory: NavigatorDirectory) => (directory.projectName || directory.name).trim().toLowerCase() === "yolu"
  const defaults = [...directories.filter(isYolu), ...directories.filter(directory => !isYolu(directory))]
  return [...new Set([...saved, ...defaults.map(projectGroupKey)])]
}

function projectBadgeAppearance(directory: NavigatorDirectory): ShortcutIcon {
  if (directory.appearance?.icon && directory.appearance.icon !== "auto") {
    return {icon: directory.appearance.icon, color: "theme"}
  }
  return {icon: "folder", color: "theme"}
}

export function conversationTree(sessions: Session[], options: TreeOptions): ConversationTreeRow[] {
  if (options.recent) {
    const group = {key: "recent", name: "", environment: "", showContext: false, collapsed: false, total: sessions.length, shown: sessions.length}
    return sessions.map(session => ({key: JSON.stringify(["recent", sessionIdentity(session)]), group, kind: "session", session, projectName: session.context?.project}))
  }
  const groups = new Map<string, { group: ConversationGroup; sessions: Session[] }>()
  const filed = new Set<string>()
  const cloud = sessions.filter(session => session.provider === "codex-cloud")
  for (const session of cloud) filed.add(sessionIdentity(session))
  if (options.navigator) {
    const assistants = sessions.filter(session => session.yolu_assistant && !filed.has(sessionIdentity(session)))
    if (assistants.length || options.showYoluAssistant) {
      const key = "yolu-assistant"
      for (const session of assistants) filed.add(sessionIdentity(session))
      groups.set(key, {group: {
        key, name: uiText("Yolu 助手"), collection: "yolu-assistant", environment: "local",
        containsSelection: assistants.some(session => sessionIdentity(session) === options.selected),
        collapsed: options.collapsed.includes(key), total: 0, shown: 0, showContext: false,
      }, sessions: assistants})
    }
  }
  const directories = options.navigator?.directories || []
  const projectGroups = new Map<string, { group: ConversationGroup; sessions: Session[] }>()
  let selectedInProject = false
  for (const directory of directories) {
    const {cwd, environment, projectID, projectName, projectRoot} = directory
    const path = conversationPathKey(cwd)
    const matchesDirectory = (session: Session) => {
      if (session.provider === "codex-cloud" || session.yolu_assistant) return false
      if ((session.environment_id || "local") !== environment) return false
      const owner = session.primary_project_id || session.terminal?.projectID || session.context?.projectID
      return owner ? owner === projectID && (!!projectRoot || conversationPathKey(session.cwd) === path) : conversationPathKey(session.cwd) === path
    }
    const matching = sessions.filter(session => !filed.has(sessionIdentity(session)) && matchesDirectory(session))
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    for (const session of matching) filed.add(sessionIdentity(session))
    if (options.selectedSession && matchesDirectory(options.selectedSession)) selectedInProject = true
    if (!matching.length) continue
    const key = projectGroupKey(directory)
    const name = projectName || directory.name
    const href = projectID ? `#/projects/${encodeURIComponent(projectID)}` : undefined
    projectGroups.set(key, {group: {key, name, environment, environmentName:directory.environmentName, collapsed:options.collapsed.includes(key), total:0, shown:0, showContext:false,
      collection:"project", projectID, projectPath:cwd, href, icon:projectBadgeAppearance(directory), identity:projectID ? `project:${projectID}` : directory.key, iconName:directory.name,
      containsSelection:options.selectedSession ? matchesDirectory(options.selectedSession) : matching.some(session => sessionIdentity(session) === options.selected)}, sessions:matching})
  }
  if (options.navigator) {
    for (const key of conversationProjectOrder(directories, options.navigator.projectOrder)) {
      const project = projectGroups.get(key)
      if (project) groups.set(key, project)
    }
    const independent = sessions.filter(session => !filed.has(sessionIdentity(session)))
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    if (independent.length) {
      const key = "independent"
      const name = uiText("未绑定项目")
      groups.set(key, {group:{key, name, collection:"independent", environment:"", icon:{icon:"folder", color:"slate"}, identity:key, iconName:name,
        containsSelection:options.selectedSession ? options.selectedSession.provider !== "codex-cloud" && !options.selectedSession.yolu_assistant && !selectedInProject : independent.some(session => sessionIdentity(session) === options.selected),
        collapsed:options.collapsed.includes(key), total:0, shown:0, showContext:true}, sessions:independent})
    }
    if (cloud.length) {
      const key = "codex-cloud"
      groups.set(key, { group: {
        key, name: "Codex Cloud", collection: "cloud", environment: "",
        containsSelection: cloud.some(session => sessionIdentity(session) === options.selected),
        collapsed: options.collapsed.includes(key), total: 0, shown: 0, showContext: false,
      }, sessions: cloud })
    }
    if (options.showRecent && !options.filtered && sessions.length) {
      const key = "recent"
      const recentSessions = [...sessions].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      groups.set(key, {group: {
        key, name: uiText("最近"), collection: "recent", environment: "",
        containsSelection: recentSessions.some(session => sessionIdentity(session) === options.selected),
        collapsed: options.collapsed.includes(key), total: 0, shown: 0, showContext: false,
      }, sessions: recentSessions})
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
    if (cloud.length) {
      const key = "codex-cloud"
      groups.set(key, { group: {
        key, name: "Codex Cloud", collection: "cloud", environment: "",
        containsSelection: cloud.some(session => sessionIdentity(session) === options.selected),
        collapsed: options.collapsed.includes(key), total: 0, shown: 0, showContext: false,
      }, sessions: cloud })
    }
  }
  const rows: ConversationTreeRow[] = []
  for (const { group, sessions } of groups.values()) {
    const isRecent = group.collection === "recent"
    group.running = sessions.some(session => conversationStatusMatches(session, "running"))
    group.waiting = sessions.some(session => conversationStatusMatches(session, "waiting"))
    group.failed = sessions.some(session => session.chat_status === "failed" || !!session.error)
    group.unread = sessions.some(session => conversationStatusMatches(session, "unread"))
    if (!isRecent && options.reveal && sessions.some(session => sessionIdentity(session) === options.reveal)) group.collapsed = false
    const basePreview = isRecent ? recentConversationPreview : projectConversationPreview
    const limit = options.limits[group.key] || basePreview
    const preview = new Set(isRecent ? [] : sessions.filter(session => {
      const identity = sessionIdentity(session)
      return identity === options.selected || identity === options.reveal || conversationStatusMatches(session, "running")
    }))
    const previewSize = Math.max(basePreview, preview.size)
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
    group.showContext = group.collection === "independent" || (!isRecent && new Set(sessions.map(session => conversationPathKey(session.cwd))).size > 1)
    rows.push({ key: JSON.stringify(["group", group.key]), kind: "group", group })
    if (group.collapsed) continue
    for (const session of visible) rows.push({ key: JSON.stringify(["session", group.key, sessionIdentity(session)]), kind: "session", group, session, projectName: isRecent ? session.context?.project : undefined })
    const showLess = !showAll && visible.length > previewSize
    if (visible.length < sessions.length || showLess) rows.push({ key: JSON.stringify(["more", group.key]), kind: "more", group, showLess })
  }
  return rows
}
