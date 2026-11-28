import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {before, test} from "node:test"
import {build} from "esbuild"
import type {BrowserProps, BrowserRequest} from "../frontend/features/files/ui/browser"

const {JSDOM, VirtualConsole} = createRequire(import.meta.url)("jsdom")
let bundle = ""
let viewerBundle = ""
before(async () => {
  const browser = await build({
    entryPoints: ["frontend/features/files/ui/browser.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "Browser",
    jsx: "automatic",
    define: {"process.env.NODE_ENV": '"production"'},
  })
  bundle = `${browser.outputFiles[0].text}\nwindow.Browser = Browser;`
  const viewer = await build({
    entryPoints: ["frontend/features/files/runtime/viewer.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "Viewer",
    plugins: [
      {
        name: "renderer-lifecycle-fixture",
        setup(builder) {
          builder.onResolve({filter: /^@pierre\/diffs$/}, () => ({path: "renderer", namespace: "fixture"}))
          builder.onLoad({filter: /.*/, namespace: "fixture"}, () => ({
            contents: `class File {
            constructor(options) {this.options = options; this.themes = []; this.cleaned = false; window.renderers.push(this)}
            render({containerWrapper}) {containerWrapper.textContent = 'Rendered file'}
            setThemeType(theme) {this.themes.push(theme)}
            setSelectedLines() {}
            cleanUp() {this.cleaned = true}
          }
          export {File, File as FileDiff}; export const parsePatchFiles = () => [];`,
            loader: "js",
          }))
        },
      },
    ],
  })
  viewerBundle = `${viewer.outputFiles[0].text}\nwindow.Viewer = Viewer;`
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return {promise, resolve, reject}
}
async function until(check: () => unknown) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(check(), "File browser did not reach the expected state")
}
function fixture() {
  const errors: unknown[] = []
  const console = new VirtualConsole()
  console.on("jsdomError", (error: unknown) => errors.push(error))
  const dom = new JSDOM('<div id="files"></div><div id="other"></div>', {
    url: "http://localhost",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: console,
  })
  const window = dom.window
  window.WorkHubFileDisplay = {
    render(container: HTMLElement, preview: {text: string}) {
      container.textContent = preview.text
      return () => container.replaceChildren()
    },
  }
  window.eval(bundle)
  const mount = (props?: BrowserProps, id = "files") =>
    window.Browser.mountFileBrowser(window.document.getElementById(id), props)
  return {
    window,
    errors,
    mount,
    close() {
      mount()
      mount(undefined, "other")
      window.close()
    },
  }
}
const directory = (...paths: string[]) => ({
  entries: paths.map((path) => ({path, name: path, directory: false})),
  truncated: false,
})
const changedFiles = {
  files: [
    {path: "one.ts", index: " ", working: "M"},
    {path: "two.ts", index: " ", working: "M"},
  ],
  branch: "main",
}

test("changing a retained file browser resource aborts its old preview and never carries selection into the new resource", async () => {
  const h = fixture()
  const late = deferred<{text: string}>()
  const calls: {path: string; environment?: string; signal?: AbortSignal | null}[] = []
  const request: BrowserRequest = (async (
    path: string,
    options: RequestInit & {environment?: string} = {},
  ) => {
    calls.push({path, environment: options.environment, signal: options.signal})
    const url = new URL(path, "http://localhost")
    if (!url.searchParams.has("file")) return directory("one.ts")
    if (options.environment === "local") return late.promise
    return {text: "new environment content", format: "file"}
  }) as BrowserRequest
  try {
    const props = {project: "one", path: "/repo", environment: "local", request, initialMode: "all"}
    h.mount(props)
    await until(() => h.window.document.querySelector('[data-change-file="one.ts"]'))
    h.window.document.querySelector('[data-change-file="one.ts"]').click()
    await until(() => calls.some((call) => call.path.includes("file=one.ts")))
    const preview = calls.find((call) => call.path.includes("file=one.ts"))
    h.mount({...props, project: "two", environment: "remote"})
    assert.equal(preview?.signal?.aborted, true)
    await until(() => calls.some((call) => call.environment === "remote"))
    assert.equal(
      calls.some((call) => call.environment === "remote" && call.path.includes("file=")),
      false,
    )
    late.resolve({text: "late old environment content"})
    await until(() => h.window.document.querySelector('[data-change-file="one.ts"]'))
    assert.equal(h.window.document.body.textContent.includes("late old environment content"), false)
    assert.equal(h.window.document.querySelector('[aria-pressed="true"][data-change-file]'), null)
    h.window.document.querySelector('[data-change-file="one.ts"]').click()
    await until(
      () => h.window.document.querySelector("#changesText")?.textContent === "new environment content",
    )
    assert.deepEqual(h.errors, [])
  } finally {
    h.close()
  }
})

test("late project metadata preserves a session file's selection and reading surface", async () => {
  const h = fixture()
  let reads = 0
  const request: BrowserRequest = (async (path: string) => {
    reads++
    return new URL(path, "http://localhost").searchParams.has("file")
      ? {text: "selected session file", format: "file"}
      : directory("one.ts")
  }) as BrowserRequest
  try {
    const props = {session: "session-one", path: "/repo", environment: "local", request, initialMode: "all"}
    h.mount(props)
    await until(() => h.window.document.querySelector('[data-change-file="one.ts"]'))
    h.window.document.querySelector('[data-change-file="one.ts"]').click()
    await until(
      () => h.window.document.querySelector("#changesText")?.textContent === "selected session file",
    )
    const reading = h.window.document.querySelector("#changesText")
    reading.scrollTop = 77
    const before = reads
    h.mount({...props, project: "late-project"})
    assert.equal(h.window.document.querySelector("#changesText"), reading)
    assert.equal(reading.scrollTop, 77)
    assert.equal(
      h.window.document.querySelector('[data-change-file="one.ts"]').getAttribute("aria-pressed"),
      "true",
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(reads, before)
    assert.deepEqual(h.errors, [])
  } finally {
    h.close()
  }
})

test("invalid saved splitter dimensions retain finite keyboard separator values", async () => {
  const h = fixture()
  try {
    h.window.localStorage.setItem(
      "workhub:file-tree-size:v1",
      JSON.stringify({width: "Infinity", height: -5}),
    )
    h.mount({
      project: "one",
      path: "/repo",
      environment: "local",
      request: (async () => directory()) as BrowserRequest,
      initialMode: "all",
    })
    const splitter = h.window.document.querySelector('[role="separator"]')
    assert.equal(splitter.getAttribute("aria-valuenow"), "220")
    assert.ok(h.window.document.getElementById(splitter.getAttribute("aria-controls")))
    assert.match(
      h.window.document.querySelector(".file-split-layout").getAttribute("style"),
      /--file-tree-height: 150px/,
    )
    assert.deepEqual(h.errors, [])
  } finally {
    h.close()
  }
})

test("directory errors and contents belong to the current request and recover without remounting the resource", async () => {
  const h = fixture()
  const fresh = deferred<ReturnType<typeof directory>>()
  try {
    const props = {project: "one", path: "/repo", environment: "local", initialMode: "all"}
    h.mount({
      ...props,
      request: (async () => {
        throw new Error("directory failed")
      }) as BrowserRequest,
    })
    await until(() =>
      h.window.document
        .querySelector('.browser-files [role="alert"]')
        ?.textContent.includes("directory failed"),
    )
    h.mount({...props, request: (async () => fresh.promise) as BrowserRequest})
    await until(() => !h.window.document.querySelector('.browser-files [role="alert"]'))
    assert.match(h.window.document.querySelector(".browser-files").textContent, /正在读取目录/)
    fresh.resolve(directory("new.ts"))
    await until(() => h.window.document.querySelector('[data-change-file="new.ts"]'))
    const another = deferred<ReturnType<typeof directory>>()
    h.mount({...props, request: (async () => another.promise) as BrowserRequest})
    await until(() => !h.window.document.querySelector('[data-change-file="new.ts"]'))
    another.resolve(directory("replacement.ts"))
    await until(() => h.window.document.querySelector('[data-change-file="replacement.ts"]'))
    assert.deepEqual(h.errors, [])
  } finally {
    h.close()
  }
})

test("a successful preview cannot erase a failed changes refresh and another pane remains isolated", async () => {
  const h = fixture()
  let failList = false
  const request: BrowserRequest = (async (path: string) => {
    const url = new URL(path, "http://localhost")
    if (!url.searchParams.has("file")) {
      if (failList) throw new Error("changes unavailable")
      return changedFiles
    }
    return {text: `contents of ${url.searchParams.get("file")}`, format: "text"}
  }) as BrowserRequest
  try {
    const props = {project: "one", path: "/repo", environment: "local", request}
    h.mount(props)
    h.mount({...props, path: "/other", idPrefix: "otherChanges"}, "other")
    await until(() => h.window.document.querySelector("#changesText")?.textContent === "contents of one.ts")
    await until(
      () => h.window.document.querySelector("#otherChangesText")?.textContent === "contents of one.ts",
    )
    failList = true
    h.window.document.querySelector("#changesRefresh").click()
    await until(() =>
      h.window.document.querySelector("#changesError")?.textContent.includes("changes unavailable"),
    )
    h.window.document.querySelector('#changesFiles [data-change-file="two.ts"]').click()
    await until(() => h.window.document.querySelector("#changesText")?.textContent === "contents of two.ts")
    assert.match(h.window.document.querySelector("#changesError").textContent, /changes unavailable/)
    assert.equal(h.window.document.querySelector("#changesError").hidden, false)
    assert.equal(h.window.document.querySelector("#otherChangesText").textContent, "contents of one.ts")
    assert.equal(h.window.document.querySelector("#otherChangesError").hidden, true)
    assert.deepEqual(h.errors, [])
  } finally {
    h.close()
  }
})

test("file rendering follows saved light and dark appearance without replacing its renderer and releases its observer", async () => {
  const dom = new JSDOM('<html data-color-scheme="dark"><body><div id="preview"></div></body></html>', {
    runScripts: "outside-only",
  })
  const window = dom.window
  try {
    window.renderers = []
    window.CSSStyleSheet = class {
      replaceSync() {}
    }
    window.eval(viewerBundle)
    window.Viewer.installFileDisplay(window)
    const container = window.document.querySelector("#preview")
    const dispose = window.WorkHubFileDisplay.render(
      container,
      {name: "file.ts", text: "const answer = 42", format: "file"},
      true,
    )
    const renderer = window.renderers[0]
    assert.equal(renderer.options.themeType, "dark")
    assert.equal(renderer.options.theme.dark, "pierre-dark")
    window.document.documentElement.dataset.colorScheme = "light"
    await until(() => renderer.themes.length === 1)
    assert.equal(renderer.themes[0], "light")
    assert.equal(window.renderers.length, 1)
    dispose()
    assert.equal(renderer.cleaned, true)
    assert.equal(container.textContent, "")
    window.document.documentElement.dataset.colorScheme = "dark"
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(renderer.themes.length, 1)
  } finally {
    window.close()
  }
})

test("pane file views report automatic diff selection and preserve their mode when restored", async () => {
  const h = fixture()
  const reports: [string, string][] = []
  const request: BrowserRequest = (async (path: string) => {
    const url = new URL(path, "http://localhost")
    if (url.searchParams.has("file")) return {text: "selected diff", format: "text"}
    return {...changedFiles, files: changedFiles.files.map((file) => ({...file, index: "M"}))}
  }) as BrowserRequest
  const props = {
    project: "one",
    path: "/repo",
    environment: "remote",
    request,
    initialMode: "working",
    onSelectFile: (path: string, mode: string) => reports.push([path, mode]),
  }
  try {
    h.mount(props)
    await until(() => reports.some(([path, mode]) => path === "one.ts" && mode === "working"))
    h.window.document.querySelector('[data-change-file="two.ts"]').click()
    await until(() => reports.at(-1)?.[0] === "two.ts")
    h.mount()
    h.mount({...props, initialMode: "index", reference: {path: "two.ts", mode: "index", version: 1}})
    await until(() => reports.some(([path, mode]) => path === "two.ts" && mode === "index"))
    assert.equal(h.window.document.querySelector("#changesMode").value, "index")
    assert.deepEqual(h.errors, [])
  } finally {
    h.close()
  }
})
