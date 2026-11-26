import {test} from "node:test"
import assert from "node:assert/strict"
import {createSettingsSaveQueue} from "../frontend/features/settings/runtime/save-queue"

test("settings writes serialize per environment and recover after a rejected save", async () => {
  const queue = createSettingsSaveQueue()
  const events: string[] = []
  let release: () => void = () => {}
  const first = queue.enqueue("local", async () => {events.push("first"); await new Promise<void>(resolve => {release = resolve}); throw new Error("offline")})
  const rejected = assert.rejects(first, /offline/)
  const second = queue.enqueue("local", async () => {events.push("second"); return "saved"})
  await queue.enqueue("wsl", async () => {events.push("independent")})
  assert.deepEqual(events, ["first", "independent"])
  release()
  await rejected
  assert.equal(await second, "saved")
  assert.deepEqual(events, ["first", "independent", "second"])
  await queue.wait("local")
})
