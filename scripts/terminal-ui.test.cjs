const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

async function mount(t, terminal = {projectID:'app',cwd:'/worktrees/app'}, rows = [], {storage = {}, profiles, conversation, intercept} = {}) {
  const host = new JSDOM('',{url:'http://localhost:4317'});
  const dom = new JSDOM(fs.readFileSync('web/terminal.html','utf8'),{url:'http://localhost:4317/?app-terminal=1',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window, messages = [], requests = [];
  for (const [key,value] of Object.entries(storage)) w.localStorage.setItem('workhub:conversation-defaults:v1:' + key,value);
  Object.defineProperty(w,'parent',{value:host.window});
  host.window.postMessage = message => messages.push(message);
  w.ResizeObserver = class {observe(){} disconnect(){}};
  w.matchMedia = () => ({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  const sockets = [];
  w.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    constructor() {sockets.push(this); queueMicrotask(() => this.onopen?.());}
    send() {}
    close() {this.readyState = 3;}
  };
  w.fetch = async (path, options) => {
    requests.push({path,options});
    const intercepted = await intercept?.(path, options);
    if (intercepted) return intercepted;
    const value = path === '/api/state' ? {projects:[{id:'app',name:'App',path:'/repo/app',worktrees:[{path:'/repo/app',branch:'main'},{path:'/worktrees/app',branch:'codex/header-unification'}]}]} : path === '/api/terminal-profiles' ? profiles || [{id:'shell',name:'Shell',executable:'/bin/sh',args:[],available:true}] : rows;
    return {ok:true,json:async()=>value};
  };
  w.eval(fs.readFileSync('web/ui/terminal.js','utf8'));
  const send = data => w.dispatchEvent(new w.MessageEvent('message',{source:host.window,origin:w.location.origin,data}));
  send({type:'workhub:page-restore',active:true,snapshot:{route:'/terminals',environment:'local',terminal,conversation}});
  for (let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
  t.after(()=>{w.WorkHubPage.dispose();dom.window.close();host.window.close();});
  return {w,send,messages,requests,sockets,$:selector=>w.document.querySelector(selector)};
}

test('a delayed stop response never overwrites an already received terminal exit', async t => {
  let complete;
  const row = {id:'one',name:'Shell',project_id:'app',cwd:'/worktrees/app',state:'running',attached:false};
  const h = await mount(t, {projectID:'app',cwd:'/worktrees/app',id:'one'}, [row], {intercept:(path) => {
    if (path.endsWith('/ticket')) return {ok:true,json:async()=>({ticket:'test'})};
    if (path.endsWith('/stop')) return new Promise(resolve => {complete=resolve;});
  }});
  for(let i=0;i<50&&!h.sockets.length;i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.sockets.length,1,h.$('#terminalFeedback').textContent);
  h.$('#stopTerminalDialog').returnValue='stop';
  h.$('#stopTerminalDialog').dispatchEvent(new h.w.Event('close'));
  assert.equal(h.$('#terminalStatus').textContent,'正在结束…');
  h.sockets[0].onmessage({data:JSON.stringify({type:'exit',exit_code:7})});
  assert.equal(h.$('#terminalStatus').textContent,'已退出 · 7');
  complete({ok:true,json:async()=>({...row,state:'exited',exit_code:7})});
  for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.$('#terminalStatus').textContent,'已退出 · 7');
  assert.equal(h.$('#stopTerminal').disabled,true);
  assert.equal(h.$('#terminalStatusBadge').dataset.state,'completed');
});

test('terminal creation shows its mode, project and working path before the launcher', async t => {
  const h = await mount(t);
  assert.equal(h.$('.conversation-kind-switch').closest('#terminalCreationSetup').nextElementSibling.id,'terminalForm');
  assert.equal(h.$('.conversation-kind-switch [aria-pressed=true]').textContent,'终端');
  assert.equal(h.$('.conversation-surface-header h2').textContent,'新建对话');
  assert.equal(h.$('#terminalContext').textContent,'App');
  assert.equal(h.$('#terminalProject').selectedOptions[0].textContent,'App · main');
  assert.equal(h.$('#terminalDirectoryPath').textContent,'/repo/app');
  assert(h.$('.conversation-surface-header').contains(h.$('#terminalStatusBadge')));
  assert.equal(h.$('#terminalConsole').querySelector('button'),null,'terminal output starts directly beneath the shared header');
  assert.equal(h.$('#terminalProject').form,h.$('#terminalForm'));
  assert.equal(h.$('#terminalDirectoryContext').hidden,true);
  assert.equal(h.$('#terminalForm').checkValidity(),true,'project root is a valid launch selection');
  h.$('#terminalKindUI').click();
  const switched=h.messages.findLast(message=>message.type==='workhub:conversation-kind');
  assert.equal(switched.kind,'ui');
  assert.equal(switched.snapshot.conversation.creationDirectory,'/repo/app');
  assert.equal(h.requests.some(request=>request.options.method==='POST'),false,'switching form does not start a process');
  assert.equal(h.$('#terminalExisting').hidden,true,'empty terminal history does not add another card');
});

test('terminal lists available tools and discloses missing commands separately', async t => {
  const profiles = ['shell','codex','claude'].map(id => ({id,name:id,executable:id,args:[],available:id !== 'claude'}));
  const h = await mount(t, {}, [], {profiles});
  assert.equal(h.$('#terminalProject').value,'app');
  assert.equal(h.$('[data-terminal-profile="codex"]').disabled,false);
  assert.equal(h.$('[data-terminal-profile="claude"]'),null);
  assert.equal(h.$('.terminal-unavailable').open,false);
  assert.equal(h.$('.terminal-unavailable code').textContent,'claude');
  assert.equal(h.$('#customTerminal').open,false);
  assert.equal(h.requests.some(r => r.options.method === 'POST'),false);
});

test('clicking a tool starts once, freezes launch settings and allows retry after failure', async t => {
  let complete;
  const profiles = ['codex','claude'].map(id => ({id,name:id,executable:id,args:[],available:true}));
  const h = await mount(t, {projectID:'app',cwd:'/worktrees/app'}, [], {profiles, intercept:(path,options) => path === '/api/terminals' && options.method === 'POST' ? new Promise(resolve => {complete=resolve;}) : undefined});
  const launches = () => h.requests.filter(r => r.path === '/api/terminals' && r.options.method === 'POST');
  assert.equal(launches().length,0,'restoring the selected Agent never launches it');
  assert.equal(h.$('#startTerminal').closest('details').open,false,'standard Agents have no separate launch button');
  const codex = h.$('[data-terminal-profile="codex"]');
  codex.click(); codex.click();
  h.$('[data-terminal-profile="claude"]').click();
  assert.equal(launches().length,1);
  assert.equal(JSON.parse(launches()[0].options.body).profile_id,'codex');
  assert.equal(JSON.parse(launches()[0].options.body).project_id,'app');
  assert.equal(h.$('#terminalProject').disabled,true);
  assert.equal(h.$('#terminalKindUI').disabled,true);
  complete({ok:false,json:async()=>({error:'fixture launch failed'})});
  for(let i=0;i<50 && (codex.disabled || !h.$('#terminalLaunchFeedback').textContent);i++) await new Promise(resolve=>setTimeout(resolve,10));
  assert.match(h.$('#terminalLaunchFeedback').textContent,/fixture launch failed/);
  assert.equal(codex.disabled,false);
  h.$('[data-terminal-profile="claude"]').click();
  assert.equal(launches().length,2);
  assert.equal(JSON.parse(launches()[1].options.body).profile_id,'claude');
  complete({ok:false,json:async()=>({error:'fixture retry failed'})});
  for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
});

test('custom Agent requires its configuration before an explicit launch', async t => {
  const h = await mount(t, undefined, [], {intercept:(path,options) => path === '/api/terminals' && options.method === 'POST' ? {ok:false,json:async()=>({error:'fixture custom launch failed'})} : undefined});
  h.$('#customTerminal').open=true;
  assert.equal(h.requests.some(r => r.options.method === 'POST'),false);
  assert.equal(h.$('#customTerminal').hidden,false);
  h.$('#customExecutable').value='my-agent';
  h.$('#customArgs').value='["--model","test"]';
  h.$('#startTerminal').click();
  for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
  const request = h.requests.find(r => r.path === '/api/terminals' && r.options.method === 'POST');
  assert.equal(JSON.parse(request.options.body).executable,'my-agent');
  assert.equal(JSON.parse(request.options.body).profile_id,'custom');
});

test('terminal pane icons share close and zoom commands and existing terminals remain reconnectable', async t => {
  const h=await mount(t,{projectID:'app'},[{id:'one',name:'Shell',project_id:'app',cwd:'/worktrees/app',state:'running',attached:false}]);
  h.send({type:'workhub:parallel-layout',split:true,focused:true,canZoom:true});
  assert.equal(h.$('#zoomTerminal').hidden,false);
  assert.equal(h.w.document.documentElement.hasAttribute('data-workspace-focused'),true);
  h.$('#openTerminalSearch').click();
  assert.equal(h.$('#terminalSearchBar').hidden,false);
  assert.equal(h.w.document.activeElement,h.$('#terminalSearch'));
  h.$('#terminalSearch').dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(h.$('#terminalSearchBar').hidden,true);
  assert.equal(h.w.document.activeElement,h.$('#openTerminalSearch'));
  h.$('#zoomTerminal svg').dispatchEvent(new h.w.MouseEvent('click',{bubbles:true}));
  assert.equal(h.messages.at(-1).command,'zoom');
  h.$('#closeTerminalView svg').dispatchEvent(new h.w.MouseEvent('click',{bubbles:true}));
  assert.equal(h.messages.at(-1).command,'close');
  assert.equal(h.$('#terminalExisting').hidden,false);
  h.$('#terminalList button').click();
  assert.equal(h.messages.at(-1).snapshot.terminal.id,'one');
  h.send({type:'workhub:parallel-layout',split:false,focused:false});
  assert.equal(h.$('#zoomTerminal').hidden,true);
  assert.equal(h.$('#closeTerminalView').hidden,true);
});
