import { test } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { patchConversationList } from "../frontend/workspace/conversation-list"

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
