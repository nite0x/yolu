const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {JSDOM} = require('jsdom');
const source = readFileSync('src-tauri/src/window-chrome.js', 'utf8');

function setup() {
  const dom = new JSDOM('<header class="workspace-tabbar"><span>空白</span><button><svg></svg></button><a>链接</a><input><span contenteditable="true">编辑</span></header>', {url:'http://127.0.0.1:12345/', runScripts:'outside-only'});
  const calls = [];
  dom.window.__TAURI_INTERNALS__ = {invoke: command => {calls.push(command); return Promise.resolve();}};
  dom.window.eval(source);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const mouse = (target, type = 'mousedown', options = {}) => target.dispatchEvent(new dom.window.MouseEvent(type, {bubbles:true, button:0, detail:1, ...options}));
  return {dom, calls, mouse, doc:dom.window.document};
}

test('blank title area starts native dragging while all controls retain their clicks', () => {
  const {dom, calls, mouse, doc} = setup();
  try {
    assert(doc.documentElement.hasAttribute('data-workhub-desktop'));
    mouse(doc.querySelector('header > span'));
    assert.deepEqual(calls, ['plugin:window|start_dragging']);
    for (const selector of ['button', 'svg', 'a', 'input', '[contenteditable]']) mouse(doc.querySelector(selector));
    mouse(doc.querySelector('header'), 'mousedown', {button:2});
    assert.equal(calls.length, 1);
    mouse(doc.querySelector('.workhub-window-drag'));
    assert.equal(calls.length, 2);
  } finally { dom.window.close(); }
});

test('double click zooms only when released at its original position', () => {
  const {dom, calls, mouse, doc} = setup();
  try {
    const header = doc.querySelector('header');
    mouse(header, 'mousedown', {detail:2, screenX:50, screenY:50});
    mouse(header, 'mouseup', {detail:2, screenX:51, screenY:50});
    assert.equal(calls.length, 0);
    mouse(header, 'mousedown', {detail:2, screenX:50, screenY:50});
    mouse(header, 'mouseup', {detail:2, screenX:50, screenY:50});
    assert.deepEqual(calls, ['plugin:window|internal_toggle_maximize']);
  } finally { dom.window.close(); }
});

test('tab iframe header drags through the host bridge without creating duplicate overlays', () => {
  const {dom, calls} = setup();
  try {
    const frame = dom.window.document.createElement('iframe');
    frame.src = 'http://127.0.0.1:12345/';
    dom.window.document.body.append(frame);
    const child = frame.contentWindow;
    child.document.write('<body><div class="page-heading"><span>任务</span><button>新建</button></div></body>');
    child.eval(source);
    child.document.dispatchEvent(new child.Event('DOMContentLoaded'));
    child.document.querySelector('span').dispatchEvent(new child.MouseEvent('mousedown', {bubbles:true, button:0, detail:1}));
    assert.deepEqual(calls, ['plugin:window|start_dragging']);
    assert.equal(child.document.querySelector('.workhub-window-drag'), null);
  } finally { dom.window.close(); }
});

test('sidebar blank space drags while brand menus and resize handles keep their interactions', () => {
  const {dom,calls,mouse,doc} = setup();
  try {
    const sidebar = doc.createElement('aside'); sidebar.className = 'sidebar';
    sidebar.innerHTML = '<span>空白</span><button>Yolu 菜单</button><summary>更多</summary><div role="menuitem">新建标签页</div><div role="separator"></div>';
    doc.body.append(sidebar);
    mouse(sidebar.querySelector('span'));
    assert.deepEqual(calls,['plugin:window|start_dragging']);
    for (const target of sidebar.querySelectorAll('button,summary,[role]')) mouse(target);
    assert.equal(calls.length,1);
  } finally {dom.window.close();}
});
