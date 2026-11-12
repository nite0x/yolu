import { test } from "node:test"
import assert from "node:assert/strict"
import { conversationTree } from "../frontend/workspace/conversation-tree"
import type { Session } from "../frontend/workspace/sessions"

const options = { tasks: [{ id: "task", name: "Login", environment_id: "local" }], scope: {kind: "all"}, limits: {}, collapsed: [], filtered: false }
const sessions = (count: number): Session[] => Array.from({length: count}, (_, index) => ({id: `session-${index}`, name: `Conversation ${index}`, cwd: "/work/login", task_ids: ["task"]}))

test("workspace previews retain recent, selected, pinned, unread, and active conversations", () => {
  const items = sessions(12)
  items[4].chat_status = "running"
  items[5].chat_status = "waiting"
  items[7].unread = true
  items[9].pinned = true
  const rows = conversationTree(items, {...options, selected: "session-11"})
  assert.deepEqual(rows.filter(row => row.kind === "session").map(row => row.session.id), ["session-0", "session-1", "session-2", "session-4", "session-5", "session-7", "session-9", "session-11"])
  assert.equal(rows[0].group.name, "Login")
  assert.equal(rows[0].group.total, 12)
  assert.equal(rows[0].group.showContext, false)
  assert.equal(rows.at(-1)?.kind, "more")
})

test("explicit links group external directories and leave unlinked conversations outside workspaces", () => {
  const items = sessions(2)
  items[0].cwd = "/external"
  items[1].task_ids = []
  items[1].context = { tasks: [{id: "task", name: "Login"}], kind: "Worktree", cwd: items[1].cwd, project: undefined, projectID: undefined, branch: undefined }
  const rows = conversationTree(items, options)
  assert.deepEqual(rows.filter(row => row.kind === "group").map(row => row.group.name), ["Login", "其他对话"])
  assert.deepEqual(rows.filter(row => row.kind === "session").map(row => row.group.taskID), ["task", undefined])
})

test("identical workspace and conversation IDs in different environments remain separate", () => {
  const local = sessions(1)[0]
  const remote = {...local, environment_id: "remote"}
  const rows = conversationTree([local, remote], {...options, tasks: [...options.tasks, {id: "task", name: "Remote login", environment_id: "remote"}]})
  assert.deepEqual(rows.filter(row => row.kind === "group").map(row => row.group.name), ["Login", "Remote login"])
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length)
})

test("shared sessions appear under each linked workspace with distinct row identities", () => {
  const item = {...sessions(1)[0], task_ids: ["task", "other", "task"]}
  const rows = conversationTree([item], {...options, tasks: [...options.tasks, {id: "other", name: "Shared", environment_id: "local"}]})
  assert.equal(rows.filter(row => row.kind === "session").length, 2)
  assert.equal(new Set(rows.map(row => row.key)).size, rows.length)
})

test("workspace expansion, collapse, selection reveal, and search use the same membership", () => {
  const items = sessions(30)
  const key = JSON.stringify(["local", "task"])
  const expanded = conversationTree(items, {...options, limits: {[key]: 23}})
  assert.equal(expanded.filter(row => row.kind === "session").length, 23)
  assert.equal(conversationTree(items, {...options, collapsed: [key]}).length, 1)
  const revealed = conversationTree(items, {...options, collapsed: [key], selected: "session-29", reveal: "session-29"})
  assert(revealed.some(row => row.kind === "session" && row.session.id === "session-29"))
  const filtered = conversationTree(items, {...options, filtered: true})
  assert.equal(filtered.filter(row => row.kind === "session").length, 30)
  assert(!filtered.some(row => row.kind === "more"))
})

test("workspace rows show directory context when their conversations span different project directories", () => {
  const items = sessions(2)
  items[1].cwd = "/work/backend"
  assert.equal(conversationTree(items, options)[0].group.showContext, true)
})
