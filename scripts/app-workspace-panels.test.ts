import assert from "node:assert/strict"
import {before, test} from "node:test"
import {build} from "esbuild"
import {JSDOM, VirtualConsole} from "jsdom"

let bundle = ""
before(async () => {
  const result = await build({
    entryPoints: ["frontend/app/shell/resizable.tsx"], bundle: true, write: false,
    format: "iife", globalName: "Panels", jsx: "automatic",
    define: {"process.env.NODE_ENV": '"production"'},
  })
  bundle = result.outputFiles[0].text + "\nwindow.Panels = Panels;"
})

test("panel teardown preserves native nodes and reading position for later pagehide handlers", t => {
  const errors: unknown[] = []
  const console = new VirtualConsole()
  console.on("jsdomError", error => errors.push(error))
  const dom = new JSDOM(`<html data-workspace-conversation><body><div class="session-browser-body"><div class="session-browser-list"><div id="sessionBrowserList"></div></div><div id="sessionBrowserResize"></div><div class="session-browser-detail"><textarea></textarea></div></div></body></html>`, {
    url: "http://localhost", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: console,
  })
  const w = dom.window
  t.after(() => dom.window.close())
  let disconnects = 0
  Object.assign(w, {ResizeObserver: class {observe() {} disconnect() { disconnects++ }}})
  const body = w.document.querySelector<HTMLElement>(".session-browser-body")!
  const original = [...body.children]
  const list = w.document.getElementById("sessionBrowserList")!
  const input = w.document.querySelector("textarea")!
  list.scrollTop = 137
  input.value = "unsaved draft"
  w.eval(bundle)
  ;(w as unknown as {Panels: {setupWorkspacePanels(): void}}).Panels.setupWorkspacePanels()
  assert.ok(body.querySelector(".ui-panels-host"))
  let savedScroll: number | undefined
  w.addEventListener("pagehide", () => { savedScroll = w.document.getElementById("sessionBrowserList")!.scrollTop })
  w.dispatchEvent(new w.Event("pagehide"))
  w.dispatchEvent(new w.Event("pagehide"))
  assert.deepEqual(errors, [])
  assert.equal(savedScroll, 137)
  assert.deepEqual([...body.children], original)
  assert.equal(w.document.querySelector("textarea"), input)
  assert.equal(input.value, "unsaved draft")
  assert.equal(disconnects, 1)
})
