import {test} from "node:test"
import assert from "node:assert/strict"
import {createConversationState} from "../frontend/workspace/conversation-state"
import {conversationEnvironmentKey} from "../frontend/workspace/conversation-runtime"

function fixture() {
  const cache = new Map<string, string>()
  const options = {
    storage: () => ({getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => {cache.set(key, value)}}),
    scopeKey: JSON.stringify,
    sessionKey: (session: {id: string; environment_id?: string}) => conversationEnvironmentKey(session.environment_id || "local", session.id),
  }
  return {options, state: createConversationState(options)}
}

test("conversation state restores scope preferences in a fresh instance without restoring stale requests", () => {
  const {options, state} = fixture()
  const scope = {kind: "project" as const, id: "repo", environment: "local"}
  const view = state.viewFor("local", scope)
  Object.assign(view, {directory: "/work/repo", selected: "thread", archived: true, loadedCount: 160, windowStart: 100, loading: true, requestID: 8})
  state.remember(view, 750, true, "local")
  const restored = createConversationState(options).viewFor("local", scope)
  assert.deepEqual([restored.directory, restored.selected, restored.archived, restored.loadedCount, restored.windowStart], ["/work/repo", "thread", true, 160, 100])
  assert.equal(restored.loading, false)
  assert.equal(restored.requestID, undefined)
  assert.equal(restored.sessions.length, 0)
})

test("partial environment queries retain selection and failures, while invalidated replies cannot change the index", () => {
  const {state} = fixture()
  let environment = "local"
  const local = {id: "same", name: "local", cwd: "/local", environment_id: "local", updated_at: 1}
  const remote = {...local, name: "remote", cwd: "/remote", environment_id: "wsl", browser_key: conversationEnvironmentKey("wsl", "same")}
  const view = state.viewFor("local", {kind: "all"})
  Object.assign(view, {sessions: [remote], selected: remote.browser_key, requestKey: "all"})
  const first = state.beginQuery(view, "all", ["local", "wsl"], () => environment)
  first.receive("local", [local]); first.settled("local"); first.publish()
  assert.equal(view.selected, remote.browser_key)
  assert.equal(view.sessions.length, 2)
  first.failed("wsl", "offline"); first.settled("wsl"); view.loading = false; first.publish()
  assert.equal(view.selected, remote.browser_key)
  assert.equal(view.error, "offline")
  const second = state.beginQuery(view, "all", ["local"], () => environment)
  second.receive("local", [{...local, name: "fresh"}]); second.settled("local"); second.publish()
  first.receive("local", [{...local, name: "late"}]); first.publish()
  assert.equal(state.session("local", "same")?.name, "fresh")
  environment = "wsl"
  second.receive("local", [{...local, name: "wrong environment"}])
  assert.equal(state.session("local", "same")?.name, "fresh")
  state.suspend(); environment = "local"
  assert.equal(second.current(), false)
})
