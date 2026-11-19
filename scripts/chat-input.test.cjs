const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../web/core/chat-input.js'), 'utf8');

test('saved send shortcuts bootstrap independently of browser storage and invalid choices default to Enter', t => {
  for (const [saved, expected] of [['enter', 'enter'], ['ctrlEnter', 'ctrlEnter'], ['', 'enter'], ['invalid', 'enter']]) {
    const dom = new JSDOM(`<meta name="ui-send-shortcut" content="${saved}">`, {url:'http://localhost', runScripts:'outside-only'});
    t.after(() => dom.window.close());
    dom.window.localStorage.setItem('yolu:chat-input-signal:v1', JSON.stringify({sendShortcut:'enter'}));
    dom.window.eval(source);
    assert.equal(dom.window.YoluChatInput.current(), expected);
  }
});

test('saving updates all open panes without storage and storage signals update other windows', t => {
  const dom = new JSDOM('<iframe></iframe>', {url:'http://localhost', runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  const pane = w.document.querySelector('iframe').contentWindow;
  for (const page of [w, pane]) page.eval(source);
  Object.defineProperty(w, 'localStorage', {get() {throw new Error('Storage unavailable');}});
  pane.YoluChatInput.apply('enter');
  assert.equal(w.YoluChatInput.current(), 'enter');
  assert.equal(pane.YoluChatInput.current(), 'enter');
  w.dispatchEvent(new w.StorageEvent('storage', {key:'yolu:chat-input-signal:v1', newValue:JSON.stringify({sendShortcut:'ctrlEnter'})}));
  assert.equal(w.YoluChatInput.current(), 'ctrlEnter');
  w.dispatchEvent(new w.StorageEvent('storage', {key:'yolu:chat-input-signal:v1', newValue:'invalid'}));
  assert.equal(w.YoluChatInput.current(), 'ctrlEnter');
});
