const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

const compatibility = fs.readFileSync('web/core/browser-compat.js', 'utf8');

test('LAN HTTP pages generate RFC 4122 UUIDs and mount the application without native randomUUID', t => {
  const dom = new JSDOM(fs.readFileSync('web/app.html', 'utf8'), {url:'http://192.168.1.20:4318/',runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperty(w.crypto, 'randomUUID', {value:undefined, writable:true, configurable:true});
  w.eval(compatibility);
  const ids = Array.from({length:100}, () => w.crypto.randomUUID());
  assert.equal(new Set(ids).size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  w.WorkHubLayout = {renderPanes(){},renderChrome(){},setupSplitResize(){},createGlobalSearch(){return {open(){},remember(){}};}};
  for (const file of ['web/core/conversation-list-width.js','web/core/page-host.js']) w.eval(fs.readFileSync(file,'utf8'));
  assert.equal(w.document.querySelectorAll('iframe.workspace-page').length, 2);
  assert([...w.document.querySelectorAll('iframe.workspace-page')].some(frame => new URL(frame.src).hash === '#/sessions'));
  const page = new URL(w.document.querySelector('iframe.workspace-page').src);
  assert.equal(page.searchParams.get('app-desktop'), '1');
  assert.equal(page.searchParams.has('app-sidebar-width'), false);
  assert(w.document.querySelector('.workspace-navigation-frame'));
  assert.equal(w.__TAURI_INTERNALS__, undefined);
});

test('both browser entry points enable the shared application layout before controllers load', t => {
  for (const file of ['web/app.html', 'web/index.html']) {
    const dom = new JSDOM(fs.readFileSync(file, 'utf8'));
    assert(dom.window.document.documentElement.hasAttribute('data-workhub-desktop'), file);
    assert(!dom.window.document.documentElement.hasAttribute('data-workhub-platform'), file);
    dom.window.close();
  }
});

test('browser compatibility preserves native UUID generation and loads before every application entry', t => {
  const dom = new JSDOM('', {runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const native = dom.window.crypto.randomUUID;
  dom.window.eval(compatibility);
  assert.equal(dom.window.crypto.randomUUID, native);
  for (const file of ['web/index.html','web/app.html','web/terminal.html']) {
    const html = fs.readFileSync(file,'utf8');
    assert(html.indexOf('/core/browser-compat.js') < html.indexOf('/ui/'));
  }
});
