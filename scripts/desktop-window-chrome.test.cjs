const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {JSDOM} = require('jsdom');
const source = platform => `${readFileSync('src-tauri/src/window-chrome.js', 'utf8')}(${JSON.stringify(platform)});`;

function setup(platform = 'macos', invoke = () => Promise.resolve()) {
  const dom = new JSDOM('<header class="page-heading"><span>空白</span><button><svg></svg></button><a>链接</a><input><span contenteditable="true">编辑</span></header>', {url:'http://127.0.0.1:12345/', runScripts:'outside-only'});
  const calls = [];
  const requests = [];
  dom.window.__TAURI_INTERNALS__ = {invoke: (command, args) => {calls.push(command); requests.push({command,args}); return invoke(command,args);}};
  dom.window.eval(source(platform));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const mouse = (target, type = 'mousedown', options = {}) => target.dispatchEvent(new dom.window.MouseEvent(type, {bubbles:true, button:0, detail:1, ...options}));
  return {dom, calls, requests, mouse, doc:dom.window.document};
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

test('page iframe header drags through the host bridge without creating duplicate overlays', () => {
  const {dom, calls} = setup();
  try {
    const frame = dom.window.document.createElement('iframe');
    frame.src = 'http://127.0.0.1:12345/';
    dom.window.document.body.append(frame);
    const child = frame.contentWindow;
    child.document.write('<body><div class="page-heading"><span>工作区</span><button>新建</button></div></body>');
    child.eval(source('macos'));
    child.document.dispatchEvent(new child.Event('DOMContentLoaded'));
    child.document.querySelector('span').dispatchEvent(new child.MouseEvent('mousedown', {bubbles:true, button:0, detail:1}));
    assert.deepEqual(calls, ['plugin:window|start_dragging']);
    assert.equal(child.document.querySelector('.workhub-window-drag'), null);
  } finally { dom.window.close(); }
});

test('desktop windows with a native title bar still mount the brand menu without custom dragging', () => {
  const {dom, calls, mouse, doc} = setup('linux');
  try {
    assert(doc.documentElement.hasAttribute('data-workhub-desktop'));
    assert(!doc.documentElement.hasAttribute('data-workhub-window-overlay'));
    assert(doc.getElementById('workhubWindowControls'));
    mouse(doc.querySelector('header > span'));
    assert.deepEqual(calls, []);
  } finally {dom.window.close();}
});

test('sidebar blank space drags while brand menus and resize handles keep their interactions', () => {
  const {dom,calls,mouse,doc} = setup();
  try {
    const sidebar = doc.createElement('aside'); sidebar.className = 'sidebar';
    sidebar.innerHTML = '<span>空白</span><button>Yolu 菜单</button><summary>更多</summary><div role="menuitem">工作区首页</div><div role="separator"></div>';
    doc.body.append(sidebar);
    mouse(sidebar.querySelector('span'));
    assert.deepEqual(calls,['plugin:window|start_dragging']);
    for (const target of sidebar.querySelectorAll('button,summary,[role]')) mouse(target);
    assert.equal(calls.length,1);
  } finally {dom.window.close();}
});

test('Windows mounts right-side controls and a native menu on startup pages', async () => {
  const {dom,calls,requests,mouse,doc} = setup('windows');
  try {
    await Promise.resolve();
    assert.equal(doc.documentElement.dataset.workhubPlatform, 'windows');
    assert(doc.documentElement.hasAttribute('data-workhub-window-overlay'));
    const actions = [...doc.querySelectorAll('.workhub-window-actions button')];
    assert.deepEqual(actions.map(button => button.dataset.windowAction), ['minimize','maximize','close']);
    const menu = doc.querySelector('.window-app-menu');
    mouse(menu);
    assert.deepEqual(calls, ['plugin:window|is_maximized']);
    menu.click();
    assert.equal(requests.at(-1).command, 'show_app_menu');
    assert.equal(requests.at(-1).args.ready, false);
    dom.window.WorkHubDesktopWindow.showMenu(true);
    assert.equal(requests.at(-1).args.ready, true);
    menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}));
    assert.equal(calls.at(-1), 'show_app_menu');
    actions[0].click();
    assert.equal(calls.at(-1), 'plugin:window|minimize');
    actions[1].click();
    assert.equal(calls.at(-1), 'plugin:window|internal_toggle_maximize');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1), 'plugin:window|is_maximized');
    actions[2].click();
    assert.equal(calls.at(-1), 'plugin:window|close');
    mouse(doc.querySelector('.workhub-window-drag'));
    assert.equal(calls.at(-1), 'plugin:window|start_dragging');
  } finally {dom.window.close();}
});

test('the production React header replaces the Windows fallback and opens the native menu with readiness', () => {
  const {dom,doc,requests} = setup('windows');
  try {
    dom.window.eval(readFileSync('web/ui/page-layout.js', 'utf8') + '\nwindow.WorkHubLayout = WorkHubLayout;');
    const controls = doc.getElementById('workhubWindowControls');
    const actions = doc.querySelector('.workhub-window-actions');
    const navigated = [];
    const render = ready => dom.window.WorkHubLayout.renderChrome(controls, {
      ready, activeView:'projects', navigate:view => navigated.push(view),
      appMenu:trigger => dom.window.WorkHubDesktopWindow.showMenu(ready, trigger),
    });
    render(false);
    doc.querySelector('.window-app-menu').click();
    assert.equal(requests.at(-1).args.ready, false);
    render(true);
    const trigger = doc.querySelector('.window-utilities .window-app-menu');
    trigger.getBoundingClientRect = () => ({left:720,bottom:30});
    trigger.click();
    assert.deepEqual({...requests.at(-1).args}, {ready:true,x:720,y:30});
    assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
    const before = requests.length;
    trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true}));
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).command, 'show_app_menu');
    assert.equal(doc.querySelectorAll('.window-app-menu').length, 1);
    assert.equal(controls.querySelector('img[src="/yolu.svg"]'), null);
    assert.equal(controls.querySelector('button').dataset.view, 'sessions');
    const navigation = controls.querySelector('.window-header-leading').firstElementChild;
    const destinations = [...navigation.querySelectorAll('button')];
    assert.equal(navigation.nextElementSibling, doc.querySelector('.window-history'));
    assert.deepEqual(destinations.map(button => button.dataset.view), ['sessions','projects','issues','settings']);
    assert(destinations.every(button => button.querySelector('svg') && button.getAttribute('aria-label') && !button.textContent));
    assert.equal(navigation.querySelector('[aria-current="page"]').dataset.view, 'projects');
    destinations[2].click();
    assert.deepEqual(navigated, ['issues']);
    assert.equal(doc.querySelector('.workhub-window-actions'), actions);
    assert.equal(actions.children.length, 3);
  } finally {dom.window.close();}
});

test('Windows updates maximize and restore labels after resize and focus, ignoring stale responses', async () => {
  const pending = [];
  const {dom,doc} = setup('windows', command => command === 'plugin:window|is_maximized'
    ? new Promise(resolve => pending.push(resolve)) : Promise.resolve());
  try {
    const maximize = doc.querySelector('[data-window-action=maximize]');
    dom.window.YoluI18n = {text: message => ({'还原':'Restore','最大化':'Maximize'})[message] || message};
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    pending[1](true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(maximize.dataset.maximized, 'true');
    assert.equal(maximize.getAttribute('aria-label'), 'Restore');
    pending[0](false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(maximize.dataset.maximized, 'true');
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    pending[2](false);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(maximize.dataset.maximized, 'false');
    assert.equal(maximize.title, 'Maximize');
  } finally {dom.window.close();}
});

test('Windows iframe dragging uses the host without mounting controls or a native menu bridge', () => {
  const {dom,calls,doc} = setup('windows');
  try {
    const frame = doc.createElement('iframe');
    frame.src = 'http://127.0.0.1:12345/';
    doc.body.append(frame);
    const child = frame.contentWindow;
    child.document.write('<body><div class="page-heading">Workspace</div></body>');
    child.eval(source('windows'));
    child.document.dispatchEvent(new child.Event('DOMContentLoaded'));
    child.document.querySelector('.page-heading').dispatchEvent(new child.MouseEvent('mousedown', {bubbles:true,button:0,detail:1}));
    assert.equal(calls.at(-1), 'plugin:window|start_dragging');
    assert.equal(child.document.querySelector('.workhub-window-actions'), null);
    assert.equal(child.WorkHubDesktopWindow, undefined);
  } finally {dom.window.close();}
});

for (const platform of ['macos','windows']) test(`native chrome reuses the shared header without duplicate controls (${platform})`, () => {
  const dom = new JSDOM('<header class="workhub-window-drag"><div id="workhubWindowControls"><button id="sharedSearch">Search</button></div></header>',{url:'http://localhost',runScripts:'outside-only'});
  try {
    dom.window.__TAURI_INTERNALS__ = {invoke:() => Promise.resolve(false)};
    dom.window.eval(source(platform));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    assert.equal(dom.window.document.querySelectorAll('.workhub-window-drag').length,1);
    assert.equal(dom.window.document.querySelectorAll('#workhubWindowControls').length,1);
    assert(dom.window.document.getElementById('sharedSearch'));
    assert.equal(dom.window.document.querySelectorAll('.window-app-menu').length,0);
    assert.equal(dom.window.document.querySelectorAll('.workhub-window-action').length,platform === 'windows' ? 3 : 0);
  } finally {dom.window.close();}
});
