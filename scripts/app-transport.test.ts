import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createRequestCache} from '../frontend/core/request-cache'
import {APIError, createAPIClient} from '../frontend/core/api-client'
import {postPageMessage, readPageMessage} from '../frontend/core/page-protocol'

const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done}); return {promise, resolve} }

test('panes share reads by environment and normalized query/headers with independent bodies', async () => {
  let calls = 0
  const cache = createRequestCache(async () => { calls++; return Response.json({value:calls}) })
  const [a, b, other] = await Promise.all([
    cache.read('/api/sessions?cwd=x&archived=true', {headers:{'X-Environment-ID':'local'}}),
    cache.read('/api/sessions?archived=true&cwd=x', {headers:new Headers({'x-environment-id':'local'})}),
    cache.read('/api/sessions?cwd=x&archived=true', {headers:{'X-Environment-ID':'remote'}}),
  ])
  assert.equal(calls, 2)
  assert.deepEqual(await a.json(), await b.json())
  assert.deepEqual(await other.json(), {value:2})
})

test('a mutation prevents an older pending read from repopulating the shared cache', async () => {
  const old = deferred<Response>()
  let reads = 0
  const cache = createRequestCache(async (_, options) => {
    if (options.method === 'POST') return Response.json({ok:true})
    return ++reads === 1 ? old.promise : Response.json({revision:reads})
  })
  const before = cache.read('/api/state')
  await cache.read('/api/projects', {method:'POST'})
  old.resolve(Response.json({revision:1}))
  assert.deepEqual(await (await before).json(), {revision:1})
  assert.deepEqual(await (await cache.read('/api/state')).json(), {revision:2})
})

test('abortable reads stay independent and failed reads are retried', async () => {
  let calls = 0
  const cache = createRequestCache(async (_, options) => {calls++; if (options.signal?.aborted) throw options.signal.reason; return new Response('{}', {status:calls === 1 ? 503 : 200})})
  assert.equal((await cache.read('/api/state')).status, 503)
  assert.equal((await cache.read('/api/state')).status, 200)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(cache.read('/api/state', {signal:abort.signal}), {name:'AbortError'})
  assert.equal((await cache.read('/api/state')).status, 200)
  assert.equal(calls, 3)
})

test('an environment switch rejects an ambient response even during JSON decoding', async () => {
  const body = deferred<unknown>()
  let revision = 0
  const api = createAPIClient({token:'token', context:() => ({environment:'local', revision}), text:t => t,
    read:async () => ({ok:true, json:() => body.promise}) as Response})
  const ambient = api('/api/state')
  const explicit = api('/api/state', {environment:'remote'})
  await Promise.resolve()
  revision++
  body.resolve({environment:'old'})
  await assert.rejects(ambient, {name:'AbortError'})
  assert.deepEqual(await explicit, {environment:'old'})
})

test('API failures retain stable codes and correlation identity for native controllers', async () => {
  const api = createAPIClient({token:'token', context:() => ({environment:'local', revision:0}), text:t => t,
    read:async () => Response.json({error:'Try again', code:'creation_uncertain', details:['Inspect the list'], command:'yolu'}, {status:409, headers:{'X-Request-ID':'correlation'}})})
  await assert.rejects(api('/api/sessions/new', {method:'POST'}), error => {
    assert(error instanceof APIError)
    assert.equal(error.code, 'creation_uncertain')
    assert.equal(error.requestID, 'correlation')
    assert.equal(error.message, 'Try again\nInspect the list')
    assert.equal(error.command, 'yolu')
    return true
  })
})

test('page boundaries ignore malformed state, routes, commands and layout payloads', () => {
  for (const payload of [null, [], {type:'unknown'}, {type:'workhub:page-state'},
    {type:'workhub:page-open',snapshot:{route:'https://outside.test'}},
    {type:'workhub:page-open',snapshot:{route:'/sessions',conversation:{selected:123}}},
    {type:'workhub:page-active',active:'false'}, {type:'workhub:page-pane-command',command:'delete'},
    {type:'workhub:conversation-group',sessions:[{}]}, {type:'workhub:page-chrome',chrome:{left:NaN,top:0}}]) assert.equal(readPageMessage(payload), null)
  const valid = {type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'remote',conversation:{selected:'native'}}}
  assert.deepEqual(readPageMessage(valid), valid)
  assert(readPageMessage({type:'workhub:page-state',snapshot:{route:'/projects',conversation:null}}))
  assert(readPageMessage({type:'workhub:parallel-layout',split:true,canZoom:true}))
  const sent: unknown[] = []
  postPageMessage({postMessage:message => {sent.push(message)}}, 'http://localhost', 'workhub:page-ready', {})
  assert.deepEqual(sent, [{type:'workhub:page-ready'}])
})

test('explicit freshness and no-store reads bypass shared response retention', async () => {
  let calls = 0
  const cache = createRequestCache(async () => Response.json({revision:++calls}))
  await cache.read('/api/state')
  for (const mode of ['no-store', 'reload', 'no-cache'] as const) {
    const first = await (await cache.read('/api/state', {cache:mode})).json()
    const second = await (await cache.read('/api/state', {cache:mode})).json()
    assert.notEqual(first.revision, second.revision)
  }
  assert.equal(calls, 7)
})
