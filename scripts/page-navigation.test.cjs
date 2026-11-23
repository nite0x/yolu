const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '../web');

function harness(t, hash = '#/projects', {desktop = false, listWidth} = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root,'app.html'),'utf8'), {url:'http://localhost:4317/' + hash, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const {window:w} = dom;
  Object.defineProperty(w,'innerWidth',{value:1800,configurable:true});
  if (listWidth) w.localStorage.setItem('workhub:conversation-list-width:v1',String(listWidth));
  if (desktop) {
    w.document.documentElement.setAttribute('data-workhub-desktop','');
    w.localStorage.setItem('workhub:sidebar-collapsed:v1','false');
    w.localStorage.setItem('workhub:sidebar-width:v1','360');
  }
  const layouts = [], splitters = [], chrome = [];
  const search = { openers: [], visits: [] };
  w.WorkHubLayout = {
    renderPanes:(_,props) => layouts.push(props), renderChrome(container,props) {chrome.push({container,props});}, setupSplitResize(options) { splitters.push(options); },
    createGlobalSearch(_, {navigate}) {
      search.navigate = navigate;
      return {open(trigger){search.openers.push(trigger);},remember(snapshot){search.visits.push(snapshot);}};
    },
    conversationDefaults:{get() {return 'ui';},set() {}},
  };
  const requests = [];
  w.fetch = async (...args) => {requests.push(args); return new Response('{}');};
  for (const file of ['core/conversation-list-width.js','core/page-host.js']) w.eval(fs.readFileSync(path.join(root,file),'utf8'));
  const frames = () => [...w.document.querySelectorAll('iframe.workspace-page')];
  const send = (frame,type,extra = {},origin = w.location.origin) => w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin,data:{type,...extra}}));
  const messages = new Map();
  const ready = (frame,restored = true) => {
    const received = [];
    frame.contentWindow.postMessage = message => received.push(message);
    frame.contentWindow.WorkHubPage = {canClose:() => true,dispose() {}};
    messages.set(frame,received); send(frame,'workhub:page-ready');
    if (restored) send(frame,'workhub:page-restored');
    return received;
  };
  const workspace = frames()[0]; ready(workspace);
  return {w,frames,send,ready,messages,layouts,chrome,requests,splitters,search,workspace,nav:() => w.document.querySelector('.workspace-navigation-frame')};
}
const conversation = id => ({route:'/sessions',environment:'local',title:id,conversation:{scope:{kind:'all'},selected:id,pane:'detail'}});
const open = (h,snapshot,placement) => {
  h.send(h.workspace,'workhub:page-open',{snapshot,placement});
  // Complete the normal frame handshake. Transition tests below deliver the
  // two readiness notifications individually to model slow document loads.
  if (h.nav() && !h.messages.has(h.nav())) h.ready(h.nav());
  for (const frame of h.frames()) if (frame !== h.workspace && !h.messages.has(frame)) h.ready(frame);
};
const visible = h => h.frames().filter(frame => !frame.hidden);

test('global search opens from the visible workspace page or a focused conversation and keeps the result environment', t => {
  const h = harness(t);
  const mount = (frame, tag) => {
    const doc = frame.contentDocument;
    const html = doc.documentElement || doc.appendChild(doc.createElement('html'));
    const body = doc.body || html.appendChild(doc.createElement('body'));
    return body.appendChild(doc.createElement(tag));
  };
  const launcher = mount(h.workspace, 'button');
  launcher.id = 'openGlobalSearch';
  h.send(h.workspace, 'workhub:global-search');
  assert.equal(h.search.openers[0], launcher);

  const remote = {...conversation(JSON.stringify(['remote', 'thread'])), environment:'remote'};
  h.search.navigate(remote);
  h.ready(h.nav());
  const reader = h.frames()[1];
  h.ready(reader);
  assert.equal(h.w.location.search, '?environment=remote');
  assert.equal(h.search.visits.at(-1).conversation.selected, remote.conversation.selected);
  h.send(h.workspace, 'workhub:global-search');
  assert.equal(h.search.openers.length, 1);

  const composer = mount(reader, 'textarea');
  composer.focus();
  const shortcut = new reader.contentWindow.KeyboardEvent('keydown', {key:'k', metaKey:true, bubbles:true, cancelable:true});
  composer.dispatchEvent(shortcut);
  assert.equal(shortcut.defaultPrevented, true);
  assert.equal(h.search.openers.at(-1), composer);
});

test('one shared navigator is mounted on the initial page without a rail inset', t => {
  const h = harness(t, '#/projects', {desktop:true});
  const nav = h.nav(), source = nav.src;
  assert.equal(new URL(source).searchParams.has('app-sidebar-width'),false);
  assert.equal(nav.parentElement.hidden,false);
  assert(h.w.document.body.hasAttribute('data-workspace-navigation-visible'));
  open(h, {route:'/issues',environment:'local'});
  open(h, {route:'/settings',environment:'local'});
  assert.equal(h.nav(),nav);
  assert.equal(nav.src,source);
  assert.equal(nav.parentElement.hidden,false);
  assert.equal(h.messages.get(nav).findLast(message=>message.type==='workhub:navigation-route').route,'/settings');
});

test('desktop home opens conversations in the current environment', t => {
  const h = harness(t, '#/projects', {desktop:true});
  open(h,{route:'/projects/app',environment:'remote'});
  h.w.dispatchEvent(new h.w.Event('workhub:desktop-home'));
  assert.equal(h.w.location.hash, '#/sessions');
  assert.equal(h.w.location.search, '?environment=remote');
  open(h,{...conversation('one'),environment:'remote'});
  h.w.dispatchEvent(new h.w.Event('workhub:desktop-home'));
  assert.equal(h.w.location.hash.split('?')[0], '#/sessions');
  assert.equal(h.w.location.search, '?environment=remote');
});

test('desktop conversation list leaves space for detail on resize and restores the saved width', t => {
  const h = harness(t, '#/projects', {desktop:true, listWidth:520});
  open(h, conversation('one'));
  const current = () => h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width');
  assert.equal(current(), '520px');
  Object.defineProperty(h.w,'innerWidth',{value:780});
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.equal(current(), '412px');
  assert.equal(h.w.localStorage.getItem('workhub:conversation-list-width:v1'), '520');
  Object.defineProperty(h.w,'innerWidth',{value:1400});
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.equal(current(), '520px');
  h.splitters[0].resize(390);
  h.splitters[0].commit();
  assert.equal(h.w.WorkHubListWidth.current(),390);
  assert.equal(h.w.localStorage.getItem('workhub:desktop-list-width:v1'),'390');
});

for (const first of ['navigation','reader']) test(`projects remain visible until both conversation documents restore (${first} first)`, t => {
  const h = harness(t,'#/projects');
  const document = h.workspace.contentDocument, source = h.workspace.src;
  h.send(h.workspace,'workhub:page-open',{snapshot:{route:'/sessions',environment:'local'}});
  const reader = h.frames().find(frame => frame !== h.workspace), navigation = h.nav();
  assert.deepEqual(visible(h),[h.workspace]);
  assert.equal(h.w.document.body.hasAttribute('data-workspace-conversations'),false);
  assert.equal(navigation.parentElement.hidden,false);
  h.ready(reader,false); h.ready(navigation,false);
  assert.deepEqual(visible(h),[h.workspace],'registered listeners do not imply a restored layout');
  assert.equal(h.messages.get(reader).findLast(message=>message.type==='workhub:page-restore').active,false);
  const order = first === 'navigation' ? [navigation,reader] : [reader,navigation];
  h.send(order[0],'workhub:page-restored');
  assert.deepEqual(visible(h),[h.workspace]);
  h.send(order[1],'workhub:page-restored');
  assert.deepEqual(visible(h),[reader]);
  assert.equal(navigation.parentElement.hidden,false);
  assert.equal(h.w.document.body.hasAttribute('data-workspace-conversations'),true);
  assert.equal(h.workspace.contentDocument,document);
  assert.equal(h.workspace.src,source);
  assert.equal(h.messages.get(reader).findLast(message=>message.type==='workhub:page-active').active,true);
});

test('a late conversation restore cannot override navigation back to projects', t => {
  const h = harness(t,'#/projects');
  h.send(h.workspace,'workhub:page-open',{snapshot:conversation('one')});
  const reader = h.frames().find(frame => frame !== h.workspace), navigation = h.nav();
  h.ready(reader,false); h.ready(navigation,false);
  open(h,{route:'/projects/app',environment:'local'});
  h.send(reader,'workhub:page-restored'); h.send(navigation,'workhub:page-restored');
  assert.deepEqual(visible(h),[h.workspace]);
  assert.equal(navigation.parentElement.hidden,false);
  assert.equal(h.w.location.hash,'#/projects/app');
  open(h,{route:'/sessions',environment:'local'});
  assert.deepEqual(visible(h),[reader]);
});

test('loading an additional pane keeps the existing conversation on screen', t => {
  const h = harness(t);
  open(h,conversation('one'));
  const reader = visible(h)[0];
  h.send(h.workspace,'workhub:page-open',{snapshot:conversation('two'),placement:'split'});
  assert.equal(reader.hidden,false);
  assert.equal(h.workspace.hidden,true);
  assert.equal(h.nav().parentElement.hidden,false);
});

test('shared navigation expands for its modal and restores pane input on close', t => {
  const h = harness(t);
  open(h, conversation('one'));
  const reader = visible(h)[0], nav = h.nav();
  const pages = h.w.document.querySelector('#workspacePages');
  const resize = h.w.document.querySelector('.workspace-shared-list-resize');
  h.send(reader, 'workhub:navigation-modal', {open:true});
  assert.equal(pages.hasAttribute('inert'), false);
  h.send(nav, 'workhub:navigation-modal', {open:true});
  assert.equal(nav.parentElement.hasAttribute('data-modal'), true);
  assert.equal(pages.hasAttribute('inert'), true);
  assert.equal(resize.hidden, true);
  h.send(nav, 'workhub:navigation-modal', {open:false});
  assert.equal(nav.parentElement.hasAttribute('data-modal'), false);
  assert.equal(pages.hasAttribute('inert'), false);
  assert.equal(resize.hidden, false);
  assert.deepEqual(visible(h), [reader]);
});

test('a retained creation form can finish restoring while its alternate is visible', t => {
  const h = harness(t);
  const draft = {route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},creating:true,pane:'detail'}};
  open(h,draft);
  const reader = visible(h)[0];
  h.send(reader,'workhub:conversation-kind',{kind:'terminal',snapshot:draft});
  const terminal = visible(h)[0];
  h.ready(terminal,false);
  h.send(terminal,'workhub:conversation-kind',{kind:'ui',snapshot:{route:'/terminals',environment:'local'}});
  assert.deepEqual(visible(h),[reader]);
  h.send(terminal,'workhub:page-restored');
  h.send(reader,'workhub:conversation-kind',{kind:'terminal',snapshot:draft});
  assert.deepEqual(visible(h),[terminal]);
  open(h,{route:'/projects',environment:'local'});
  open(h,{route:'/sessions',environment:'local'});
  assert.deepEqual(visible(h),[terminal]);
});

test('independent pages reuse one document and preserve project routes and directory parameters', t => {
  const h = harness(t);
  for (const route of ['/projects','/projects/app','/projects/app/git?path=%2Frepo%2Fapp','/projects/app/worktrees','/projects/app','/settings']) {
    open(h,{route,environment:'remote'});
    assert.equal(h.frames().length,1);
    assert.equal(visible(h)[0],h.workspace);
    assert.equal(h.w.location.hash,'#' + route);
    assert.equal(h.w.location.search,'?environment=remote');
    assert.equal(h.messages.get(h.workspace).findLast(message => message.type === 'workhub:page-restore').snapshot.route,route);
  }
  assert.equal(h.w.document.querySelector('[role="tab"]'),null);
  assert.equal(h.requests.length,0);
  for (const key of ['t','w','Tab','1']) {
    const event = new h.w.KeyboardEvent('keydown',{key,ctrlKey:true,cancelable:true});
    h.w.document.dispatchEvent(event);
    assert.equal(event.defaultPrevented,false);
  }
});

test('parallel Agents remain mounted while sidebar navigation opens independent pages', t => {
  const h = harness(t);
  open(h,conversation('one')); h.ready(visible(h)[0]); h.ready(h.nav());
  open(h,conversation('two'),'split'); h.ready(visible(h)[1]);
  open(h,conversation('three'),'split'); h.ready(visible(h)[2]);
  const readers = visible(h), documents = readers.map(frame => frame.contentDocument);
  assert.equal(readers.length,3);
  assert.equal(h.nav().hidden,false);
  h.send(h.nav(),'workhub:page-open',{snapshot:{route:'/projects/app',environment:'local'}});
  assert.equal(visible(h).length,1);
  assert.equal(visible(h)[0],h.workspace);
  assert.equal(h.nav().parentElement.hidden,false);
  const geometry = h.messages.get(h.workspace).findLast(message => message.type === 'workhub:page-pane');
  assert.equal(geometry.shared,false);
  assert.equal(geometry.split,false);
  open(h,{route:'/sessions',environment:'local'});
  assert.deepEqual(visible(h),readers);
  assert.deepEqual(readers.map(frame => frame.contentDocument),documents);
  assert.equal(h.nav().parentElement.hidden,false);
  assert.equal(h.frames().length,4);
  open(h,conversation('four'),'split');
  assert.equal(visible(h).length,3);
});

test('history selection changes the focused reader and focuses an already open Agent', t => {
  const h = harness(t);
  open(h,conversation('one')); h.ready(visible(h)[0]); h.ready(h.nav());
  open(h,conversation('two'),'split'); h.ready(visible(h)[1]);
  const readers = visible(h);
  h.send(h.nav(),'workhub:conversation-select',{snapshot:conversation('three')});
  assert.equal(h.frames().length,3);
  assert.equal(h.messages.get(readers[1]).findLast(message => message.type === 'workhub:page-restore').snapshot.conversation.selected,'three');
  h.send(h.nav(),'workhub:conversation-select',{snapshot:conversation('one')});
  assert.equal(readers[0].dataset.focused,'true');
  assert.equal(readers[1].dataset.focused,'false');
  assert.equal(h.nav().parentElement.hidden,false);
});

test('pane close and zoom controls operate independently of page navigation', t => {
  const h = harness(t);
  open(h,conversation('one')); h.ready(visible(h)[0]); h.ready(h.nav());
  open(h,conversation('two'),'split'); h.ready(visible(h)[1]);
  const [first,second] = visible(h);
  h.send(second,'workhub:page-pane-command',{command:'zoom'});
  assert.deepEqual(visible(h),[second]);
  h.send(h.nav(),'workhub:conversation-select',{snapshot:conversation('two')});
  assert.deepEqual(visible(h),[first,second]);
  h.send(second,'workhub:page-pane-command',{command:'close'});
  assert.deepEqual(visible(h),[first]);
  assert.equal(second.isConnected,false);
  assert.equal(h.nav().parentElement.hidden,false);
});

test('narrow windows expose every retained conversation through a selector', t => {
  const h = harness(t);
  open(h,conversation('one')); h.ready(visible(h)[0]);
  open(h,conversation('two'),'split'); h.ready(visible(h)[1]);
  Object.defineProperty(h.w,'innerWidth',{value:900}); h.w.dispatchEvent(new h.w.Event('resize'));
  const selector = h.w.document.getElementById('workspaceNarrowPanes');
  assert.equal(selector.options.length,2);
  assert.equal(visible(h).length,1);
  selector.value = selector.options[0].value; selector.dispatchEvent(new h.w.Event('change'));
  assert.equal(visible(h)[0].id,'page-' + selector.value);
});

test('draft pane labels distinguish empty drafts and update without changing the focused pane', t => {
  const h = harness(t);
  const draft = {route:'/sessions',environment:'local',title:'新建对话',conversation:{scope:{kind:'all'},creating:true,selected:null,pane:'detail'}};
  open(h,draft);
  open(h,draft,'split');
  const panes = visible(h);
  Object.defineProperty(h.w,'innerWidth',{value:900}); h.w.dispatchEvent(new h.w.Event('resize'));
  const selector = h.w.document.getElementById('workspaceNarrowPanes');
  assert.equal(new Set([...selector.options].map(option=>option.textContent)).size,2);
  const focused = selector.value;
  h.send(panes[0],'workhub:page-state',{snapshot:{...draft,title:'草稿：优化导航',draftTitle:'优化导航'}});
  assert.match(selector.options[0].textContent,/草稿：优化导航/);
  assert.equal(selector.value,focused,'renaming a draft preview does not focus another pane');
});

test('foreign messages cannot navigate the workspace or replace a conversation', t => {
  const h = harness(t), route = h.w.location.hash;
  h.send(h.workspace,'workhub:page-open',{snapshot:conversation('one')},'https://example.invalid');
  assert.equal(h.w.location.hash,route);
  assert.equal(h.frames().length,1);
});

test('late updates from the hidden workspace cannot replace a parallel Agent', t => {
  const h = harness(t);
  open(h,conversation('one')); h.ready(visible(h)[0]); h.ready(h.nav());
  open(h,conversation('two'),'split'); h.ready(visible(h)[1]);
  const reader = visible(h)[1], messages = h.messages.get(reader), before = messages.length;
  h.send(h.workspace,'workhub:page-state',{snapshot:conversation('stale')});
  assert.equal(messages.length,before);
  assert.equal(h.w.location.hash.split('?')[0],'#/sessions');
});

test('page navigation from a single reader preserves its conversation and opens the workspace document', t => {
  const h = harness(t);
  open(h,conversation('one')); const reader = visible(h)[0]; h.ready(reader); h.ready(h.nav());
  h.send(reader,'workhub:page-state',{snapshot:{route:'/projects/app',environment:'local'}});
  assert.deepEqual(visible(h),[h.workspace]);
  assert.equal(h.w.location.hash,'#/projects/app');
  const restored = h.messages.get(reader).findLast(message => message.type === 'workhub:page-restore');
  assert.equal(restored.snapshot.conversation.selected,'one');
  assert.equal(restored.active,false);
  open(h,{route:'/sessions',environment:'local'});
  assert.deepEqual(visible(h),[reader]);
});

test('narrow navigation uses the retained navigator and dismisses on chat selection', t => {
  const h = harness(t);
  Object.defineProperty(h.w,'innerWidth',{value:640});
  open(h,conversation('one'));
  const reader = visible(h)[0], nav = h.nav();
  const button = h.w.document.getElementById('workspaceNavigationToggle');
  assert.equal(nav.parentElement.hidden,true);
  assert.equal(h.w.document.body.hasAttribute('data-workspace-navigation-visible'),false);
  assert.equal(h.messages.get(reader).findLast(message => message.type === 'workhub:page-pane').shared,true);
  button.click();
  assert.equal(nav.parentElement.hidden,false);
  assert.equal(button.getAttribute('aria-expanded'),'true');
  h.send(nav,'workhub:conversation-select',{snapshot:conversation('one')});
  assert.deepEqual(visible(h),[reader]);
  assert.equal(nav.parentElement.hidden,true);
  assert.equal(button.getAttribute('aria-expanded'),'false');
});

test('removed global assistant cannot open a panel through links, messages or its former shortcut', t => {
  const h = harness(t, '#/assistant', {desktop:true});
  assert.equal(h.w.document.getElementById('workspaceAssistant'), null);
  assert.equal(new URL(h.workspace.src).hash, '#/projects');
  h.send(h.nav(), 'workhub:assistant-toggle');
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', {code:'KeyY', altKey:true, shiftKey:true, bubbles:true}));
  assert.equal(h.w.document.getElementById('workspaceAssistant'), null);
});

for (const desktop of [false,true]) test(`header destinations, search and refresh work across page changes (desktop=${desktop})`, async t => {
  const h = harness(t,'#/projects',{desktop});
  assert.equal(h.w.document.querySelectorAll('.workhub-window-drag').length,1);
  assert.equal(h.chrome.at(-1).container,h.w.document.getElementById('workhubWindowControls'));
  assert.equal(h.chrome.at(-1).props.activeView,'projects');
  const trigger = h.w.document.createElement('button');
  h.chrome.at(-1).props.search(trigger);
  assert.equal(h.search.openers.at(-1),trigger);
  open(h,{route:'/projects/app',environment:'remote'});
  assert.equal(h.chrome.at(-1).props.activeView,'projects');
  const refreshed = [];
  h.workspace.contentWindow.WorkHubPage.refresh = async () => {refreshed.push('workspace'); return 'updated';};
  h.nav().contentWindow.WorkHubPage.refresh = async () => {refreshed.push('navigation'); return 'updated';};
  assert.equal(await h.chrome.at(-1).props.refresh(),'updated');
  assert.deepEqual(refreshed.sort(),['navigation','workspace']);
  h.nav().contentWindow.WorkHubPage.refresh = async () => 'pending';
  assert.equal(await h.chrome.at(-1).props.refresh(),'pending');
  h.nav().contentWindow.WorkHubPage.refresh = async () => 'failed';
  assert.equal(await h.chrome.at(-1).props.refresh(),'failed');
  for (const view of ['issues','settings','projects']) {
    h.chrome.at(-1).props.navigate(view);
    assert.equal(h.w.location.hash,'#/' + view);
    assert.equal(h.w.location.search,'?environment=remote');
    assert.equal(h.chrome.at(-1).props.activeView,view);
  }
});

const traverse = (h, action) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('history traversal did not complete')), 1000);
  h.w.addEventListener('popstate', () => {clearTimeout(timer); resolve();}, {once:true});
  action();
});
for (const desktop of [false,true]) test(`back and forward restore the exact retained conversation and project directory (desktop=${desktop})`, async t => {
  const h = harness(t, '#/projects', {desktop});
  assert.equal(h.chrome.at(-1).props.canGoBack, false);
  assert.equal(h.chrome.at(-1).props.canGoForward, false);
  const snapshot = {...conversation('remote-thread'), environment:'remote'};
  open(h, snapshot);
  const reader = visible(h)[0], document = reader.contentDocument;
  const html = document.appendChild(document.createElement('html'));
  const body = html.appendChild(document.createElement('body'));
  const draft = body.appendChild(document.createElement('textarea'));
  draft.value = 'unsent draft';
  const route = '/projects/app?directory=%2Frepo%2Ffeature';
  open(h, {route,environment:'remote'});
  const length = h.w.history.length;
  await traverse(h, () => h.chrome.at(-1).props.back());
  assert.deepEqual(visible(h), [reader]);
  assert.equal(reader.contentDocument, document);
  assert.equal(draft.value, 'unsent draft');
  assert.equal(h.w.location.search, '?environment=remote');
  assert.equal(h.chrome.at(-1).props.canGoForward, true);
  await traverse(h, () => h.chrome.at(-1).props.forward());
  assert.equal(h.w.location.hash, '#' + route);
  assert.deepEqual(visible(h), [h.workspace]);
  assert.equal(h.w.history.length, length);
  assert.equal(h.chrome.at(-1).props.canGoForward, false);
});

test('browser history distinguishes conversation URLs and ignores metadata updates', async t => {
  const h = harness(t);
  open(h,conversation('one'));
  const reader = visible(h)[0];
  open(h,conversation('two'));
  const length = h.w.history.length;
  h.send(reader, 'workhub:page-state', {snapshot:{...conversation('two'),title:'Renamed',context:'Running'}});
  assert.equal(h.w.history.length, length);
  await traverse(h, () => h.w.history.back());
  assert.equal(h.messages.get(reader).findLast(m => m.type === 'workhub:page-restore').snapshot.conversation.selected, 'one');
  await traverse(h, () => h.w.history.forward());
  assert.equal(h.messages.get(reader).findLast(m => m.type === 'workhub:page-restore').snapshot.title, 'Renamed');
  await traverse(h, () => h.w.history.back());
  open(h, {route:'/settings',environment:'local'});
  assert.equal(h.chrome.at(-1).props.canGoForward, false);
  await traverse(h, () => h.w.history.back());
  assert.equal(h.messages.get(reader).findLast(m => m.type === 'workhub:page-restore').snapshot.conversation.selected, 'one');
});

test('history restores focused split readers and keyboard navigation works inside frames', async t => {
  const h = harness(t);
  open(h,conversation('one'));
  open(h,conversation('two'),'split');
  const readers = visible(h);
  open(h,{route:'/projects/app',environment:'local'});
  const key = new h.workspace.contentWindow.KeyboardEvent('keydown', {key:'ArrowLeft',altKey:true,bubbles:true,cancelable:true});
  await traverse(h, () => h.workspace.contentDocument.dispatchEvent(key));
  assert.equal(key.defaultPrevented,true);
  assert.deepEqual(visible(h),readers);
  assert.equal(readers[1].dataset.focused,'true');
  await traverse(h, () => h.w.history.back());
  assert.deepEqual(visible(h),readers);
  assert.equal(readers[0].dataset.focused,'true');
});

test('history respects resource close guards and recovers its URL and controls', async t => {
  const h = harness(t);
  open(h, conversation('one'));
  open(h, {route:'/settings',environment:'local'});
  h.workspace.contentWindow.WorkHubPage.canClose = () => false;
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('guarded history did not return')),1000);
    let count = 0;
    const listener = () => {if (++count === 2) {clearTimeout(timer); h.w.removeEventListener('popstate',listener); resolve();}};
    h.w.addEventListener('popstate',listener);
    h.chrome.at(-1).props.back();
  });
  assert.equal(h.w.location.hash,'#/settings');
  assert.deepEqual(visible(h),[h.workspace]);
  h.workspace.contentWindow.WorkHubPage.canClose = () => true;
  await traverse(h, () => h.chrome.at(-1).props.back());
  assert.equal(h.w.location.hash.split('?')[0],'#/sessions');
});

test('an initially empty conversation destination resolves in place instead of trapping Back', async t => {
  const h = harness(t,'#/sessions');
  open(h,conversation('one'));
  assert.equal(h.w.history.length,1);
  assert.equal(h.chrome.at(-1).props.canGoBack,false);
  open(h,{route:'/projects',environment:'local'});
  await traverse(h, () => h.w.history.back());
  assert.equal(h.w.location.hash.split('?')[0],'#/sessions');
  assert.equal(h.chrome.at(-1).props.canGoBack,false);
});

test('macOS history shortcuts preserve Option-arrow text editing inside a composer', async t => {
  const h = harness(t);
  Object.defineProperty(h.w.navigator,'platform',{value:'MacIntel',configurable:true});
  open(h,conversation('one'));
  const event = new h.w.KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,cancelable:true});
  h.w.document.dispatchEvent(event);
  assert.equal(event.defaultPrevented,false);
  const back = new h.w.KeyboardEvent('keydown',{key:'[',metaKey:true,cancelable:true});
  await traverse(h, () => h.w.document.dispatchEvent(back));
  assert.equal(back.defaultPrevented,true);
  assert.equal(h.w.location.hash,'#/projects');
});
