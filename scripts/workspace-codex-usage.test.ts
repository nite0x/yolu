import { before, test } from "node:test"
import assert from "node:assert/strict"
import { build } from "esbuild"
import { JSDOM, VirtualConsole } from "jsdom"

let bundle = ""
before(async () => {
  const result = await build({entryPoints:["frontend/workspace/codex-usage.tsx"], outfile:"quota-test.js", bundle:true, write:false, format:"iife", globalName:"Usage", jsx:"automatic", define:{"process.env.NODE_ENV":'"production"'}, plugins:[{name:"no-css",setup(b){b.onLoad({filter:/\.css$/},()=>({contents:"",loader:"css"}))}}]})
  bundle = result.outputFiles.find(file => file.path.endsWith(".js"))!.text + "\nwindow.Usage = Usage;"
})
const pause = () => new Promise(r => setTimeout(r,20))
async function until(check:()=>unknown) { for(let n=0;n<100;n++){if(check()) return;await pause()} assert.ok(check(),"quota UI did not reach expected state") }
function fixture(handler:(path:string, init:RequestInit)=>Promise<unknown>, hidden=false) {
  const errors:unknown[]=[]
  const console=new VirtualConsole();console.on("jsdomError",e=>errors.push(e))
  const dom=new JSDOM('<meta name="csrf-token" content="test-token"><aside><footer class="sidebar-footer"></footer></aside>',{url:"http://localhost",runScripts:"dangerously",pretendToBeVisual:true,virtualConsole:console})
  const w=dom.window
  if(hidden) w.document.documentElement.setAttribute("data-workspace-inactive","")
  Object.assign(w,{ResizeObserver:class{observe(){} unobserve(){} disconnect(){}},fetch:async(path:string,init:RequestInit)=>({ok:true,json:async()=>handler(path,init)})})
  w.eval(bundle)
  let dispose=(w as any).Usage.mountCodexUsage(w.document.querySelector("aside"))
  return {w,errors,remount(){dispose();dispose=(w as any).Usage.mountCodexUsage(w.document.querySelector("aside"))},close(){dispose();dom.window.close()}}
}

test("multiple quota buckets preserve real windows, unknown percentages and zero remaining",async()=>{
  const h=fixture(async()=>({}))
  try {
    const {quotaWindows,quotaDuration}=(h.w as any).Usage
    const windows=quotaWindows({rateLimits:{primary:{usedPercent:99}},rateLimitsByLimitId:{codex:{primary:{usedPercent:100,windowDurationMins:300},secondary:{usedPercent:25,windowDurationMins:10080}},other:{primary:{usedPercent:null}}}})
    assert.deepEqual(Array.from(windows,(w:any)=>w.remaining),[0,75,null])
    assert.equal(quotaDuration(300),"5 小时额度")
    assert.equal(quotaDuration(10080),"每周额度")
    assert.equal(quotaDuration(15),"15 分钟额度")
    assert.equal(quotaDuration(null),"额度窗口")
  } finally {h.close()}
})

test("reset requires explicit confirmation, reuses uncertain attempts after remount and refreshes authoritative limits",async()=>{
  const posts:any[]=[]
  let mode="timeout", count=2, used=95
  let finish:((value:unknown)=>void)|undefined
  const quota=()=>({rateLimits:{primary:{usedPercent:used}},rateLimitResetCredits:{availableCount:count,credits:[{id:"later",resetType:"codexRateLimits",status:"available",title:"Full reset",expiresAt:2100000000},{id:"earlier",resetType:"codexRateLimits",status:"available",title:"Full reset",expiresAt:2000000000}]},checkedAt:1750000000})
  const h=fixture(async(path,init)=>{
    if(path==="/api/environments")return {environments:[]}
    if(init.method==="POST"){
      posts.push(JSON.parse(String(init.body)))
      if(mode==="timeout")throw new Error("暂未确认重置结果")
      return new Promise(resolve=>{finish=resolve})
    }
    return quota()
  })
  try {
    const doc=h.w.document
    const button=(text:string)=>[...doc.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!
    const show=async()=>{await until(()=>doc.querySelector('.codex-quota-trigger'));doc.querySelector<HTMLButtonElement>('.codex-quota-trigger')!.click();await until(()=>button('使用重置卡') && !button('使用重置卡').disabled)}
    await show()
    assert.match(doc.querySelector('.codex-reset-cards')!.textContent!,/可用 2 张/)
    assert.equal(doc.querySelector<HTMLSelectElement>('.codex-reset-choice select')!.value,'earlier')
    button('使用重置卡').click();await until(()=>button('确认使用 1 张'))
    assert.equal(posts.length,0)
    button('取消').click();await until(()=>button('使用重置卡'))
    assert.equal(posts.length,0)
    button('使用重置卡').click();await until(()=>button('确认使用 1 张'))
    button('确认使用 1 张').click()
    await until(()=>doc.querySelector('[role=alert]') && button('重试上次操作'))
    assert.equal(posts.length,1);assert.equal(posts[0].confirmed,true);assert.equal(posts[0].creditId,'earlier')
    assert.ok(posts[0].idempotencyKey)
    h.remount();await until(()=>doc.querySelector('.codex-quota-trigger'))
    doc.querySelector<HTMLButtonElement>('.codex-quota-trigger')!.click()
    await until(()=>button('重试上次操作'))
    assert.equal(posts.length,1,'reopening must not automatically redeem')
    mode='success';button('重试上次操作').click();button('重试上次操作')?.click()
    await until(()=>finish)
    assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1])
    count=1;used=0;finish!({outcome:'alreadyRedeemed'})
    await until(()=>doc.querySelector('.codex-quota-trigger')?.textContent?.includes('100%') && doc.body.textContent?.includes('未重复使用'))
    assert.match(doc.querySelector('.codex-reset-cards')!.textContent!,/可用 1 张/)
    assert.equal(h.w.sessionStorage.length,0)
    assert.deepEqual(h.errors,[])
  }finally{h.close()}
})

test("quota details refresh, isolate environments, preserve stale results on failure and restore keyboard focus",async()=>{
  let remoteDone:((value:unknown)=>void)|undefined
  let fail=false
  const requests:{path:string;env:string}[]=[]
  const h=fixture(async(path,init)=>{
    const headers=init.headers as Record<string,string>
    assert.equal(headers["X-CSRF-Token"],"test-token")
    if(path==="/api/environments") return {environments:[{id:"local",name:"本机"},{id:"remote",name:"远程"}]}
    requests.push({path,env:headers["X-Environment-ID"]})
    if(fail) throw new Error("读取失败")
    if(headers["X-Environment-ID"]==="remote") return new Promise(resolve=>{remoteDone=resolve})
    return {rateLimits:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:1800000000}},checkedAt:1750000000}
  })
  try {
    const doc=h.w.document
    await until(()=>doc.querySelector('.codex-quota-trigger')?.textContent?.includes("75%"))
    const trigger=doc.querySelector<HTMLButtonElement>('.codex-quota-trigger')!
    trigger.focus();trigger.click()
    await until(()=>doc.querySelector('select') && doc.querySelector('[role=meter]'))
    assert.equal(doc.querySelector('[role=meter]')?.getAttribute('aria-valuenow'),"75")
    assert.ok(requests.some(r=>r.path.endsWith('?refresh=1')))
    const select=doc.querySelector('select')!
    select.value="remote";select.dispatchEvent(new h.w.Event("change",{bubbles:true}))
    await until(()=>remoteDone && !doc.querySelector('[role=meter]'))
    assert.ok(!doc.querySelector('.codex-quota-trigger')?.textContent?.includes('75%'))
    remoteDone!({rateLimits:{primary:{usedPercent:90,windowDurationMins:60},secondary:{usedPercent:null}},checkedAt:1750000000})
    await until(()=>doc.querySelector('[role=meter]')?.getAttribute('aria-valuenow')==='10')
    assert.equal(doc.querySelector('.codex-quota-trigger')?.getAttribute('data-tone'),'low')
    assert.ok(doc.body.textContent?.includes('未提供比例'))
    fail=true;doc.querySelector<HTMLButtonElement>('[aria-label="刷新 Codex 额度"]')!.click()
    await until(()=>doc.querySelector('[role=alert]'))
    assert.equal(doc.querySelector('[role=meter]')?.getAttribute('aria-valuenow'),'10')
    assert.match(doc.querySelector('[role=alert]')!.textContent!,/上次成功读取/)
    assert.match(trigger.textContent!,/待更新/)
    doc.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
    await until(()=>!doc.querySelector('.codex-quota-popover'))
    assert.equal(doc.activeElement,trigger)
    assert.deepEqual(h.errors,[])
  }finally{h.close()}
})

test("hidden workspace pages defer quota reads until activated",async()=>{
  let calls=0
  const h=fixture(async()=>{calls++;return {rateLimits:null}},true)
  try {
    await until(()=>h.w.document.querySelector('.codex-quota-trigger'))
    assert.equal(calls,0)
    h.w.document.documentElement.removeAttribute('data-workspace-inactive')
    h.w.dispatchEvent(new h.w.CustomEvent('workhub:tab-visibility'))
    await until(()=>calls===1)
    await until(()=>h.w.document.body.textContent?.includes('未提供额度'))
  }finally{h.close()}
})
