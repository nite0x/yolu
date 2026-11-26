import {before, test, type TestContext} from "node:test"
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {build} from "esbuild"
import {JSDOM} from "jsdom"

let bundle = ""
before(async () => {
  const output = await build({
    entryPoints:["frontend/entrypoints/terminal.ts"], bundle:true, write:false,
    outfile:"terminal-test.js", format:"iife", jsx:"automatic",
    define:{"process.env.NODE_ENV":'"production"'},
    plugins:[{
      name:"terminal-lifecycle-fixture",
      setup(builder) {
        builder.onLoad({filter:/\.css$/}, () => ({contents:"",loader:"css"}))
        builder.onResolve({filter:/^@xterm\//}, args => ({path:args.path,namespace:"terminal-fixture"}))
        builder.onLoad({filter:/.*/,namespace:"terminal-fixture"}, args => ({loader:"js",contents:args.path === "@xterm/xterm" ? `
          export class Terminal {
            cols=80; rows=24; pending=0; drains=[];
            constructor(options) { this.options=options; (globalThis.terminalInstances ||= []).push(this) }
            loadAddon() {} open() {} onData() {} reset() {} focus() {} resize() {}
            write(data, done) {
              if (!data) { if(this.pending) this.drains.push(done); else done?.(); return }
              this.pending++;
              (globalThis.terminalWrites ||= []).push({data,done:() => {done?.(); if(--this.pending===0) for(const drain of this.drains.splice(0)) drain?.()}})
            }
            dispose() { this.disposed=true }
          }
        ` : `export class ${args.path.endsWith("addon-fit") ? "FitAddon" : args.path.endsWith("addon-search") ? "SearchAddon" : "WebglAddon"} { proposeDimensions() {} onContextLoss() {} dispose() {} }`}))
      },
    }],
  })
  bundle = output.outputFiles.find(file => file.path.endsWith(".js"))!.text
})

const tick = () => new Promise<void>(resolve => setImmediate(resolve))
async function until(check: () => boolean) {
  for (let count=0;count<100;count++) {if (check()) return; await tick()}
  assert(check(), "terminal fixture did not settle")
}

async function mount(t: TestContext, ticket?: (id: string) => Promise<object>) {
  const dom = new JSDOM(readFileSync("web/terminal.html","utf8"), {url:"http://localhost:4317/?app-terminal=1",runScripts:"outside-only",pretendToBeVisual:true})
  const host = new JSDOM("", {url:"http://localhost:4317"})
  const w = dom.window as typeof dom.window & {
    WorkHubPage: {dispose(): void}
    terminalInstances: {options:object;disposed?:boolean}[]
    terminalWrites: {done(): void}[]
  }
  const messages: {type:string}[] = [], requests:string[] = []
  const sockets: {onopen?: (() => void) | null; onmessage?: ((event: {data:string}) => void) | null; onerror?: (() => void) | null; onclose?: (() => void) | null; sent:string[];readyState:number}[] = []
  Object.defineProperty(w,"parent",{value:host.window})
  host.window.postMessage = message => messages.push(message)
  Object.assign(w, {
    ResizeObserver:class {observe(){} disconnect(){}},
    matchMedia:() => ({matches:false,addEventListener(){},removeEventListener(){}}),
    WebSocket:class {
      static OPEN=1
      readyState=1
      bufferedAmount=0
      sent:string[]=[]
      onopen?: () => void
      constructor() {sockets.push(this); queueMicrotask(() => this.onopen?.())}
      send(data:string) {this.sent.push(data)}
      close() {this.readyState=3}
    },
    fetch:async (path:string) => {
      requests.push(path)
      const id = path.match(/\/api\/terminals\/([^/]+)\/ticket$/)?.[1]
      const value = id ? await ticket?.(id) || {ticket:id}
        : path === "/api/state" ? {projects:[{id:"app",name:"App",path:"/repo/app",worktrees:[]}]}
        : path === "/api/terminal-profiles" ? []
        : ["one","two"].map(id => ({id,name:id,project_id:"app",cwd:"/repo/app",state:"running"}))
      return {ok:true,json:async () => value}
    },
  })
  const createElement = w.document.createElement
  w.eval(bundle)
  const send = (data:object) => w.dispatchEvent(new w.MessageEvent("message", {source:host.window,origin:w.location.origin,data}))
  const restore = (id:string) => send({type:"workhub:page-restore",active:true,snapshot:{route:"/terminals",environment:"local",terminal:{id,projectID:"app",cwd:"/repo/app"}}})
  t.after(() => {w.WorkHubPage.dispose(); dom.window.close(); host.window.close()})
  return {w,send,restore,messages,requests,sockets,createElement,status:() => w.document.getElementById("terminalStatus")?.textContent}
}

test("an obsolete connection attempt cannot block a newly restored terminal", async t => {
  let release!: (value:object) => void
  const delayed = new Promise<object>(resolve => {release=resolve})
  const h = await mount(t, id => id === "one" ? delayed : Promise.resolve({ticket:id}))
  h.restore("one")
  await until(() => h.requests.includes("/api/terminals/one/ticket"))
  h.restore("two")
  await until(() => h.sockets.length === 1)
  assert(h.requests.includes("/api/terminals/two/ticket"))
  assert.equal(JSON.parse(h.sockets[0].sent[0]).ticket,"two")
  release({ticket:"one"})
  await tick(); await tick()
  assert.equal(h.sockets.length,1, "late ticket must not install an obsolete socket")
})

test("reconnect drains pending output and ignores obsolete socket callbacks", async t => {
  const h = await mount(t)
  h.restore("one")
  await until(() => h.sockets.length === 1)
  const staleError = h.sockets[0].onerror!
  const staleOpen = h.sockets[0].onopen!
  h.sockets[0].onmessage!({data:JSON.stringify({type:"output",data:"b2xk",seq:99})})
  h.w.document.getElementById("reconnectTerminal")!.click()
  await tick()
  assert.equal(h.sockets.length,1, "reconnect must wait for already received output to finish parsing")
  h.w.terminalWrites[0].done()
  await until(() => h.sockets.length === 2)
  assert.equal(h.sockets[0].onerror,null)
  staleError(); staleOpen()
  assert.equal(h.status(),"已连接")
  h.w.document.getElementById("reconnectTerminal")!.click()
  await until(() => h.sockets.length === 3)
  assert.equal(JSON.parse(h.sockets[2].sent[0]).since,99, "reconnect must retain the sequence of parsed output")
})


test("a disposed terminal's buffered output cannot change another terminal sequence", async t => {
  const h = await mount(t)
  h.restore("one")
  await until(() => h.sockets.length === 1)
  h.sockets[0].onmessage!({data:JSON.stringify({type:"output",data:"b2xk",seq:99})})
  h.restore("two")
  await until(() => h.sockets.length === 2)
  h.w.terminalWrites[0].done()
  h.w.document.getElementById("reconnectTerminal")!.click()
  await until(() => h.sockets.length === 3)
  assert.equal(JSON.parse(h.sockets[2].sent[0]).since,0)
})

test("disposal restores the DOM adapter and releases document listeners", async t => {
  const h = await mount(t)
  h.restore("one")
  await until(() => h.sockets.length === 1)
  assert.notEqual(h.w.document.createElement,h.createElement)
  h.w.WorkHubPage.dispose()
  assert.equal(h.w.document.createElement,h.createElement)
  assert.equal(h.w.terminalInstances[0].disposed,true)
  const count = h.messages.length, reads = h.requests.length
  h.w.document.dispatchEvent(new h.w.Event("pointerdown",{bubbles:true}))
  h.w.document.dispatchEvent(new h.w.Event("focusin",{bubbles:true}))
  h.w.dispatchEvent(new h.w.Event("yolu:appearance"))
  h.restore("two")
  await tick(); await tick()
  assert.equal(h.messages.length,count)
  assert.equal(h.requests.length,reads)
  assert.equal(h.sockets[0].onmessage,null)
})
