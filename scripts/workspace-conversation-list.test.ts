import { test } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { patchConversationList } from "../frontend/workspace/conversation-list"
import { ConversationList, ConversationScopes } from "../frontend/workspace/session-browser"
import type { Session } from "../frontend/workspace/sessions"
import { uiText } from "../frontend/i18n"

test("scope options group sources and shorten directories while preserving full paths and selection", () => {
  const path = "D:\\Projects\\Yolu"
  const scopes = [
    {kind: "all", name: "All conversations"},
    {kind: "task", id: "task", environment: "local", name: "Feature"},
    {kind: "project", id: "project", environment: "remote", environmentName: "Remote", name: "Yolu"},
    {kind: "directory", cwd: path, environment: "local", name: path},
  ]
  const dom = new JSDOM(renderToStaticMarkup(createElement(ConversationScopes, {scopes, selected: {kind: "directory", cwd: "d:/projects/yolu/", environment: "local"}})))
  assert.deepEqual([...dom.window.document.querySelectorAll('.session-scope-group h3')].map(element => element.textContent), [uiText('任务'), uiText('项目'), uiText('工作目录')])
  const selected = dom.window.document.querySelector('[aria-current="true"]')!
  assert.equal(selected.getAttribute('title'), path)
  assert.equal(selected.querySelector('.session-scope-option-title')?.textContent, 'Yolu')
  assert.equal(selected.querySelector('.session-scope-option-context')?.textContent, 'D:/Projects')
  assert.equal(JSON.parse(selected.getAttribute('data-conversation-scope')!).cwd, path)
  assert.match(dom.window.document.querySelectorAll('.session-scope-group')[1].textContent!, /Remote/)
  dom.window.close()
})

test("conversation statuses use inline accessible icons and titles preserve their full hover text", () => {
  const name = "A long conversation title that should stay on a single line with an ellipsis"
  const states = ["starting", "running", "waiting", "stopping", "handoff", "failed", "interrupted", "unknown", ""]
  const sessions: Session[] = states.map((state, index) => ({id: String(index), name, cwd: "/repo", chat_status: state, unread: true, updated_at: 1794520000}))
  sessions.push({id: "terminal", name, cwd: "/repo", terminal: {taskID: "task", attached: true}})
  const dom = new JSDOM(renderToStaticMarkup(createElement(ConversationList, {sessions, showDirectory: false})))
  for (const row of dom.window.document.querySelectorAll(".session-browser-item")) {
    const title = row.querySelector(".session-browser-item-title")!
    const status = row.querySelector<HTMLElement>(".session-browser-item-status")!
    assert.equal(title.getAttribute("title"), name)
    assert.equal(title.textContent, name)
    assert.equal(status.parentElement, title.parentElement)
    assert.equal(row.querySelector("time")?.parentElement, title.parentElement)
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
    {id: "terminal", name: "Shell", cwd: "/repo", terminal: {taskID: "task", attached: true}},
    {id: "context", name: "Conversation", cwd: "/repo", environment_name: "Remote", context: {project: "App", branch: "feature/work", cwd: "/repo", tasks: [], kind: "Worktree"}},
  ]
  const dom = new JSDOM(renderToStaticMarkup(createElement(ConversationList, {sessions, showDirectory: false, parallel: true, parallelSessions: ["plain", "terminal"]})))
  assert.equal(dom.window.document.querySelector('[data-conversation-session="plain"] .session-browser-item-meta'), null)
  const terminal = dom.window.document.querySelector('[data-conversation-session="terminal"]')!
  assert.equal(terminal.querySelector('.session-browser-item-meta'), null)
  assert.equal(terminal.querySelector('.session-browser-item-kind'), null)
  assert.equal(terminal.querySelector('.session-browser-item-heading .sr-only')?.textContent, uiText('终端'))
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
  const markup = (name: string) => `<div class="session-browser-groups"><section class="session-browser-group" data-conversation-group="local-task" aria-label="${name}"><h3>${name}</h3><ul class="session-browser-items"><li><button data-conversation-session="session">Conversation</button></li></ul></section></div>`
  patchConversationList(list, markup("task-id"))
  const row = list.querySelector("[data-conversation-session]")
  patchConversationList(list, markup("Login"))
  assert.equal(list.querySelector("section")?.getAttribute("aria-label"), "Login")
  assert.equal(list.querySelector("[data-conversation-session]"), row)
  dom.window.close()
})
