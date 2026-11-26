const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {MessageChannel} = require('node:worker_threads');
const root = path.join(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'web/ui/i18n.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'frontend/shared/i18n/locales/en.json'), 'utf8'));
function open(t, choice, languages) {
  const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8').replace('__UI_LANGUAGE__', choice);
  const dom = new JSDOM(html, {url:'http://localhost:4317/',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(() => {dom.window.dispatchEvent(new dom.window.Event("pagehide"));dom.window.close()});
  Object.defineProperty(dom.window.navigator,'languages',{value:languages});
  dom.window.eval(bootstrap);
  return dom.window;
}

test('explicit locale overrides system language and translates application labels and accessibility names', t => {
 const w=open(t,'en',['zh-CN']);
 assert.equal(w.document.documentElement.lang,'en');
 assert.equal(w.document.querySelector('[data-view="sessions"]').getAttribute('aria-label'),'Conversations');
 assert.equal(w.document.querySelector('#panelTitle').textContent,'Projects');
 assert.equal(w.YoluI18n.text('查看 {0} 的目录详情','用户项目'),'View directory details for 用户项目');
});

test('system locale follows Chinese variants and otherwise falls back to English', t => {
 assert.equal(open(t,'system',['zh-TW']).YoluI18n.locale,'zh-CN');
 assert.equal(open(t,'system',['en-GB']).YoluI18n.locale,'en');
 assert.equal(open(t,'system',['fr-FR']).YoluI18n.locale,'en');
 assert.equal(open(t,'zh-CN',['en-US']).document.querySelector('#panelTitle').textContent,'项目');
});

test('localization does not rewrite user text, draft values or terminal contents', t => {
 const w=open(t,'en',['en-US']);
 const user=w.document.createElement('div'); user.textContent='工作区';
 const draft=w.document.createElement('textarea'); draft.value='项目：修复问题';
 const terminal=w.document.createElement('pre'); terminal.textContent='正在执行用户命令';
 w.document.body.append(user,draft,terminal);w.YoluI18n.applyStatic();
 assert.equal(user.textContent,'工作区');assert.equal(draft.value,'项目：修复问题');assert.equal(terminal.textContent,'正在执行用户命令');
});

test('catalog preserves every interpolation argument and provides English translations', () => {
 for(const [source,english] of Object.entries(catalog)) {
  assert.equal(typeof english,'string',source);
  assert.ok(!/\p{Script=Han}/u.test(english),source);
  const args = value => [...new Set(value.match(/\{\d+\}/g)||[])].sort();
  assert.deepEqual(args(source),args(english),source);
 }
});


test('English applies to production React forms while project names remain verbatim', async t => {
 const w=open(t,'en',['zh-CN']);
 const channels=[];
 t.after(()=>channels.forEach(c=>{c.port1.close();c.port2.close()}));
 Object.assign(w,{TextEncoder,TextDecoder,ReadableStream,WritableStream,TransformStream,CSS:{escape:value=>value},MessageChannel:class extends MessageChannel{constructor(){super();channels.push(this)}}});
 w.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}};
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 w.eval(fs.readFileSync(path.join(root,'web/ui/ui.js'),'utf8'));
 assert.equal(w.document.querySelector('#projectSource option[value="scan"]').textContent,'Scan directory and add in bulk');
 const scan=w.WorkHubUI.projectScanResults({repositories:[{path:'/repo/example',name:'用户项目',common_dir:'/repo/example/.git',selected:true}],warnings:[],truncated:false});
 assert.match(scan,/Found 1 repositories, including 0 already registered/);
 assert.match(scan,/用户项目/);
 assert.equal(w.document.querySelector('#languageTitle').textContent,'Interface language');
 assert.equal(w.document.querySelector('#saveLanguage').textContent,'Apply and reload');
 assert.equal(w.document.querySelector('#languageSelect option[value="zh-CN"]').textContent,'简体中文');
 const html=w.WorkHubUI.projects([{id:'project',name:'用户项目',path:'/project',worktrees:[]}],null);
 const container=w.document.createElement('div');container.innerHTML=html;
 assert.ok(container.textContent.includes('用户项目'));
 assert.ok(!container.textContent.includes('创建于'));
 const report=w.WorkHubUI.codexDiagnostics([{id:'local',name:'Local',report:{platform:'linux',user:'test',cli_path:'/usr/bin/codex',codex_home:'/tmp/codex',candidates:[],checked_at:'2026-11-05T00:00:00Z',status:'ok',checks:[{id:'sessions',name:'对话接口',status:'ok',message:'已完成初始化并成功读取对话列表'}]}}]);
 const diagnostics=w.document.createElement('div');diagnostics.innerHTML=report;
 assert.ok(diagnostics.textContent.includes('Conversation interface'));
 assert.ok(diagnostics.textContent.includes('Initialized successfully and read the conversation list.'));
 for(let i=0;i<4;i++) await new Promise(resolve=>setImmediate(resolve));
});
