import {test} from "node:test"
import assert from "node:assert/strict"
import {conversationTree} from "../frontend/app/conversation-tree"
import type {Session} from "../frontend/app/sessions"

const directory = (projectID: string, environment = "local") => ({
  key:JSON.stringify([environment,projectID]), cwd:"/repo/" + projectID, environment,
  environmentName:environment, name:projectID, projectID, projectRoot:true,
})
const session = (id: string, primary_project_id?:string, extra:Partial<Session> = {}): Session => ({
  id, name:id, cwd:primary_project_id ? "/repo/" + primary_project_id : "/temp/independent",
  primary_project_id, ...extra,
})
const setup = (overrides:Partial<Parameters<typeof conversationTree>[1]> = {}) => ({
  navigator:{directories:[directory("app"),directory("api")]}, limits:{}, collapsed:[], filtered:false, ...overrides,
})
const listed = (rows:ReturnType<typeof conversationTree>) => rows.flatMap(row => row.kind === "session" ? [row] : [])

test("project previews include active, unread, pinned and selected sessions beyond the normal limit", () => {
  const items = [
    ...["first","second","third","hidden"].map(id => session(id,"app")),
    session("running","app",{chat_status:"running"}),session("unread","app",{unread:true}),session("pinned","app",{pinned:true}),session("selected","app"),
  ]
  const rows = conversationTree(items,setup({selected:"selected"}))
  assert.deepEqual(listed(rows).map(row => row.session.id), ["first","second","third","running","unread","pinned","selected"])
  assert.equal(rows.find(row => row.kind === "more")?.group.total,8)
})

test("grouping claims a session only once using its primary project across multiple bindings", () => {
  const items = [session("same","api",{cwd:"/repo/app",project_ids:["app","api"]}),session("outside",undefined)]
  const rows = conversationTree(items,setup())
  assert.deepEqual(listed(rows).map(row => [row.session.id,row.group.collection,row.group.name]), [["same","project","api"],["outside","independent","独立对话"]])
})

test("identical project and session identifiers in separate environments remain independent", () => {
  const rows = conversationTree([session("one","app"),session("one","app",{environment_id:"wsl"})], setup({navigator:{directories:[directory("app"),directory("app","wsl")]}}))
  assert.deepEqual(listed(rows).map(row => row.group.environment),["local","wsl"])
  assert.notEqual(listed(rows)[0].key,listed(rows)[1].key)
})

test("older imported sessions appear with their inferred repository and worktree", () => {
  const items = [session("imported",undefined,{cwd:"/worktrees/branch",context:{project:"app",projectID:"app",branch:"feature/ui",kind:"Worktree",cwd:"/worktrees/branch"}})]
  assert.equal(listed(conversationTree(items,setup()))[0]?.group.href,"#/projects/app")
})

test("project groups reveal selected conversations and honor limits, collapse and search", () => {
  const items = ["a","b","c","d","e"].map(id => session(id,"app"))
  const key = conversationTree(items,setup()).find(row => row.kind === "group")!.group.key
  assert.equal(listed(conversationTree(items,setup({collapsed:[key]}))).length,0)
  assert(listed(conversationTree(items,setup({collapsed:[key],reveal:"e",selected:"e"}))).some(row => row.session.id === "e"))
  assert.equal(listed(conversationTree(items,setup({limits:{[key]:4}}))).length,4)
  assert.equal(listed(conversationTree(items,setup({filtered:true}))).length,5)
  const filtered = conversationTree(items,setup({collapsed:[key],filtered:true,selectedSession:session("outside the results","app")}))
  assert.equal(listed(filtered).length,0)
  assert.equal(filtered.find(row => row.kind === "group")?.group.containsSelection,true)
})

test("grouping omits empty projects and recent mode uses registered project name", () => {
  const item = session("existing","app",{context:{project:"Application",projectID:"app",cwd:"/repo/app",kind:"Project",branch:"main"}})
  const grouped = conversationTree([item],setup())
  assert(!grouped.some(row => row.kind === "group" && row.group.name === "api"))
  const recent = listed(conversationTree([item],setup({recent:true})))
  assert.equal(recent[0].projectName,"Application")
})
