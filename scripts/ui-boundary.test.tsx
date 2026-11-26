import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {test} from "node:test"
import {build} from "esbuild"

const {JSDOM, VirtualConsole} = createRequire(import.meta.url)("jsdom")

test("a render failure stays inside its pane and retry preserves the owner draft", async () => {
  const output = await build({
    stdin: {
      contents: `import {createRecoverableRoot} from './frontend/shared/ui/feedback/root';
      import {flushSync} from 'react-dom';
      function Content() {if (window.crash) throw new Error('fixture failure'); return <input aria-label="Draft" defaultValue={window.draft} />}
      window.mount = () => {const root = createRecoverableRoot(document.getElementById('pane')); flushSync(() => root.render(<Content />)); return root};`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    define: {"process.env.NODE_ENV": '"production"'},
  })
  const dom = new JSDOM('<div id="navigation">Navigation stays available</div><div id="pane"></div>', {
    runScripts: "outside-only",
    virtualConsole: new VirtualConsole(),
  })
  const window = dom.window
  try {
    window.crash = true
    window.draft = "Retained draft"
    window.eval(output.outputFiles[0].text)
    const root = window.mount()
    assert.equal(window.document.querySelectorAll('[role="alert"]').length, 1)
    assert.equal(window.document.querySelector("#navigation").textContent, "Navigation stays available")
    window.crash = false
    window.document.querySelector("button").click()
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(window.document.querySelector('input[aria-label="Draft"]').value, "Retained draft")
    assert.equal(window.document.querySelectorAll('[role="alert"]').length, 0)
    root.unmount()
  } finally {
    window.close()
  }
})
