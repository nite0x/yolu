import {before, test} from "node:test"
import assert from "node:assert/strict"
import {build} from "esbuild"
import {JSDOM} from "jsdom"

let bundle = ""
before(async () => {
  const result = await build({stdin:{contents:'export * from "./frontend/features/conversations/creation/choices"; export * from "./frontend/features/conversations/creation/directories"; export * from "./frontend/entities/projects/creation"',resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,format:"iife",globalName:"Choices"})
  bundle = result.outputFiles[0].text + "\nwindow.Choices=Choices;"
})
function fixture() {
  const dom = new JSDOM('<select id="source"></select><div id="sessionBrowserDirectoryChoices"></div><textarea></textarea>', {url:"http://localhost",runScripts:"outside-only",pretendToBeVisual:true})
  const w = dom.window
  const originalMatches = w.HTMLElement.prototype.matches
  w.HTMLElement.prototype.matches = function(selector) { return selector === ":popover-open" ? this.hasAttribute("data-open") : originalMatches.call(this,selector) }
  Object.assign(w.HTMLElement.prototype, {showPopover(){this.setAttribute("data-open", "");this.dispatchEvent(new w.Event("toggle"))},hidePopover(){this.removeAttribute("data-open");this.dispatchEvent(new w.Event("toggle"))},scrollIntoView(){},getClientRects(){return [{width:300,height:200}]}})
  w.eval(bundle)
  const api = (w as any).Choices
  const source = w.document.querySelector("select")!
  const container = w.document.querySelector<HTMLElement>("#sessionBrowserDirectoryChoices")!
  for (let index=0;index<9;index++) {
    const option = new w.Option(index ? `project-${index} · ${index === 2 ? "codex/very-long-branch" : "main"}` : "Default",index ? `/repo/${index}` : "")
    option.title = index ? `/home/work/project-${index}` : ""; source.add(option)
  }
  const focus = () => w.document.querySelector("textarea")!.focus()
  const render = (settings = {}) => api.renderCreationChoices(source,container,undefined,{focus,...settings})
  render()
  const buttons = () => [...container.querySelectorAll<HTMLButtonElement>(":scope > button[data-creation-choice]")]
  const popup = () => container.querySelector<HTMLElement>(".creation-directory-popover")!
  const search = () => container.querySelector<HTMLInputElement>("input")!
  const open = () => container.querySelector<HTMLButtonElement>(".creation-more")!.click()
  const key = (value:string) => search().dispatchEvent(new w.KeyboardEvent("keydown",{key:value,bubbles:true,cancelable:true}))
  return {dom,w,api,source,container,buttons,popup,search,open,key,render}
}

test("the six quick choices stay stable and an overflow selection updates More and returns input focus", async () => {
  const h=fixture()
  try {
    const original=h.buttons().map(button=>button.dataset.creationChoice)
    assert.equal(original.length,6)
    h.open(); assert.equal(h.w.document.activeElement,h.search())
    h.search().value="project-8"; h.search().dispatchEvent(new h.w.Event("input"))
    assert.equal(h.popup().querySelectorAll('[role="option"]').length,1)
    h.key("Enter")
    await new Promise(resolve=>h.w.requestAnimationFrame(resolve))
    assert.equal(h.source.value,"/repo/8")
    assert.equal(h.container.querySelector('.creation-more')?.getAttribute("aria-pressed"),"true")
    assert.deepEqual(h.buttons().map(button=>button.dataset.creationChoice),original)
    assert.equal(h.w.document.activeElement?.tagName,"TEXTAREA")
    assert.equal(h.buttons().filter(button=>button.getAttribute("aria-pressed")==="true").length,0)
    h.open();h.search().value="project-2";h.search().dispatchEvent(new h.w.Event("input"))
    assert.equal(h.popup().querySelectorAll('[role="option"]').length,1,"search includes quick choices")
    h.key("Escape");assert(!h.popup().matches(":popover-open"));assert.equal(h.source.value,"/repo/8")
  } finally {h.dom.window.close()}
})

test("arrows, empty results and disabled choices retain the selection contract", () => {
  const h=fixture()
  try {
    h.open();h.key("ArrowDown");h.key("Enter");assert.equal(h.source.value,"/repo/7")
    h.open();h.search().value="not-here";h.search().dispatchEvent(new h.w.Event("input"));h.key("Enter")
    assert.equal(h.source.value,"/repo/7");assert.equal(h.popup().querySelector('[role="status"]')?.textContent,"无匹配目录")
    h.key("Escape");h.source.disabled=true;h.render();assert(h.buttons().every(button=>button.disabled))
  } finally {h.dom.window.close()}
})

test("the working directory popover opens additional directory setup with the primary selection intact", () => {
  const h=fixture()
  try {
    h.source.value="/repo/3"
    let added = 0
    h.render({addDirectory:() => {added++}})
    h.open()
    const add = h.popup().querySelector<HTMLButtonElement>(".creation-directory-footer:not([hidden])")!
    assert.equal(add.textContent,"添加附加目录")
    add.click()
    assert.equal(added,1)
    assert.equal(h.source.value,"/repo/3")
    assert.equal(h.popup().matches(":popover-open"),false)
  } finally {h.dom.window.close()}
})

test("pinning and fourteen-day creation usage rank only when a new draft resets the quick choices", () => {
  const h=fixture()
  try {
    h.api.recordCreationDirectory("/repo/8","new-session")
    h.api.pinCreationDirectory("/repo/7",true)
    h.render();assert.equal(h.buttons()[1].dataset.creationChoice,"/repo/1")
    h.api.resetCreationChoices(h.container);h.render()
    assert.equal(h.buttons()[1].dataset.creationChoice,"/repo/7")
    assert.equal(h.buttons()[2].dataset.creationChoice,"/repo/8")
    h.api.recordCreationDirectory("/repo/6","old-session",Date.now()-15*86400000)
    assert.equal(h.w.localStorage.getItem('workhub:conversation-defaults:v1:directory-usage:/repo/6'),null)
  } finally {h.dom.window.close()}
})

test("creation roots exclude missing, detached, temporary and separately registered linked checkouts", () => {
  const h=fixture()
  try {
    const trees=[{path:"/repos/app",branch:"main"},{path:"/generated/task",branch:"task"}]
    const projects=[{id:"main",name:"app",path:"/repos/app",worktrees:trees},{id:"linked",name:"task",path:"/generated/task",worktrees:trees},{id:"temp",path:"/private/tmp/test",worktrees:[]},{id:"detached",path:"/repos/detached",worktrees:[{path:"/repos/detached",detached:true}]},{id:"missing",path:"/repos/missing",worktrees:[{path:"/repos/missing",branch:"main",missing:true}]}]
    assert.deepEqual(Array.from(h.api.mainCreationProjects(projects),(item:any)=>item.id),["main"])
  } finally {h.dom.window.close()}
})
