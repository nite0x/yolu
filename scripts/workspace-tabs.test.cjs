const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '../web');
const storageKey = 'workhub:workspace-tabs:v1';

function harness(t, saved, hash = '', fetch) {
  const dom = new JSDOM(fs.readFileSync(path.join(root,'workspace.html'),'utf8'), {url:'http://localhost:4317/' + hash, runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const {window:w} = dom;
  Object.defineProperty(w,'innerWidth',{value:1800,configurable:true});
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.eval(fs.readFileSync(path.join(root,'ui/workspace-tabs.js'),'utf8') + '\nwindow.WorkHubTabbar = WorkHubTabbar;');
  if (saved) w.localStorage.setItem(storageKey, JSON.stringify(saved));
  if (fetch) w.fetch = fetch;
  w.eval(fs.readFileSync(path.join(root,'core/workspace-tabs.js'),'utf8'));
  const frames = () => [...w.document.querySelectorAll('iframe.workspace-page')];
  const buttons = () => [...w.document.querySelectorAll('[role="tab"]')];
  const send = (frame,type,extra = {},origin = w.location.origin) => w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin,data:{type,...extra}}));
  return {w,frames,buttons,send,add:()=>w.document.getElementById('workspaceTabNew').click(),saved:()=>JSON.parse(w.localStorage.getItem(storageKey))};
}

test('restored background tabs keep snapshots without booting until first activation', t => {
  const original = {selected:'active',tabs:[
    {id:'active',snapshot:{...conversation('one'),parallel:{panes:[conversation('two')],widths:[2,1],focused:1},conversationListWidth:390}},
    {id:'background',snapshot:{...conversation('three'),conversation:{...conversation('three').conversation,session:{id:'three',name:'Saved title',cwd:'/saved'}}}},
  ]};
  const h = harness(t,original), background = h.frames().find(frame => frame.id === 'page-background');
  assert.equal(background.hasAttribute('src'),false);
  for (const frame of visibleFrames(h)) {
    const url = new URL(frame.src);
    assert.equal(url.searchParams.get('workspace-conversation'),'1');
    assert.equal(url.searchParams.get('workspace-pane'),'1');
    assert.equal(url.searchParams.get('workspace-tab-height'),'0');
    assert.equal(url.searchParams.get('workspace-list-width'),'390');
  }
  h.w.dispatchEvent(new h.w.Event('pagehide'));
  assert.deepEqual(h.saved().tabs[1].snapshot.conversation,original.tabs[1].snapshot.conversation);
  h.buttons()[1].click();
  assert.equal(new URL(background.src).searchParams.get('workspace-tab'),'background');
  const src = background.src;
  h.buttons()[0].click(); h.buttons()[1].click();
  assert.equal(background.src,src,'returning to a mounted page retains its document');
});

test('host metadata reads share work and independent bodies without mixing environments or caching failures', async t => {
  const pending = [];
  const h = harness(t,null,'',(url,options = {}) => {
    if (url === '/api/workspace-tabs') return Promise.resolve({ok:true,json:async()=>({})});
    return new Promise(resolve => pending.push({url,options,resolve}));
  });
  const read = h.w.WorkHubWorkspace.read;
  const options = environment => ({headers:{'X-Environment-ID':environment}});
  const first = read('/api/state',options('local')), second = read('/api/state',options('local'));
  const remote = read('/api/state',options('remote'));
  assert.equal(pending.length,2);
  pending[0].resolve(new Response(JSON.stringify({environment:'local'})));
  pending[1].resolve(new Response(JSON.stringify({environment:'remote'})));
  assert.equal((await (await first).json()).environment,'local');
  assert.equal((await (await second).json()).environment,'local');
  assert.equal((await (await remote).json()).environment,'remote');
  const forced = read('/api/state?refresh=1',options('local'));
  assert.equal(pending.length,3);
  pending[2].resolve(new Response('{}')); await forced;
  const failed = read('/api/environments',options('local'));
  pending[3].resolve(new Response('{}',{status:503})); await failed;
  const retried = read('/api/environments',options('local'));
  assert.equal(pending.length,5);
  pending[4].resolve(new Response('{}')); await retried;
  const mutation=read('/api/projects',{...options('local'),method:'POST',body:'{}'});
  pending[5].resolve(new Response('{}')); await mutation;
  const fresh=read('/api/state',options('local'));
  assert.equal(pending.length,7,'a mutation invalidates shared state before its follow-up refresh');
  pending[6].resolve(new Response(JSON.stringify({environment:'changed'})));
  assert.equal((await (await fresh).json()).environment,'changed');
});

test('embedded page geometry is established before deferred UI controllers run', t => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>',{url:'http://localhost:4317/?workspace-tab=one&workspace-conversation=1&workspace-pane=1&workspace-tab-height=0&workspace-list-width=390&workspace-sidebar-width=72#/sessions',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  dom.window.eval(fs.readFileSync(path.join(root,'core/workspace-bootstrap.js'),'utf8'));
  const html = dom.window.document.documentElement;
  assert(html.hasAttribute('data-workspace-conversation'));
  assert(html.hasAttribute('data-workspace-pane'));
  assert(!html.hasAttribute('data-workspace-navigation'));
  assert.equal(html.style.getPropertyValue('--workspace-shared-list-width'),'390px');
  assert.equal(html.style.getPropertyValue('--workspace-navigation-left'),'72px');
  assert.equal(html.style.getPropertyValue('--workspace-tab-height'),'0px');
  assert.equal(html.getAttribute('data-workspace-initial-route'),'sessions');
});

test('an unselected conversation page reserves its final list and reader before data or iframe readiness', t => {
  const snapshot = {route:'/sessions',environment:'local',title:'全部对话'};
  const h = harness(t,{selected:'empty',tabs:[{id:'empty',snapshot}]}), frame = h.frames()[0];
  const navigation = h.w.document.querySelector('.workspace-navigation-frame');
  const wrapper = navigation.parentElement;
  assert(h.w.document.body.hasAttribute('data-workspace-conversations'));
  assert.equal(new URL(frame.src).searchParams.get('workspace-conversation'),'1');
  assert(wrapper.querySelector('.workspace-list-placeholder'));
  assert(!wrapper.hasAttribute('data-ready'));
  h.send(navigation,'workhub:tab-ready');
  assert(!wrapper.hasAttribute('data-ready'),'script readiness is earlier than restored static controls');
  h.send(navigation,'workhub:tab-restored');
  assert(wrapper.hasAttribute('data-ready'));
  h.send(navigation,'workhub:conversation-select',{initial:true,snapshot:conversation('first')});
  assert.equal(h.frames()[0],frame,'initial data fills the mounted reader');
  assert.equal(h.saved().tabs[0].snapshot.conversation.selected,'first');
  assert(h.w.document.body.hasAttribute('data-workspace-conversations'));
  h.send(navigation,'workhub:conversation-select',{initial:true,snapshot:conversation('stale')});
  assert.equal(h.saved().tabs[0].snapshot.conversation.selected,'first','late automatic selection cannot replace the current conversation');
  h.add();
  assert(wrapper.hidden);
  h.buttons()[0].click();
  assert(!wrapper.hidden);
});

test('focusing another conversation pane gives shared navigation its task and selected session', t => {
  const h=parallelHarness(t);
  h.choice(conversation('session-b','task-b'));
  const navigation=h.w.document.querySelector('.workspace-navigation-frame'), messages=[];
  navigation.contentWindow.postMessage=message=>messages.push(message);
  h.send(navigation,'workhub:tab-ready');
  navigation.dispatchEvent(new h.w.Event('load'));
  assert.equal(messages.findLast(message=>message.type==='workhub:tab-layout').height,40,'a late iframe load cannot cover the shared list heading with the tab bar');
  const second=visibleFrames(h)[1];
  h.send(second,'workhub:tab-focus');
  const group=messages.findLast(message=>message.type==='workhub:conversation-group');
  assert.equal(group.target.conversation.selected,group.selected);
  assert.equal(group.target.conversation.scope.id,'task-b');
  assert.equal(group.target.title,second.title);
});

test('tabs keep separate mounted pages while switching and closing', t => {
  const h = harness(t);
  const first = h.frames()[0];
  first.contentDocument.open(); first.contentDocument.write('<!doctype html><body></body>'); first.contentDocument.close();
  const draft = first.contentDocument.createElement('textarea'); draft.value = '尚未发送的草稿'; first.contentDocument.body.append(draft);
  const scroll = first.contentDocument.createElement('div'); first.contentDocument.body.append(scroll); scroll.scrollTop = 321;
  h.add();
  assert.equal(h.frames().length,2);
  assert(first.hidden);
  h.buttons()[0].click();
  assert(!first.hidden);
  assert.equal(draft.value,'尚未发送的草稿');
  assert.equal(scroll.scrollTop,321);
  assert.equal(first,h.frames()[0]);
  h.w.document.querySelectorAll('.workspace-tab-close')[1].click();
  assert.equal(h.frames().length,1);
  assert.equal(first,h.frames()[0]);
  h.w.document.querySelector('.workspace-tab-close').click();
  assert.equal(h.frames().length,1,'closing the last tab leaves a usable workspace');
});

test('browser layout controls stay reachable and reserve space without remounting pages', t => {
  const h = harness(t);
  const bar = h.w.document.getElementById('workspaceTabBar');
  const first = h.frames()[0];
  const messages = [];
  first.contentWindow.postMessage = message => messages.push(message);
  first.dispatchEvent(new h.w.Event('load'));
  assert.equal(messages.findLast(message=>message.type==='workhub:tab-layout').height,40,'the initial layout does not wait for API readiness');
  first.contentWindow.WorkHubTab = {canClose:()=>true};
  h.send(first,'workhub:tab-ready');
  assert.equal(bar.hidden,false);
  assert.equal(messages.findLast(message=>message.type==='workhub:tab-restore').tabBarHeight,40);
  h.send(first,'workhub:tab-open',{snapshot:{route:'/projects'}});
  assert.equal(bar.hidden,false);
  assert.deepEqual(JSON.parse(JSON.stringify(messages.findLast(message=>message.type==='workhub:tab-layout'))),{type:'workhub:tab-layout',height:40});
  const secondMessages = [];
  h.frames()[1].contentWindow.postMessage = message => secondMessages.push(message);
  h.frames()[1].dispatchEvent(new h.w.Event('load'));
  assert.equal(secondMessages.findLast(message=>message.type==='workhub:tab-layout').height,40);
  h.frames()[1].contentWindow.WorkHubTab = {canClose:()=>true};
  h.send(h.frames()[1],'workhub:tab-ready');
  assert.equal(secondMessages.findLast(message=>message.type==='workhub:tab-restore').tabBarHeight,40);
  h.w.document.querySelectorAll('.workspace-tab-close')[1].click();
  assert.equal(bar.hidden,false);
  assert.equal(messages.findLast(message=>message.type==='workhub:tab-layout').height,40);
  assert.equal(h.frames()[0],first);
  assert.equal(first.hidden,false);
});

test('navigation reports update only their originating tab and render labels safely', t => {
  const h = harness(t);
  const first = h.frames()[0]; h.add();
  const second = h.frames()[1];
  h.send(first,'workhub:tab-state',{snapshot:{route:'/sessions',environment:'local',title:'<img src=x onerror=alert(1)>',conversation:{scope:{kind:'task',id:'one'},selected:'session-a'}}});
  h.send(second,'workhub:tab-state',{snapshot:{route:'/projects',environment:'wsl',title:'另一个项目',project:{id:'two',detail:true}}});
  assert.equal(h.w.location.hash,'#/projects');
  assert.equal(h.w.document.querySelector('.workspace-tab-label img'),null);
  assert.equal(h.buttons()[0].textContent,'<img src=x onerror=alert(1)>');
  h.buttons()[0].click();
  assert.equal(h.w.location.hash,'#/sessions');
  assert(!new URL(h.w.location.href).searchParams.has('environment'));
  assert.equal(h.saved().tabs[1].snapshot.project.id,'two');
});

test('desktop keeps a single tab visible without remounting pages', t => {
  const h = harness(t);
  const controls = h.w.document.createElement('div');
  controls.id = 'workhubWindowControls'; h.w.document.body.append(controls);
  const bar = h.w.document.getElementById('workspaceTabBar');
  const first = h.frames()[0];
  first.contentDocument.write('<!doctype html><body></body>');
  const messages = [];
  first.contentWindow.postMessage = message => messages.push(message);
  h.w.document.documentElement.setAttribute('data-workhub-desktop', '');
  h.w.dispatchEvent(new h.w.Event('workhub:desktop-chrome'));
  assert.equal(bar.hidden, false);
  assert(!h.w.document.body.hasAttribute('data-workspace-tabs-hidden'));
  assert(controls.querySelector('.window-brand-trigger'));
  assert.equal(controls.querySelector('.window-tab-new'),null);
  assert.equal(first.contentDocument.documentElement.style.getPropertyValue('--workspace-sidebar-inset'),'0px');
  h.send(first, 'workhub:tab-ready');
  assert.equal(messages.findLast(message=>message.type==='workhub:tab-restore').tabBarHeight, 0);
  h.add();
  const secondMessages = [];
  h.frames()[1].contentWindow.postMessage = message => secondMessages.push(message);
  h.frames()[1].dispatchEvent(new h.w.Event('load'));
  assert.equal(bar.hidden, false);
  assert(!h.w.document.body.hasAttribute('data-workspace-tabs-hidden'));
  assert.equal(controls.querySelector('.window-tab-new'),null);
  assert.equal(first.contentDocument.documentElement.style.getPropertyValue('--workspace-sidebar-inset'),'0px');
  assert.equal(h.frames()[0], first);
  assert.equal(secondMessages.findLast(message=>message.type==='workhub:tab-layout').height, 0);
  h.w.document.querySelectorAll('.workspace-tab-close')[1].click();
  assert.equal(bar.hidden,false);
  assert.equal(h.frames()[0],first);
  assert.equal(first.hasAttribute('aria-label'),false);
  assert.equal(first.getAttribute('aria-labelledby'),h.buttons()[0].id);
  assert.equal(first.contentDocument.documentElement.style.getPropertyValue('--workspace-sidebar-inset'),'0px');
  h.send(first,'workhub:tab-chrome',{chrome:{left:72,top:0}});
  assert.equal(bar.hidden,false,'sidebar collapse keeps the tab visible');
  h.send(first,'workhub:tab-chrome',{chrome:{left:244,top:0}});
  assert.equal(bar.hidden,false);
});

test('Yolu menu opens a new tab and restores focus without replacing the conversation group', async t => {
  const h = parallelHarness(t);
  h.choice(conversation('second'));
  h.w.document.querySelectorAll('.workspace-tab-close')[1].click();
  const original = visibleFrames(h);
  const controls = h.w.document.createElement('div');
  controls.id = 'workhubWindowControls'; h.w.document.body.append(controls);
  h.w.document.documentElement.setAttribute('data-workhub-desktop','');
  h.w.dispatchEvent(new h.w.Event('workhub:desktop-chrome'));
  const trigger = controls.querySelector('.window-brand-trigger');
  trigger.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  await new Promise(resolve => setTimeout(resolve,30));
  const menu = h.w.document.querySelector('[role="menu"]');
  assert(menu,'the brand menu is portaled into the host, outside the sidebar iframe');
  assert.match(menu.textContent,/新建标签页/);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  await new Promise(resolve => setTimeout(resolve,30));
  assert.equal(h.w.document.querySelector('[role="menu"]'),null);
  assert.equal(h.w.document.activeElement,trigger);
  trigger.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  await new Promise(resolve => setTimeout(resolve,30));
  h.w.document.querySelector('[role="menuitem"]').click();
  await new Promise(resolve => setTimeout(resolve,30));
  assert.equal(h.saved().tabs.length,2);
  assert.equal(h.w.document.getElementById('workspaceTabBar').hidden,false);
  h.w.document.querySelectorAll('.workspace-tab-close')[1].click();
  assert.deepEqual(visibleFrames(h),original);
  assert.equal(h.w.document.getElementById('workspaceTabBar').hidden,false);
});

test('desktop sidebar control follows the active page and toggles the existing sidebar control', t => {
  const h = harness(t);
  const controls = h.w.document.createElement('div');
  controls.id = 'workhubWindowControls'; h.w.document.body.append(controls);
  h.w.document.documentElement.setAttribute('data-workhub-desktop', '');
  h.w.dispatchEvent(new h.w.Event('workhub:desktop-chrome'));
  assert(controls.querySelector('button').disabled);
  const first = h.frames()[0];
  first.contentDocument.write('<body><button class="sidebar-toggle">侧栏</button></body>');
  let toggles = 0;
  first.contentDocument.querySelector('button').onclick = () => { toggles++; };
  h.send(first, 'workhub:tab-ready');
  h.send(first, 'workhub:tab-chrome', {chrome:{left:244,top:0}});
  assert.equal(controls.querySelector('button').getAttribute('aria-label'), '收起侧栏');
  controls.querySelector('button').click();
  assert.equal(toggles, 1);
  h.send(first, 'workhub:tab-chrome', {chrome:{left:72,top:0}});
  assert.equal(controls.querySelector('button').getAttribute('aria-expanded'), 'false');
  assert.equal(controls.querySelector('button').getAttribute('aria-label'), '展开侧栏');
  assert.equal(h.frames()[0], first);
});

test('two conversations from one task open as distinct tabs without changing the source', t => {
  const h = harness(t);
  const source = h.frames()[0];
  for (const id of ['a','b']) h.send(source,'workhub:tab-open',{snapshot:{route:'/sessions',environment:'local',title:'对话 '+id,conversation:{scope:{kind:'task',id:'same-task'},selected:id,pane:'detail'}}});
  assert.equal(h.frames().length,3);
  assert.equal(h.saved().tabs[0].snapshot.route,'/requirements');
  assert.deepEqual(h.saved().tabs.slice(1).map(tab=>tab.snapshot.conversation.selected),['a','b']);
});

test('restores all pages and active selection, rejects foreign messages and invalid routes', t => {
  const h = harness(t,{selected:'b',tabs:[{id:'a',snapshot:{route:'/sessions',title:'会话 A',environment:'local',conversation:{scope:{kind:'task',id:'task'},selected:'one'}}},{id:'b',snapshot:{route:'/projects',title:'项目 B',environment:'wsl'}}]});
  assert.equal(h.frames().length,2);
  assert.equal(h.buttons()[1].getAttribute('aria-selected'),'true');
  h.send(h.frames()[0],'workhub:tab-open',{snapshot:{}},'https://untrusted.example');
  assert.equal(h.frames().length,2);
  h.send(h.frames()[0],'workhub:tab-open',{snapshot:{route:'https://untrusted.example',environment:'local'}});
  const url = new URL(h.frames()[2].src);
  assert.equal(url.origin,'http://localhost:4317');
  assert.equal(url.hash,'#/requirements');
});

test('close runs the existing cleanup but blocks during an in-progress foreground submission', t => {
  const h = harness(t); h.add();
  const frame = h.frames()[1]; let cleanup = 0;
  frame.contentWindow.WorkHubTab = {canClose:()=>false,dispose:()=>cleanup++};
  h.send(frame,'workhub:tab-ready');
  h.w.document.querySelectorAll('.workspace-tab-close')[1].click();
  assert.equal(h.frames().length,2);
  frame.contentWindow.WorkHubTab.canClose = ()=>true;
  h.w.document.querySelectorAll('.workspace-tab-close')[1].click();
  assert.equal(h.frames().length,1);
  assert.equal(cleanup,1);
});

test('database state restores on a fresh origin and takes precedence over stale browser storage', async t => {
  const old={selected:'old',tabs:[{id:'old',snapshot:{route:'/requirements',title:'过期页面'}}]};
  const stored={initialized:true,selected:'current',tabs:[{id:'current',snapshot:{route:'/sessions',title:'后端对话',conversation:{scope:{kind:'task',id:'task'},selected:'back'}}}]};
  const calls=[];
  const h=harness(t,old,'',async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>stored};});
  for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.frames().length,1);
  assert.equal(h.buttons()[0].textContent,'后端对话');
  assert.equal(h.saved().tabs[0].snapshot.conversation.selected,'back');
  assert.equal(calls[0].options.headers['X-Environment-ID'],'local');
  h.w.dispatchEvent(new h.w.Event('pagehide'));
  for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
  const write=calls.find(call=>call.options.method==='PUT');
  assert.equal(JSON.parse(write.options.body).selected,'current');
});

test('Radix tab keyboard navigation retains panel associations and independent close buttons', async t => {
  const h=harness(t);h.add();
  const second=h.buttons()[1];second.focus();
  second.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(h.buttons()[0].getAttribute('aria-selected'),'true');
  assert.equal(h.frames()[0].getAttribute('aria-labelledby'),h.buttons()[0].id);
  assert.equal(h.buttons()[0].getAttribute('aria-controls'),h.frames()[0].id);
  assert(h.w.document.querySelector('[data-slot="tabs-list"][data-variant="line"]'));
  assert.equal(h.w.document.querySelector('button button'),null);
});

test('background navigation changes do not redraw the bar and title updates retain other tab nodes', t => {
  const h=harness(t);h.add();
  const [first,second]=h.frames();
  h.send(first,'workhub:tab-state',{snapshot:{route:'/sessions',environment:'local',title:'前端',context:'任务'}});
  const other=h.buttons()[1];
  let renders=0;
  const render=h.w.WorkHubTabbar.render;
  h.w.WorkHubTabbar={...h.w.WorkHubTabbar,render:(...args)=>{renders++;return render(...args);}};
  h.send(first,'workhub:tab-state',{snapshot:{route:'/sessions',environment:'local',title:'前端',context:'任务',conversation:{search:'新筛选',selected:'session'}}});
  assert.equal(renders,0);
  h.send(first,'workhub:tab-state',{snapshot:{route:'/sessions',environment:'local',title:'新的很长的前端对话标题',context:'任务'}});
  assert.equal(renders,1);
  assert.equal(h.buttons()[1],other);
  assert.equal(h.frames()[1],second);
});

test('switching retained tabs applies the shared sidebar before reveal and discards stale bar geometry', t => {
  const h = harness(t), first = h.frames()[0]; h.add(); const second = h.frames()[1];
  const observed = [];
  for (const frame of [first, second]) {
    frame.contentDocument.write('<body><aside class="sidebar"></aside></body>');
    const page = frame.contentWindow, body = frame.contentDocument.body;
    frame.contentDocument.querySelector('.sidebar').getBoundingClientRect = () => {
      const width = body.classList.contains('sidebar-collapsed') ? 72 : parseFloat(body.style.getPropertyValue('--sidebar-width'));
      return {width, height:800, right:width, bottom:800};
    };
    page.addEventListener('workhub:sidebar-sync', () => {
      observed.push({frame, hidden:frame.hidden});
      body.classList.toggle('sidebar-collapsed', h.w.localStorage.getItem('workhub:sidebar-collapsed:v1') === 'true');
      body.style.setProperty('--sidebar-width', h.w.localStorage.getItem('workhub:sidebar-width:v1') + 'px');
    });
  }
  h.send(first, 'workhub:tab-chrome', {chrome:{left:72, top:0}});
  h.w.localStorage.setItem('workhub:sidebar-collapsed:v1', 'false');
  h.w.localStorage.setItem('workhub:sidebar-width:v1', '340');
  h.buttons()[0].click();
  assert.equal(observed.at(-1).hidden, true);
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-sidebar-width'), '340px');
  assert.equal(h.frames()[0], first);
  h.w.localStorage.setItem('workhub:sidebar-collapsed:v1', 'true');
  h.buttons()[1].click();
  assert.equal(observed.at(-1).hidden, true);
  assert(second.contentDocument.body.classList.contains('sidebar-collapsed'));
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-sidebar-width'), '72px');
  h.buttons()[0].click();
  assert(first.contentDocument.body.classList.contains('sidebar-collapsed'));
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-sidebar-width'), '72px');
});

test('the integrated bar tracks only active sidebar geometry including collapsed and mobile layouts', t => {
  const h=harness(t);const first=h.frames()[0];h.add();const second=h.frames()[1];
  h.send(second,'workhub:tab-chrome',{chrome:{left:300,top:0}});
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-sidebar-width'),'300px');
  h.send(first,'workhub:tab-chrome',{chrome:{left:72,top:0}});
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-sidebar-width'),'300px');
  h.buttons()[0].click();
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-sidebar-width'),'72px');
  h.send(first,'workhub:tab-chrome',{chrome:{left:0,top:184}});
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-sidebar-width'),'0px');
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-tabs-top'),'184px');
});

function conversation(id,task = 'task-a',environment = 'local') {
  return {route:'/sessions',title:'对话 ' + id,context:'任务 ' + task,environment,conversation:{scope:{kind:'task',id:task,environment},selected:environment === 'local' ? id : JSON.stringify([environment,id]),pane:'detail'}};
}
function parallelHarness(t, extra = {}) {
  const h = harness(t,{selected:'a',tabs:[{id:'a',snapshot:conversation('session-a')},{id:'task',snapshot:{route:'/requirements/task-b',title:'任务 B'}}],...extra});
  let picker;
  h.w.WorkHubTabbar = {...h.w.WorkHubTabbar,renderPicker:(_,props) => {picker = props;}};
  h.openPicker = () => {h.w.document.querySelector('[aria-label="添加并列对话"]').click(); return picker;};
  h.choice = (snapshot) => {h.openPicker().choose(snapshot);};
  h.picker = () => picker;
  return h;
}
const visibleFrames = h => h.frames().filter(frame => !frame.hidden);
const button = (h,label) => h.w.document.querySelector(`[aria-label="${label}"]`);
const paneAction = (h,title,command) => h.send(h.frames().find(frame=>frame.title===title),'workhub:tab-pane-command',{command});
const chooseFromList = (h,snapshot) => h.send(h.w.document.querySelector('.workspace-navigation-frame'),'workhub:conversation-select',{snapshot});

const terminal = (id,taskID = 'task-a') => ({route:'/terminals',environment:'local',title:id ? 'Shell' : '新建终端',terminal:{id,taskID}});
test('new conversation opens directly and inline form switching keeps the same tab and draft', t => {
  const h = harness(t,{selected:'a',tabs:[{id:'a',snapshot:conversation('session-a','task-a')}]});
  button(h,'新建对话').click();
  assert.equal(h.buttons().length,2,'one click opens the original new conversation page');
  assert.equal(h.w.document.querySelector('[role="dialog"]'),null);
  const ui = visibleFrames(h)[0], snapshot = h.saved().tabs[1].snapshot;
  assert.equal(snapshot.conversation.creating,true);
  ui.contentDocument.open(); ui.contentDocument.write('<!doctype html><body><textarea>尚未发送</textarea></body>'); ui.contentDocument.close();
  h.send(ui,'workhub:conversation-kind',{kind:'terminal',snapshot});
  const term = visibleFrames(h)[0];
  assert.notEqual(term,ui);
  assert.equal(h.buttons().length,2,'changing form never adds a global tab');
  assert.equal(h.saved().tabs[1].snapshot.terminal.taskID,'task-a');
  h.send(term,'workhub:conversation-kind',{kind:'ui',snapshot:h.saved().tabs[1].snapshot});
  assert.equal(visibleFrames(h)[0],ui);
  assert.equal(ui.contentDocument.querySelector('textarea').value,'尚未发送');
  h.send(ui,'workhub:conversation-kind',{kind:'terminal',snapshot});
  assert.equal(visibleFrames(h)[0],term,'unfinished terminal options keep their original document');
  h.w.document.querySelectorAll('.workspace-tab-close')[1].click();
  assert.equal(h.frames().length,1,'closing disposes both unfinished forms');
});
test('embedded and shared-list creation requests open directly at the requested position and keep task directory', t => {
  const h = harness(t,{selected:'a',tabs:[{id:'a',snapshot:conversation('session-a')}]});
  const snapshot = {...conversation(null),conversation:{...conversation(null).conversation,creating:true},terminal:{taskID:'task-a',projectID:'project-a'}};
  for (const frame of [h.frames()[0],h.w.document.querySelector('.workspace-navigation-frame')]) {
    h.send(frame,'workhub:tab-open',{create:true,placement:'split',snapshot});
    assert.equal(h.w.document.querySelector('[role="dialog"]'),null);
  }
  assert.equal(visibleFrames(h).length,3);
  const ui=visibleFrames(h)[2];
  h.send(ui,'workhub:conversation-kind',{kind:'terminal',snapshot});
  assert.equal(visibleFrames(h).length,3);
  assert.equal(h.saved().tabs[0].snapshot.parallel.panes[1].terminal.projectID,'project-a');
  h.send(visibleFrames(h)[2],'workhub:tab-open',{create:true,placement:'split',snapshot});
  assert.equal(visibleFrames(h).length,3,'changing forms retains the three-pane limit');
});
test('new conversation remembers form kind and keeps remote and unbound project creation in UI', t => {
  const h = harness(t,{selected:'a',tabs:[{id:'a',snapshot:conversation('one','task-a')}]});
  button(h,'新建对话').click();
  const draft = visibleFrames(h)[0];
  h.send(draft,'workhub:conversation-kind',{kind:'terminal',snapshot:h.saved().tabs.at(-1).snapshot});
  button(h,'新建对话').click();
  assert.equal(h.saved().tabs.at(-1).snapshot.route,'/terminals');
  assert.equal(h.saved().tabs.at(-1).snapshot.terminal.taskID,'task-a');
  h.send(visibleFrames(h)[0],'workhub:conversation-kind',{kind:'ui',snapshot:h.saved().tabs.at(-1).snapshot});
  button(h,'新建对话').click();
  assert.equal(h.saved().tabs.at(-1).snapshot.route,'/sessions');
  h.w.WorkHubTabbar.conversationDefaults.set('kind','terminal');
  for (const snapshot of [
    {route:'/sessions',environment:'remote-a',conversation:{scope:{kind:'task',id:'remote-task',environment:'remote-a'},creating:true}},
    {route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'unbound'},creating:true}},
  ]) {
    h.send(visibleFrames(h)[0],'workhub:tab-open',{create:true,snapshot});
    assert.equal(h.saved().tabs.at(-1).snapshot.route,'/sessions');
  }
});
test('form switching rejects remote terminals and existing conversations or running terminals', t => {
  const remote={...conversation(null,'task-a','remote-a'),conversation:{...conversation(null).conversation,creating:true,selected:null}};
  const h=harness(t,{selected:'a',tabs:[{id:'a',snapshot:remote},{id:'b',snapshot:conversation('existing')},{id:'c',snapshot:terminal('running')}]});
  const first=visibleFrames(h)[0];
  h.send(first,'workhub:conversation-kind',{kind:'terminal',snapshot:remote});
  assert.equal(visibleFrames(h)[0],first);
  h.buttons()[1].click();
  const second=visibleFrames(h)[0];
  h.send(second,'workhub:conversation-kind',{kind:'terminal',snapshot:conversation('existing')});
  assert.equal(visibleFrames(h)[0],second);
  h.buttons()[2].click();
  const third=visibleFrames(h)[0];
  h.send(third,'workhub:conversation-kind',{kind:'ui',snapshot:terminal('running')});
  assert.equal(visibleFrames(h)[0],third);
});
test('terminal panes mix with conversations, retain documents and restore within the three-pane limit', t => {
  const h = parallelHarness(t), first = visibleFrames(h)[0];
  h.send(first,'workhub:tab-open',{placement:'split',snapshot:terminal()});
  const second = visibleFrames(h)[1];
  assert.equal(new URL(second.src).searchParams.get('workspace-terminal'),'1');
  h.send(second,'workhub:tab-state',{snapshot:terminal('pty-one')});
  assert.equal(h.buttons().length,2,'starting a terminal promotes its pane without creating a global tab');
  h.choice(conversation('session-b'));
  assert.equal(visibleFrames(h).length,3);
  h.send(second,'workhub:tab-open',{placement:'split',snapshot:terminal()});
  assert.equal(visibleFrames(h).length,3);
  h.buttons()[1].click(); h.buttons()[0].click();
  assert.equal(visibleFrames(h)[1],second,'switching tabs retains the terminal document');
  const restored = harness(t,h.saved());
  assert.equal(visibleFrames(restored).length,3);
  assert.equal(restored.saved().tabs[0].snapshot.parallel.panes[0].terminal.id,'pty-one');
  h.send(second,'workhub:tab-pane-command',{command:'close'});
  assert.equal(visibleFrames(h).length,2);
  assert.equal(visibleFrames(h)[0],first);
});
test('terminal-only groups retain the shared conversation list, and duplicate starts a fresh terminal', t => {
  const h = harness(t,{selected:'terminal',tabs:[{id:'terminal',snapshot:terminal('existing')}]});
  const navigation = h.w.document.querySelector('.workspace-navigation-frame');
  const handle = h.w.document.querySelector('.workspace-shared-list-resize');
  h.w.document.querySelector('.workspace-shared-list-size').getBoundingClientRect = () => ({width:280,height:700});
  assert(h.w.document.body.hasAttribute('data-workspace-conversations'));
  assert(!navigation.parentElement.hidden && !handle.hidden);
  handle.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));
  assert.equal(h.saved().tabs[0].snapshot.conversationListWidth,320);
  const messages = [];
  navigation.contentWindow.postMessage = message => messages.push(message);
  h.send(navigation,'workhub:tab-ready');
  assert.equal(messages.find(message=>message.type==='workhub:tab-restore').snapshot.conversation.scope.id,'task-a');
  assert.equal(messages.findLast(message=>message.type==='workhub:conversation-group').autoSelect,false,'loading the list must not replace the terminal');
  button(h,'在右侧新建对话').click();
  const ui = visibleFrames(h)[1];
  h.send(ui,'workhub:conversation-kind',{kind:'terminal',snapshot:h.saved().tabs[0].snapshot.parallel.panes[0]});
  assert.equal(visibleFrames(h).length,2);
  assert.equal(h.w.document.querySelector('.workspace-navigation-frame'),navigation);
  assert(!navigation.parentElement.hidden && !handle.hidden);
  h.w.document.getElementById('workspaceTabDuplicate').click();
  assert.equal(h.buttons().length,2);
  assert.equal(h.saved().tabs[1].snapshot.terminal.id,undefined,'duplicate must not attach two views to the same PTY');
  const restored = harness(t,h.saved());
  assert.equal(visibleFrames(restored).length,2);
  assert.equal(restored.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'320px');
  assert(!restored.w.document.querySelector('.workspace-shared-list-resize').hidden);
  Object.defineProperty(restored.w,'innerWidth',{value:1300,configurable:true});
  restored.w.dispatchEvent(new restored.w.Event('resize'));
  assert.equal(visibleFrames(restored).length,1,'pane fitting reserves the visible conversation list');
  Object.defineProperty(restored.w,'innerWidth',{value:600,configurable:true});
  restored.w.dispatchEvent(new restored.w.Event('resize'));
  assert.equal(visibleFrames(restored).length,1);
  assert.equal(restored.w.document.getElementById('workspaceNarrowPanes').options.length,2);
});
test('a single terminal restores its list width and list selection preserves its mounted process view', t => {
  const h = harness(t,{selected:'terminal',tabs:[{id:'terminal',snapshot:{...terminal('existing'),conversationListWidth:390}}]});
  const frame = visibleFrames(h)[0], navigation = h.w.document.querySelector('.workspace-navigation-frame');
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'390px');
  chooseFromList(h,conversation('another'));
  assert.equal(h.buttons().length,2);
  h.buttons()[0].click();
  assert.equal(visibleFrames(h)[0],frame);
  assert.equal(h.w.document.querySelector('.workspace-navigation-frame'),navigation);
  assert(!navigation.parentElement.hidden);
  assert.equal(h.saved().tabs[0].snapshot.terminal.id,'existing');
  assert.equal(h.saved().tabs[0].snapshot.conversationListWidth,390);
});
test('opening an already displayed terminal focuses its owner, and shared list navigation preserves a focused terminal', t => {
  const h = parallelHarness(t), first = visibleFrames(h)[0];
  h.send(first,'workhub:tab-open',{placement:'split',snapshot:terminal('one')});
  const second = visibleFrames(h)[1];
  h.send(first,'workhub:tab-open',{snapshot:terminal('one')});
  assert.equal(h.buttons().length,2);
  assert.equal(second.dataset.focused,'true');
  chooseFromList(h,conversation('another'));
  assert.equal(h.buttons().length,3,'list navigation opens a conversation rather than replacing the terminal');
  h.buttons()[0].click();
  assert.equal(visibleFrames(h)[1],second);
});

for (const index of [1,2]) test(`restoring a conversation group resumes pane ${index + 1} and its task scope`, async t => {
  const h = parallelHarness(t);
  h.choice(conversation('session-b','task-b','remote-b'));
  h.choice(conversation('session-c','task-c','remote-c'));
  const frames = visibleFrames(h);
  h.send(frames[index],'workhub:tab-focus');
  assert.equal(h.saved().tabs[0].snapshot.parallel.focused,index,'a focus-only change is saved immediately');
  const saved = h.saved();
  // Simulate an initialized host store on a fresh origin without local storage.
  const restored = harness(t,null,'',async()=>({ok:true,json:async()=>({...saved,initialized:true})}));
  for (let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
  const focused = visibleFrames(restored).find(frame=>frame.dataset.focused === 'true');
  assert.equal(focused.title,frames[index].title);
  const navigation = restored.w.document.querySelector('.workspace-navigation-frame'), messages = [];
  navigation.contentWindow.postMessage = message => messages.push(message);
  restored.send(navigation,'workhub:tab-ready');
  const snapshot = messages.find(message=>message.type==='workhub:tab-restore').snapshot;
  assert.equal(snapshot.environment,`remote-${index === 1 ? 'b' : 'c'}`);
  assert.equal(snapshot.conversation.scope.id,`task-${index === 1 ? 'b' : 'c'}`);
  Object.defineProperty(restored.w,'innerWidth',{value:600,configurable:true});
  restored.w.dispatchEvent(new restored.w.Event('resize'));
  assert.deepEqual(visibleFrames(restored),[focused],'narrow windows reveal the restored pane');
});

test('focused positions tolerate legacy and filtered snapshots without selecting the wrong conversation', t => {
  for (const focused of [undefined,-1,8,'1',true]) {
    const h = harness(t,{selected:'a',tabs:[{id:'a',snapshot:{...conversation('first'),parallel:{panes:[conversation('second')],focused}}}]});
    assert.equal(visibleFrames(h).find(frame=>frame.dataset.focused === 'true').title,'对话 first');
  }
  for (const [focused,expected] of [[1,'对话 first'],[2,'对话 last']]) {
    const h = harness(t,{selected:'a',tabs:[{id:'a',snapshot:{...conversation('first'),parallel:{panes:[{route:'/projects'},conversation('last')],focused}}}]});
    assert.equal(visibleFrames(h).find(frame=>frame.dataset.focused === 'true').title,expected);
  }
});

test('a restored draft keeps its focused position while becoming a conversation', t => {
  const h = parallelHarness(t);
  const first = visibleFrames(h)[0];
  h.send(first,'workhub:tab-open',{placement:'split',snapshot:newConversation()});
  const restored = harness(t,h.saved()), draft = visibleFrames(restored).find(frame=>frame.dataset.focused === 'true');
  assert.equal(draft.title,'新建对话');
  restored.send(draft,'workhub:tab-state',{snapshot:conversation('new-session')});
  assert.equal(draft.dataset.focused,'true');
  assert.equal(restored.saved().tabs[0].snapshot.parallel.focused,1);
});

const newConversation = (task = 'task-a',environment = 'local') => ({...conversation('',task,environment),title:'新建对话',conversation:{scope:{kind:'task',id:task,environment},selected:null,creating:true,pane:'detail'}});

test('new split conversations are inserted to the right, restore drafts, and become sessions in place', t => {
  const h = parallelHarness(t), first = visibleFrames(h)[0];
  const panes = () => visibleFrames(h).sort((a,b)=>Number(a.style.gridColumn) - Number(b.style.gridColumn));
  h.send(first,'workhub:tab-open',{placement:'split',snapshot:newConversation()});
  const second = visibleFrames(h)[1];
  assert.equal(h.buttons().length,2,'a split retains the original workspace tab count');
  assert.equal(visibleFrames(h)[0],first);
  h.send(first,'workhub:tab-open',{placement:'split',snapshot:newConversation('task-b','remote')});
  const middle = panes()[1];
  assert.equal(panes()[2],second,'insertion is next to the source pane');
  const navigation = h.w.document.querySelector('.workspace-navigation-frame'), messages = [];
  navigation.contentWindow.postMessage = message => messages.push(message);
  h.send(navigation,'workhub:tab-ready');
  assert.equal(messages.findLast(message=>message.type==='workhub:conversation-group').canSplit,false);
  h.send(navigation,'workhub:tab-open',{placement:'split',snapshot:newConversation()});
  assert.equal(visibleFrames(h).length,3,'the host also enforces the three-pane limit');
  const restored = harness(t,h.saved());
  assert.equal(visibleFrames(restored).length,3);
  assert.equal(restored.saved().tabs[0].snapshot.parallel.panes[0].environment,'remote');
  assert.equal(restored.saved().tabs[0].snapshot.parallel.panes[1].conversation.creating,true);
  h.send(middle,'workhub:tab-state',{snapshot:conversation('created','task-b','remote')});
  assert.equal(h.buttons().length,2,'promotion of a draft must not create a separate tab');
  assert.equal(panes()[1],middle,'creating the session keeps the mounted pane');
  assert.equal(h.saved().tabs[0].snapshot.parallel.panes[0].conversation.selected,JSON.stringify(['remote','created']));
  h.send(second,'workhub:tab-open',{snapshot:newConversation()});
  assert.equal(h.buttons().length,3,'ordinary new conversation still defaults to a workspace tab');
});

test('current placement retains the focused controller and leaves the other panes unchanged', t => {
  const h = parallelHarness(t), first = visibleFrames(h)[0];
  h.choice(conversation('session-b'));
  const second = visibleFrames(h)[1], messages = [];
  let disposed = 0;
  second.contentWindow.postMessage = message => messages.push(message);
  second.contentWindow.WorkHubTab = {canClose:()=>false,dispose:()=>disposed++};
  h.send(second,'workhub:tab-ready');
  const navigation = h.w.document.querySelector('.workspace-navigation-frame');
  h.send(navigation,'workhub:tab-open',{placement:'current',snapshot:newConversation('other-task')});
  assert.equal(h.saved().tabs[0].snapshot.parallel.panes[0].conversation.selected,'session-b','foreground operations block replacement');
  second.contentWindow.WorkHubTab.canClose = () => true;
  h.send(navigation,'workhub:tab-open',{placement:'current',snapshot:newConversation('other-task')});
  assert.deepEqual(visibleFrames(h),[first,second]);
  assert.equal(disposed,0,'retain controller memory including unsent attachments');
  assert.equal(messages.findLast(message=>message.type==='workhub:tab-restore').snapshot.conversation.creating,true);
  assert.equal(h.saved().tabs[0].snapshot.conversation.selected,'session-a');
  assert.equal(h.saved().tabs[0].snapshot.parallel.panes[0].conversation.scope.id,'other-task');
  h.send(second,'workhub:tab-state',{snapshot:conversation('new-session','other-task')});
  assert.equal(h.buttons().length,2);
  assert.equal(h.saved().tabs[0].snapshot.parallel.panes[0].conversation.selected,'new-session');
});

test('a new primary draft retains its parallel conversations on restore', t => {
  const h = parallelHarness(t), first = visibleFrames(h)[0];
  h.choice(conversation('session-b'));
  h.send(first,'workhub:tab-open',{placement:'current',snapshot:newConversation()});
  const restored = harness(t,h.saved());
  assert.equal(visibleFrames(restored).length,2);
  assert.equal(restored.saved().tabs[0].snapshot.conversation.creating,true);
  assert.equal(restored.saved().tabs[0].snapshot.parallel.panes[0].conversation.selected,'session-b');
});

test('new conversation tabs retain shared navigation through creation and restoration', t => {
  const h = parallelHarness(t), original = visibleFrames(h)[0];
  const navigation = h.w.document.querySelector('.workspace-navigation-frame');
  h.w.document.querySelector('[aria-label="调整共享对话列表宽度"]').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
  const draft = {...conversation(''),title:'新建对话',conversation:{scope:{kind:'task',id:'task-a'},selected:null,creating:true,pane:'detail'}};
  h.send(navigation,'workhub:tab-open',{snapshot:draft});
  const frame = visibleFrames(h)[0], messages = [];
  frame.contentWindow.postMessage = message => messages.push(message);
  h.send(frame,'workhub:tab-ready');
  assert(h.w.document.body.hasAttribute('data-workspace-conversations'));
  assert.equal(h.w.document.querySelector('.workspace-navigation-frame'),navigation);
  assert(!navigation.parentElement.hidden);
  assert.equal(messages.findLast(message=>message.type==='workhub:tab-pane').shared,true);
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'520px');
  assert.equal(button(h,'添加并列对话'),null,'drafts do not yet have a conversation identity for parallel panes');
  const restored = harness(t,h.saved());
  assert(restored.w.document.body.hasAttribute('data-workspace-conversations'));
  assert.equal(restored.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'520px');
  h.send(frame,'workhub:tab-state',{snapshot:conversation('session-new')});
  assert.equal(visibleFrames(h)[0],frame,'creating the conversation keeps its mounted chat surface');
  assert.equal(h.w.document.querySelector('.workspace-navigation-frame'),navigation);
  assert(button(h,'添加并列对话'));
  h.buttons()[0].click();
  assert.equal(visibleFrames(h)[0],original);
  Object.defineProperty(restored.w,'innerWidth',{value:600,configurable:true});
  restored.w.dispatchEvent(new restored.w.Event('resize'));
  assert(!restored.w.document.body.hasAttribute('data-workspace-conversations'),'drafts retain mobile list/detail navigation');
});

test('shared list selection can leave a new conversation without opening another global tab', t => {
  const draft = {...conversation(''),conversation:{scope:{kind:'task',id:'task-a'},selected:null,creating:true,pane:'detail'}};
  const h = harness(t,{selected:'draft',tabs:[{id:'draft',snapshot:draft}]});
  const frame = visibleFrames(h)[0], navigation = h.w.document.querySelector('.workspace-navigation-frame');
  frame.contentWindow.WorkHubTab = {canClose:()=>false};
  h.send(frame,'workhub:tab-ready');
  chooseFromList(h,conversation('existing'));
  assert.equal(visibleFrames(h)[0],frame,'a pending foreground operation still blocks replacement');
  frame.contentWindow.WorkHubTab.canClose = () => true;
  chooseFromList(h,conversation('existing'));
  assert.equal(h.buttons().length,1);
  assert.equal(h.saved().tabs[0].snapshot.conversation.selected,'existing');
  assert.equal(h.w.document.querySelector('.workspace-navigation-frame'),navigation);
  assert(h.w.document.body.hasAttribute('data-workspace-conversations'));
});

test('same-task and cross-task conversations share one global tab and retain independent documents', t => {
  const h = parallelHarness(t), original = h.frames()[0];
  Object.defineProperty(h.w,'innerWidth',{value:1800,configurable:true});
  original.contentDocument.write('<body><textarea>草稿 A</textarea></body>');
  h.choice(conversation('session-b'));
  h.choice(conversation('session-c','task-b'));
  assert.equal(h.buttons().length,2,'only the conversation group and task page are global tabs');
  assert.equal(visibleFrames(h).length,3);
  assert.equal(h.w.document.querySelectorAll('.workspace-pane-heading [role="tablist"]').length,0,'panes do not add another layer of tabs');
  assert.equal(h.buttons()[0].textContent,'对话 session-a +2');
  assert.equal(original.contentDocument.querySelector('textarea').value,'草稿 A');
  const saved = h.saved().tabs[0].snapshot;
  assert.deepEqual(saved.parallel.panes.map(p=>p.conversation.scope.id),['task-a','task-b']);
  assert.equal(saved.conversation.selected,'session-a');
  assert.equal(button(h,'添加并列对话'),null,'three conversations is the limit');
  assert.equal(h.frames()[0],original);
});

test('switching global tabs hides and restores the whole group without replacing its panes', t => {
  const h = parallelHarness(t); h.choice(conversation('session-b','task-b'));
  const group = visibleFrames(h);
  group[1].contentDocument.write('<body><textarea>草稿 B</textarea></body>');
  h.buttons()[1].click();
  assert.equal(visibleFrames(h).length,1);
  assert.equal(visibleFrames(h)[0].id,'page-task');
  h.buttons()[0].click();
  assert.deepEqual(visibleFrames(h),group);
  assert.equal(group[1].contentDocument.querySelector('textarea').value,'草稿 B');
  assert.equal(h.saved().selected,'a');
});

test('replacing a named pane leaves all other documents and drafts untouched', t => {
  const h = parallelHarness(t); h.choice(conversation('session-b','task-b'));
  const [first,second] = visibleFrames(h);
  first.contentDocument.write('<body><textarea>保留草稿</textarea></body>');
  h.send(second,'workhub:tab-focus');
  chooseFromList(h,conversation('session-c','task-c'));
  assert.equal(visibleFrames(h)[0],first);
  assert.equal(first.contentDocument.querySelector('textarea').value,'保留草稿');
  assert(!second.isConnected);
  assert.equal(h.saved().tabs[0].snapshot.parallel.panes[0].conversation.scope.id,'task-c');
});

test('choosing an existing conversation focuses it and environment identity prevents collisions', t => {
  const h = parallelHarness(t); h.choice(conversation('session-a','task-remote','remote'));
  assert.equal(visibleFrames(h).length,2,'identical session IDs in different environments remain distinct');
  const first = h.frames()[0];
  h.choice(conversation('session-a'));
  assert.equal(visibleFrames(h).length,2,'already visible conversation is not duplicated');
  assert.equal(first.dataset.focused,'true');
  assert.equal(h.saved().selected,'a','focusing a pane does not change the global selected tab');
});

test('removing primary promotes a survivor and returns to a normal conversation without stopping runs', t => {
  const h = parallelHarness(t); Object.defineProperty(h.w,'innerWidth',{value:1800,configurable:true}); h.choice(conversation('session-b','task-b')); h.choice(conversation('session-c','task-c'));
  const [first,second,third] = visibleFrames(h), disposed = [];
  for (const frame of [first,second,third]) {frame.contentWindow.WorkHubTab = {canClose:()=>true,dispose:()=>disposed.push(frame)}; h.send(frame,'workhub:tab-ready');}
  paneAction(h,'对话 session-a','close');
  assert.equal(h.saved().tabs[0].snapshot.conversation.selected,'session-b');
  assert.equal(h.buttons()[0].textContent,'对话 session-b +1');
  assert.deepEqual(visibleFrames(h),[second,third]);
  paneAction(h,'对话 session-c','close');
  assert.equal(h.w.document.body.hasAttribute('data-workspace-split'),false);
  assert.equal(visibleFrames(h)[0],second);
  assert.equal(h.saved().tabs[0].snapshot.parallel,undefined);
  assert.deepEqual(disposed,[first,third]);
  assert.equal(second.getAttribute('aria-labelledby'),'tab-a');
});

test('foreground submissions block replacement, removal and whole-group closure atomically', t => {
  const h = parallelHarness(t); h.choice(conversation('session-b'));
  const [first,second] = visibleFrames(h);
  first.contentWindow.WorkHubTab = {canClose:()=>true}; second.contentWindow.WorkHubTab = {canClose:()=>false};
  h.send(first,'workhub:tab-ready'); h.send(second,'workhub:tab-ready');
  h.send(second,'workhub:tab-focus'); chooseFromList(h,conversation('session-c'));
  assert.equal(visibleFrames(h)[1],second);
  paneAction(h,'对话 session-b','close');
  assert.equal(visibleFrames(h).length,2);
  h.w.document.querySelector('.workspace-tab-close').click();
  assert.equal(h.frames().length,3,'closing a group validates all pages before disposing any');
});

test('zoom and compact view keep the group intact and every conversation reachable', t => {
  const h = parallelHarness(t); Object.defineProperty(h.w,'innerWidth',{value:1800,configurable:true}); h.choice(conversation('session-b')); h.choice(conversation('session-c'));
  const frames = visibleFrames(h);
  paneAction(h,'对话 session-b','zoom');
  assert.equal(visibleFrames(h).length,1);
  paneAction(h,'对话 session-b','zoom');
  assert.deepEqual(visibleFrames(h),frames);
  Object.defineProperty(h.w,'innerWidth',{value:600,configurable:true}); h.w.dispatchEvent(new h.w.Event('resize'));
  assert.equal(visibleFrames(h).length,1);
  const chooser = h.w.document.getElementById('workspaceNarrowPanes');
  assert.equal(chooser.options.length,3);
  chooser.value = frames[2].id.slice(5); chooser.dispatchEvent(new h.w.Event('change'));
  assert.equal(visibleFrames(h)[0],frames[2]);
  Object.defineProperty(h.w,'innerWidth',{value:1800,configurable:true}); h.w.dispatchEvent(new h.w.Event('resize'));
  assert.deepEqual(visibleFrames(h),frames);
});

test('group snapshots restore widths and both task contexts; malformed groups cannot split other pages', t => {
  const source = conversation('session-a'); source.parallel = {panes:[conversation('session-b','task-b')],widths:[1,2]};
  const h = parallelHarness(t,{tabs:[{id:'a',snapshot:source}]});
  assert.equal(visibleFrames(h).length,2);
  assert.equal(h.w.document.getElementById('workspacePages').style.gridTemplateColumns,'1fr 8px 2fr');
  const restored = harness(t,h.saved());
  assert.equal(visibleFrames(restored).length,2);
  assert.equal(restored.saved().tabs[0].snapshot.parallel.panes[0].context,'任务 task-b');
  const bad = harness(t,{selected:'a',tabs:[{id:'a',snapshot:{route:'/projects',parallel:source.parallel}}]});
  assert.equal(visibleFrames(bad).length,1);
  const duplicate = harness(t,{selected:'a',tabs:[{id:'a',snapshot:{...source,parallel:{panes:[source,{route:'/projects'}],widths:[-1,2]}}}]});
  assert.equal(visibleFrames(duplicate).length,1);
});

test('global keyboard shortcuts and new-tab links keep whole conversation groups together', t => {
  const h = parallelHarness(t); h.choice(conversation('session-b'));
  const [first,second] = visibleFrames(h);
  h.send(second,'workhub:tab-focus');
  h.send(second,'workhub:tab-key',{key:{key:'Tab',ctrlKey:true}});
  assert.equal(h.saved().selected,'task');
  h.send(h.frames()[1],'workhub:tab-key',{key:{key:'1',ctrlKey:true}});
  assert.deepEqual(visibleFrames(h),[first,second]);
  h.send(second,'workhub:tab-open',{snapshot:{route:'/projects',title:'项目'}});
  assert.equal(h.buttons().length,3);
  h.buttons()[0].click(); assert.deepEqual(visibleFrames(h),[first,second]);
});

test('legacy workspace split migrates to independent global tabs without losing pages', t => {
  const h = harness(t,{selected:'b',tabs:['a','b','c'].map(id=>({id,snapshot:conversation(id)})),layout:{columns:2,panes:['a','b'],groups:[['a','c'],['b']],widths:[1,1]}});
  assert.equal(h.buttons().length,3);
  assert.equal(visibleFrames(h).length,1);
  assert.deepEqual(h.saved().tabs.map(tab=>tab.snapshot.conversation.selected),['a','b','c']);
});

test('pane resize persists only the current group and preserves its conversation frames', t => {
  const h = parallelHarness(t); h.choice(conversation('session-b'));
  const frames = visibleFrames(h);
  frames.forEach(frame => {frame.getBoundingClientRect = () => ({width:400,height:700});});
  h.w.document.querySelector('[role="separator"]').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
  assert.deepEqual(h.saved().tabs[0].snapshot.parallel.widths,[1.025,0.9750000000000001]);
  assert.equal(h.saved().tabs[1].snapshot.parallel,undefined);
  assert.deepEqual(visibleFrames(h),frames);
});

const settlePicker = () => new Promise(resolve=>setTimeout(resolve,30));
test('real picker defaults to current task and permits cross-task search and selection', async t => {
  const requests = [];
  const tasks = [{id:'task-a',name:'任务 A',environment_id:'local',members:[]},{id:'task-b',name:'任务 B',environment_id:'local',members:[]}];
  const fetch = async (url,options = {}) => {
    requests.push({url,options});
    const value = url === '/api/workspace-tabs' ? {initialized:true,selected:'a',tabs:[{id:'a',snapshot:conversation('session-a')}]} : url === '/api/task-inventory' ? {requirements:tasks,environments:[{id:'local',name:'本机'}]} : url === '/api/environments' ? {environments:[{id:'local',name:'本机'}]} : {sessions:[{id:url.includes('task-b')?'session-b':'session-a',name:url.includes('task-b')?'后端排障':'前端开发',cwd:'/sample'}]};
    return {ok:true,json:async()=>value};
  };
  const h = harness(t,null,'',fetch); await settlePicker();
  button(h,'添加并列对话').click(); await settlePicker(); await settlePicker();
  assert(requests.some(request=>request.url.includes('task_id=task-a') && request.url.includes('linked=true')));
  const select = h.w.document.querySelector('[aria-label="选择任务范围"]');
  select.value = JSON.stringify(['local','task-b']); select.dispatchEvent(new h.w.Event('change',{bubbles:true})); await settlePicker();
  assert(requests.some(request=>request.url.includes('task_id=task-b')));
  const row = h.w.document.querySelector('.conversation-picker-row'); assert(row.textContent.includes('任务 B'));
  row.click();
  assert.equal(visibleFrames(h).length,2);
  assert.equal(h.saved().tabs[0].snapshot.parallel.panes[0].conversation.scope.id,'task-b');
  assert.equal(h.w.document.querySelector('[role="dialog"]'),null);
});

test('all conversation panes share one reusable sidebar and sidebar navigation preserves their group', t => {
  const h = parallelHarness(t); h.choice(conversation('session-b','task-b'));
  const navigation = h.w.document.querySelector('.workspace-navigation-frame');
  assert(navigation && !navigation.parentElement.hidden);
  assert.equal(h.w.document.querySelectorAll('.workspace-shared-navigation').length,1);
  h.send(navigation,'workhub:tab-ready');
  h.send(navigation,'workhub:tab-chrome',{chrome:{left:300,top:0}});
  assert.equal(h.w.document.body.style.getPropertyValue('--workspace-shared-sidebar-width'),'300px');
  const panes = h.saved().tabs[0].snapshot.parallel.panes;
  h.send(navigation,'workhub:tab-open',{snapshot:{route:'/sessions',title:'任务 C',conversation:{scope:{kind:'task',id:'task-c'}}}});
  assert.equal(h.buttons().length,3);
  assert(!navigation.parentElement.hidden,'an unselected scope already uses the shared list layout');
  h.buttons()[0].click();
  assert.equal(h.w.document.querySelector('.workspace-navigation-frame'),navigation);
  assert(!navigation.parentElement.hidden);
  assert.deepEqual(h.saved().tabs[0].snapshot.parallel.panes,panes);
});

test('shared conversation list locates existing panes and explicitly adds across tasks without replacing them', t => {
 const h = parallelHarness(t); h.choice(conversation('session-b','task-b'));
 const navigation = h.w.document.querySelector('.workspace-navigation-frame');
 const first = visibleFrames(h)[0], groupCount = h.buttons().length;
 h.send(navigation,'workhub:conversation-select',{snapshot:conversation('session-b','task-b')});
 assert.equal(h.buttons().length,groupCount);
 assert.equal(visibleFrames(h).length,2);
 h.send(navigation,'workhub:conversation-add',{snapshot:conversation('session-c','task-c')});
 assert.equal(visibleFrames(h).length,3);
 assert.equal(visibleFrames(h)[0],first);
 assert.equal(h.saved().tabs[0].snapshot.parallel.panes[1].conversation.scope.id,'task-c');
 assert.equal(h.w.document.querySelectorAll('.workspace-navigation-frame').length,1);
 h.send(navigation,'workhub:conversation-select',{snapshot:conversation('session-d','task-d')});
 assert.equal(h.buttons().length,groupCount,'list selection replaces only the focused pane in the existing group');
 assert.equal(visibleFrames(h).length,3);
 assert.equal(h.saved().tabs[0].snapshot.parallel.panes[1].conversation.selected,'session-d');
});

test('shared list divider resizes with pointer and keyboard without replacing conversation documents', t => {
 const h = parallelHarness(t); h.choice(conversation('session-b','task-b'));
 const frames = visibleFrames(h), handle = h.w.document.querySelector('[aria-label="调整共享对话列表宽度"]');
 const size = h.w.document.querySelector('.workspace-shared-list-size');
 size.getBoundingClientRect = () => ({width:Number.parseFloat(h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width')),height:700});
 frames[0].contentDocument.write('<body><textarea>保留草稿</textarea></body>');
 const pointer = (type,x) => new h.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x});
 handle.dispatchEvent(pointer('pointerdown',524));
 assert(h.w.document.body.hasAttribute('data-split-resizing'));
 h.w.document.dispatchEvent(pointer('pointermove',624));
 h.w.document.dispatchEvent(pointer('pointerup',624));
 assert(!h.w.document.body.hasAttribute('data-split-resizing'));
 assert.equal(h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'380px');
 assert.equal(h.w.localStorage.getItem('workhub:conversation-list-width:v1'),'380');
 assert.equal(h.saved().tabs[0].snapshot.parallel.listWidth,380);
 handle.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true,cancelable:true}));
 assert.equal(h.saved().tabs[0].snapshot.parallel.listWidth,340);
 handle.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
 assert.equal(handle.getAttribute('aria-valuenow'),'520');
 handle.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
 assert.equal(h.saved().tabs[0].snapshot.parallel.listWidth,220);
 handle.dispatchEvent(new h.w.MouseEvent('dblclick',{bubbles:true}));
 assert.equal(h.saved().tabs[0].snapshot.parallel.listWidth,280);
 assert.equal(frames[0].contentDocument.querySelector('textarea').value,'保留草稿');
 assert.deepEqual(visibleFrames(h),frames);
 assert.deepEqual(h.saved().tabs[0].snapshot.parallel.widths,[1,1]);
});

test('shared list width restores on a fresh origin and the divider follows the group across tabs', t => {
 const h = parallelHarness(t); h.choice(conversation('session-b'));
 const handle = h.w.document.querySelector('[aria-label="调整共享对话列表宽度"]');
 handle.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
 const restored = harness(t,h.saved());
 assert.equal(restored.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'520px');
 h.buttons()[1].click(); assert(handle.hidden);
 h.buttons()[0].click(); assert(!handle.hidden);
 assert.equal(h.w.document.querySelector('[aria-label="调整共享对话列表宽度"]'),handle);
 assert.equal(h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'520px');
});

test('single and parallel conversations reuse the same list geometry and stable conversation surfaces', t => {
 const h = parallelHarness(t);
 const first = visibleFrames(h)[0], navigation = h.w.document.querySelector('.workspace-navigation-frame');
 const handle = h.w.document.querySelector('[aria-label="调整共享对话列表宽度"]');
 const messages = [];
 first.contentWindow.postMessage = message => messages.push(message);
 h.send(first,'workhub:tab-ready');
 assert(h.w.document.body.hasAttribute('data-workspace-conversations'));
 assert(!h.w.document.body.hasAttribute('data-workspace-split'));
 assert(!navigation.parentElement.hidden && !handle.hidden);
 assert.deepEqual(JSON.parse(JSON.stringify(messages.findLast(message=>message.type==='workhub:tab-pane'))),{type:'workhub:tab-pane',split:false,shared:true});
 first.contentDocument.write('<body><textarea>单栏草稿</textarea></body>');
 handle.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));
 assert.equal(h.saved().tabs[0].snapshot.conversationListWidth,520);
 h.choice(conversation('session-b'));
 assert.equal(h.w.document.querySelector('.workspace-navigation-frame'),navigation);
 assert.equal(h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'520px');
 paneAction(h,'对话 session-b','close');
 assert.equal(visibleFrames(h)[0],first);
 assert.equal(first.contentDocument.querySelector('textarea').value,'单栏草稿');
 assert(!handle.hidden && !navigation.parentElement.hidden);
 assert.equal(h.saved().tabs[0].snapshot.parallel,undefined);
 const restored = harness(t,h.saved());
 assert.equal(restored.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'520px');
 h.buttons()[1].click(); assert(handle.hidden);
 h.buttons()[0].click(); assert(!handle.hidden);
 Object.defineProperty(h.w,'innerWidth',{value:600,configurable:true}); h.w.dispatchEvent(new h.w.Event('resize'));
 assert(!h.w.document.body.hasAttribute('data-workspace-conversations'),'single conversations retain their mobile list/detail navigation');
 assert(handle.hidden);
});

test('opening a conversation in an ordinary page adopts the unified layout and list selections replace only that conversation', t => {
 const h = harness(t), first = h.frames()[0], messages = [];
 first.contentWindow.WorkHubTab = {canClose:()=>true};
 first.contentWindow.postMessage = message => messages.push(message);
 h.send(first,'workhub:tab-ready');
 h.send(first,'workhub:tab-state',{snapshot:conversation('session-a')});
 assert(h.w.document.body.hasAttribute('data-workspace-conversations'));
 assert.equal(messages.findLast(message=>message.type==='workhub:tab-pane').shared,true);
 const navigation = h.w.document.querySelector('.workspace-navigation-frame');
 h.send(navigation,'workhub:conversation-select',{snapshot:conversation('session-b')});
 assert.equal(h.buttons().length,1);
 assert.equal(h.saved().tabs[0].snapshot.conversation.selected,'session-b');
 assert.equal(h.w.document.querySelector('.workspace-navigation-frame'),navigation);
 assert.equal(h.frames().length,1);
});


test('switching conversation tabs restores the corresponding task scope in the shared list', t => {
 const a = conversation('session-a','task-a'), b = conversation('session-b','task-b');
 const h = harness(t,{selected:'a',tabs:[{id:'a',snapshot:a},{id:'b',snapshot:b}]}), navigation = h.w.document.querySelector('.workspace-navigation-frame');
 const messages = [];
 navigation.contentWindow.postMessage = message => messages.push(message);
 navigation.contentWindow.WorkHubTab = {snapshot:()=>a};
 h.send(navigation,'workhub:tab-ready');
 h.buttons()[1].click();
 const restore = messages.findLast(message=>message.type==='workhub:tab-restore');
 assert.equal(restore.snapshot.conversation.scope.id,'task-b');
 assert.equal(restore.snapshot.conversation.selected,'session-b');
 assert.equal(restore.snapshot.conversation.pane,'list');
 assert.equal(h.w.document.querySelector('.workspace-navigation-frame'),navigation);
});

test('shared list drag batches geometry into one paint without messaging or rerendering conversation panes', t => {
 const h = parallelHarness(t); h.choice(conversation('session-b'));
 const nav = h.w.document.querySelector('.workspace-navigation-frame'), messages = [];
 nav.contentDocument.write('<!doctype html><html><body></body></html>');
 nav.contentWindow.postMessage = message => messages.push(message);
 h.send(nav,'workhub:tab-ready');
 const frames = visibleFrames(h);
 for (const frame of frames) {frame.contentWindow.postMessage = message => messages.push(message); h.send(frame,'workhub:tab-ready');}
 messages.length = 0;
 const handle = h.w.document.querySelector('[aria-label="调整共享对话列表宽度"]'), size = h.w.document.querySelector('.workspace-shared-list-size');
 size.getBoundingClientRect = () => ({width:Number.parseFloat(h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width')),height:700});
 let callback, scheduled = 0, paneRenders = 0;
 h.w.requestAnimationFrame = fn => {callback=fn; scheduled++; return scheduled;};
 h.w.cancelAnimationFrame = () => {callback=undefined;};
 const render = h.w.WorkHubTabbar.renderPanes;
 h.w.WorkHubTabbar.renderPanes = (...args) => {paneRenders++; return render(...args);};
 const pointer = (type,x) => new h.w.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x});
 handle.dispatchEvent(pointer('pointerdown',524));
 for (let x=525; x<=624; x++) h.w.document.dispatchEvent(pointer('pointermove',x));
 assert.equal(scheduled,1,'pointer bursts are coalesced before the next browser paint');
 callback();
 assert.equal(h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'380px');
 assert.equal(nav.contentDocument.documentElement.style.getPropertyValue('--workspace-shared-list-width'),'380px','the clipped list and conversation boundary update synchronously');
 assert.equal(messages.length,0,'pointer movement never asks child pages to rebuild');
 assert.equal(paneRenders,0);
 assert.equal(h.saved().tabs[0].snapshot.parallel.listWidth,280,'persistence waits until the drag commits');
 h.w.document.dispatchEvent(pointer('pointermove',634));
 h.w.document.dispatchEvent(pointer('pointerup',634));
 assert.equal(h.w.document.body.style.getPropertyValue('--workspace-conversation-list-width'),'390px','release flushes the final pending position');
 assert.equal(nav.contentDocument.documentElement.style.getPropertyValue('--workspace-shared-list-width'),'390px');
 assert.equal(h.saved().tabs[0].snapshot.parallel.listWidth,390);
 assert.equal(paneRenders,1,'layout mode reconciles once on release');
 assert.deepEqual(visibleFrames(h),frames);
});
