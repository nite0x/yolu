const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '../web');

function harness(t, hash = '#/requirements') {
  const dom = new JSDOM(fs.readFileSync(path.join(root,'workspace.html'),'utf8'), {url:'http://localhost:4317/' + hash, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const {window:w} = dom;
  Object.defineProperty(w,'innerWidth',{value:1800,configurable:true});
  const layouts = [];
  w.WorkHubLayout = {
    renderPanes:(_,props) => layouts.push(props), renderChrome() {}, setupSplitResize() {},
    conversationDefaults:{get() {return 'ui';},set() {}},
  };
  const requests = [];
  w.fetch = async (...args) => {requests.push(args); return new Response('{}');};
  w.eval(fs.readFileSync(path.join(root,'core/page-host.js'),'utf8'));
  const frames = () => [...w.document.querySelectorAll('iframe.workspace-page')];
  const send = (frame,type,extra = {},origin = w.location.origin) => w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin,data:{type,...extra}}));
  const messages = new Map();
  const ready = frame => {
    const received = [];
    frame.contentWindow.postMessage = message => received.push(message);
    frame.contentWindow.WorkHubPage = {canClose:() => true,dispose() {}};
    messages.set(frame,received); send(frame,'workhub:page-ready');
    return received;
  };
  const workspace = frames()[0]; ready(workspace);
  return {w,frames,send,ready,messages,layouts,requests,workspace,nav:() => w.document.querySelector('.workspace-navigation-frame')};
}
const conversation = id => ({route:'/sessions',environment:'local',title:id,conversation:{scope:{kind:'all'},selected:id,pane:'detail'}});
const open = (h,snapshot,placement) => h.send(h.workspace,'workhub:page-open',{snapshot,placement});
const visible = h => h.frames().filter(frame => !frame.hidden);

test('independent pages reuse one document and preserve project routes and directory parameters', t => {
  const h = harness(t);
  for (const route of ['/projects','/projects/app','/projects/app/git?path=%2Frepo%2Fapp&requirement=task','/projects/app/worktrees','/requirements/task','/settings']) {
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
  assert.equal(h.nav().parentElement.hidden,true);
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
  assert.equal(h.w.location.hash,'#/sessions');
});

test('page navigation from a single reader preserves its conversation and opens the workspace document', t => {
  const h = harness(t);
  open(h,conversation('one')); const reader = visible(h)[0]; h.ready(reader); h.ready(h.nav());
  h.send(reader,'workhub:page-state',{snapshot:{route:'/requirements/task',environment:'local'}});
  assert.deepEqual(visible(h),[h.workspace]);
  assert.equal(h.w.location.hash,'#/requirements/task');
  const restored = h.messages.get(reader).findLast(message => message.type === 'workhub:page-restore');
  assert.equal(restored.snapshot.conversation.selected,'one');
  assert.equal(restored.active,false);
  open(h,{route:'/sessions',environment:'local'});
  assert.deepEqual(visible(h),[reader]);
});

test('a narrow single reader retains its own sidebar and history list', t => {
  const h = harness(t);
  Object.defineProperty(h.w,'innerWidth',{value:640});
  open(h,conversation('one'));
  const reader = visible(h)[0], messages = h.ready(reader);
  assert.equal(h.nav(),null);
  assert.equal(h.w.document.body.hasAttribute('data-workspace-conversations'),false);
  assert.equal(messages.findLast(message => message.type === 'workhub:page-pane').shared,false);
});
