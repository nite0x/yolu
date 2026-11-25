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

test("project previews prioritize active and selected sessions before filling available slots", () => {
  const items = [
    ...["first","second","third","hidden"].map(id => session(id,"app")),
    session("running","app",{chat_status:"running"}),session("unread","app",{unread:true}),session("pinned","app",{pinned:true}),session("selected","app"),
  ]
  const rows = conversationTree(items,setup({selected:"selected"}))
  assert.deepEqual(listed(rows).map(row => row.session.id), ["running","selected"])
  assert.equal(rows.find(row => row.kind === "more")?.group.total,8)
  assert.deepEqual(listed(conversationTree(items,setup())).map(row => row.session.id), ["first","running"])
  const active = [...items, session("starting","app",{chat_status:"starting"})]
  assert.deepEqual(listed(conversationTree(active,setup({selected:"selected"}))).map(row => row.session.id), ["running","selected","starting"])
})

test("grouping claims a session only once using its primary project across multiple bindings", () => {
  const items = [session("same","api",{cwd:"/repo/app",project_ids:["app","api"]}),session("outside",undefined)]
  const rows = conversationTree(items,setup())
  assert.deepEqual(listed(rows).map(row => [row.session.id,row.group.collection]), [["same","project"],["outside","independent"]])
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

test("unbound conversations are automatically grouped into one collapsible empty project group", () => {
  const items = [
    session("app", "app"),
    session("standalone-1", undefined, {updated_at: 30}),
    session("standalone-2", undefined, {updated_at: 20}),
    session("standalone-3", undefined, {updated_at: 10, chat_status: "running"}),
  ]
  const expanded = conversationTree(items, setup())
  const header = expanded.find(row => row.kind === "group" && row.group.collection === "independent")
  assert(header)
  assert.equal(header.group.key, "independent")
  assert.equal(header.group.href, undefined)
  assert.equal(header.group.total, 3)
  assert.equal(header.group.shown, 2)
  assert.deepEqual(listed(expanded).filter(row => row.group.collection === "independent").map(row => row.session.id), ["standalone-1", "standalone-3"])
  assert(expanded.some(row => row.kind === "more" && row.group.key === "independent"))

  const collapsed = conversationTree(items, setup({collapsed: ["independent"], selected: "standalone-2"}))
  const collapsedHeader = collapsed.find(row => row.kind === "group" && row.group.collection === "independent")
  assert(collapsedHeader)
  assert.equal(collapsedHeader.group.collapsed, true)
  assert.equal(collapsedHeader.group.containsSelection, true)
  assert.equal(collapsedHeader.group.running, true)
  assert.equal(listed(collapsed).some(row => row.group.collection === "independent"), false)

  const revealed = conversationTree(items, setup({collapsed: ["independent"], reveal: "standalone-2", selected: "standalone-2"}))
  assert.equal(listed(revealed).some(row => row.session.id === "standalone-2"), true)
})

test("projects receive distinct preset theme icons across filters without letter initials", () => {
  const directories = [
    {...directory("a"), name:"North Market"},
    {...directory("b"), name:"North Maps", appearance:{icon:"rocket", color:"theme"}},
    {...directory("c"), name:"North Mail"},
  ]
  const options = setup({navigator:{directories}})
  const badges = (items: Session[]) => conversationTree(items,options).filter(row => row.kind === "group").map(row => row.group.icon)
  const first = session("one","a")
  const second = session("two","b")
  const third = session("three","c")
  const [firstIcon, secondIcon, thirdIcon] = badges([first, second, third])
  assert(firstIcon && firstIcon.icon !== "auto")
  assert.equal(firstIcon.color, "theme")
  assert.equal(secondIcon?.icon, "rocket")
  assert(thirdIcon && thirdIcon.icon !== "auto")
  assert.equal(new Set([firstIcon.icon, secondIcon?.icon, thirdIcon.icon]).size, 3)
  assert.deepEqual(badges([first]), [firstIcon])
})
