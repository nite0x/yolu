import {test} from "node:test"
import assert from "node:assert/strict"
import {createControllerCache} from "../frontend/features/conversations/runtime/controller-cache"
import {ChatController} from "../frontend/features/conversations/runtime/controller"
import {idleChat} from "../frontend/features/conversations/model/messages"

function controller(saved = true) {
  return {saved, disposed: false, async prepareForEviction() {return this.saved}, async flushDraft() {return this.saved}, dispose() {this.disposed = true}}
}

test("retention evicts the oldest inactive controller and preserves a recently visited owner", async () => {
  const a = controller(), b = controller(), c = controller()
  const cache = createControllerCache<ReturnType<typeof controller>>(2, value => value === c)
  cache.set("a", a); cache.set("b", b); cache.get("a"); cache.set("c", c)
  await cache.trim()
  assert.equal(cache.size, 2)
  assert.equal(b.disposed, true)
  assert.equal(a.disposed, false)
  assert.equal(c.disposed, false)
})

test("failed persistence keeps its controller until a later successful save", async () => {
  const a = controller(false), b = controller()
  const cache = createControllerCache<ReturnType<typeof controller>>(1, value => value === b)
  cache.set("a", a); cache.set("b", b)
  await cache.trim()
  assert.equal(cache.size, 2)
  assert.equal(await cache.flush(), false)
  a.saved = true
  assert.equal(await cache.flush(), true)
  await cache.trim()
  assert.equal(cache.size, 1)
  assert.equal(a.disposed, true)
})

test("reopening a controller while its save is pending prevents eviction", async () => {
  let release: (saved: boolean) => void = () => {}
  const a = {...controller(), prepareForEviction: () => new Promise<boolean>(resolve => {release = resolve})}
  const b = controller()
  let active: typeof b = b
  const cache = createControllerCache<typeof b>(1, value => value === active)
  cache.set("a", a); cache.set("b", b)
  const trimmed = cache.trim()
  active = a; cache.get("a")
  release(true)
  await trimmed
  assert.equal(a.disposed, false)
  assert.equal(cache.get("a"), a)
})

test("rekeying a draft during eviction cannot dispose its new session owner", async () => {
  let release: (saved: boolean) => void = () => {}
  const a = {...controller(), prepareForEviction: () => new Promise<boolean>(resolve => {release = resolve})}
  const b = controller()
  const cache = createControllerCache<typeof b>(1, value => value === b)
  cache.set("draft", a); cache.set("b", b)
  const trimmed = cache.trim()
  cache.delete("draft"); cache.set("session", a)
  // The new entry also requires a fresh persistence check; make it fail safely.
  a.prepareForEviction = async () => false
  release(true)
  await trimmed
  assert.equal(cache.get("session"), a)
  assert.equal(a.disposed, false)
})

test("an uncertain send cannot be evicted even if its message draft can be saved", async t => {
  const ids: string[] = []
  const session = {id: "retained", name: "Retained", cwd: "/repo"}
  let fail = true
  const owner = new ChatController({
    session, environment: "local", persistDraft: true, created() {}, close() {},
    stream: async () => {throw new Error("unused")},
    request: async <T>(path: string, init?: RequestInit): Promise<T> => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      if (path.endsWith("/chat") && body) {
        ids.push(body.request_id)
        if (fail) {fail = false; throw new Error("uncertain response")}
        return {...idleChat(), id: body.request_id, turn_id: "accepted", status: "completed"} as T
      }
      return idleChat() as T
    },
  })
  t.after(() => owner.dispose())
  owner.setQuestionDraft('["run","approval"]', {answer: {text: "Unsent blocking answer"}})
  assert.equal(await owner.prepareForEviction(), false)
  owner.questionDrafts.clear()
  owner.setDraft("Keep the retry identity")
  await assert.rejects(owner.send("Keep the retry identity"), /uncertain response/)
  assert.equal(await owner.prepareForEviction(), false)
  await owner.send("Keep the retry identity")
  assert.equal(ids[0], ids[1])
  assert.equal(await owner.prepareForEviction(), true)
})
