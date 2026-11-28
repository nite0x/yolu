const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '../web');

function harness(t, hash = '#/projects', {desktop = false, listWidth, width = 1800, height = 1000, savedLayout, bootstrapLayout} = {}) {
  let html = fs.readFileSync(path.join(root,'app.html'),'utf8');
  if (bootstrapLayout) html = html.replace('__PANE_LAYOUT__', bootstrapLayout.replaceAll('"', '&quot;'));
  const dom = new JSDOM(html, {url:'http://localhost:4317/' + hash, runScripts:'outside-only'});
  t.after(async () => { await new Promise(resolve => setTimeout(resolve, 10)); dom.window.close(); });
  const {window:w} = dom;
  w.Response = Response;
  Object.defineProperty(w,'innerWidth',{value:width,configurable:true});
  Object.defineProperty(w,'innerHeight',{value:height,configurable:true});
  if (listWidth) w.localStorage.setItem('workhub:conversation-list-width:v1',String(listWidth));
  if (savedLayout) w.localStorage.setItem('workhub:pane-layout:v1:default', savedLayout);
  if (desktop) {
    w.document.documentElement.setAttribute('data-workhub-desktop','');
    w.localStorage.setItem('workhub:sidebar-collapsed:v1','false');
    w.localStorage.setItem('workhub:sidebar-width:v1','360');
  }
  const layouts = [], splitters = [], chrome = [];
  const search = { openers: [], visits: [], options: [] };
  w.eval(fs.readFileSync(path.join(root,'ui/page-layout.js'),'utf8') + '\nwindow.WorkHubLayout = WorkHubLayout;');
  const realLayout = w.WorkHubLayout;
  const realPaneLayout = realLayout.paneLayout;
  w.WorkHubLayout = {
    ...realLayout,
    renderChrome(container,props) {chrome.push({container,props});},
    setupSplitResize(options) { splitters.push(options); },
    createGlobalSearch(_, {navigate}) {
      search.navigate = navigate;
      return {
        open(trigger, options){search.openers.push(trigger); search.options.push(options);},
        remember(snapshot){search.visits.push(snapshot);},
        preload(){},
        recentConversations(){return [];},
      };
    },
    conversationDefaults:{get() {return 'ui';},set() {}},
    paneLayout: {
      ...realPaneLayout,
      render(container, props) {
        layouts.push(props);
        realPaneLayout.render(container, props);
      },
    },
  };
  const requests = [];
  w.fetch = async (...args) => {requests.push(args); return new Response(String(args[0]).includes('/files?') ? JSON.stringify(String(args[0]).includes('file=') ? {text:'Fixture file',format:'text'} : {entries:[],truncated:false}) : '{}');};
  for (const file of ['ui/browser-runtime.js','core/conversation-list-width.js','core/page-host.js']) w.eval(fs.readFileSync(path.join(root,file),'utf8'));
  const pagesEl = w.document.getElementById('workspacePages');
  pagesEl.getBoundingClientRect = () => ({left:0, top:0, right:w.innerWidth, bottom:w.innerHeight, width:w.innerWidth, height:w.innerHeight});
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
  const workspace = () => w.document.getElementById('page-workspace');
  if (workspace()) ready(workspace());
  return {w,frames,send,ready,messages,layouts,chrome,requests,splitters,search,get workspace(){return workspace();},nav:() => w.document.querySelector('.workspace-navigation-frame')};
}
const conversation = id => ({route:'/sessions',environment:'local',title:id,conversation:{scope:{kind:'all'},selected:id,pane:'detail'}});
const open = (h,snapshot,placement) => {
  const source = h.workspace || h.nav();
  if (!h.messages.has(source)) h.ready(source);
  h.send(source,'workhub:page-open',{snapshot,placement});
  // Complete the normal frame handshake. Transition tests below deliver the
  // two readiness notifications individually to model slow document loads.
  if (h.nav() && !h.messages.has(h.nav())) h.ready(h.nav());
  for (const frame of h.frames()) if (!h.messages.has(frame)) h.ready(frame);
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

for (const desktop of [false, true]) test(`saving a draft keeps navigator filters in the ${desktop ? 'desktop' : 'browser'} host`, t => {
  const h = harness(t, '#/projects', {desktop});
  const draft = {route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},creating:true,pane:'detail'}};
  open(h,draft);
  const nav = h.nav(), reader = visible(h)[0];
  const group = () => h.messages.get(nav).findLast(message => message.type === 'workhub:conversation-group');

  assert.equal(group().target.conversation.creating,true);
  h.send(reader,'workhub:page-state',{snapshot:conversation('created')});
  assert.equal(group().selected,'created');
  assert.equal(group().createdConversation,true);

  open(h,conversation('existing'));
  assert.equal(group().selected,'existing');
  assert.equal(group().createdConversation,false);
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
  const h = harness(t, '#/projects', {width: 2800, height: 1400});
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
  assert.equal(visible(h).length,4);
  h.send(readers[0], 'workhub:page-focus');
  open(h,conversation('five'),'split');
  h.send(readers[0], 'workhub:page-focus');
  open(h,conversation('six'),'split');
  assert.equal(visible(h).length,6);
  h.send(readers[0], 'workhub:page-focus');
  open(h,conversation('seven'),'split');
  assert.equal(visible(h).length,6,'product limit caps simultaneous panes at six');
});

test('sidebar selection preserves multi-pane groups, switches to standalone conversations, and restores groups intact', t => {
  const h = harness(t);
  open(h,conversation('one')); h.ready(visible(h)[0]); h.ready(h.nav());
  open(h,conversation('two'),'split'); h.ready(visible(h)[1]);
  const readers = visible(h);
  // Selecting an ungrouped conversation switches to a standalone view without destroying the one+two group.
  h.send(h.nav(),'workhub:conversation-select',{snapshot:conversation('three')});
  const threeFrame = h.frames().find(f => f !== h.workspace && !readers.includes(f));
  assert.ok(threeFrame);
  h.ready(threeFrame);
  assert.deepEqual(visible(h), [threeFrame]);
  assert.equal(h.messages.get(threeFrame).findLast(message => message.type === 'workhub:page-restore').snapshot.conversation.selected,'three');
  // Clicking any member of the one+two group restores the entire split group with both iframes intact.
  h.send(h.nav(),'workhub:conversation-select',{snapshot:conversation('one')});
  assert.deepEqual(visible(h), readers);
  assert.equal(readers[0].dataset.focused,'true');
  assert.equal(readers[1].dataset.focused,'false');
  assert.equal(h.nav().parentElement.hidden,false);
  const groupMsg = h.messages.get(h.nav()).findLast(m => m.type === 'workhub:conversation-group');
  assert.deepEqual(Array.from(groupMsg.sessions), ['one', 'two']);
  assert.equal(groupMsg.selected, 'one');
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
  Object.defineProperty(h.w,'innerWidth',{value:640}); h.w.dispatchEvent(new h.w.Event('resize'));
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
  Object.defineProperty(h.w,'innerWidth',{value:640}); h.w.dispatchEvent(new h.w.Event('resize'));
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
  assert.equal(h.w.location.hash,'#/sessions');
  assert.equal(h.workspace,null);
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
  const drafts = [];
  Object.assign(h.nav().contentWindow.WorkHubPage,{
    canCreateConversation:true,
    createConversation: (...args) => drafts.push(args),
  });
  Object.defineProperty(h.w,'innerWidth',{value:760,configurable:true});
  h.w.dispatchEvent(new h.w.Event('resize'));
  h.chrome.at(-1).props.navigate('settings');
  assert(h.nav().parentElement.hidden);
  assert(h.chrome.at(-1).props.canCreateConversation);
  h.chrome.at(-1).props.createConversation('current');
  h.chrome.at(-1).props.createConversation('split');
  assert.deepEqual(drafts,[['current','remote'],['split','remote']]);
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

test('starting in conversations loads the resource workspace on its first visit and retains it', t => {
  const h = harness(t,'#/sessions');
  assert.equal(h.workspace,null);
  assert.deepEqual(h.frames(),[]);
  open(h,conversation('one'));
  const reader = visible(h)[0];
  assert.equal(h.workspace,null);
  open(h,{route:'/projects/app?directory=%2Frepo',environment:'remote'});
  const workspace = h.workspace;
  assert.deepEqual(visible(h),[workspace]);
  const url = new URL(workspace.src);
  assert.equal(url.searchParams.get('environment'),'remote');
  assert.equal(url.hash,'#/projects/app?directory=%2Frepo');
  open(h,conversation('one'));
  assert.deepEqual(visible(h),[reader]);
  open(h,{route:'/settings',environment:'local'});
  assert.equal(h.workspace,workspace);
  assert.equal(workspace.src,url.href);
  assert.equal(h.messages.get(workspace).findLast(message=>message.type==='workhub:page-restore').snapshot.route,'/settings');
});

test('a deep-linked conversation starts restoring alongside the shared list', t => {
  const h = harness(t,'#/sessions?session=one');
  assert.equal(h.workspace,null);
  assert(h.nav());
  assert.equal(h.frames().length,1);
  h.ready(h.frames()[0],false);
  const restore = h.messages.get(h.frames()[0]).find(message=>message.type==='workhub:page-restore');
  assert.equal(restore.snapshot.conversation.selected,'one');
});

test('a narrow conversation launch restores its reader while the navigator is closed', t => {
  const h = harness(t,'#/sessions',{width:760});
  assert.equal(h.workspace,null);
  assert.equal(h.nav().parentElement.hidden,true);
  assert.equal(h.frames().length,1);
  h.ready(h.frames()[0]);
  assert.deepEqual(visible(h),h.frames());
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

test('recursive pane splitting opens new conversation drafts directly, inherits project context, preserves sibling iframes, and supports mixed directions', t => {
  const h = harness(t);
  const projectConv = {
    route: '/sessions', environment: 'local', title: 'App chat',
    conversation: {scope: {kind: 'project', id: 'app', environment: 'local'}, selected: 'one', pane: 'detail', session: {id: 'one', cwd: '/repo/app', primary_project_id: 'app'}},
  };
  open(h, projectConv);
  const first = visible(h)[0], firstDoc = first.contentDocument;

  // Split right from a project conversation -> directly opens a new conversation draft inheriting the project without reloading pane 1
  h.send(first, 'workhub:page-pane-command', {command: 'split-right'});
  const splitDraft = h.frames().find(f => f !== h.workspace && f !== first);
  assert.ok(splitDraft, 'new split directly mounts a conversation draft iframe');
  assert.equal(h.w.document.querySelector('.pane-layout-empty'), null);
  h.ready(splitDraft);
  assert.equal(first.contentDocument, firstDoc);
  assert.equal(parseFloat(first.style.left), 0);
  assert.equal(parseFloat(first.style.width), 50);
  assert.equal(parseFloat(splitDraft.style.left), 50);
  assert.equal(parseFloat(splitDraft.style.width), 50);
  const draftRestore = h.messages.get(splitDraft).findLast(m => m.type === 'workhub:page-restore').snapshot;
  assert.equal(draftRestore.conversation.creating, true);
  assert.equal(draftRestore.conversation.scope.id, 'app');
  assert.equal(draftRestore.conversation.creationDirectory, '/repo/app');

  // Bind conversation two via sidebar drag-drop center replace into the focused split pane
  h.send(h.nav(), 'workhub:conversation-drag', {phase: 'start', snapshot: conversation('two'), clientX: 100, clientY: 100});
  h.send(h.nav(), 'workhub:conversation-drag', {phase: 'move', clientX: 1350, clientY: 500});
  h.send(h.nav(), 'workhub:conversation-drag', {phase: 'end', clientX: 1350, clientY: 500});
  assert.equal(visible(h).length, 2);
  assert.equal(h.messages.get(splitDraft).findLast(m => m.type === 'workhub:page-restore').snapshot.conversation.selected, 'two');

  // Split down from an unbound conversation -> nested vertical split falling back to default directory
  h.send(splitDraft, 'workhub:page-pane-command', {command: 'split-down'});
  const third = h.frames().find(f => f !== h.workspace && f !== first && f !== splitDraft);
  h.ready(third);
  assert.equal(first.contentDocument, firstDoc);
  assert.equal(parseFloat(splitDraft.style.top), 0);
  assert.equal(parseFloat(splitDraft.style.height), 50);
  assert.equal(parseFloat(third.style.top), 50);
  assert.equal(parseFloat(third.style.height), 50);
  const defaultDraft = h.messages.get(third).findLast(m => m.type === 'workhub:page-restore').snapshot;
  assert.equal(defaultDraft.conversation.creating, true);
  assert.equal(defaultDraft.conversation.scope.kind, 'all');
  assert.equal(defaultDraft.conversation.creationDirectory, '');
  assert.equal(h.w.document.querySelectorAll('.pane-layout-divider[role="separator"]').length, 2);

  // Close panes down to the last remaining pane -> resets directly to a new conversation draft and does NOT autoSelect
  h.send(third, 'workhub:page-pane-command', {command: 'close'});
  h.send(splitDraft, 'workhub:page-pane-command', {command: 'close'});
  assert.deepEqual(visible(h), [first]);
  h.send(first, 'workhub:page-pane-command', {command: 'close'});
  const resetDraft = h.frames().find(f => f !== h.workspace);
  assert.ok(resetDraft, 'closing the last pane opens a fresh new conversation draft');
  h.ready(resetDraft);
  assert.equal(h.w.document.querySelector('.pane-layout-empty'), null);
  assert.equal(h.messages.get(resetDraft).findLast(m => m.type === 'workhub:page-restore').snapshot.conversation.creating, true);
  assert.equal(h.messages.get(resetDraft).findLast(m => m.type === 'workhub:parallel-layout').canClose, false);
  const lastGroup = h.messages.get(h.nav()).findLast(m => m.type === 'workhub:conversation-group');
  assert.equal(lastGroup.autoSelect, false, 'closing the last pane must not autoSelect a conversation back over the fresh draft');
});

test('pane drag-and-drop moves and swaps panes without reloading iframes and Escape cancels cleanly', t => {
  const h = harness(t);
  open(h, conversation('one'));
  open(h, conversation('two'), 'split');
  const [first, second] = visible(h);
  const firstDoc = first.contentDocument, secondDoc = second.contentDocument;

  first.getBoundingClientRect = () => ({left:0, top:0, width:900, height:1000, right:900, bottom:1000});
  // Drag first onto center of second, then cancel via Escape -> unchanged
  h.send(first, 'workhub:page-pane-drag', {phase: 'start'});
  h.send(first, 'workhub:page-pane-drag', {phase: 'move', clientX: 1350, clientY: 500});
  assert.equal(h.w.document.querySelector('.pane-layout-drop-preview')?.dataset.zone, 'center');
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', {key: 'Escape', cancelable: true}));
  assert.equal(h.w.document.querySelector('.pane-layout-drop-preview'), null);
  assert.equal(parseFloat(first.style.left), 0);

  // Drag first onto bottom of second and commit -> vertical split, no iframe reloads
  h.send(first, 'workhub:page-pane-drag', {phase: 'start'});
  h.send(first, 'workhub:page-pane-drag', {phase: 'move', clientX: 1350, clientY: 920});
  assert.equal(h.w.document.querySelector('.pane-layout-drop-preview')?.dataset.zone, 'bottom');
  h.send(first, 'workhub:page-pane-drag', {phase: 'end'});
  assert.equal(first.contentDocument, firstDoc);
  assert.equal(second.contentDocument, secondDoc);
  assert.equal(parseFloat(second.style.top), 0);
  assert.equal(parseFloat(second.style.height), 50);
  assert.equal(parseFloat(first.style.top), 50);
  assert.equal(parseFloat(first.style.height), 50);
});

test('pane keyboard shortcuts handle split, directional focus, maximize/restore and close', t => {
  const h = harness(t);
  Object.defineProperty(h.w.navigator, 'platform', {value: 'MacIntel', configurable: true});
  open(h, conversation('one'));
  open(h, conversation('two'), 'split');
  const [first, second] = visible(h);
  const firstDoc = first.contentDocument, secondDoc = second.contentDocument;
  assert.equal(second.dataset.focused, 'true');

  // Focus left (Cmd+Opt+ArrowLeft)
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', {key: 'ArrowLeft', metaKey: true, altKey: true, cancelable: true}));
  assert.equal(first.dataset.focused, 'true');

  // Maximize (Cmd+Shift+Enter) and restore preserves mounted documents without reloading
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', {key: 'Enter', metaKey: true, shiftKey: true, cancelable: true}));
  assert.deepEqual(visible(h), [first]);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', {key: 'Enter', metaKey: true, shiftKey: true, cancelable: true}));
  assert.deepEqual(visible(h), [first, second]);
  assert.equal(first.contentDocument, firstDoc);
  assert.equal(second.contentDocument, secondDoc);

  // Split down (Cmd+Shift+\) opens a new conversation draft directly
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', {key: '|', code: 'Backslash', metaKey: true, shiftKey: true, cancelable: true}));
  const third = h.frames().find(f => f !== h.workspace && f !== first && f !== second);
  assert.ok(third);
  h.ready(third);
  assert.deepEqual(visible(h), [first, second, third]);

  // Close split draft pane via Opt+Shift+W
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', {key: 'W', code: 'KeyW', altKey: true, shiftKey: true, cancelable: true}));
  assert.deepEqual(visible(h), [first, second]);
});

test('persisted layout restores across restart, migrates legacy 3-column state, handles narrow->wide recovery, and degrades missing/corrupt data', t => {
  const saved = JSON.stringify({
    version: 1,
    context: 'default',
    layout: {
      version: 1,
      root: {
        type: 'split',
        id: 's1',
        direction: 'vertical',
        ratio: 0.35,
        children: [
          {type: 'pane', id: 'p1', content: {type: 'conversation', conversationId: '["local","one"]'}},
          {type: 'pane', id: 'p2', content: {type: 'conversation', conversationId: '["local","two"]'}},
        ],
      },
      activePaneId: 'p2',
    },
    conversations: {
      '["local","one"]': {environment: 'local', route: '/sessions', title: 'One', selected: 'one'},
      '["local","two"]': {environment: 'local', route: '/sessions', title: 'Two', selected: 'two'},
    },
  });

  const h = harness(t, '#/sessions', {bootstrapLayout: saved});
  h.ready(h.nav());
  for (const frame of h.frames()) h.ready(frame);
  const restored = visible(h);
  assert.equal(restored.length, 2);
  assert.equal(parseFloat(restored[0].style.height), 35);
  assert.equal(parseFloat(restored[1].style.height), 65);
  assert.equal(restored[1].dataset.focused, 'true');

  // Narrow/short -> wide recovery preserves custom 35/65 ratio and blocks phantom drag in compact mode
  const doc0 = restored[0].contentDocument, doc1 = restored[1].contentDocument;
  Object.defineProperty(h.w, 'innerHeight', {value: 500, configurable: true});
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.equal(visible(h).length, 1);
  assert.ok(h.w.document.getElementById('workspaceNarrowPanes'));
  h.send(restored[1], 'workhub:page-pane-drag', {phase: 'start'});
  assert.equal(h.w.document.getElementById('workspacePages').hasAttribute('data-pane-dragging'), false);
  Object.defineProperty(h.w, 'innerHeight', {value: 1000, configurable: true});
  h.w.dispatchEvent(new h.w.Event('resize'));
  assert.equal(visible(h).length, 2);
  assert.equal(parseFloat(restored[0].style.height), 35);
  assert.equal(restored[0].contentDocument, doc0);
  assert.equal(restored[1].contentDocument, doc1);

  // Stale conversation-missing for a different session ID does NOT wipe active pane
  h.send(restored[1], 'workhub:conversation-missing', {sessionId: 'stale-other', environment: 'local'});
  assert.equal(visible(h).length, 2);

  // Matching missing/deleted conversation degrades only that pane to a fresh draft without harming sibling
  h.send(restored[1], 'workhub:conversation-missing', {sessionId: 'two', environment: 'local'});
  const degraded = h.frames().find(f => f !== h.workspace && f !== restored[0]);
  assert.ok(degraded);
  h.ready(degraded);
  assert.deepEqual(visible(h), [restored[0], degraded]);
  assert.equal(h.messages.get(degraded).findLast(m => m.type === 'workhub:page-restore').snapshot.conversation.creating, true);

  // pagehide flushes layout to PUT /api/settings/pane-layout with keepalive: true
  h.w.dispatchEvent(new h.w.Event('pagehide'));
  const putReq = h.requests.findLast(([url, init]) => String(url).includes('/api/settings/pane-layout') && init?.method === 'PUT');
  assert.ok(putReq);
  assert.equal(putReq[1].keepalive, true);

  // Corrupt saved layout degrades gracefully to a fresh new conversation draft
  const corrupt = harness(t, '#/sessions', {savedLayout: '{corrupt-json'});
  corrupt.ready(corrupt.nav());
  assert.equal(corrupt.frames().length, 1);
  corrupt.ready(corrupt.frames()[0]);
  assert.equal(corrupt.messages.get(corrupt.frames()[0]).findLast(m => m.type === 'workhub:page-restore').snapshot.conversation.creating, true);

  // Legacy 3-column state migrates cleanly to binary tree
  const legacy = JSON.stringify({
    pages: [{id: 'c1', conversationId: '["local","a"]', width: 1}, {id: 'c2', conversationId: '["local","b"]', width: 1}],
    focused: 'c1',
  });
  const migrated = harness(t, '#/sessions', {savedLayout: legacy});
  migrated.ready(migrated.nav());
  for (const frame of migrated.frames()) migrated.ready(frame);
  assert.equal(visible(migrated).length, 2);
  assert.equal(visible(migrated)[0].dataset.focused, 'true');
});

for (const desktop of [false, true]) test(`independent right multi-tab panel opens files from conversations, preserves tabs across switches, and persists (desktop=${desktop})`, async t => {
  const h = harness(t, '#/projects', {desktop, width: 1800, height: 1000});
  open(h, conversation('one'));
  const reader = visible(h)[0];
  const readerSource = reader.src;
  const file1 = {cwd:'/repo/feature',projectId:'p1',sessionId:'one',bindingId:'binding-2',path:'src/main.ts',line:23,git:true,mode:'all'};
  const file2 = {cwd:'/repo/other',projectId:'p2',sessionId:'one',path:'src/main.ts',git:true,mode:'working'};
  h.send(reader, 'workhub:page-open', {placement:'split',snapshot:{route:'/files',environment:'remote',title:'main.ts',file:file1}});
  // Conversation split stage stays pure single-pane; file opens in right multi-tab panel.
  assert.equal(visible(h).length, 1);
  assert.equal(reader.src, readerSource);
  assert.equal(h.w.document.body.hasAttribute('data-right-panel-open'), true);
  assert.equal(h.w.document.querySelectorAll('#workspaceRightPanel [role="tab"]').length, 1);
  assert.ok(h.w.document.querySelector('#workspaceRightPanel .file-browser'));

  // Opening a second file adds an independent second tab with context disambiguation for same filename.
  h.send(reader, 'workhub:page-open', {placement:'split',snapshot:{route:'/files',environment:'local',title:'main.ts',file:file2}});
  const tabs = [...h.w.document.querySelectorAll('#workspaceRightPanel [role="tab"]')];
  assert.equal(tabs.length, 2);
  assert.ok(tabs[0].querySelector('.right-panel-tab-context'));
  assert.ok(tabs[1].querySelector('.right-panel-tab-context'));

  // Switching conversations does NOT close or switch the independent right-panel tabs.
  h.send(h.nav(), 'workhub:conversation-select', {snapshot: conversation('two')});
  assert.equal(h.w.document.body.hasAttribute('data-right-panel-open'), true);
  assert.equal(h.w.document.querySelectorAll('#workspaceRightPanel [role="tab"]').length, 2);
  assert.equal(h.w.document.querySelectorAll('#workspaceRightPanel [role="tab"]')[1].getAttribute('aria-selected'), 'true');

  // Reopening file1 at a new line focuses the existing tab without duplicating it.
  h.send(reader, 'workhub:page-open', {placement:'split',snapshot:{route:'/files',environment:'remote',title:'main.ts',file:{...file1,line:48}}});
  assert.equal(h.w.document.querySelectorAll('#workspaceRightPanel [role="tab"]').length, 2);
  assert.equal(h.w.document.querySelectorAll('#workspaceRightPanel [role="tab"]')[0].getAttribute('aria-selected'), 'true');

  // Persists across restart and restores tabs independently of conversations.
  await new Promise(resolve => setTimeout(resolve, 270));
  const saved = JSON.parse(h.w.localStorage.getItem('workhub:pane-layout:v1:default'));
  assert.equal(saved.rightPanel.open, true);
  assert.equal(saved.rightPanel.tabs.length, 2);
  assert.equal(saved.rightPanel.tabs[0].bindingId, 'binding-2');
  assert.equal(saved.rightPanel.tabs[0].line, 48);

  const restored = harness(t, '#/sessions', {savedLayout:JSON.stringify(saved), width:1800});
  restored.ready(restored.nav());
  for (const frame of restored.frames()) restored.ready(frame);
  assert.equal(restored.w.document.body.hasAttribute('data-right-panel-open'), true);
  assert.equal(restored.w.document.querySelectorAll('#workspaceRightPanel [role="tab"]').length, 2);

  // Header toggle collapses panel while preserving tabs, and re-expanding shows them again.
  h.chrome.at(-1).props.toggleRightPanel();
  assert.equal(h.w.document.body.hasAttribute('data-right-panel-open'), false);
  assert.equal(h.chrome.at(-1).props.rightPanelTabCount, 2);
  h.chrome.at(-1).props.toggleRightPanel();
  assert.equal(h.w.document.body.hasAttribute('data-right-panel-open'), true);
  assert.equal(h.w.document.querySelectorAll('#workspaceRightPanel [role="tab"]').length, 2);

  // Closing both tabs collapses the right panel cleanly.
  h.w.document.querySelectorAll('#workspaceRightPanel .right-panel-tab-close')[0].click();
  assert.equal(h.w.document.querySelectorAll('#workspaceRightPanel [role="tab"]').length, 1);
  h.w.document.querySelectorAll('#workspaceRightPanel .right-panel-tab-close')[0].click();
  assert.equal(h.w.document.body.hasAttribute('data-right-panel-open'), false);
});

test('sidebar drag-to-split lays out multi-pane groups and moving a conversation dissolves its former group', async t => {
  const h = harness(t, '#/projects', {width: 1800, height: 1000});
  open(h, conversation('one'));
  const first = visible(h)[0];

  // Drag conversation 'two' from sidebar onto the right edge of single pane 'one' -> auto splits!
  h.send(h.nav(), 'workhub:conversation-drag', {phase: 'start', snapshot: conversation('two'), clientX: 50, clientY: 120});
  h.send(h.nav(), 'workhub:conversation-drag', {phase: 'move', clientX: 1600, clientY: 500});
  const preview = h.w.document.querySelector('.pane-layout-drop-preview');
  assert.ok(preview);
  assert.equal(preview.dataset.zone, 'right');
  h.send(h.nav(), 'workhub:conversation-drag', {phase: 'end', clientX: 1600, clientY: 500});
  const second = h.frames().find(f => f !== h.workspace && f !== first);
  assert.ok(second);
  h.ready(second);
  assert.deepEqual(visible(h), [first, second]);

  // Switch to standalone conversation 'three' -> group (one+two) stays preserved in memory.
  h.send(h.nav(), 'workhub:conversation-select', {snapshot: conversation('three')});
  const third = h.frames().find(f => f !== h.workspace && f !== first && f !== second);
  assert.ok(third);
  h.ready(third);
  assert.deepEqual(visible(h), [third]);

  // Drag 'one' from sidebar onto the bottom edge of 'three' -> forms group (three+one) AND dissolves former group (one+two)!
  h.send(h.nav(), 'workhub:conversation-drag', {phase: 'start', snapshot: conversation('one'), clientX: 50, clientY: 80});
  h.send(h.nav(), 'workhub:conversation-drag', {phase: 'move', clientX: 900, clientY: 920});
  assert.equal(h.w.document.querySelector('.pane-layout-drop-preview').dataset.zone, 'bottom');
  h.send(h.nav(), 'workhub:conversation-drag', {phase: 'end', clientX: 900, clientY: 920});
  assert.equal(visible(h).length, 2);
  assert.ok(visible(h).includes(third) && visible(h).includes(first));
  assert.equal(parseFloat(third.style.top), 0);
  assert.equal(parseFloat(first.style.top), 50);
  assert.equal(h.w.document.querySelectorAll('.pane-layout-divider[data-direction="vertical"]').length, 1);

  // Clicking 'two' now opens 'two' as a standalone single pane because its former group dissolved.
  h.send(h.nav(), 'workhub:conversation-select', {snapshot: conversation('two')});
  assert.deepEqual(visible(h), [second]);

  // Clicking 'three' restores the new (three+one) vertical split group intact!
  h.send(h.nav(), 'workhub:conversation-select', {snapshot: conversation('three')});
  assert.equal(visible(h).length, 2);
  assert.ok(visible(h).includes(third) && visible(h).includes(first));
  assert.equal(parseFloat(third.style.top), 0);
  assert.equal(parseFloat(first.style.top), 50);
  assert.equal(h.w.document.querySelectorAll('.pane-layout-divider[data-direction="vertical"]').length, 1);
});

for (const desktop of [false, true]) test(`global creation always opens a new maximized standalone window and preserves existing multi-pane groups (desktop=${desktop})`, t => {
  const h = harness(t, '#/projects', {desktop});
  open(h, conversation('one'));
  const first = visible(h)[0];
  open(h, conversation('two'), 'split');
  const second = visible(h)[1];
  assert.deepEqual(visible(h), [first, second]);

  Object.assign(h.nav().contentWindow.WorkHubPage, {
    canCreateConversation: true,
    createConversation(placement) {
      assert.equal(placement, 'current');
      h.send(h.nav(), 'workhub:page-open', {create:true, placement, snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},creating:true,selected:null,pane:'detail'}}});
    },
  });
  h.w.dispatchEvent(new h.w.Event('resize'));
  h.chrome.at(-1).props.createConversation('current');
  const newDraft = h.frames().find(f => f !== h.workspace && f !== first && f !== second);
  assert.ok(newDraft, 'global creation mounts a new maximized standalone conversation draft');
  h.ready(newDraft);
  assert.deepEqual(visible(h), [newDraft]);
  assert.equal(h.w.document.querySelectorAll('.pane-layout-divider').length, 0);
  assert.equal(h.messages.get(newDraft).findLast(m => m.type === 'workhub:page-restore').snapshot.conversation.creating, true);

  // Clicking 'one' in sidebar restores the preserved (one+two) multi-pane group!
  h.send(h.nav(), 'workhub:conversation-select', {snapshot: conversation('one')});
  assert.deepEqual(visible(h), [first, second]);
  assert.equal(h.w.document.querySelectorAll('.pane-layout-divider').length, 1);
});

for (const desktop of [false, true]) test(`shared pane split controls open conversation drafts directly and support keyboard direction menu (desktop=${desktop})`, async t => {
  const h = harness(t, '#/projects', {desktop, width: 1800, height: 1000});
  open(h, {
    route: '/sessions', environment: 'local', title: 'App chat',
    conversation: {scope: {kind: 'project', id: 'app', environment: 'local'}, selected: 'one', pane: 'detail', session: {id: 'one', cwd: '/repo/app', primary_project_id: 'app'}},
  });
  const first = visible(h)[0];
  // Mount an empty pane header directly via the shared LayoutRoot contract to exercise keyboard direction menu.
  const hostContainer = h.w.document.createElement('div');
  h.w.document.body.append(hostContainer);
  const lastProps = h.layouts.at(-1);
  const activeId = lastProps.layout.activePaneId;
  const emptyLayout = h.w.WorkHubLayout.paneLayout.createInitialLayout({type:'empty'}, activeId);
  h.w.WorkHubLayout.paneLayout.render(hostContainer, {...lastProps, layout: emptyLayout});
  const header = () => hostContainer.querySelector('.pane-layout-empty .pane-layout-header');
  assert.equal(header().querySelectorAll('[data-pane-action]').length, 1);
  header().querySelector('[data-pane-action="split-right"]').click();
  const splitRightFrame = h.frames().find(f => f !== h.workspace && f !== first);
  assert.ok(splitRightFrame);
  h.ready(splitRightFrame);
  assert.equal(h.messages.get(splitRightFrame).findLast(m => m.type === 'workhub:page-restore').snapshot.conversation.scope.id, 'app');
  const trigger = header().querySelector('[data-pane-menu-trigger]');
  trigger.focus();
  trigger.dispatchEvent(new h.w.KeyboardEvent('keydown', {key:'ArrowDown',bubbles:true,cancelable:true}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert(h.w.document.activeElement.matches('[role="menuitem"]'));
  h.w.document.activeElement.dispatchEvent(new h.w.KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(h.w.document.activeElement, trigger);
  trigger.click();
  await new Promise(resolve => setImmediate(resolve));
  const down = [...header().querySelectorAll('[role="menuitem"]')].find(item => item.textContent === '向下分屏');
  assert.equal(down.disabled, false);
  down.click();
  const splitDownFrame = h.frames().find(f => f !== h.workspace && f !== first && f !== splitRightFrame);
  assert.ok(splitDownFrame);
  h.ready(splitDownFrame);
  assert.equal(h.w.document.querySelectorAll('.pane-layout-divider[data-direction="vertical"]').length, 1);
  assert.equal(hostContainer.querySelector('[role="menu"]'), null);
  assert(visible(h).includes(first));
});

test('sidebar parallel add caps at three panes while pane-header splitting still allows up to six', t => {
  const h = harness(t, '#/projects', {width: 2800, height: 1400});
  open(h, conversation('one'));
  h.send(h.nav(), 'workhub:conversation-add', {snapshot: conversation('two')});
  h.ready(h.frames().find(f => f !== h.workspace && !h.messages.has(f)));
  h.send(h.nav(), 'workhub:conversation-add', {snapshot: conversation('three')});
  h.ready(h.frames().find(f => f !== h.workspace && !h.messages.has(f)));
  assert.equal(visible(h).length, 3);
  assert.equal(h.messages.get(h.nav()).findLast(m => m.type === 'workhub:conversation-group').full, true);

  // Sidebar add refuses a 4th unopened conversation
  h.send(h.nav(), 'workhub:conversation-add', {snapshot: conversation('four')});
  assert.equal(visible(h).length, 3);

  // Sidebar add still focuses an already-open conversation when at 3 panes
  const first = visible(h)[0];
  h.send(h.nav(), 'workhub:conversation-add', {snapshot: conversation('one')});
  assert.equal(first.dataset.focused, 'true');

  // Pane header split still creates a 4th pane directly as a draft under the 6-pane limit
  h.send(first, 'workhub:page-pane-command', {command: 'split-down'});
  const fourth = h.frames().find(f => f !== h.workspace && !h.messages.has(f));
  assert.ok(fourth);
  h.ready(fourth);
  assert.equal(visible(h).length, 4);
});
