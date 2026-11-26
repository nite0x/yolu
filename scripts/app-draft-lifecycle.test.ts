import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createDraftPersistence} from '../frontend/features/conversations/runtime/draft-persistence'
import {restoreImages, validDraft, type DraftRecord} from '../frontend/features/conversations/runtime/drafts'

const draft: DraftRecord = {text:'Keep my text', images:[], project:'', settings:{}, reading:{top:0,bottom:true,anchor:'',offset:0}, updated:1}

test('draft decoding rejects malformed reading state and safely ignores damaged image records', () => {
  for (const value of [null, [], {...draft,updated:NaN}, {...draft,settings:[]}, {...draft,reading:true}, {...draft,reading:{...draft.reading,top:'3'}}]) assert.equal(validDraft(value), false)
  const damaged = {...draft,images:[null, {}, {url:'data:image/png;base64,eA=='}, {id:'valid',name:'image.png',contentType:'image/png',url:'data:image/png;base64,eA=='}]}
  assert(validDraft(damaged))
  assert.deepEqual(restoreImages(damaged.images).map(image => image.id), ['valid'])
})

test('disposing a draft owner finishes queued writes without notifications or retry timers', async t => {
  let reject: (error: Error) => void = () => {}
  let timers = 0, requests = 0
  t.mock.method(globalThis, 'setTimeout', () => {timers++; return 1 as unknown as ReturnType<typeof setTimeout>})
  const notices: string[] = []
  const owner = createDraftPersistence({
    request: () => {requests++; return new Promise((_resolve, fail) => {reject = fail})},
    key: () => 'owner', enabled: () => true, connected: () => true, submitting: () => false,
    capture: () => draft, restore: () => assert.fail('disposed draft restored'), notice: text => notices.push(text),
  })
  const flushed = owner.flush()
  await Promise.resolve()
  owner.dispose()
  reject(new Error('offline'))
  assert.equal(await flushed, false)
  owner.changed(); owner.persist()
  assert.equal(requests, 1)
  assert.equal(timers, 0)
  assert.deepEqual(notices, [])
})

test('a late draft read cannot restore a disposed owner', async () => {
  let resolve: (value: unknown) => void = () => {}
  const owner = createDraftPersistence({
    request: <T>() => new Promise<T>(done => {resolve = value => done(value as T)}),
    key: () => 'owner', enabled: () => true, connected: () => true, submitting: () => false,
    capture: () => draft, restore: () => assert.fail('disposed draft restored'), notice: () => assert.fail('disposed owner notified'),
  })
  const loaded = owner.load(); owner.dispose(); resolve(draft); await loaded
})

test('restoring a cloud conversation draft preserves the session capability restrictions', async t => {
  const {ChatController} = await import('../frontend/features/conversations/runtime/controller')
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {configurable:true,value:{getItem:() => JSON.stringify(draft)}})
  t.after(() => {if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else Reflect.deleteProperty(globalThis, 'localStorage')})
  const owner = new ChatController({
    session:{id:'cloud',name:'Cloud conversation',cwd:'/repo',provider:'codex-cloud'},
    environment:'local',persistDraft:true,created() {},close() {},
    request:async <T>() => ({} as T),stream:async () => {throw new Error('unused')},
  })
  t.after(() => owner.dispose())
  assert.equal(owner.getSnapshot().draft, draft.text)
  assert.deepEqual(owner.getSnapshot().capabilities, {steer:false,fork:false,handoff:false,rate_limits:false,voice:false})
})
