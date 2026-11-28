import { test } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { patchConversationList } from "../frontend/features/conversations/list/list"
import { conversationTree } from "../frontend/features/conversations/list/tree"
import { ConversationList, ConversationScopes } from "../frontend/features/conversations/list/browser"
import type { Session } from "../frontend/entities/conversations/catalog"
import { uiText } from "../frontend/shared/i18n/index"

test("scope options group sources and shorten directories while preserving full paths and selection", () => {
  const path = "D:\\Projects\\Yolu"
  const scopes = [
    {kind: "all", name: "All conversations"},
    {kind: "project", id: "project", environment: "remote", environmentName: "Remote", name: "Yolu"},
    {kind: "directory", cwd: path, environment: "local", name: path},
  ]
  const dom = new JSDOM(renderToStaticMarkup(createElement(ConversationScopes, {scopes, selected: {kind: "directory", cwd: "d:/projects/yolu/", environment: "local"}})))
  assert.deepEqual([...dom.window.document.querySelectorAll('.session-scope-group h3')].map(element => element.textContent), [uiText('项目'), uiText('工作目录')])
  const selected = dom.window.document.querySelector('[aria-current="true"]')!
  assert.equal(selected.getAttribute('title'), path)
  assert.equal(selected.querySelector('.session-scope-option-title')?.textContent, 'Yolu')
  assert.equal(selected.querySelector('.session-scope-option-context')?.textContent, 'D:/Projects')
  assert.equal(JSON.parse(selected.getAttribute('data-conversation-scope')!).cwd, path)
  assert.match(dom.window.document.querySelectorAll('.session-scope-group')[0].textContent!, /Remote/)
  dom.window.close()
})

test("conversation statuses use inline accessible icons and titles preserve their full hover text", () => {
  const name = "A long conversation title that should stay on a single line with an ellipsis"
  const states = ["starting", "running", "waiting", "stopping", "handoff", "failed", "interrupted", "unknown", ""]
  const sessions: Session[] = states.map((state, index) => ({id: String(index), name, cwd: "/repo", chat_status: state, unread: true, updated_at: 1794520000}))
  sessions.push({id: "terminal", name, cwd: "/repo", terminal: {workspaceID: "workspace", attached: true}})
  const dom = new JSDOM(renderToStaticMarkup(createElement(ConversationList, {sessions, showDirectory: false})))
  for (const row of dom.window.document.querySelectorAll(".session-browser-item")) {
    const title = row.querySelector(".session-browser-item-title")!
    const status = row.querySelector<HTMLElement>(".session-browser-item-status")!
    assert.equal(title.getAttribute("title"), name)
    assert.equal(title.textContent, name)
    assert.equal(status.parentElement, row.querySelector(".session-browser-item-trailing"))
    assert.equal(row.querySelector("time")?.parentElement?.className, "session-browser-item-trailing")
    assert.equal(row.querySelector("time")?.parentElement?.parentElement, title.parentElement)
    assert.equal(status.textContent, "")
    assert.equal(row.querySelector(".session-browser-item-meta [data-session-indicators]"), null)
    if (status.dataset.state === "idle") {
      assert.equal(status.hidden, true)
      assert(row.querySelector(".session-browser-unread-dot[title]"))
    } else {
      assert.equal(status.hidden, false)
      assert.equal(row.querySelector(".session-browser-unread-dot"), null)
      assert(status.querySelector("svg[aria-hidden=true]"))
      assert(status.getAttribute("aria-label"))
      assert.equal(status.getAttribute("title"), status.getAttribute("aria-label"))
    }
  }
  dom.window.close()
})

test("compact conversation rows omit empty metadata and keep directory and environment on one secondary line", () => {
  const sessions: Session[] = [
    {id: "plain", name: "Conversation", cwd: "/repo"},
    {id: "terminal", name: "Shell", cwd: "/repo", terminal: {workspaceID: "workspace", attached: true}},
    {id: "context", name: "Conversation", cwd: "/repo", provider: "agy", environment_name: "Remote", context: {project: "App", branch: "feature/work", cwd: "/repo", workspaces: [], kind: "Worktree"}},
    {id: "cloud", name: "Cloud task", cwd: "", provider: "codex-cloud"},
    {id: "assistant", name: "Assistant", cwd: "/repo", yolu_assistant: true},
  ]
  const dom = new JSDOM(renderToStaticMarkup(createElement(ConversationList, {sessions, showDirectory: false, parallel: true, parallelSessions: ["plain", "terminal"]})))
  assert.equal(dom.window.document.querySelector('[data-conversation-session="plain"] .session-browser-item-meta'), null)
  const terminal = dom.window.document.querySelector('[data-conversation-session="terminal"]')!
  assert.equal(terminal.querySelector('.session-browser-item-meta'), null)
  assert.equal(terminal.querySelector('.session-browser-item-kind'), null)
  assert.equal(terminal.querySelector('.session-browser-item-heading .sr-only')?.textContent, uiText('终端'))
  assert.equal(terminal.querySelector('.session-browser-item-agent'),null)
  for (const [id, label, src] of [
    ["plain", "Codex", "/agent-codex.png"],
    ["context", "Antigravity", "/agent-antigravity.svg"],
    ["cloud", "Codex Cloud", "/agent-codex.png"],
    ["assistant", uiText("Yolu 助手"), "/yolu.svg"],
  ]) {
    const agent = dom.window.document.querySelector(`[data-conversation-session="${id}"] .session-browser-item-agent`)!
    assert.equal(agent.getAttribute("alt"),label)
    assert.equal(agent.getAttribute("src"),src)
    assert(agent.nextElementSibling?.matches(".session-browser-item-title"))
  }
  for (const id of ["plain", "terminal"]) {
    const row = dom.window.document.querySelector(`[data-conversation-session="${id}"]`)!
    assert.equal(row.getAttribute('data-parallel-member'), 'true')
    assert.equal(row.getAttribute('aria-description'), uiText('已并列'))
    const button = dom.window.document.querySelector(`[data-conversation-parallel="${id}"]`)!
    assert.equal(button.getAttribute('data-parallel-open'), 'true')
    assert(button.querySelector('svg'))
    assert(button.getAttribute('title')!.includes(uiText('已并列')))
  }
  assert.equal(dom.window.document.querySelector('[data-conversation-parallel="context"]')?.hasAttribute('data-parallel-open'), false)
  const metadata = dom.window.document.querySelector('[data-conversation-session="context"] .session-browser-item-meta')!
  assert(metadata.querySelector('.session-browser-item-project'))
  assert(metadata.querySelector('.session-browser-item-branch'))
  assert(metadata.querySelector('.session-browser-environment'))
  assert.equal(metadata.querySelector('time'), null)
  dom.window.close()
})

test("workspace names update their accessible labels after metadata arrives while retaining conversation rows", () => {
  const dom = new JSDOM('<div id="list"></div>')
  const list = dom.window.document.getElementById("list")!
  const markup = (name: string) => `<div class="session-browser-groups"><section class="session-browser-group" data-conversation-group="local-workspace" aria-label="${name}"><h3>${name}</h3><ul class="session-browser-items"><li><button data-conversation-session="session">Conversation</button></li></ul></section></div>`
  patchConversationList(list, markup("workspace-id"))
  const row = list.querySelector("[data-conversation-session]")
  patchConversationList(list, markup("Login"))
  assert.equal(list.querySelector("section")?.getAttribute("aria-label"), "Login")
  assert.equal(list.querySelector("[data-conversation-session]"), row)
  dom.window.close()
})

test("grouped list omits project chevrons, middle-truncates long branch and directory subtitles, and groups unbound sessions", () => {
  const longBranch = "feature/very-long-branch-name-for-middle-truncation-test"
  const longDirectory = "super-long-worktree-directory-name-01"
  const sessions: Session[] = [
    {id: "proj", name: "Project chat", cwd: `/repo/worktrees/${longDirectory}`, primary_project_id: "app", context: {project: "App", projectID: "app", branch: longBranch, cwd: `/repo/worktrees/${longDirectory}`, kind: "Worktree"}},
    {id: "free", name: "Unbound chat", cwd: `/tmp/${longDirectory}`},
  ]
  const rows = conversationTree(sessions, {
    navigator: {directories: [{key: "local:/repo/app", cwd: "/repo/app", environment: "local", environmentName: "Local", name: "App", projectID: "app", projectName: "App", projectRoot: true}]},
    limits: {}, collapsed: [], filtered: false,
  })
  const dom = new JSDOM(renderToStaticMarkup(createElement(ConversationList, {sessions, rows, showDirectory: true, sidebarMode: "grouped"})))
  const doc = dom.window.document
  assert.equal(doc.querySelector(".session-workspace-chevron, .lucide-chevron-right, .lucide-chevron-down"), null)
  const branch = doc.querySelector('[data-conversation-session="proj"] .session-browser-item-branch')!
  assert.equal(branch.getAttribute("title"), longBranch)
  assert.equal(branch.textContent, longBranch)
  assert(branch.querySelector(".session-middle-truncate-start"))
  assert(branch.querySelector(".session-middle-truncate-end"))
  const location = doc.querySelector('[data-conversation-session="free"] .session-browser-item-location')!
  assert.equal(location.getAttribute("title"), `/tmp/${longDirectory}`)
  assert.equal(location.textContent, longDirectory)
  assert(location.querySelector(".session-middle-truncate-start"))
  assert(location.querySelector(".session-middle-truncate-end"))
  const unboundGroup = doc.querySelector('[data-collection="independent"]')!
  const unboundToggle = unboundGroup.querySelector('[data-conversation-group-toggle="independent"]')!
  assert.equal(unboundToggle.querySelector(".session-workspace-name")?.textContent, uiText("未绑定项目"))
  assert.equal(unboundGroup.querySelector(".session-collection-details"), null)
  assert.equal(unboundGroup.querySelector("details.session-collection-menu"), null)
  assert(unboundGroup.querySelector("button.session-collection-create[data-conversation-standalone='true']"))
  assert.equal(doc.querySelector('[data-sidebar-section="projects"]')?.textContent, uiText("项目"))
  assert.equal(doc.querySelector('[data-sidebar-section="cloud"]'), null)
  dom.window.close()
})

test("grouped list keeps main-branch project rows single-line, aggregates collapsed status signals, and renders compact recent badges", () => {
  const sessions: Session[] = [
    {id: "assistant-chat", name: "Assistant chat", cwd: "/tmp/yolu", yolu_assistant: true, updated_at: 60},
    {id: "main-chat", name: "Main chat", cwd: "/repo/app", primary_project_id: "app", updated_at: 40, context: {project: "App", projectID: "app", branch: "main", cwd: "/repo/app", kind: "Project"}},
    {id: "wt-chat", name: "Worktree chat", cwd: "/repo/worktrees/feat", primary_project_id: "app", updated_at: 30, context: {project: "App", projectID: "app", branch: "feature/ui", cwd: "/repo/worktrees/feat", kind: "Worktree"}},
    {id: "unread-chat", name: "Unread chat", cwd: "/repo/api", primary_project_id: "api", updated_at: 20, unread: true},
    {id: "waiting-chat", name: "Waiting chat", cwd: "/repo/ops", primary_project_id: "ops", updated_at: 15, chat_status: "waiting", unread: true},
    {id: "cloud-chat", name: "Cloud chat", cwd: "", provider: "codex-cloud", cloud_environment: "apix", updated_at: 50},
  ]
  const directories = [
    {key: "local:/repo/app", cwd: "/repo/app", environment: "local", environmentName: "Local", name: "App", projectID: "app", projectName: "App", projectRoot: true},
    {key: "local:/repo/api", cwd: "/repo/api", environment: "local", environmentName: "Local", name: "API", projectID: "api", projectName: "API", projectRoot: true},
    {key: "local:/repo/ops", cwd: "/repo/ops", environment: "local", environmentName: "Local", name: "Ops", projectID: "ops", projectName: "Ops", projectRoot: true},
  ]
  const collapsed = [JSON.stringify(["local", "project", "api"]), JSON.stringify(["local", "project", "ops"])]
  const rows = conversationTree(sessions, {
    navigator: {directories},
    limits: {}, collapsed, filtered: false, showRecent: true, showYoluAssistant: true,
  })
  const dom = new JSDOM(renderToStaticMarkup(createElement(ConversationList, {sessions, rows, showDirectory: true, sidebarMode: "grouped"})))
  const doc = dom.window.document
  const sections = [...doc.querySelectorAll(".session-browser-workspaces > *")].map(el =>
    el.getAttribute("data-sidebar-section") ? `section:${el.getAttribute("data-sidebar-section")}` : `group:${el.getAttribute("data-collection")}`,
  )
  assert.deepEqual(sections, ["group:yolu-assistant", "section:projects", "group:project", "group:project", "group:project", "section:cloud", "group:cloud", "group:recent"])
  assert.equal(doc.querySelector('[data-sidebar-section="cloud"]')?.textContent, uiText("云环境"))
  assert.equal(doc.querySelector("details.session-collection-menu"), null)
  const appGroup = doc.querySelector('[data-collection="project"][aria-label="App"]')!
  assert(appGroup.querySelector('.session-collection-actions > a.session-collection-details'))
  assert(appGroup.querySelector('.session-collection-actions > button.session-collection-create[data-action="project-conversation-new"]'))
  assert.equal(appGroup.querySelector('[data-conversation-session="main-chat"] .session-browser-item-meta'), null)
  assert(appGroup.querySelector('[data-conversation-session="wt-chat"] .session-browser-item-branch'))

  const apiGroup = doc.querySelector('[data-collection="project"][aria-label="API"]')!
  assert(apiGroup.querySelector('.session-workspace-unread.session-browser-unread-dot'))
  const opsGroup = doc.querySelector('[data-collection="project"][aria-label="Ops"]')!
  assert.equal(opsGroup.querySelector('.session-workspace-status')?.getAttribute('data-state'), 'waiting')

  const recentGroup = doc.querySelector('[data-collection="recent"]')!
  assert.equal(recentGroup.querySelector('.session-recent-toggle')?.textContent, uiText("最近"))
  assert.equal(recentGroup.querySelector('[data-conversation-session="wt-chat"] .session-browser-item-meta'), null)
  assert(recentGroup.querySelector('[data-conversation-session="wt-chat"] .session-browser-item-badge-worktree'))
  assert(recentGroup.querySelector('[data-conversation-session="cloud-chat"] .session-browser-item-badge'))
  dom.window.close()
})

test("patching conversation list preserves distinct section labels and open session item menus across refreshes", () => {
  const dom = new JSDOM('<div id="list"></div>')
  const list = dom.window.document.getElementById("list")!
  const markup = (name: string) => `<div class="session-browser-groups"><div class="session-sidebar-section-label" data-sidebar-section="projects"><span>项目</span></div><section class="session-browser-group" data-conversation-group="project"><h3 class="session-workspace-heading"><button>Project</button><span class="session-collection-actions"><button class="session-collection-create" data-action="project-conversation-new">New conversation</button></span></h3><ul class="session-browser-items"><li><button data-conversation-session="one">${name}</button><details class="session-item-menu"><summary>More</summary><button>Archive</button></details></li></ul></section><div class="session-sidebar-section-label" data-sidebar-section="cloud"><span>云环境</span></div><section class="session-browser-group" data-conversation-group="codex-cloud"><h3 class="session-workspace-heading"><button>Codex Cloud</button></h3></section></div>`
  patchConversationList(list, markup("Original title"))
  const menu = list.querySelector<HTMLDetailsElement>("details.session-item-menu")!
  const trigger = dom.window.document.createElement("span")
  trigger.className = "ui-action-host"
  menu.before(trigger)
  menu.classList.add("ui-native-menu")
  menu.open = true
  patchConversationList(list, markup("Updated title"))
  assert.equal(list.querySelector("details.session-item-menu"), menu)
  assert.equal(menu.open, true)
  assert.equal(menu.previousElementSibling, trigger)
  assert.equal(list.querySelector("[data-conversation-session]")?.textContent, "Updated title")
  assert.deepEqual([...list.querySelectorAll("[data-sidebar-section]")].map(node => node.getAttribute("data-sidebar-section")), ["projects", "cloud"])
  dom.window.close()
})
