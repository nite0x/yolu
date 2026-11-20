import { uiText } from "../i18n";
import type { Workspace } from "./types"

export type WorkspaceFilter = "all" | "issues" | "dirty" | "push" | "conflicts"
export function memberSignals(m: Workspace["members"][number]) {
  const t = m.worktree
  const issues = m.state !== "ready" || !!(m.error || t?.missing || t?.error || t?.prunable || t?.bare)
  return {
    issues,
    dirty: (t?.dirty || 0) > 0,
    push: (t?.sync_ahead || 0) > 0,
    conflicts: !!(t?.conflicts?.length || t?.operation),
    checking: !issues && !t?.status_updated_at,
  }
}
export function workspaceSignals(workspace: Workspace) {
  const values = workspace.members.map(memberSignals)
  return {issues: values.filter(v => v.issues).length, dirty: values.filter(v => v.dirty).length, push: values.filter(v => v.push).length, conflicts: values.filter(v => v.conflicts).length, checking: values.filter(v => v.checking).length}
}
export function workspaceMatches(workspace: Workspace, filter: WorkspaceFilter) {
  return filter === "all" || (filter === "issues" && workspace.connected === false) || workspaceSignals(workspace)[filter] > 0
}
export const workspaceFilterLabels: Record<WorkspaceFilter, string> = {all: uiText("全部项目"), issues: uiText("目录异常"), dirty: uiText("有改动"), push: uiText("待推送"), conflicts: uiText("Git 操作待处理")}
