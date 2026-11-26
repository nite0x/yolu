import {test} from "node:test"
import assert from "node:assert/strict"
import {createOperations} from "../frontend/app/model/operations"
import {createSessionRequests} from "../frontend/features/conversations/list/requests"
import {conversationPathKey,conversationEnvironmentKey} from "../frontend/shared/lib/workspace-identity"

test("operation ownership is per environment and resource, and completion cannot release a newer operation", () => {
  const operations=createOperations()
  const first=operations.begin({environment:"local",key:"project:a",project:"a",title:"fetch"})!
  assert.equal(operations.begin({environment:"local",key:"project:a",title:"push"}),undefined)
  assert(operations.begin({environment:"local",key:"project:b",title:"fetch"}))
  assert(operations.begin({environment:"wsl",key:"project:a",title:"fetch"}))
  operations.end(first)
  const next=operations.begin({environment:"local",key:"project:a",title:"push"})!
  operations.end(first)
  assert(operations.snapshot().some(item=>item.id===next.id))
})

test("session queries share simultaneous identical reads while force and navigation invalidate stale requests", async () => {
  const coordinator=createSessionRequests()
  const pending: {path:string;environment:string;resolve:(value:any)=>void}[]=[]
  const request=<T>(path:string,options:{environment:string})=>new Promise<T>(resolve=>pending.push({path,environment:options.environment,resolve}))
  const a=coordinator.load(request,"local","cwd=%2Frepo&archived=true")
  const b=coordinator.load(request,"local","archived=true&cwd=%2Frepo")
  assert.equal(pending.length,1)
  const forced=coordinator.load(request,"local","cwd=%2Frepo&archived=true",true)
  assert.equal(pending.length,2)
  assert.match(pending[1].path,/refresh=1/)
  pending[1].resolve({sessions:[{id:"fresh"}]})
  await forced
  pending[0].resolve({sessions:[{id:"old"}]})
  await Promise.all([a,b])
  assert.equal((await coordinator.load(request,"local","archived=true&cwd=%2Frepo")).sessions[0].id,"fresh")
  coordinator.invalidate("local")
  const after=coordinator.load(request,"local","archived=true&cwd=%2Frepo")
  assert.equal(pending.length,3)
  pending[2].resolve({sessions:[]});await after
})

test("canonical path keys normalize Windows aliases and scope IDs by environment", () => {
  assert.equal(conversationPathKey("C:\\Repo\\"),"c:/repo")
  assert.equal(conversationPathKey("/Home/Repo/"),"/Home/Repo")
  assert.notEqual(conversationEnvironmentKey("local","same"),conversationEnvironmentKey("wsl","same"))
})
