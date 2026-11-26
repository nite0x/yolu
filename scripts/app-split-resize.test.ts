import {test} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {setupConversationResize} from '../frontend/features/conversations/list/resize'

test('conversation resizing shares pointer bounds, finishes on narrow layout and releases all listeners', () => {
  const dom = new JSDOM('<div id="host"><div class="session-browser-body"><aside id="sessionBrowserListPane"></aside><div id="sessionBrowserResize" tabindex="0"></div></div></div>', {url:'http://localhost'})
  try {
    const document = dom.window.document
    const host = document.getElementById('host')!
    const body = host.querySelector<HTMLElement>('.session-browser-body')!
    const list = document.getElementById('sessionBrowserListPane')!
    const handle = document.getElementById('sessionBrowserResize')!
    let available = 1000
    body.getBoundingClientRect = () => ({width:available}) as DOMRect
    list.getBoundingClientRect = () => ({width:parseFloat(host.style.getPropertyValue('--conversation-list-width')) || 280}) as DOMRect
    const dispose = setupConversationResize(host, dom.window as unknown as Window)
    const pointer = (target: EventTarget, type: string, x: number, id = 1) => {
      const event = new dom.window.MouseEvent(type, {clientX:x,button:0,bubbles:true,cancelable:true})
      Object.defineProperty(event, 'pointerId', {value:id})
      target.dispatchEvent(event)
    }
    pointer(handle, 'pointerdown', 280); pointer(document, 'pointerup', 280)
    assert.equal(dom.window.localStorage.getItem('workhub:conversation-list-width:v1'), null, 'a click must not persist an untouched width')
    pointer(handle, 'pointerdown', 280); pointer(document, 'pointermove', 400, 2)
    assert.equal(host.style.getPropertyValue('--conversation-list-width'), '')
    pointer(document, 'pointermove', 400)
    assert.equal(handle.getAttribute('aria-valuenow'), '400')
    available = 600; dom.window.dispatchEvent(new dom.window.Event('resize'))
    assert.equal(host.hasAttribute('data-resizing'), false)
    assert.equal(dom.window.localStorage.getItem('workhub:conversation-list-width:v1'), '400')
    available = 1000
    dispose(); dispose()
    pointer(handle, 'pointerdown', 400); pointer(document, 'pointermove', 500); pointer(document, 'pointerup', 500)
    handle.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'End'}))
    assert.equal(host.style.getPropertyValue('--conversation-list-width'), '400px')
    assert.equal(host.hasAttribute('data-resizing'), false)
  } finally {dom.window.close()}
})
