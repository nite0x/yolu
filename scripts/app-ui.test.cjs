const { test: nodeTest } = require('node:test');
const test = (name, options, callback) => nodeTest(name, {timeout:15000,...(typeof options === 'function' ? {} : options)}, callback || options);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MessageChannel } = require('node:worker_threads');
const { JSDOM } = require('jsdom');

const web = path.join(__dirname, '../web');
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

async function harness(t, readOnly = true, {origin = 'http://localhost:4317', pins = {}, storage = {}, storageUnavailable = false, width = 1024, route = '/projects/app', intercept: initialIntercept, pageHost, desktop = false, sharedNavigation = false} = {}) {
  const tree = (path, branch) => ({ path, branch, dirty: 0, status_updated_at: '2026-10-23T06:00:00Z' });
  const app = { id: 'app', name: 'App', folder: 'app', path: '/repo/app', worktrees: [tree('/repo/app', 'master'), tree('/workspace/workspace/app', 'feature/workspace')] };
  const backend = { id: 'backend', name: 'Backend', folder: 'backend', path: '/repo/backend', worktrees: [tree('/repo/backend', 'master')] };
  const data = { root: '/workspace', projects: [app, backend], terminal: { platform: 'linux', available: true, settings: { kind: 'auto' }, supported_kinds: ['auto', 'custom'], supported_styles: ['command', 'otty'], launcher: '/usr/bin/terminal', message: '终端已就绪' } };
  const environments = { environments: [{ id: 'local', name: '本机' }], distributions: [], platform: 'linux', wsl_supported: false };
  const sessions = [{ id: 'session-1', name: 'Billing review', cwd: app.worktrees[1].path, updated_at: 1792735200, available: true, source: 'app', primary_project_id:'app' }];
  const history = [
    { id: 'message-1', turn_id: 'turn-1', kind: 'user', text: '检查当前代码' },
    { id: 'command-1', turn_id: 'turn-1', kind: 'command', command: 'git status --short', cwd: app.worktrees[1].path, status: 'completed', exit_code: 0, duration_ms: 12, output: 'working tree clean' },
    { id: 'reply-1', turn_id: 'turn-1', kind: 'assistant', text: '当前工作目录干净。' },
  ];
  const overview = project => ({ project, current: 'master', credentials: { available: true, message: '使用已有凭证' }, master_source: 'refs/remotes/origin/master', remotes: [{ name: 'origin', url: '/test/remote.git' }], branches: [
    { name: 'master', ref: 'refs/heads/master', kind: 'local', commit: '12345678', worktrees: [project.path] },
    { name: 'release', ref: 'refs/heads/release', kind: 'local', commit: '12345678', worktrees: [] },
    { name: 'feature/workspace', ref: 'refs/heads/feature/workspace', kind: 'local', commit: '12345678', worktrees: project.id === 'app' ? ['/workspace/workspace/app'] : [] },
    { name: 'origin/master', ref: 'refs/remotes/origin/master', kind: 'remote', commit: '12345678', worktrees: [] },
  ] });
  const query = sharedNavigation ? '?app-page=shared-navigation&app-navigation=1&app-desktop=1' : '';
  const dom = new JSDOM(fs.readFileSync(path.join(web, 'index.html'), 'utf8').replaceAll('__UI_LANGUAGE__', 'zh-CN').replace('__SESSION_MODE__', readOnly ? 'read-only' : 'interactive'), { url: origin + '/' + query + '#' + route, runScripts: 'outside-only', pretendToBeVisual: true });
  const channels = [];
  t.after(() => { if (dom.window.WorkHubPage) dom.window.WorkHubPage.dispose(); else dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); for (const channel of channels) { channel.port1.close(); channel.port2.close(); } });
  const { window } = dom;
  if (pageHost) Object.defineProperty(window, 'parent', {value:pageHost});
  Object.defineProperty(window, 'innerWidth', {value:width, configurable:true, writable:true});
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  if (storageUnavailable) Object.defineProperty(window, 'localStorage', {get() {throw new Error('Storage unavailable');}});
  const document = window.document;
  if (desktop) document.documentElement.setAttribute('data-workhub-desktop', '');
  Object.assign(window, { TextEncoder, TextDecoder, ReadableStream, WritableStream, TransformStream, CSS: { escape: value => value }, MessageChannel: class extends MessageChannel { constructor() { super(); channels.push(this); } }, scrollTo() {}, confirm: () => true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLDialogElement.prototype.show = function () { this.open = true; };
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  let conversationReturnRoute = '/projects/app';
  const requests = [];
  let intercept = initialIntercept;
  window.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, options, body });
    if (intercept) { const result = await intercept(url, options, body); if (result) return result; }
    let result;
    if (url.startsWith('/api/resource-icons?')) {
      const environment = new URL(url, origin).searchParams.get('environment') || 'local';
      const saved = pins[environment] ||= {icons:{}};
      if (options.method === 'PUT') saved.icons = {...saved.icons, [body.id]:body.appearance};
      result = {icons:saved.icons || {}};
    }
    else if (url === '/api/environments') result = options.method === 'POST' ? { id: 'wsl-test' } : environments;
    else if (url === '/api/settings/terminal' && options.method === 'PUT') result = data.terminal = { ...data.terminal, settings: body, launcher: body.path || '/usr/bin/terminal', message: '终端已就绪' };
    else if (url === '/api/settings/default-agent') {
      if (options.method === 'PUT') data.default_agent = body.provider;
      result = {provider:data.default_agent || 'codex'};
    }
    else if (url === '/api/settings/browser-access') result = {enabled:false,port:4318,code:'',running:false,error:'',can_manage:true,addresses:[]};
    else if (url === '/api/settings/codex') result = {platform:'linux',user:'tester',codex_home:'/home/tester/.codex',cli_path:'/usr/bin/codex',candidates:['/usr/bin/codex'],version:'codex-cli test',checked_at:'2026-11-04T12:00:00Z',status:'ok',checks:[{id:'cli',name:'CLI 安装与版本',status:'ok',message:'codex-cli test'}]};
    else if (url.startsWith('/api/settings/conversation-defaults?provider=agy')) {
      if (options.method === 'PUT') data.agy_conversation_defaults = body;
      result = {settings:data.agy_conversation_defaults || {}, models:[
        {model:'gemini',displayName:'Gemini',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'high'}]},
        {model:'claude',displayName:'Claude',supportedReasoningEfforts:[{reasoningEffort:'low'}]},
      ]};
    }
    else if (url === '/api/settings/conversation-defaults') {
      if (options.method === 'PUT') data.conversation_defaults = body;
      result = {settings:data.conversation_defaults || {}, models:[
        {model:'body-model',displayName:'正文模型',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'high'}],serviceTiers:[{id:'fast',name:'Fast'}]},
        {model:'other-model',displayName:'另一个模型',supportedReasoningEfforts:[{reasoningEffort:'low'}]},
      ]};
    }
    else if (url === '/api/settings/session-title') {
      if (options.method === 'PUT') data.title_settings = body;
      result = {settings: data.title_settings || {model: ''}, models: [{model:'body-model',displayName:'正文模型'}, {model:'title-model',displayName:'标题模型'}]};
    }
    else if (url.endsWith('/history/events') || url.includes('/chat/events?')) return { ok: true, headers: { get: () => 'text/event-stream' }, body: new ReadableStream({ start(controller) { controller.close(); } }) };
    else if (url.includes('/history')) result = { session: sessions[0], entries: url.includes('cursor=') ? [{ id: 'older', turn_id: 'old-turn', kind: 'assistant', text: '更早的记录' }] : history, next_cursor: url.includes('cursor=') ? null : 'older-page' };
    else if (url.endsWith('/chat/approval') || url.endsWith('/chat')) result = { id: body?.request_id || 'run-1', status: 'idle', busy: false, entries: [], approvals: [] };
    else if (url.endsWith('/resume')) result = { message: '已打开会话终端' };
    else if (url.startsWith('/api/codex/sessions?')) result = { data: sessions.map(s => ({ ...s, updatedAt: s.updated_at })), nextCursor: null };
    else if (url.endsWith('/sessions') || url.startsWith('/api/sessions?')) {
      const query = new URL(url, 'http://localhost').searchParams;
      const project = data.projects.find(item => item.id === query.get('project_id'));
      const paths = project?.worktrees.map(tree => tree.path);
      result = {sessions:sessions.filter(item => (!paths || paths.includes(item.cwd) || item.project_directories?.some(dir => paths.includes(dir))) && (!query.has('cwd') || query.get('cwd') === item.cwd))};
    }
    else if (url.endsWith('/git')) result = options.method === 'POST' ? { message: '已完成', output: 'fixture result' } : overview(data.projects.find(p => url.includes('/' + p.id + '/')));
    else if (url === '/api/projects' && options.method === 'POST') { data.projects.push({ id: 'new-project', ...body, folder: 'new-project', worktrees: [tree(body.path, 'master')] }); result = { id: 'new-project' }; }
    else if (url.endsWith('/worktrees') && options.method === 'POST') result = { message: 'Worktree 已创建', branch: body.branch };
    else result = data;
    return { ok: true, json: async () => structuredClone(result) };
  };
  for (const script of document.querySelectorAll('script[src]')) {
    const file = script.getAttribute('src').slice(1);
    // Legacy controller tests exercise the fallback; the bridge is covered below.
    if (file === 'chat/loader.js') continue;
    if (readOnly && ['features/sessions/session-chat.js', 'features/sessions/session-create.js'].includes(file)) continue;
    vm.runInContext(fs.readFileSync(path.join(web, file), 'utf8'), dom.getInternalVMContext(), { filename: file });
  }
  await settle();
  const $ = selector => document.querySelector(selector);
  const change = (selector, value) => { const node = $(selector); node.value = value; node.dispatchEvent(new window.Event('change', { bubbles: true })); return node; };
  const input = (selector, value) => { const node = $(selector); node.value = value; node.dispatchEvent(new window.Event('input', { bubbles: true })); return node; };
  return { window, document, $, change, input, data, environments, sessions, history, requests, currentSession: () => vm.runInContext('sessionHistoryState', dom.getInternalVMContext()), setIntercept(fn) { intercept = fn; }, click(selector) { $(selector).click(); }, async navigate(route) { const changed = window.location.hash === '#' + route ? Promise.resolve() : new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true })); window.navigate(route); await changed; await settle(); }, async openConversations(kind) { if (window.location.hash !== '#/sessions') conversationReturnRoute = window.location.hash.slice(1); const changed = window.location.hash === '#/sessions' ? Promise.resolve() : new Promise(resolve => window.addEventListener('hashchange', resolve, {once:true})); $(`[data-action="${kind}-conversations"]`).click(); await changed; await settle(); }, async leaveConversations() { await this.navigate(conversationReturnRoute); }, async submit(selector) { $(selector).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle(); } };
}

for (const readOnly of [true, false]) test(`the production project and conversation UI mounts in ${readOnly ? 'read-only' : 'interactive'} mode`, async t => {
  const h = await harness(t, readOnly);
  assert(h.$('#content .working-directory-cards'));
  assert(h.$('#projectForm [data-slot="input"]'));
  const ids = [...h.document.querySelectorAll('[id]')].map(node => node.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(h.$('[data-view="workspaces"]'), null);
  assert(h.$('[data-action="project-conversation-new"]'));
});

test('desktop project controls stay in the list through search, refresh and page changes', async t => {
  const h = await harness(t, true, {desktop:true, width:960, route:'/projects'});
  assert(h.$('#projectListPane').classList.contains('workspace-pane'));
  assert(h.$('#projectDetail').classList.contains('workspace-pane'));
  const toolbar = h.$('#projectListPane #panelToolbar');
  const search = h.$('#projectListPane #search');
  const projectList = h.$('#projectListPane');
  assert.equal(toolbar.querySelector('#projectAddButton button').closest('[hidden]'), null);
  assert(toolbar.querySelector('.list-search #projectFilters .project-filters'));
  assert(toolbar.querySelector('#projectFilters #projectEnvironment'));
  search.focus();
  h.input('#search','Backend');
  await h.window.refresh(true);
  assert.equal(h.$('#projectListPane'), projectList);
  assert.equal(h.document.activeElement, search);
  assert.deepEqual([...projectList.querySelectorAll('.project-list-item')].map(row => row.dataset.id), ['backend']);
  await h.navigate('/sessions');
  assert(h.$('.list-search #sessionScopePicker #sessionStatusFilters'));
  await h.navigate('/projects');
  assert.equal(h.$('#projectListPane #panelToolbar'), toolbar);
  await h.window.selectEnvironment('wsl-test', '/projects');
  assert.equal(h.$('#projectListPane #panelToolbar'), toolbar);
  h.data.projects = [];
  await h.window.refresh(true);
  assert.equal(h.$('#projectListPane #panelToolbar'), toolbar);
  assert.match(h.$('.project-list-empty').textContent, /没有已登记的项目/);
  h.click('#projectAddButton button');
  assert.equal(h.$('#projectDialog').open, true);
});

test('folder selection fills the project path, preserves drafts on cancellation and reports failures', async t => {
  const h = await harness(t);
  let result = { path: '/repo/中文 项目' };
  let failed = false;
  h.setIntercept((url) => url === '/api/dialogs/directory' ? { ok: !failed, json: async () => failed ? { error: '无法打开文件夹选择窗口' } : result } : null);
  h.window.openProject();
  h.input('#projectName', 'Keep this name');
  h.click('#chooseProjectDirectory'); await settle();
  assert.equal(h.$('#projectPath').value, result.path);
  assert.equal(h.$('#projectName').value, 'Keep this name');
  assert.equal(h.$('#projectDialog').open, true);
  assert.equal(h.requests.find(r => r.url === '/api/dialogs/directory').options.headers['X-Environment-ID'], 'local');
  assert.equal(h.requests.some(r => r.url === '/api/projects' && r.options.method === 'POST'), false);
  result = { path: '' };
  h.click('#chooseProjectDirectory'); await settle();
  assert.equal(h.$('#projectPath').value, '/repo/中文 项目');
  assert.equal(h.$('#projectError').hidden, true);
  failed = true;
  h.click('#chooseProjectDirectory'); await settle();
  assert.match(h.$('#projectError').textContent, /无法打开/);
  assert.equal(h.$('#projectError').hidden, false);
  assert.equal(h.$('#chooseProjectDirectory').disabled, false);
  assert.equal(h.$('#projectPath').value, '/repo/中文 项目');
});

test('folder selection cannot overlap or put a host path into a WSL project', async t => {
  const h = await harness(t);
  let release;
  const selected = new Promise(resolve => { release = resolve; });
  h.setIntercept(async url => url === '/api/dialogs/directory' ? await selected : null);
  h.window.openProject();
  h.click('#chooseProjectDirectory'); h.click('#chooseProjectDirectory');
  assert.equal(h.$('#chooseProjectDirectory').disabled, true);
  assert.equal(h.$('#projectEnvironmentSelect').disabled, true);
  h.click('#projectDialog .close-dialog');
  assert.equal(h.$('#projectDialog').open, true);
  assert.equal(h.requests.filter(r => r.url === '/api/dialogs/directory').length, 1);
  release({ ok: true, json: async () => ({ path: '' }) }); await settle();
  assert.equal(h.$('#chooseProjectDirectory').disabled, false);
  assert.equal(h.$('#projectEnvironmentSelect').disabled, false);
  h.environments.environments.push({ id: 'wsl-test', name: 'WSL' });
  await h.window.loadEnvironments();
  h.window.openProject(null, 'wsl-test');
  assert.equal(h.$('#chooseProjectDirectory').disabled, true);
  assert.equal(h.$('#projectDirectoryHint').hidden, false);
  h.click('#chooseProjectDirectory'); await settle();
  assert.equal(h.requests.filter(r => r.url === '/api/dialogs/directory').length, 1);
  h.change('#projectEnvironmentSelect', 'local');
  assert.equal(h.$('#chooseProjectDirectory').disabled, false);
  assert.equal(h.$('#projectDirectoryHint').hidden, true);
});

test('Git retains the selected worktree, occupied-branch protection and source tracking', async t => {
  const h = await harness(t);
  await h.window.openGit('app', '/workspace/workspace/app');
  assert.equal(h.$('#gitWorktree').value, '/workspace/workspace/app');
  assert.equal(h.$('#gitSwitch option[value="refs/heads/master"]').disabled, true);
  h.change('#gitBranchSource', 'refs/remotes/origin/master');
  assert.equal(h.$('#gitTrack').checked, true);
  assert.equal(h.$('#gitTrack').disabled, false);
  h.input('#gitBranchName', 'feature/billing');
  await h.submit('#gitCreateForm');
  const request = h.requests.find(r => r.options.method === 'POST' && r.url.endsWith('/git'));
  assert.deepEqual(request.body, { action: 'create_branch', name: 'feature/billing', source: 'refs/remotes/origin/master', track: true });
  assert.equal(h.$('#gitWorktree').value, '/workspace/workspace/app');
  assert.equal(h.$('#gitResult').hidden, false);
});

test('merge current worktree branch into a local target previews and submits the same direction without switching', async t => {
  const h = await harness(t);
  h.setIntercept((url, options, body) => {
    if (body?.action === 'merge_into_preview') return { ok: true, json: async () => ({ message: 'feature/workspace → master', output: 'abc feature change', expected_branch: 'feature/workspace', expected_head: 'source-head', target_commit: 'target-head', target_path: '/repo/app' }) };
  });
  await h.window.openGit('app', '/workspace/workspace/app', 'workspace');
  assert.deepEqual([...h.$('#gitMergeTarget').options].map(option => option.value), ['refs/heads/master', 'refs/heads/release']);
  assert.match(h.$('#gitMergeIntoDirection').textContent, /feature\/workspace → master/);
  h.click('[data-action="git-merge-into-preview"]'); await settle();
  assert.deepEqual(h.requests.find(r => r.body?.action === 'merge_into_preview').body, { action: 'merge_into_preview', target: 'refs/heads/master', path: '/workspace/workspace/app', expected_branch: 'feature/workspace' });
  assert.match(h.$('#gitMergeIntoPreview').textContent, /feature\/workspace → master/);
  assert.match(h.$('#gitMergeIntoPreview').textContent, /目标目录：\/repo\/app/);
  assert.equal(h.$('[data-action="git-merge-into"]').disabled, false);
  h.click('[data-action="git-merge-into"]'); await settle();
  assert.deepEqual(h.requests.find(r => r.body?.action === 'merge_into').body, { action: 'merge_into', target: 'refs/heads/master', path: '/workspace/workspace/app', expected_head: 'source-head', expected_branch: 'feature/workspace', target_commit: 'target-head' });
  assert.equal(h.$('#gitWorktree').value, '/workspace/workspace/app');
  assert.match(h.$('#gitContext').textContent, /feature\/workspace/);
  assert.equal(h.$('[data-action="git-merge-into"]').disabled, true);
  assert(!h.requests.some(r => r.body?.action === 'switch' || r.body?.action === 'push'));
});

test('merge into preview ignores a response after the target selection changes', async t => {
  const h = await harness(t);
  let resolvePreview;
  h.setIntercept((url, options, body) => {
    if (body?.action === 'merge_into_preview') return new Promise(resolve => { resolvePreview = resolve; });
  });
  await h.window.openGit('app', '/workspace/workspace/app', 'workspace');
  h.click('[data-action="git-merge-into-preview"]'); await settle();
  h.change('#gitMergeTarget', 'refs/heads/release');
  resolvePreview({ ok: true, json: async () => ({ message: 'feature/workspace → master', expected_branch: 'feature/workspace', expected_head: 'source-head', target_commit: 'target-head' }) });
  await settle();
  assert.equal(h.$('[data-action="git-merge-into"]').disabled, true);
  assert.equal(h.$('#gitMergeIntoPreview').hidden, true);
  h.click('[data-action="git-merge-into"]'); await settle();
  assert(!h.requests.some(r => r.body?.action === 'merge_into'));
});

test('merge into preview is invalidated by target or source directory changes and blocks dirty targets', async t => {
  const h = await harness(t);
  h.setIntercept((url, options, body) => {
    if (body?.action === 'merge_into_preview') return { ok: true, json: async () => ({ message: 'feature/workspace → master', expected_branch: 'feature/workspace', expected_head: 'source-head', target_commit: 'target-head' }) };
  });
  await h.window.openGit('app', '/workspace/workspace/app');
  h.click('[data-action="git-merge-into-preview"]'); await settle();
  assert.equal(h.$('[data-action="git-merge-into"]').disabled, false);
  h.change('#gitMergeTarget', 'refs/heads/release');
  assert.equal(h.$('[data-action="git-merge-into"]').disabled, true);
  assert.equal(h.$('#gitMergeIntoPreview').hidden, true);
  h.click('[data-action="git-merge-into-preview"]'); await settle();
  h.change('#gitWorktree', '/repo/app');
  assert.equal(h.$('[data-action="git-merge-into"]').disabled, true);
  assert(![...h.$('#gitMergeTarget').options].some(option => option.value === 'refs/heads/master'));
  Object.assign(h.data.projects[0].worktrees[0], { dirty: 1 });
  Object.assign(h.data.projects[0].worktrees[1], { dirty: 2 });
  await h.window.openGit('app', '/workspace/workspace/app', 'workspace');
  assert.equal(h.$('[data-action="git-merge-into-preview"]').disabled, true);
  assert.match(h.$('#gitMergeIntoDirection').textContent, /目标目录不可用或有未提交修改/);
  h.change('#gitMergeTarget', 'refs/heads/release');
  assert.equal(h.$('[data-action="git-merge-into-preview"]').disabled, false);
});

for (const readOnly of [true, false]) test(`merge conflict automatically opens AI in ${readOnly ? 'terminal' : 'sidebar'} mode and can be reopened without duplicate creation`, async t => {
  const h = await harness(t, readOnly);
  h.setIntercept((url, options, body) => {
    const ok = data => ({ ok: true, json: async () => data });
    if (body?.action === 'merge_preview') return ok({ message: 'origin/master → feature/workspace', output: 'abc source change', source_commit: 'source-head', expected_head: 'target-head' });
    if (body?.action === 'merge') {
      Object.assign(h.data.projects[0].worktrees[1], { operation: 'merge', head: 'target-head', merge_head: 'source-head', conflicts: ['README.md'], dirty: 1 });
      return ok({ message: '合并出现冲突', conflict: true, merge_head: 'source-head', conflicts: ['README.md'] });
    }
    if (url.endsWith('/merge-terminal')) return ok({ message: '已打开 Codex 终端' });
    if (url.endsWith('/sessions/new')) {
      const session = { id: 'merge-session', name: '解决合并冲突', cwd: '/workspace/workspace/app' };
      h.sessions.push(session);
      return ok({ session, chat: { id: body.request_id, status: 'starting', busy: true, entries: [], approvals: [] } });
    }
  });
  await h.window.openGit('app', '/workspace/workspace/app', 'workspace');
  h.change('#gitMergeSource', 'refs/remotes/origin/master');
  h.click('[data-action="git-merge-preview"]'); await settle();
  assert.match(h.$('#gitMergePreview').textContent, /origin\/master → feature\/workspace/);
  assert.equal(h.$('[data-action="git-merge"]').disabled, false);
  h.click('[data-action="git-merge"]'); await settle();
  const requests = h.requests.filter(r => r.url.endsWith(readOnly ? '/merge-terminal' : '/sessions/new'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.project_id, 'app');
  assert.equal(requests[0].body.merge_head, 'source-head');
  if (readOnly) {
    assert.match(h.$('#gitMergeStatus').textContent, /README.md/);
    h.click('[data-action="git-merge-ai"]'); await settle();
  } else {
    assert.equal(requests[0].body.purpose, 'merge_conflict');
    assert.equal(h.currentSession().session, 'merge-session');
    assert.equal(h.$('#gitDialog').open, false);
    await h.window.launchGitMergeAI();
    h.window.closeSessionHistory(false);
    await settle();
  }
  assert.equal(h.requests.filter(r => r.url.endsWith(readOnly ? '/merge-terminal' : '/sessions/new')).length, 1);
});

test('the directory overflow remembers the chosen tool and retains its worktree after rendering', async t => {
  const h = await harness(t);
  assert.match(h.$('[data-project-open-primary]').textContent, /VS Code 打开/);
  h.click('[data-project-open] summary');
  assert.equal(h.$('details[data-project-open]').open, true);
  h.click('[data-project-open-choice="idea"]'); await settle();
  assert.equal(h.$('details[data-project-open]').open, false);
  assert.equal(h.window.localStorage.getItem('workhub:project-open:v1'), 'idea');
  assert.deepEqual(h.requests.find(r => r.url === '/api/projects/app/open').body, { tool: 'idea', path: '/repo/app' });
  h.window.render();
  assert.match(h.$('[data-project-open-primary]').textContent, /IDEA 打开/);
  h.click('[data-project-open-primary]'); await settle();
  assert.equal(h.requests.filter(r => r.url === '/api/projects/app/open').length, 2);
  h.click('[data-project-open] summary');
  h.$('[data-project-open] summary').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(h.$('details[data-project-open]').open, false);
  assert.equal(h.document.activeElement, h.$('[data-project-open] summary'));
  h.click('[data-project-open-choice="terminal"]'); await settle();
  assert.deepEqual(h.requests.find(r => r.body?.action === 'terminal').body, { action: 'terminal', path: '/repo/app' });
  h.window.render();
  assert.match(h.$('[data-project-open-primary]').textContent, /终端 打开/);
  assert.equal(h.$('[data-project-open-primary]').dataset.action, 'project-terminal');
});

test('an AI launch failure preserves merge context and retries the same creation identifier', async t => {
  const h = await harness(t);
  Object.assign(h.data.projects[0].worktrees[1], { operation: 'merge', head: 'target', merge_head: 'source', conflicts: ['README.md'], dirty: 1 });
  await h.window.refresh();
  let fail = true;
  h.setIntercept(url => url.endsWith('/merge-terminal') ? { ok: !fail, json: async () => fail ? { error: '终端连接暂不可用' } : { message: '已打开 Codex 终端' } } : undefined);
  await h.window.openGit('app','/workspace/workspace/app');
  h.click('[data-action="git-merge-ai"]'); await settle();
  assert.match(h.$('#gitError').textContent, /终端连接暂不可用/);
  assert.match(h.$('#gitMergeStatus').textContent, /README.md/);
  assert.equal(h.$('[data-action="git-merge-ai"]').disabled, false);
  fail = false;
  h.click('[data-action="git-merge-ai"]'); await settle();
  const attempts = h.requests.filter(r => r.url.endsWith('/merge-terminal'));
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].body.request_id, attempts[1].body.request_id);
  assert.equal(h.$('#gitMergeActive').hidden, false);
});

test('a busy Git operation allows closing its dialog and recovers its controls after failure', async t => {
  const h = await harness(t);
  await h.window.openGit('app', '/workspace/workspace/app');
  let release;
  h.setIntercept((url, options) => options.method === 'POST' && url.endsWith('/git') ? new Promise(resolve => { release = resolve; }) : undefined);
  const operation = h.window.gitOperation({ action: 'fetch', remote: 'origin' }, '正在获取分支');
  await settle();
  assert.equal(h.$('[data-action="git-reload"]').disabled, true);
  const cancel = new h.window.Event('cancel', { cancelable: true });
  h.$('#gitDialog').dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, false);
  release({ ok: false, json: async () => ({ error: '请在终端登录', code: 'authentication_required' }) });
  await operation;
  assert.equal(h.$('#gitError').hidden, false);
  assert.equal(h.$('#gitAuthHelp').hidden, false);
  assert.match(h.$('#gitError').textContent, /请在终端登录/);
  assert.equal(h.$('[data-action="git-reload"]').disabled, false);
  assert.equal(h.$('#gitWorktree').value, '/workspace/workspace/app');
});

test('creating a worktree keeps both branch modes and their existing request format', async t => {
  const h = await harness(t);
  await h.window.openWorktree('app');
  h.input('#worktreeSlug', 'qa-check');
  assert.equal(h.$('#worktreeBranch').value, 'codex/qa-check');
  assert.match(h.$('#worktreePath').textContent, /\/workspace\/qa-check\/app/);
  h.change('#worktreeMode', 'existing');
  assert.equal(h.$('#worktreeBranch').disabled, true);
  assert.equal(h.$('#worktreeSource').disabled, true);
  assert.equal(h.$('#worktreeExisting').disabled, false);
  h.change('#worktreeExisting', 'release');
  await h.submit('#worktreeForm');
  assert.deepEqual(h.requests.find(r => r.options.method === 'POST' && r.url.endsWith('/worktrees')).body, { slug: 'qa-check', mode: 'existing', branch: 'release', source: '' });
});

test('browser access settings save on the host, retain drafts and rotate the saved pairing code', async t => {
  let saved = {enabled:false,port:4318,code:'',running:false,error:'',can_manage:true,addresses:[]};
  const h = await harness(t, true, {intercept:(url, options, body) => {
    if (url !== '/api/settings/browser-access') return;
    if (options.method === 'PUT') saved = {...saved, enabled:body.enabled, port:body.port, running:body.enabled, code:body.regenerate_code ? 'replacement-code' : 'pairing-code', addresses:['http://192.168.1.20:' + body.port]};
    return {ok:true,json:async()=>saved};
  }});
  await h.navigate('/settings');
  assert.equal(h.$('#browserAccessFields').disabled, false);
  h.click('#browserAccessEnabled');
  h.input('#browserAccessPort', '54321');
  await h.window.refresh();
  assert.equal(h.$('#browserAccessPort').value, '54321');
  await h.submit('#browserAccessForm');
  const save = h.requests.findLast(r => r.url === '/api/settings/browser-access' && r.options.method === 'PUT');
  assert.deepEqual(save.body, {enabled:true,port:54321,regenerate_code:false});
  assert.equal(save.options.headers['X-Environment-ID'], 'local');
  assert.equal(h.$('#browserAccessCode').value, 'pairing-code');
  assert.equal(h.$('#browserAccessConnection').hidden, false);
  assert.equal(h.$('#browserAccessAddresses code').textContent, 'http://192.168.1.20:54321');
  h.input('#browserAccessPort', '54322');
  h.click('#resetBrowserAccessCode');
  await settle();
  assert.deepEqual(h.requests.findLast(r => r.url === '/api/settings/browser-access' && r.options.method === 'PUT').body, {enabled:true,port:54321,regenerate_code:true});
  assert.equal(h.$('#browserAccessCode').value, 'replacement-code');
});

test('remote browser settings hide host controls and provide sign-out', async t => {
  const h = await harness(t, true, {origin:'http://192.168.1.20:4318',route:'/settings',intercept:url => {
    if (url === '/api/settings/browser-access') return {ok:true,json:async()=>({enabled:true,port:4318,code:'',running:true,error:'',can_manage:false,addresses:[]})};
  }});
  assert.equal(h.$('#browserAccessFields').hidden, true);
  assert.equal(h.$('#browserAccessFields').disabled, true);
  assert.equal(h.$('#browserAccessLogout').hidden, false);
  assert.equal(h.$('#browserAccessCode').value, '');
  assert.equal(h.$('#browserAccessLogout').getAttribute('target'), '_top');
  assert.equal(h.$('#browserAccessLogout').getAttribute('method'), 'post');
});

test('failed browser access saves preserve editable settings and the active pairing code', async t => {
  const h = await harness(t, true, {route:'/settings',intercept:(url, options) => {
    if (url !== '/api/settings/browser-access') return;
    return options.method === 'PUT' ? {ok:false,json:async()=>({error:'Port already in use'})} : {ok:true,json:async()=>({enabled:true,port:4318,code:'current-code',running:true,error:'',can_manage:true,addresses:[]})};
  }});
  h.input('#browserAccessPort', '54321');
  await h.submit('#browserAccessForm');
  assert.equal(h.$('#browserAccessPort').value, '54321');
  assert.equal(h.$('#browserAccessCode').value, 'current-code');
  assert.equal(h.$('#browserAccessFields').disabled, false);
  assert.match(h.$('#browserAccessStatus').textContent, /Port already in use/);
});

test('settings preserve unsaved edits during polling and keep the terminal request format', async t => {
  const h = await harness(t);
  await h.navigate('/settings');
  assert(h.$('#settingsPage [data-slot="card"]'));
  assert.equal(h.$('#terminalCustomFields').hidden, true);
  h.change('#terminalKind', 'custom');
  assert.equal(h.$('#terminalPath').required, true);
  const pathInput = h.input('#terminalPath', ' /my/terminal ');
  h.click('[data-settings-section="settings-conversation"]');
  assert.equal(h.window.document.activeElement.id,'settings-conversation-title');
  assert.equal(h.$('[data-settings-section="settings-conversation"]').getAttribute('aria-current'),'location');
  assert.equal(h.$('#terminalPath'),pathInput,'category navigation retains the same unsaved form');
  assert.equal(pathInput.value,' /my/terminal ');
  h.change('#terminalStyle', 'command');
  h.data.projects[0].worktrees[0].dirty = 2;
  await h.window.refresh();
  assert.equal(h.$('#terminalPath'), pathInput);
  assert.equal(pathInput.value, ' /my/terminal ');
  await h.submit('#terminalForm');
  assert.deepEqual(h.requests.find(r => r.url === '/api/settings/terminal' && r.options.method === 'PUT').body, { kind: 'custom', path: '/my/terminal', style: 'command' });
  assert.equal(h.$('#terminalError').hidden, true);
});

test('send shortcut settings save immediately on selection and revert on failure', async t => {
  const h = await harness(t, true, {route:'/settings', intercept:(url, options, body) => {
    if (url === '/api/settings/chat-input') return {ok:true,json:async()=>body};
  }});
  const selectedShortcut = () => h.$('#sendShortcutGroup input[name="send_shortcut"]:checked')?.value;
  assert.equal(selectedShortcut(), 'enter');
  h.click('#sendShortcutGroup input[value="ctrlEnter"]');
  await settle();
  assert.equal(selectedShortcut(), 'ctrlEnter');
  assert.equal(h.window.YoluChatInput.current(), 'ctrlEnter');
  assert.match(h.$('#chatInputStatus').textContent, /已保存并应用/);
  const save = h.requests.find(r => r.url === '/api/settings/chat-input');
  assert.deepEqual(save.body, {send_shortcut:'ctrlEnter'});
  assert.equal(save.options.headers['X-Environment-ID'], 'local');
  await h.navigate('/sessions');
  await h.navigate('/settings');
  assert.equal(selectedShortcut(), 'ctrlEnter');
  h.setIntercept(url => url === '/api/settings/chat-input' ? {ok:false,json:async()=>({error:'Save failed'})} : undefined);
  h.click('#sendShortcutGroup input[value="enter"]');
  await settle();
  assert.equal(h.window.YoluChatInput.current(), 'ctrlEnter');
  assert.equal(selectedShortcut(), 'ctrlEnter');
  assert.equal(h.$('#chatInputError').hidden, false);
  assert.match(h.$('#chatInputError').textContent, /Save failed/);
});

test('appearance palettes apply immediately with rollback on failure, and language actions appear only when dirty', async t => {
  const h = await harness(t, true, {route:'/settings', intercept:(url, options, body) => {
    if (url === '/api/settings/appearance') return {ok:true,json:async()=>body};
  }});
  const selectedTheme = () => h.$('#colorThemeGroup input[name="color_theme"]:checked')?.value;
  assert.equal(selectedTheme(), 'mint');
  assert.equal(h.$('#saveLanguage').hidden, true);
  assert.equal(h.$('#cancelLanguage').hidden, true);
  h.click('#colorThemeGroup input[value="dark"]');
  await settle();
  assert.equal(selectedTheme(), 'dark');
  assert.equal(h.window.YoluTheme.current(), 'dark');
  assert.match(h.$('#appearanceStatus').textContent, /已保存/);
  assert.deepEqual(h.requests.findLast(r => r.url === '/api/settings/appearance').body, {color_theme:'dark'});
  h.setIntercept(url => url === '/api/settings/appearance' ? {ok:false,json:async()=>({error:'Palette write failed'})} : undefined);
  h.click('#colorThemeGroup input[value="light"]');
  await settle();
  assert.equal(h.window.YoluTheme.current(), 'dark');
  assert.equal(selectedTheme(), 'dark');
  assert.equal(h.$('#appearanceError').hidden, false);
  assert.match(h.$('#appearanceError').textContent, /Palette write failed/);
  h.change('#languageSelect', 'en');
  assert.equal(h.$('#saveLanguage').hidden, false);
  assert.equal(h.$('#cancelLanguage').hidden, false);
  h.click('#cancelLanguage');
  assert.equal(h.$('#languageSelect').value, 'zh-CN');
  assert.equal(h.$('#saveLanguage').hidden, true);
  assert.equal(h.$('#cancelLanguage').hidden, true);
});

test('preset terminal changes save immediately while custom terminal waits for explicit submit', async t => {
  const h = await harness(t);
  h.data.terminal.supported_kinds = ['auto', 'otty', 'custom'];
  await h.window.refresh();
  await h.navigate('/settings');
  h.change('#terminalKind', 'otty');
  await settle();
  const put = h.requests.findLast(r => r.url === '/api/settings/terminal' && r.options.method === 'PUT');
  assert.deepEqual(put.body, {kind:'otty', path:'', style:'otty'});
  assert.match(h.$('#terminalSaveStatus').textContent, /已保存/);
  const beforeCustom = h.requests.filter(r => r.url === '/api/settings/terminal' && r.options.method === 'PUT').length;
  h.change('#terminalKind', 'custom');
  await settle();
  assert.equal(h.requests.filter(r => r.url === '/api/settings/terminal' && r.options.method === 'PUT').length, beforeCustom);
  assert.equal(h.$('#terminalCustomFields').hidden, false);
});

test('Codex diagnostics stay read-only, retain report details during polling and provide a copy fallback', async t => {
  const h = await harness(t);
  let checks = 0;
  h.setIntercept((url, options) => {
    if (url !== '/api/settings/codex') return;
    checks++;
    assert.equal(options.headers['X-Environment-ID'], 'local');
    assert.notEqual(options.method, 'POST');
    return {ok:true,json:async()=>({platform:'darwin',user:'mac-user',codex_home:'/Users/mac/.codex',cli_path:'/opt/homebrew/bin/codex',daemon_path:'/Users/mac/.codex/packages/app-server-daemon/current/bin/codex',version:'CLI-new',daemon_version:'daemon-old',candidates:['/opt/homebrew/bin/codex','/usr/local/bin/codex'],checked_at:'2026-11-04T12:00:00Z',status:'error',checks:[{id:'sessions',name:'对话接口',status:'error',message:'<img src=x onerror=alert(1)>配置错误',advice:'退出并停止后台后重试'}]})};
  });
  await h.navigate('/settings'); await settle();
  assert.equal(checks, 1);
  assert.match(h.$('#codexDiagnosticsResults').textContent, /macOS.*mac-user/);
  assert.equal(h.$('#codexDiagnosticsResults img'), null);
  const details = h.$('#codexDiagnosticsResults details');details.open = true;
  await h.window.refresh();await settle();
  assert.equal(checks, 1, 'workspace polling must not rerun subprocess checks');
  assert.equal(h.$('#codexDiagnosticsResults details'), details);
  assert.equal(details.open, true);
  assert.match(details.textContent, /CLI-new/);assert.match(details.textContent, /daemon-old/);
  h.click('#copyCodexDiagnostics');await settle();
  const copy = h.$('#codexDiagnosticsCopy');
  assert.equal(copy.hidden, false);
  assert.match(copy.value, /退出并停止后台后重试/);
  assert.match(copy.value, /\/usr\/local\/bin\/codex/);
  assert.equal(copy.selectionEnd, copy.value.length);
  h.click('#checkCodex');await settle();
  assert.equal(checks, 2);assert.equal(copy.hidden, true);
});

test('Codex checks isolate Windows and WSL users and retain independent reports when one WSL is offline', async t => {
  const h = await harness(t);
  Object.assign(h.environments, {platform:'windows',wsl_supported:true,distributions:['Ubuntu','Debian'],environments:[{id:'local',name:'Windows 本机'},{id:'wsl-alice',name:'Ubuntu / alice',distro:'Ubuntu'},{id:'wsl-bob',name:'Ubuntu / bob',distro:'Ubuntu'},{id:'offline',name:'WSL 已断开',distro:'Ubuntu'}]});
  let resolveAlice;
  const checks = [];
  h.setIntercept((url, options) => {
    if (url !== '/api/settings/codex') return;
    const environment = options.headers['X-Environment-ID'];checks.push(environment);
    if (environment === 'offline') return {ok:false,json:async()=>({error:'WSL 辅助程序未连接'})};
    const report = {platform:environment === 'local' ? 'windows':'linux',user:environment,cli_path:environment === 'local' ? 'C:\\Tools\\codex.exe' : `/home/${environment}/.local/bin/codex`,codex_home:`/${environment}/.codex`,candidates:[],checked_at:'now',status:'ok',checks:[]};
    if (environment === 'wsl-alice') return new Promise(resolve => {resolveAlice = () => resolve({ok:true,json:async()=>report});});
    return {ok:true,json:async()=>report};
  });
  await h.window.loadEnvironments();await h.navigate('/settings');await settle();
  h.click('#checkAllCodex');await settle();await settle();
  assert.equal(h.$('#checkAllCodex').disabled, true);
  assert.equal(h.$('#copyCodexDiagnostics').disabled, true);
  assert.match(h.$('#codexUnregistered').textContent, /Debian/);
  assert(!h.$('#codexUnregistered').textContent.includes('Ubuntu'));
  assert(h.$('[data-codex-environment="wsl-bob"]'));
  assert.match(h.$('[data-codex-environment="offline"] [role="alert"]').textContent, /WSL 辅助程序未连接/);
  // Switch while Alice is pending. Her late response must keep her identity.
  await h.window.selectEnvironment('wsl-bob','/settings');await settle();
  resolveAlice();await settle();await settle();
  assert.equal(h.$('#checkAllCodex').disabled, false);
  assert.equal(h.$('#copyCodexDiagnostics').disabled, false);
  assert.deepEqual([...new Set(checks)].sort(), ['local','offline','wsl-alice','wsl-bob']);
  assert.match(h.$('[data-codex-environment="local"]').textContent, /C:\\Tools\\codex.exe/);
  assert.match(h.$('[data-codex-environment="wsl-alice"]').textContent, /\/home\/wsl-alice/);
  assert.match(h.$('[data-codex-environment="wsl-bob"]').textContent, /\/home\/wsl-bob/);
  h.click('#copyCodexDiagnostics');await settle();
  assert.match(h.$('#codexDiagnosticsCopy').value, /WSL 辅助程序未连接/);
});

test('Codex installation uses the selected report environment and refreshes it after navigation', { timeout: 10000 }, async t => {
  const h = await harness(t, false);
  const environment = 'wsl-alice';
  const plan = {action:'install', manager:'standalone', path:'/home/alice/.local/bin/codex'};
  const installed = {status:'succeeded', action:'install', stage:'daemon', version:'codex-cli 1.2.3'};
  let installation;
  let version;
  let resolveDaemonStart;
  const daemonStarting = new Promise(resolve => { resolveDaemonStart = resolve; });
  let resolvePoll;
  const polled = new Promise(resolve => { resolvePoll = resolve; });
  h.environments.environments.push({id:environment, name:'Ubuntu / alice', distro:'Ubuntu'});
  h.setIntercept((url, options, body) => {
    const target = options.headers['X-Environment-ID'];
    if (url === '/api/settings/codex' && target === environment) {
      return {ok:true, json:async()=>({
        platform:'linux', user:'alice', candidates:[], checked_at:'now', status: version ? 'ok' : 'error',
        version, checks:[
          {id:'cli', name:'CLI 安装与版本', status:version ? 'ok' : 'error', message:version || 'missing'},
          {id:'daemon', name:'共享后台', status:version ? 'ok' : 'skipped', message:version ? '已连接共享后台并成功读取对话列表' : 'missing'}
        ],
        install_state:installation, install_plan:{...plan, action:version ? 'upgrade' : 'install'}
      })};
    }
    if (url !== '/api/settings/codex/install') return;
    assert.equal(target, environment);
    if (options.method === 'POST') {
      assert.deepEqual(body, plan);
      installation = {status:'running', action:'install'};
    } else if (installation.stage !== 'daemon') {
      installation = {...installation, stage:'daemon', version:installed.version};
      resolveDaemonStart();
    } else {
      installation = installed;
      version = installed.version;
      resolvePoll();
    }
    return {ok:true, json:async()=>installation};
  });
  await h.navigate('/settings');
  h.click('#checkAllCodex'); await settle();
  const action = '[data-codex-environment="wsl-alice"] [data-codex-install]';
  assert.match(h.$(action).textContent, /安装 Codex CLI/);
  h.click(action); await settle();
  assert.equal(h.$(action).disabled, true);
  await daemonStarting; await settle();
  assert.match(h.$('[data-codex-environment="wsl-alice"] [role="status"]').textContent, /正在启动并检测 Codex 共享后台/);
  await h.navigate('/projects');
  await polled; await settle();
  await h.navigate('/settings');
  assert.equal(h.$(action).disabled, false);
  assert.match(h.$(action).textContent, /升级 Codex CLI/);
  assert.match(h.$('[data-codex-environment="wsl-alice"] [role="status"]').textContent, /安装完成.*1\.2\.3/);
  assert.match(h.$('[data-codex-environment="wsl-alice"]').textContent, /共享后台通过已连接共享后台并成功读取对话列表/);
  assert.equal(h.requests.filter(r => r.url === '/api/settings/codex/install' && r.options.method === 'POST').length, 1);
});

test('title settings save immediately on selection and report failures accessibly', async t => {
  const h = await harness(t);
  await h.navigate('/settings');
  assert.equal(h.$('#sessionTitleFields').disabled, false);
  assert.equal(h.$('#sessionTitleModel').value, '');
  h.change('#sessionTitleModel', 'title-model');
  await settle();
  assert.equal(h.$('#sessionTitleModel').value, 'title-model');
  assert.deepEqual(h.requests.findLast(r => r.url === '/api/settings/session-title' && r.options.method === 'PUT').body, {model:'title-model'});
  assert.equal(h.$('#sessionTitleError').hidden, true);
  assert.match(h.$('#sessionTitleStatus').textContent, /已保存/);
  h.setIntercept((url, options) => url === '/api/settings/session-title' && options.method === 'PUT' ? {ok:false,json:async()=>({error:'模型已不可用'})} : undefined);
  h.change('#sessionTitleModel', 'body-model');
  await settle();
  assert.equal(h.$('#sessionTitleModel').value, 'body-model');
  assert.equal(h.$('#sessionTitleError').getAttribute('role'), 'alert');
  assert.equal(h.$('#sessionTitleError').hidden, false);
  assert.match(h.$('#sessionTitleError').textContent, /模型已不可用/);
});

test('conversation defaults save automatically per agent and environment with segmented controls', async t => {
  const h = await harness(t);
  await h.navigate('/settings');
  const effortValue = () => h.$('#conversationDefaultEffort input[name="conversation_default_effort"]:checked')?.value ?? '';
  const permissionValue = () => h.$('#conversationDefaultPermission input[name="conversation_default_permission"]:checked')?.value ?? '';
  assert.equal(h.$('#conversationDefaultsFields').disabled, false);
  assert.equal(h.$('#conversationDefaultModel').value, '');
  assert.equal(permissionValue(), '');
  assert.equal(h.$('#environmentSelect').closest('form').id, 'defaultAgentForm');
  assert.match(h.$('#settingsTitleEnv').textContent, /本机.*仅用于新对话/);
  h.change('#conversationDefaultModel', 'body-model'); await settle();
  h.change('#conversationDefaultSpeed', 'fast'); await settle();
  h.click('#conversationDefaultEffort input[value="high"]'); await settle();
  h.click('#conversationDefaultPermission input[value="ask"]'); await settle();
  await h.window.refresh(true); await settle();
  assert.equal(h.$('#conversationDefaultModel').value, 'body-model');
  assert.equal(permissionValue(), 'ask');
  const saved = h.requests.findLast(r => r.url === '/api/settings/conversation-defaults' && r.options.method === 'PUT');
  assert.deepEqual(saved.body, {model:'body-model',effort:'high',serviceTier:'fast',permission:'ask'});
  assert.equal(saved.options.headers['X-Environment-ID'], 'local');
  assert.match(h.$('#conversationDefaultsStatus').textContent, /已保存/);
  h.click('#conversationDefaultPermission input[value="full"]'); await settle();
  assert.equal(h.$('#conversationDefaultPermissionHelp').dataset.danger, 'true');
  h.click('#conversationDefaultPermission input[value="ask"]'); await settle();
  assert.equal(h.$('#conversationDefaultPermissionHelp').dataset.danger, 'false');
  h.click('#conversationDefaultProviderGroup input[value="agy"]'); await settle();
  assert.equal(h.$('#conversationDefaultModel').value, '');
  assert.match(h.$('#conversationDefaultPermission').textContent, /启用沙箱/);
  assert.equal(h.$('#conversationDefaultSpeed').disabled, true);
  h.change('#conversationDefaultModel', 'claude'); await settle();
  h.click('#conversationDefaultEffort input[value="low"]'); await settle();
  h.click('#conversationDefaultPermission input[value="ask"]'); await settle();
  assert.deepEqual(h.data.agy_conversation_defaults, {model:'claude',effort:'low',serviceTier:'',permission:'ask'});
  h.click('#conversationDefaultProviderGroup input[value="codex"]'); await settle();
  assert.equal(h.$('#conversationDefaultModel').value, 'body-model');
  assert.equal(effortValue(), 'high');
  h.click('#conversationDefaultProviderGroup input[value="agy"]'); await settle();
  assert.equal(h.$('#conversationDefaultModel').value, 'claude');
  assert.equal(effortValue(), 'low');
  h.click('#conversationDefaultsReload'); await settle();
  assert.equal(effortValue(), 'low');
  h.click('#conversationDefaultProviderGroup input[value="codex"]'); await settle();
  h.click('#conversationDefaultsReload'); await settle();
  assert.equal(h.$('#conversationDefaultModel').value, 'body-model');
  assert.equal(effortValue(), 'high');
  assert.equal(h.$('#conversationDefaultSpeed').value, 'fast');
  h.change('#conversationDefaultModel', 'other-model'); await settle();
  assert.equal(effortValue(), '');
  assert.equal(h.$('#conversationDefaultSpeed').value, '');
  assert.equal(h.$('#conversationDefaultSpeed').disabled, true);
  h.change('#conversationDefaultModel', ''); await settle();
  h.click('#conversationDefaultPermission input[value=""]'); await settle();
  assert.deepEqual(h.data.conversation_defaults, {model:'',effort:'',serviceTier:'',permission:''});
  h.setIntercept((url, options) => url === '/api/settings/conversation-defaults' && options.method === 'PUT' ? {ok:false,json:async()=>({error:'模型已不可用'})} : undefined);
  h.change('#conversationDefaultModel', 'body-model'); await settle();
  assert.equal(h.$('#conversationDefaultModel').value, 'body-model');
  assert.equal(h.$('#conversationDefaultsFields').disabled, false);
  assert.equal(h.$('#conversationDefaultsError').hidden, false);
  assert.match(h.$('#conversationDefaultsError').textContent, /模型已不可用/);
});

test('late conversation defaults cannot overwrite another environment and offline defaults remain editable', async t => {
  const h = await harness(t);
  h.environments.environments.push({id:'wsl-test',name:'WSL test'});
  let resolveLocal;
  h.setIntercept((url, options) => {
    if (url !== '/api/settings/conversation-defaults') return;
    if (options.headers['X-Environment-ID'] === 'local') return new Promise(resolve => {resolveLocal = () => resolve({ok:true,json:async()=>({settings:{permission:'full'},models:[]})});});
    return {ok:true,json:async()=>({settings:{permission:'ask'},models:[],models_error:'CLI offline'})};
  });
  await h.window.loadEnvironments(); await h.navigate('/settings');
  await h.window.selectEnvironment('wsl-test','/settings'); await settle();
  assert.equal(h.$('#conversationDefaultPermission input[name="conversation_default_permission"]:checked')?.value, 'ask');
  assert.equal(h.$('#conversationDefaultsFields').disabled, false);
  assert.match(h.$('#conversationDefaultsStatus').textContent, /CLI offline/);
  resolveLocal(); await settle();
  assert.equal(h.$('#conversationDefaultPermission input[name="conversation_default_permission"]:checked')?.value, 'ask');
});

test('large reasoning catalogs retain every choice and save the visible dropdown value', async t => {
  const efforts = ['low','medium','high','xhigh','max','ultra'];
  const h = await harness(t, true, {route:'/settings', intercept:(url, options) => {
    if (url === '/api/settings/conversation-defaults' && options.method !== 'PUT') return {ok:true,json:async()=>({settings:{effort:'ultra'},models:[{model:'large',isDefault:true,supportedReasoningEfforts:efforts.map(reasoningEffort=>({reasoningEffort}))}]})};
  }});
  assert.equal(h.$('#conversationDefaultEffort').hidden, true);
  assert.equal(h.$('#conversationDefaultEffortDropdown').hidden, false);
  assert.equal(h.$('#conversationDefaultEffortSelect').value, 'ultra');
  assert.deepEqual([...h.$('#conversationDefaultEffortSelect').options].map(o=>o.value), ['',...efforts]);
  h.change('#conversationDefaultEffortSelect', 'max'); await settle();
  assert.equal(h.requests.findLast(r=>r.url === '/api/settings/conversation-defaults' && r.options.method === 'PUT').body.effort, 'max');
});

test('rapid default changes serialize writes and retain the final persisted selection', async t => {
  const h = await harness(t, true, {route:'/settings'});
  let completeFirst;
  let writes = 0;
  h.setIntercept((url, options, body) => {
    if (url !== '/api/settings/conversation-defaults' || options.method !== 'PUT') return;
    writes++;
    if (writes === 1) return new Promise(resolve => {completeFirst = () => {h.data.conversation_defaults = body; resolve({ok:true,json:async()=>({})});};});
  });
  h.click('#conversationDefaultPermission input[value="ask"]'); await settle();
  h.click('#conversationDefaultPermission input[value="auto"]'); await settle();
  assert.equal(writes, 1, 'the second request waits for the first write');
  assert.match(h.$('#conversationDefaultsStatus').textContent, /保存中/);
  completeFirst(); await settle();
  assert.equal(writes, 2);
  assert.equal(h.data.conversation_defaults.permission, 'auto');
  assert.equal(h.$('#conversationDefaultPermission input:checked').value, 'auto');
  assert.match(h.$('#conversationDefaultsStatus').textContent, /已保存/);
});

test('failed default drafts survive refresh and scope changes and can be retried', async t => {
  const h = await harness(t, true, {route:'/settings'});
  h.environments.environments.push({id:'wsl-test',name:'WSL test'});
  await h.window.loadEnvironments();
  h.setIntercept((url, options) => url === '/api/settings/conversation-defaults' && options.method === 'PUT' ? {ok:false,json:async()=>({error:'Write failed'})} : undefined);
  h.click('#conversationDefaultPermission input[value="auto"]'); await settle();
  assert.equal(h.$('#conversationDefaultsRetry').hidden, false);
  h.click('#conversationDefaultProviderGroup input[value="agy"]'); await settle();
  h.click('#conversationDefaultProviderGroup input[value="codex"]'); await settle();
  assert.equal(h.$('#conversationDefaultPermission input:checked').value, 'auto');
  h.click('#conversationDefaultsReload'); await settle();
  assert.equal(h.$('#conversationDefaultPermission input:checked').value, 'auto');
  await h.window.selectEnvironment('wsl-test','/settings'); await settle();
  assert.equal(h.$('#conversationDefaultPermission input:checked').value, '');
  await h.window.selectEnvironment('local','/settings'); await settle();
  assert.equal(h.$('#conversationDefaultPermission input:checked').value, 'auto');
  assert.match(h.$('#conversationDefaultsError').textContent, /Write failed/);
  assert.equal(h.$('#conversationDefaultsRetry').hidden, false);
  h.setIntercept(undefined);
  h.click('#conversationDefaultsRetry'); await settle();
  assert.equal(h.$('#conversationDefaultsRetry').hidden, true);
  assert.equal(h.$('#conversationDefaultsError').hidden, true);
  assert.equal(h.data.conversation_defaults.permission, 'auto');
});

test('failed terminal saves keep the draft and show an accessible error', async t => {
  const h = await harness(t);
  await h.navigate('/settings'); h.change('#terminalKind', 'custom');
  h.input('#terminalPath', '/unsaved/terminal');
  h.setIntercept((url, options) => url === '/api/settings/terminal' && options.method === 'PUT' ? { ok: false, json: async () => ({ error: '程序不可用' }) } : undefined);
  await h.submit('#terminalForm');
  assert.equal(h.$('#terminalError').getAttribute('role'), 'alert');
  assert.equal(h.$('#terminalError').hidden, false);
  assert.match(h.$('#terminalError').textContent, /程序不可用/);
  assert.equal(h.$('#terminalPath').value, '/unsaved/terminal');
});

test('WSL connection and reconnect use the same environment payloads', async t => {
  const h = await harness(t);
  Object.assign(h.environments, { distributions: ['Ubuntu'], platform: 'windows', wsl_supported: true, environments: [{ id: 'local', name: '本机' }, { id: 'wsl-test', name: 'Ubuntu' }] });
  await h.window.loadEnvironments(); await h.navigate('/settings');
  assert.equal(h.$('#addEnvironment').hidden, false);
  h.click('#addEnvironment'); await settle();
  assert.equal(h.$('#environmentDialog').open, true);
  h.input('#environmentUser', ' tester '); h.input('#environmentRoot', ' /home/tester/workspaces '); h.click('#environmentImport');
  await h.submit('#environmentForm');
  assert.deepEqual(h.requests.find(r => r.url === '/api/environments' && r.options.method === 'POST').body, { distro: 'Ubuntu', user: 'tester', root: '/home/tester/workspaces', import_existing: true });
  assert.equal(h.$('#environmentDialog').open, false);
  assert.equal(h.$('#environmentSelect').value, 'wsl-test');
  h.click('#reconnectEnvironment'); await settle();
  assert(h.requests.some(r => r.url === '/api/environments/wsl-test/reconnect' && r.options.method === 'POST'));
});

test('read-only conversations retain history paging, expanded commands and a live output dialog', async t => {
  const h = await harness(t);
  await h.openConversations('project');
  assert.equal(h.$('#newBrowserSession').disabled, true);
  assert.equal(h.$('#sessionChatForm').hidden, true);
  assert(h.$('#sessionHistoryEntries [data-slot="card"]'));
  const detail = h.$('#sessionHistoryEntries details'); detail.open = true;
  h.click('[data-command-output]');
  assert.equal(h.$('#sessionCommandOutputDialog').open, true);
  assert.equal(h.$('#sessionCommandOutputText').textContent, 'working tree clean');
  h.history[1].output = 'updated output';
  await h.window.loadSessionHistory(false, true);
  assert.equal(h.$('#sessionHistoryEntries details'), detail);
  assert.equal(h.$('#sessionCommandOutputText').textContent, 'updated output');
  h.history[2].text = '更新后的回复';
  await h.window.loadSessionHistory(false, true);
  assert.equal(h.$('#sessionHistoryEntries details').open, true);
  await h.window.loadSessionHistory(true);
  assert.match(h.$('#sessionHistoryEntries').textContent, /更早的记录/);
  assert.equal(h.$('#loadOlderHistory').hidden, true);
  h.click('#closeSessionCommandOutput');
  h.window.closeSessionHistory();
  assert.equal(h.$('#sessionCommandOutputDialog').open, false);
  assert.equal(h.$('#conversationDialog'), null);
  assert.equal(h.$('#sessionHistoryPanel').hidden, true);
  assert.equal(h.document.activeElement, h.$('#sessionBrowserSearch'));
  assert(!h.requests.some(r => r.url.endsWith('/chat') || r.url.endsWith('/sessions/new')));
});

test('the global scope picker filters projects and exact directories', async t => {
  const h = await harness(t);
  h.sessions.push({ id: 'outside', name: 'Outside conversation', cwd: '/outside' });
  await h.navigate('/sessions');
  h.$('#sessionScopePicker').open = true; await settle();
  h.input('#sessionScopeSearch', '/outside');
  const result = h.$('[data-conversation-scope]');
  assert.equal(JSON.parse(result.dataset.conversationScope).cwd, '/outside');
  result.click(); await settle();
  assert.equal(h.$('#sessionScopePicker').open, false);
  assert.equal(h.$('[data-conversation-session]').dataset.conversationSession, 'outside');
  assert.equal(h.$('#newBrowserSession').disabled, true);
  assert.equal(h.$('#sessionDirectoryField'), null);
  h.click('[data-conversation-action="all"]'); await settle();
  assert.equal(h.document.querySelectorAll('[data-conversation-session]').length, 2);
});

test('conversation scope menu uses the top layer, fits the viewport and closes on selection, Escape and navigation', async t => {
  const h = await harness(t);
  await h.navigate('/sessions');
  const picker = h.$('#sessionScopePicker'), panel = picker.querySelector('[popover]');
  assert.equal(panel.getAttribute('popover'), 'manual');
  let visible = false;
  panel.showPopover = () => { visible = true; };
  panel.hidePopover = () => { visible = false; };
  const matches = panel.matches.bind(panel);
  panel.matches = selector => selector === ':popover-open' ? visible : matches(selector);
  h.window.innerWidth = 800; h.window.innerHeight = 600;
  picker.querySelector('summary').getBoundingClientRect = () => ({left:650, right:780, top:500, bottom:530});
  h.$('#sessionBrowserScopeBar').getBoundingClientRect = () => ({left:300, width:280});
  picker.open = true; await settle();
  assert.equal(visible, true);
  assert.equal(panel.style.top, 'auto');
  assert.equal(panel.style.bottom, '106px');
  assert.equal(panel.style.left, '300px');
  assert(parseFloat(panel.style.left) >= 12);
  assert(parseFloat(panel.style.left) + parseFloat(panel.style.width) <= 788);
  assert(parseFloat(panel.style.maxHeight) <= 482);
  assert.equal(h.document.activeElement, h.$('#sessionScopeSearch'));
  h.input('#sessionScopeSearch', 'Backend');
  [...h.document.querySelectorAll('[data-conversation-scope]')].find(button => JSON.parse(button.dataset.conversationScope).kind === 'project').click();
  await settle();
  assert.equal(visible, false);
  assert.match(h.$('#sessionScopeLabel').textContent, /项目 · Backend/);
  picker.open = true; await settle();
  h.$('#sessionScopeSearch').dispatchEvent(new h.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
  await settle();
  assert.equal(visible, false);
  assert.equal(h.document.activeElement, picker.querySelector('summary'));
  picker.open = true; await settle();
  await h.navigate('/projects');
  assert.equal(visible, false);
  assert.equal(picker.open, false);
});

test('background activity and unread completion update navigation without reopening a conversation', async t => {
  const h = await harness(t);
  await h.openConversations('project');
  await h.leaveConversations();
  const activity = () => h.$('#sessionNavigationStatus').textContent;
  h.sessions[0].chat_status = 'running';
  await h.window.refreshConversations(true); assert.equal(activity(), '运行中');
  h.sessions[0].chat_status = 'waiting';
  await h.window.refreshConversations(true); assert.equal(activity(), '待确认');
  h.sessions[0].chat_status = ''; h.sessions[0].completed_run = 'background-run';
  await h.window.refreshConversations(true); assert.equal(activity(), '有新消息');
  assert.equal(h.$('#conversationDialog'), null);
  h.window.eval('sessionReadMemory.clear()');
  await h.window.refreshConversations(true); assert.equal(activity(), '有新消息');
  await h.openConversations('project');
  assert.equal(activity(), '');
  const seen = JSON.parse(h.window.localStorage.getItem('workhub:session-read:' + JSON.stringify(['local', 'session-1'])));
  assert.equal(seen.run, 'background-run');
  await h.leaveConversations();
  h.sessions[0].completed_run = 'another-run';
  await h.window.refreshConversations(true); assert.equal(activity(), '有新消息');
});

test('assistant activity immediately updates the shared list and navigation', async t => {
  const h = await harness(t, false);
  let opened;
  h.window.WorkHubAssistant = { open(options) { opened = options; }, close() {} };
  await h.openConversations('project');
  opened.activity('session-1', { id: 'live', status: 'running', busy: true });
  assert.equal(h.$('[data-session-indicators="session-1"]').getAttribute('aria-label'), '运行中');
  assert(h.$('.session-browser-item-heading [data-session-indicators="session-1"] svg'));
  assert.equal(h.$('[data-session-indicators="session-1"]').textContent, '');
  opened.activity('session-1', { id: 'live', status: 'waiting', busy: true });
  assert.equal(h.$('[data-session-indicators="session-1"]').getAttribute('title'), '待确认');
  assert.equal(h.$('[data-session-indicators="session-1"]').dataset.state, 'waiting');
  opened.activity('session-1', { id: 'live', turn_id: 'turn', status: 'completed', busy: false });
  assert.equal(h.$('[data-session-indicators="session-1"]').hidden, true);
});

test('interactive approval questions keep native values, secret fields and answer requests', async t => {
  const h = await harness(t, false);
  h.window.openSessionHistory('session-1','local','app'); await settle();
  const current = h.currentSession();
  h.window.applyChatState(current, { id: 'approval-run', status: 'waiting', busy: true, entries: [], approvals: [{ id: 'approval-1', title: '选择方案', kind: 'questions', can_accept: true, questions: [{ id: 'method', header: '方案', question: '采用哪个方案？', options: [{ label: 'A', description: '兼容旧数据' }] }, { id: 'secret', header: '测试', question: '填写测试值', isSecret: true }] }] });
  assert.equal(h.$('[data-free-answer-for="secret"]').type, 'password');
  h.change('[data-answer-for="method"]', 'A'); h.input('[data-free-answer-for="secret"]', 'fixture-only');
  await h.submit('#sessionChatApprovals form');
  assert.deepEqual(h.requests.find(r => r.url.endsWith('/chat/approval')).body, { run_id: 'approval-run', approval_id: 'approval-1', decision: 'accept', answers: { method: ['A'], secret: ['fixture-only'] } });
});

test('message shortcuts and drafts retain their concrete creation directory', async t => {
  const h = await harness(t, false);
  h.window.openSessionHistory('session-1','local','app'); await settle();
  h.input('#sessionChatInput', '  继续检查  ');
  h.$('#sessionChatInput').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await settle();
  const sent = h.requests.filter(r => r.url.endsWith('/chat') && r.options.method === 'POST');
  assert.equal(sent.length, 1); assert.equal(sent[0].body.text, '继续检查'); assert(sent[0].body.request_id);
  h.click('#newBrowserSession');
  assert.equal(h.$('#sessionBrowserNewDirectory').value, '');
  h.change('#sessionBrowserNewDirectory', '/repo/app');
  assert.equal(h.currentSession().target.cwd,'/repo/app');
  h.input('#sessionChatInput', '保留这份草稿');
  h.window.closeSessionHistory(); h.click('#newBrowserSession');
  h.change('#sessionBrowserNewDirectory', '/repo/app');
  assert.equal(h.$('#sessionChatInput').value, '保留这份草稿');
  assert(!h.requests.some(r => r.url.endsWith('/sessions/new')));
});

test('legacy MCP forms preserve drafts when another request arrives and return typed answers', async t => {
  const h=await harness(t,false);
  h.window.openSessionHistory('session-1','local','app');await settle();
  const current=h.currentSession();
  const approval={id:'mcp',title:'填写配置',details:'请选择配置',kind:'elicitation',can_accept:true,choices:[{id:'decline',label:'拒绝',accepts:false},{id:'accept',label:'提交回答',accepts:true}],elicitation:{mode:'form',server_name:'apix',fields:[{name:'choice',title:'方案',type:'string',required:true,options:[{value:'id-a',label:'方案 A'}]},{name:'enabled',title:'启用',type:'boolean',required:true,default:false},{name:'count',title:'数量',type:'integer',required:true,default:0}]}};
  const chat={id:'run',status:'waiting',busy:true,entries:[],approvals:[approval]};
  h.window.applyChatState(current,chat);
  const field=h.change('select[name="elicitation:choice"]',JSON.stringify('id-a'));
  h.window.applyChatState(current,{...chat,approvals:[approval,{id:'another',title:'另一个请求',kind:'questions',can_accept:true}]});
  assert.equal(h.$('select[name="elicitation:choice"]'),field);
  assert.equal(field.value,JSON.stringify('id-a'));
  h.click('form[data-chat-approval="mcp"] button[value="accept"]');await settle();
  assert.deepEqual(h.requests.find(r=>r.url.endsWith('/chat/approval')).body,{run_id:'run',approval_id:'mcp',decision:'accept',answers:{},content:{choice:'id-a',enabled:false,count:0}});
});


test('conversation entry opens the page directly and restores the same scope and browser after returning', async t => {
  const h = await harness(t, false);
  let opens = 0, closes = 0;
  h.window.WorkHubAssistant = { open() { opens++; }, close() { closes++; } };
  await h.openConversations('project');
  const browser = h.$('#sessionBrowser'), panel = h.$('#assistantChatRoot'), current = h.currentSession();
  h.window.setConversationDirectory('/workspace/workspace/app'); await settle();
  const afterFilter = h.currentSession();
  const beforeOpens = opens, beforeCloses = closes;
  h.window.render(); await settle();
  assert.equal(h.$('#conversationDialog'), null);
  assert.equal(h.window.location.hash, '#/sessions');
  assert.equal(h.$('#sessionsPage').hidden, false); assert.equal(h.$('#workContent').hidden, true);
  assert.equal(h.$('#sessionPageMount #sessionBrowser'), browser);
  assert.equal(h.$('#assistantChatRoot'), panel); assert.equal(h.currentSession(), afterFilter);
  assert.equal(opens, beforeOpens); assert.equal(closes, beforeCloses);
  assert.equal(h.window.WorkHubConversations.current.directory, '/workspace/workspace/app');
  h.click('[data-conversation-action="all"]'); await settle();
  assert.equal(h.$('#sessionScopeLabel').textContent, '全部对话');
  await h.navigate('/projects/app');
  await h.openConversations('project');
  assert.equal(h.$('#sessionPageMount #sessionBrowser'), browser);
  assert.equal(h.$('#assistantChatRoot'), panel);
  assert.equal(h.window.WorkHubConversations.current.directory, '/workspace/workspace/app');
  assert.notEqual(h.currentSession(), current); // The controller registry, not DOM history state, owns drafts.
  assert(!h.requests.some(r => r.url.endsWith('/chat/stop')));
});

test('conversation columns resize without reopening chat and retain their width across navigation', async t => {
  const h = await harness(t, false);
  await h.openConversations('project');
  const browser = h.$('#sessionBrowser'), handle = h.$('#sessionBrowserResize');
  const list = h.$('#sessionBrowserListPane'), body = h.$('.session-browser-body');
  let available = 1000, captured;
  body.getBoundingClientRect = () => ({ width: available });
  list.getBoundingClientRect = () => ({ width: Math.max(220, Math.min(parseFloat(browser.style.getPropertyValue('--conversation-list-width')) || 280, available - 328)) });
  handle.setPointerCapture = id => { captured = id; };
  handle.hasPointerCapture = id => captured === id;
  handle.releasePointerCapture = () => { captured = undefined; };
  const pointer = (type, x, id = 1, button = 0) => {
    const event = new h.window.MouseEvent(type, { clientX: x, button, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'pointerId', { value: id });
    handle.dispatchEvent(event);
  };
  const panel = h.$('#assistantChatRoot'), session = h.currentSession();
  pointer('pointerdown', 280);
  pointer('pointermove', 400, 2); // Another pointer cannot move this split.
  assert.equal(browser.style.getPropertyValue('--conversation-list-width'), '');
  pointer('pointermove', 400);
  assert.equal(handle.getAttribute('aria-valuenow'), '400');
  assert.equal(captured, 1);
  pointer('pointerup', 400);
  assert.equal(captured, undefined);
  assert(!browser.hasAttribute('data-resizing'));
  assert.equal(h.window.localStorage.getItem('workhub:conversation-list-width:v1'), '400');
  await h.leaveConversations(); await h.openConversations('project');
  assert.equal(browser.style.getPropertyValue('--conversation-list-width'), '400px');
  assert.equal(h.$('#assistantChatRoot'), panel);
  assert.equal(h.currentSession().session, session.session);
  available = 720;
  pointer('pointerdown', 392); pointer('pointermove', 900);
  assert.equal(handle.getAttribute('aria-valuenow'), '392'); // Leave room for the conversation.
  pointer('pointermove', -900);
  assert.equal(handle.getAttribute('aria-valuenow'), '220');
  pointer('pointercancel', -900);
  assert(!browser.hasAttribute('data-resizing'));
  pointer('pointermove', 400);
  assert.equal(handle.getAttribute('aria-valuenow'), '220');
  assert(!h.requests.some(r => r.url.endsWith('/chat/stop')));
});

test('conversation split supports keyboard resizing and leaves narrow-screen navigation intact', async t => {
  const h = await harness(t);
  await h.openConversations('project');
  const browser = h.$('#sessionBrowser'), handle = h.$('#sessionBrowserResize');
  let available = 1000;
  h.$('.session-browser-body').getBoundingClientRect = () => ({ width: available });
  h.$('#sessionBrowserListPane').getBoundingClientRect = () => ({ width: parseFloat(browser.style.getPropertyValue('--conversation-list-width')) || 280 });
  const key = (value, shiftKey = false) => handle.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
  key('ArrowRight'); assert.equal(handle.getAttribute('aria-valuenow'), '290');
  key('ArrowLeft', true); assert.equal(handle.getAttribute('aria-valuenow'), '250');
  key('End'); assert.equal(handle.getAttribute('aria-valuenow'), '520');
  key('Home'); assert.equal(handle.getAttribute('aria-valuenow'), '220');
  available = 600;
  key('End'); assert.equal(handle.getAttribute('aria-valuenow'), '220');
  h.click('[data-conversation-action="back"]');
  assert.equal(browser.dataset.pane, 'list');
  assert.equal(h.window.localStorage.getItem('workhub:conversation-list-width:v1'), '220');
});

test('late directory responses cannot replace the latest filter, including switching back to the first directory', async t => {
  const h = await harness(t);
  const pending = [];
  h.setIntercept(url => url.startsWith('/api/sessions?') && url.includes('cwd=') ? new Promise(resolve => pending.push({ url, resolve })) : undefined);
  await h.openConversations('project');
  h.window.setConversationDirectory('/workspace/workspace/app');
  h.window.setConversationDirectory('/workspace/workspace');
  h.window.setConversationDirectory('/workspace/workspace/app');
  assert.equal(pending.length, 3);
  const ok = sessions => ({ ok: true, json: async () => ({ sessions }) });
  pending[2].resolve(ok([{ id: 'latest', name: 'Latest response', cwd: '/workspace/workspace/app' }])); await settle();
  pending[0].resolve(ok([{ id: 'stale', name: 'Old response', cwd: '/workspace/workspace/app' }]));
  pending[1].resolve(ok([{ id: 'wrong-dir', name: 'Wrong directory', cwd: '/workspace/workspace' }])); await settle();
  assert.equal(h.$('[data-conversation-session]').dataset.conversationSession, 'latest');
  assert.equal(h.window.WorkHubConversations.current.directory, '/workspace/workspace/app');
});

test('scope picker Escape, mobile list navigation and browser back retain the expected page', async t => {
  const h = await harness(t);
  await h.navigate('/sessions'); h.$('#sessionScopePicker').open = true; await settle();
  h.$('#sessionScopeSearch').dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(h.$('#sessionScopePicker').open, false); assert(h.currentSession());
  h.click('[data-conversation-session]'); assert.equal(h.$('#sessionBrowser').dataset.pane, 'detail');
  h.click('[data-conversation-action="back"]'); assert.equal(h.$('#sessionBrowser').dataset.pane, 'list');
  await h.navigate('/projects/app'); await h.openConversations('project');
  h.$('#sessionBrowserSearch').dispatchEvent(new h.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
  assert.equal(h.window.location.hash, '#/sessions');
  const returned = new Promise(resolve => h.window.addEventListener('hashchange', resolve, {once:true}));
  h.window.history.back(); await returned; await settle();
  assert.equal(h.$('#conversationDialog'), null);
  assert.equal(h.window.location.hash, '#/projects/app');
});

test('environment switching isolates identical conversation IDs and rejects late responses', async t => {
  const h = await harness(t, false);
  h.environments.environments.push({ id: 'remote', name: 'Remote' });
  await h.window.loadEnvironments();
  let release;
  h.setIntercept((url, options) => {
    if (!url.startsWith('/api/sessions?')) return;
    if (options.headers['X-Environment-ID'] === 'local') return new Promise(resolve => { release = resolve; });
    return { ok: true, json: async () => ({ sessions: [{ id: 'session-1', name: 'Remote conversation', cwd: '/remote' }] }) };
  });
  await h.navigate('/sessions');
  const old = release;
  await h.window.selectEnvironment('remote', '/sessions'); await settle();
  assert.equal(h.$('[data-conversation-session]').textContent.includes('Remote conversation'), true);
  old({ ok: true, json: async () => ({ sessions: [{ id: 'session-1', name: 'Late local conversation', cwd: '/local' }] }) }); await settle();
  assert.equal(h.$('[data-conversation-session]').textContent.includes('Remote conversation'), true);
  assert.equal(h.$('#sessionsEnvironment').value, '');
  assert(h.requests.some(r => r.url.startsWith('/api/sessions?') && r.options.headers['X-Environment-ID'] === 'remote'));
});

test('a narrow list does not mark hidden conversation details as read', async t => {
  const h = await harness(t);
  await h.openConversations('project'); await h.leaveConversations();
  h.sessions[0].completed_run = 'unread-mobile'; await h.window.refreshConversations(true);
  h.$('#sessionBrowser').getBoundingClientRect = () => ({ width: 360 });
  await h.openConversations('project');
  assert.equal(h.$('#sessionBrowser').dataset.pane, 'list');
  assert.equal(h.$('#sessionNavigationStatus').textContent, '有新消息');
  h.click('[data-conversation-session="session-1"]');
  assert.equal(h.$('#sessionBrowser').dataset.pane, 'detail'); assert.equal(h.$('#sessionNavigationStatus').textContent, '');
});

test('list loading failures distinguish an unreadable scope from an empty directory and recover on retry', async t => {
  const h = await harness(t);
  let release;
  h.setIntercept(url => url.startsWith('/api/sessions?') ? new Promise(resolve => { release = resolve; }) : undefined);
  await h.openConversations('project');
  assert.match(h.$('#sessionBrowserEmpty').textContent, /正在读取/);
  release({ ok: false, json: async () => ({ error: 'fixture offline' }) }); await settle();
  assert.equal(h.$('#sessionBrowserError').hidden, false);
  assert.match(h.$('#sessionBrowserEmpty').textContent, /暂时无法读取/);
  h.setIntercept(null); h.click('[data-conversation-action="refresh"]'); await settle();
  assert.equal(h.$('#sessionBrowserError').hidden, true);
  assert(h.$('[data-conversation-session="session-1"]'));
});

test('project refresh never silently widens a saved directory filter while worktrees are unavailable', async t => {
  const h = await harness(t);
  await h.navigate('/projects'); h.click('[data-action="select-project"][data-id="app"]');
  await h.openConversations('project');
  h.window.setConversationDirectory('/workspace/workspace/app'); await settle();
  h.data.projects[0].worktrees = [];
  await h.window.refresh(true);
  assert.equal(h.window.WorkHubConversations.current.directory, '/workspace/workspace/app');
  assert.equal(h.$('#sessionDirectoryFilter'), null);
  assert.match(h.$('#sessionActiveFilterLabel').title, /workspace\/workspace\/app/);
  await h.window.refreshConversations(true);
  assert.equal(h.window.WorkHubConversations.current.directory, '/workspace/workspace/app');
  assert(h.requests.filter(r => r.url.startsWith('/api/sessions?')).at(-1).url.includes('cwd=%2Fworkspace%2Fworkspace%2Fapp'));
});

test('conversation pinning sorts the shared list and the archive filter uses its own query',async t=>{
 const h=await harness(t);
 h.sessions.push({id:'pinned',name:'Pinned conversation',cwd:'/workspace/workspace/app',updated_at:1,pinned:true});
 await h.navigate('/sessions');
 assert.equal(h.$('[data-conversation-session]').dataset.conversationSession,'pinned');
 h.setIntercept(url=>url.startsWith('/api/sessions?')&&url.includes('archived=true')?{ok:true,json:async()=>({sessions:[{id:'archive',name:'Archived conversation',cwd:'/workspace/workspace/app',archived:true}]})}:undefined);
 h.$('#sessionBrowserArchived').checked=true;h.$('#sessionBrowserArchived').dispatchEvent(new h.window.Event('change',{bubbles:true}));await settle();
 assert.equal(h.$('[data-conversation-session]').dataset.conversationSession,'archive');
 assert(h.requests.some(r=>r.url.includes('archived=true')));
});

test('session organization events update the same browser without reopening another environment',async t=>{
 const h=await harness(t);await h.navigate('/sessions');
 const notify=(session,action,environment='local')=>h.window.dispatchEvent(new h.window.CustomEvent('workhub:session-managed',{detail:{session,action,environment}}));
 notify({...h.sessions[0],name:'Renamed',pinned:true},'rename');
 assert.match(h.$('[data-conversation-session="session-1"]').textContent,/Renamed/);
 notify({...h.sessions[0],name:'Wrong environment'},'rename','remote');
 assert.doesNotMatch(h.$('#sessionBrowserList').textContent,/Wrong environment/);
 notify({id:'fork',name:'Forked conversation',cwd:'/workspace/workspace/app'},'fork');
 assert.equal(h.currentSession().session,'fork');
 notify({id:'fork',name:'Forked conversation',cwd:'/workspace/workspace/app',archived:true},'archive');
 assert.equal(h.$('[data-conversation-session="fork"]'),null);
});

test('conversation filters default to all environments and expose optional filtering when needed', async t => {
  const h = await harness(t);
  await h.navigate('/sessions');
  assert(h.$('#sessionBrowserScopeBar').closest('.session-browser-list'));
  assert.equal(h.$('#sessionEnvironmentField').hidden, true);
  assert.equal(h.$('#sessionsEnvironment').value, '');
  h.environments.environments.push({id: 'wsl-test', name: 'Ubuntu'});
  await h.window.loadEnvironments(); await settle();
  assert.equal(h.$('#sessionEnvironmentField').hidden, false);
  assert.equal(h.$('#sessionsEnvironment').options.length, 3);
  h.environments.environments.pop();
  await h.window.loadEnvironments(); await settle();
  assert.equal(h.$('#sessionEnvironmentField').hidden, true);
});

test('conversation list omits shared context and retains active counts and refreshed titles', async t => {
  const h = await harness(t, false);
  let updated;
  h.window.WorkHubAssistant = {open() {}, close() {}, updateSession(session) {updated = session;}};
  h.sessions[0].chat_status = 'running';
  await h.openConversations('project');
  assert.match(h.$('#sessionBrowserContext').textContent, /项目 · App · 本机/);
  assert.match(h.$('#sessionBrowserCount').getAttribute('aria-label'), /1 个运行中/);
  assert.equal(h.$('[data-conversation-session="session-1"] .session-browser-item-context'), null);
  assert.equal(h.$('.session-browser-item-workspace'), null);
  assert.equal(h.$('.session-browser-item-directory'), null);
  assert.equal(h.$('#sessionBrowserList [data-conversation-unlink]'), null);
  h.sessions[0].name = 'Codex generated title';
  await h.window.refreshConversations(true); await settle();
  assert.equal(updated.name, 'Codex generated title');
  assert.match(h.$('[data-conversation-session="session-1"]').textContent, /Codex generated title/);
});

test('shared project navigation restores the same toolbar after conversations and settings', async t => {
  const h = await harness(t, true, {route:'/projects'});
  const toolbar = h.$('#panelToolbar');
  const search = h.$('#search');
  const errors = [];
  h.window.addEventListener('error', event => errors.push(event.error));
  for (const route of ['/sessions', '/settings', '/projects']) {
    await h.navigate(route);
    await h.navigate('/projects');
    assert.equal(h.$('#projectListPane #panelToolbar'), toolbar);
    assert.equal(h.$('#projectListPane #search'), search);
    assert(h.$('#projectListPane .project-filters'));
  }
  assert.deepEqual(errors, []);
});

test('browser navigation uses the shared rail and ignores old expandable sidebar preferences', async t => {
  const h = await harness(t, true, {width:1440, storage:{'workhub:sidebar-collapsed:v1':'false','workhub:sidebar-width:v1':'360'}});
  const route = h.window.location.hash;
  assert(h.document.documentElement.hasAttribute('data-workhub-desktop'));
  assert(!h.document.documentElement.hasAttribute('data-workhub-platform'));
  assert.equal(h.$('.sidebar-toggle, .sidebar-resize'), null);
  assert.equal(h.document.body.classList.contains('sidebar-collapsed'), false);
  h.window.localStorage.setItem('workhub:sidebar-collapsed:v1', 'true');
  h.window.dispatchEvent(new h.window.StorageEvent('storage', {key:'workhub:sidebar-collapsed:v1'}));
  h.window.dispatchEvent(new h.window.Event('workhub:sidebar-sync'));
  await settle();
  assert.equal(h.$('.sidebar-toggle, .sidebar-resize'), null);
  assert.equal(h.document.body.style.getPropertyValue('--sidebar-width'), '');
  assert.equal(h.window.location.hash, route);
});

test('compact conversation filters expose active choices, clear together and settings live beside refresh', async t => {
  const h = await harness(t);
  await h.navigate('/sessions');
  assert.equal(h.$('.sidebar-guide'), null);
  assert.equal(h.$('.sidebar nav [data-view="settings"]'), null);
  assert(h.$('.sidebar-footer-actions #refreshControl + [data-view="settings"]'));
  assert(h.$('#sessionScopeAll').closest('#sessionScopePicker'));
  assert.equal(h.$('#sessionFilterPicker'), null);
  assert.equal(h.$('#sessionDirectoryFilter'), null);
  assert(h.$('#sessionBrowserArchived').closest('#sessionScopePicker'));
  assert(h.$('#sessionsEnvironment').closest('#sessionScopePicker'));
  assert(h.$('#sessionStatusFilters').closest('#sessionScopePicker'));
  assert(h.$('#sessionBrowserCount').classList.contains('sr-only'));
  assert.equal(h.$('.session-browser-list-heading'), null);
  assert.equal(h.$('#sessionBrowserCount').textContent, '1');
  assert.equal(h.$('.session-browser-list-heading [data-conversation-action="refresh"]'), null);
  assert.equal(h.$('.session-browser-list-caption'), null);
  assert.equal(h.$('#sessionScopePicker').parentElement, h.$('#sessionBrowserSearch').closest('.list-search'));
  assert.equal(h.$('#sessionBrowserScopeBar').firstElementChild, h.$('#sessionBrowserSearch').parentElement);
  assert.equal(h.$('#sessionBrowserScopeBar').lastElementChild, h.$('#newBrowserSession').parentElement);
  assert(h.$('#sessionScopeLabel').classList.contains('sr-only'));
  assert.equal(h.$('#sessionScopePicker summary').querySelectorAll('svg').length, 1);
  assert(h.$('#newBrowserSession').closest('#sessionBrowserScopeBar'));
  assert.equal(h.$('#newBrowserSession').closest('#sessionScopePicker'), null);
  assert.equal(h.$('#pinConversationDirectory'), null);
  h.window.setConversationDirectory('/workspace/workspace/app'); await settle();
  h.click('#sessionBrowserArchived'); await settle();
  assert.equal(h.$('#sessionClearFilters').hidden, false);
  assert.match(h.$('#sessionActiveFilterLabel').textContent, /app.*已归档/);
  h.click('#sessionClearFilters'); await settle();
  assert.equal(h.window.WorkHubConversations.current.directory, '');
  assert.equal(h.$('#sessionBrowserArchived').checked, false);
  assert.equal(h.$('#sessionClearFilters').hidden, true);
  h.$('#sessionScopePicker').open = true;
  h.$('#sessionBrowserArchived').focus();
  h.$('#sessionBrowserArchived').dispatchEvent(new h.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true, cancelable:true}));
  assert.equal(h.$('#sessionScopePicker').open, false);
  assert.equal(h.document.activeElement, h.$('#sessionScopePicker summary'));
  const settingsChanged = new Promise(resolve => h.window.addEventListener('hashchange', resolve, {once:true}));
  h.click('.sidebar-settings'); await settingsChanged; await settle();
  assert.equal(h.window.location.hash, '#/settings');
  assert.equal(h.$('#settingsPage').hidden, false);
});

test('a late conversation catalog response cannot replace a fresh list after switching environments and back', async t => {
  const h = await harness(t);
  let release;
  h.setIntercept(url => /^\/api\/sessions\?(?:refresh=1)?$/.test(url) ? new Promise(resolve => {release = resolve;}) : undefined);
  const pending = h.window.refreshConversationCatalog(true); await settle();
  h.setIntercept((url, options) => /^\/api\/sessions\?(?:refresh=1)?$/.test(url) ? {ok:true, json:async()=>({sessions:[{id:'session-1', name:options.headers['X-Environment-ID'] === 'wsl-test' ? 'Remote' : 'Fresh local', cwd:'/repo/app', pinned:true}]})} : undefined);
  await h.window.selectEnvironment('wsl-test', '/projects'); await settle();
  await h.window.selectEnvironment('local', '/projects'); await settle();
  assert.match(h.window.eval('conversationItems()[0].name'), /Fresh local/);
  release({ok:true, json:async()=>({sessions:[{id:'session-1', name:'Stale local', cwd:'/repo/app', pinned:true}]})});
  await pending; await settle();
  assert.match(h.window.eval('conversationItems()[0].name'), /Fresh local/);
  assert.doesNotMatch(h.window.eval('conversationItems()[0].name'), /Stale local/);
});

test('project filters retain selection, distinguish directory changes and recover from empty results', async t => {
  const h = await harness(t);
  h.data.projects[0].worktrees[1].dirty = 3;
  h.data.projects[1].error = 'Repository unavailable';
  await h.navigate('/projects');
  await h.window.refresh(true);
  assert.equal(h.document.querySelectorAll('.project-list-item').length, 2);
  assert.equal(h.$('.project-list-item [data-action]'), null);
  assert.equal(h.$('.page-heading'),null);
  assert.equal(h.$('#stats'),null);
  assert(h.$('#panelToolbar [data-action="new-project"]'));
  h.click('[data-action="project-filter"][data-filter="dirty"]');
  assert.equal(h.document.querySelectorAll('.project-list-item').length, 1);
  assert.equal(h.$('.project-list-item').dataset.id, 'app');
  assert.equal(h.$('#projectDetail').hidden, true);
  h.click('[data-action="select-project"][data-id="app"]');
  assert.equal(h.$('.project-workspace').dataset.pane, 'detail');
  assert.match(h.$('#projectDetail').textContent, /有改动 3/);
  assert.equal(h.$('#projectDetail h2').textContent, 'App');
  h.click('[data-action="project-list"]');
  assert.equal(h.$('.project-workspace').dataset.pane, 'list');
  assert.equal(h.document.activeElement, h.$('.project-list-item'));
  h.click('[data-action="project-filter"][data-filter="error"]');
  assert.equal(h.$('.project-list-item').dataset.id, 'backend');
  h.click('[data-action="select-project"][data-id="backend"]');
  assert.match(h.$('#projectDetail').textContent, /Repository unavailable/);
  assert.equal(h.$('[data-action="new-worktree"]').disabled, true);
  h.click('[data-action="project-list"]');
  h.input('#search', 'no match');
  assert.match(h.$('.project-list-empty').textContent, /没有匹配的项目/);
  h.click('.project-list-empty [data-action="project-filter"]');
  assert.equal(h.$('[data-filter="all"]').getAttribute('aria-pressed'), 'true');
  h.input('#search', '');
  assert.equal(h.document.querySelectorAll('.project-list-item').length, 2);
});

test('project directory controls retain the exact worktree and compact zero-value Git details', async t => {
  const h = await harness(t);
  const tree = h.data.projects[0].worktrees[1];
  Object.assign(tree, { upstream: 'origin/feature/workspace', sync_available: true, sync_ahead: 0, sync_behind: 0, compare_available: true, comparison_ref: 'main', ahead: 0, behind: 0 });
  await h.navigate('/projects/app');
  await h.window.refresh(true);
  const row = h.$('[data-action="git-open"][data-path="/workspace/workspace/app"]').closest('article');
  assert.equal(row.querySelector('.directory-sync-summary').textContent, 'origin/feature/workspace↑0↓0');
  assert.equal(row.querySelector('.directory-sync-counts').getAttribute('aria-label'), '待推送 0 个提交，待拉取 0 个提交');
  assert.equal(row.querySelector('.directory-local-status').textContent, '干净');
  assert.equal(row.querySelector('.directory-card-expanded').hidden, true);
  const rowSelector = '[data-directory-path="/workspace/workspace/app"]';
  h.click(rowSelector + ' [data-action="project-directory-toggle"]');
  h.click(rowSelector + ' [data-section="git"]');
  assert.match(h.$(rowSelector + ' .directory-detail-content').textContent, /与基线一致/);
  h.click('[data-action="git-open"][data-path="/workspace/workspace/app"]'); await settle();
  assert.equal(h.$('#gitWorktree').value, '/workspace/workspace/app');
  h.$('#gitDialog').close();
  h.click('[data-project-open-primary][data-path="/workspace/workspace/app"]'); await settle();
  assert.deepEqual(h.requests.filter(r => r.url === '/api/projects/app/open').at(-1).body, { tool: 'vscode', path: '/workspace/workspace/app' });
  Object.assign(tree, {sync_ahead:2, sync_behind:3});
  await h.window.refresh();
  const updatedRow = () => h.$('[data-directory-path="/workspace/workspace/app"]');
  assert.equal(updatedRow().querySelector('.directory-sync-counts').textContent, '↑2↓3');
  assert.match(updatedRow().querySelector('.directory-sync-counts').title, /已分歧/);
  assert.equal(updatedRow().querySelector('.directory-local-status').textContent, '已提交');
  assert.equal(updatedRow().querySelector('.directory-local-status > span').title, '已有 2 个提交待推送');
  assert.equal(updatedRow().querySelector('.project-linked-workspaces'),null);
  tree.dirty = 1;
  await h.window.refresh();
  assert.equal(updatedRow().querySelector('.directory-local-status').textContent, '有改动 1已提交');
  assert.equal(updatedRow().querySelector('.directory-changes-link').dataset.path, tree.path);
  tree.sync_available = false;
  await h.window.refresh();
  assert.equal(updatedRow().querySelector('.directory-sync-counts'), null);
  assert.match(updatedRow().querySelector('.directory-sync-summary').textContent, /暂不可用/);
  assert.equal(updatedRow().querySelector('.directory-local-status').textContent, '有改动 1');
});

test('project detail cards retain expansion and isolate Git and conversation activity by path', async t => {
  const h = await harness(t);
  const [main, worktree] = h.data.projects[0].worktrees;
  const detached = {...worktree, path:'/repo/detached', branch:'', detached:true, sync_available:true, sync_ahead:4};
  const awaitingPush = {...worktree, path:'/repo/awaiting-push', upstream:'origin/main', sync_available:true, sync_ahead:1, dirty:4, changes:{added:2,modified:1,deleted:1}};
  h.data.projects[0].worktrees = [detached, worktree, awaitingPush, main];
  h.sessions.push({id:'secondary', name:'Additional directory', cwd:'/unrelated', project_directories:[main.path, detached.path], updated_at:1792735201, available:true});
  await h.navigate('/projects/app');
  await h.window.refresh(true);
  await h.window.refreshProjectConversations(true);
  await settle();
  const cards = () => [...h.document.querySelectorAll('#projectDetail [data-directory-path]')].map(row => row.dataset.directoryPath);
  const card = path => `[data-directory-path="${path}"]`;
  assert.deepEqual(cards(), [main.path, detached.path, worktree.path, awaitingPush.path]);
  assert.equal(h.$('[data-primary-directory]').dataset.directoryPath, main.path);
  h.change('[data-project-directory-sort]', 'changes');
  assert.deepEqual(cards().slice(0, 2), [main.path, awaitingPush.path]);
  h.change('[data-project-directory-filter]', 'dirty');
  assert.deepEqual(cards(), [awaitingPush.path]);
  h.click(card(awaitingPush.path) + ' [data-action="project-directory-toggle"]');
  assert.deepEqual([...h.document.querySelectorAll('.directory-change-legend span')].map(label => label.textContent), ['修改 1', '新增 2', '删除 1']);
  h.change('[data-project-directory-filter]', 'active');
  assert(!cards().includes(awaitingPush.path));
  h.click(card(detached.path) + ' .directory-session-count');
  assert.equal(h.$(card(detached.path) + ' .project-conversation-row').dataset.session, 'secondary');
  h.click('[data-action="project-directory-expand-all"]');
  assert([...h.document.querySelectorAll('.directory-card-expanded')].every(panel => !panel.hidden));
  h.click('[data-action="project-directory-expand-all"]');
  assert([...h.document.querySelectorAll('.directory-card-expanded')].every(panel => panel.hidden));
  await h.navigate('/projects/app?directory=' + encodeURIComponent(awaitingPush.path));
  assert.deepEqual(cards().slice(0, 2), [main.path, awaitingPush.path]);
  assert.equal(h.document.activeElement.dataset.directoryPath, awaitingPush.path);
  h.click(card(awaitingPush.path) + ' [data-action="project-commit-plan"]');
  assert.equal(h.$('#changesCommitPlan').hidden, false);
  assert.match(h.$('#changesPlanContext').textContent, /awaiting-push/);
  h.click('#returnToChanges');
  assert.equal(h.$('#changesBrowser').hidden, false);
  assert.equal(h.$('#changesCommitPlan').hidden, true);
  h.$('#changesDialog').close();
});

test('project detail disambiguates duplicate worktree names, defaults clean primary cards to sessions and toggles dirty filter from summary', async t => {
  const h = await harness(t);
  const [main, worktree] = h.data.projects[0].worktrees;
  main.dirty = 0;
  worktree.dirty = 2;
  const releaseAgent = {...worktree, path:'/tmp/noah-release/agent', branch:'', head:'a1b2c3d4e5f6', detached:true, dirty:0, upstream:''};
  const reviewAgent = {...worktree, path:'/project/noah-review/agent', branch:'', head:'f6e5d4c3b2a1', detached:true, dirty:0, upstream:''};
  h.data.projects[0].worktrees = [main, worktree, releaseAgent, reviewAgent];
  h.sessions.push(
    ...Array.from({length: 6}, (_, index) => ({
      id: `main-extra-${index}`, name: `Main task ${index}`, cwd: main.path, updated_at: 1792735210 + index, available: true,
    })),
  );
  await h.navigate('/projects/app');
  await h.window.refresh(true);
  await h.window.refreshProjectConversations(true);
  await settle();
  const card = path => h.$(`[data-directory-path="${path}"]`);
  assert.equal(card(releaseAgent.path).querySelector('h4').textContent, 'noah-release/agent');
  assert.equal(card(reviewAgent.path).querySelector('h4').textContent, 'noah-review/agent');
  assert.equal(card(releaseAgent.path).querySelector('.branch').textContent, 'detached @ a1b2c3d');
  assert.equal(card(releaseAgent.path).querySelector('.directory-card-row .directory-sync'), null);
  assert.equal(card(releaseAgent.path).dataset.idleDirectory, 'true');
  assert.equal(card(main.path).querySelector('.directory-sections [data-section="sessions"]').getAttribute('aria-pressed'), 'true');
  assert.equal(card(main.path).querySelectorAll('.directory-section-content .project-conversation-row').length, 5);
  assert.match(card(main.path).querySelector('.directory-sessions-footer').textContent, /查看全部 \d+ 条关联对话/);
  h.click('.project-detail-summary [data-action="project-directory-filter"][data-filter="dirty"]');
  assert.deepEqual([...h.document.querySelectorAll('#projectDetail [data-directory-path]')].map(node => node.dataset.directoryPath), [worktree.path]);
  h.click('.project-detail-summary [data-action="project-directory-filter"][data-filter="dirty"]');
  assert.equal(h.document.querySelectorAll('#projectDetail [data-directory-path]').length, 4);
});

test('empty search states offer a direct reset without confusing an empty project with a pending scan', async t => {
  const h = await harness(t);
  await h.navigate('/projects');
  h.input('#search', 'not-found');
  await h.navigate('/projects');
  h.input('#search', 'not-found');
  h.click('[data-action="clear-project-search"]');
  assert.equal(h.$('#search').value, '');
  assert.equal(h.document.querySelectorAll('.project-list-item').length, 2);
  await h.navigate('/projects/app');
  h.data.projects[0].worktrees = [];
  h.data.projects[0].refreshing = false;
  await h.window.refresh();
  assert.match(h.$('.project-detail-empty').textContent, /尚未发现工作目录/);
  assert(h.$('.project-detail-empty [data-action="project-refresh"]'));
  h.data.projects[0].refreshing = true;
  h.data.projects[0].status_updated_at = '';
  await h.window.refresh();
  assert.match(h.$('.project-detail-empty').textContent, /正在发现工作目录/);
});

test('sidebar refresh status stays compact and retains its detailed explanation', async t => {
  const h = await harness(t);
  h.data.status_refreshing = true;
  await h.window.refresh();
  assert.equal(h.$('#syncText').textContent, '更新中…');
  assert.match(h.$('#syncText').title, /当前显示最近结果/);
  assert.equal(h.$('#syncDot').classList.contains('updating'), true);
  h.data.status_refreshing = false;
  await h.window.refresh();
  assert.equal(h.$('#syncText').textContent, '已更新');
  assert.equal(h.$('#syncDot').classList.contains('updating'), false);
});

test('the independent project list restores search, scroll and focus after opening a detail', async t => {
  const h = await harness(t, true, {width:1440, route:'/projects'});
  h.data.projects[0].worktrees[1].dirty = 3;
  await h.window.refresh();
  assert.equal(h.$('.project-change-indicator').textContent, '1 个目录有改动');
  h.input('#search', 'App');
  h.$('.project-list-scroll').scrollTop = 170;
  h.click('[data-action="select-project"][data-id="app"]');
  assert.equal(h.$('#projectListPane').hidden, true);
  assert.equal(h.$('#projectDetail').hidden, false);
  assert.equal(h.document.activeElement, h.$('#projectDetail h2'));
  h.click('[data-action="project-list"]');
  assert.equal(h.$('#projectListPane').hidden, false);
  assert.equal(h.$('#projectDetail').hidden, true);
  assert.equal(h.$('#search').value, 'App');
  assert.equal(h.$('.project-list-scroll').scrollTop, 170);
  assert.equal(h.document.activeElement.dataset.id, 'app');
});

for (const desktop of [false, true]) test(`the ${desktop ? 'desktop' : 'browser'} default-directory draft can switch to the terminal launcher`, async t => {
  const host = pageHost(t), h = await harness(t, false, {pageHost:host.window, desktop});
  h.window.dispatchEvent(new h.window.MessageEvent('message', {source:host.window, origin:'http://localhost:4317', data:{type:'workhub:page-restore', active:true, snapshot:{route:'/sessions', environment:'local', conversation:{scope:{kind:'all'}, creating:true, selected:null, pane:'detail'}}}}));
  await settle(); await settle();
  assert.equal(h.$('#sessionBrowserNewDirectory').value, '');
  const terminal = h.$('[data-conversation-kind="terminal"]');
  assert.equal(terminal.disabled, false, 'the default directory does not prevent switching forms');
  h.input('#sessionChatInput', 'Keep the default-directory draft');
  terminal.focus(); terminal.click();
  const switched = host.messages.findLast(message => message.type === 'workhub:conversation-kind');
  assert.equal(switched.kind, 'terminal');
  assert.equal(switched.snapshot.environment, 'local');
  assert.equal(switched.snapshot.conversation.creationDirectory, '');
  assert.equal(switched.snapshot.terminal.cwd, undefined);
  assert.equal(h.$('#sessionChatInput').value, 'Keep the default-directory draft');
  assert.equal(h.requests.some(request => request.options.method === 'POST' && /\/chat$|\/terminals$/.test(request.url)), false);
  h.currentSession().submitting = true;
  h.window.renderConversationBrowser();
  assert.equal(terminal.disabled, true, 'a pending send still prevents switching');
  h.currentSession().submitting = false;
  h.window.WorkHubConversations.current.targetEnvironment = 'remote';
  h.window.renderConversationBrowser();
  assert.equal(terminal.disabled, true, 'remote environments still prevent switching');
  assert.match(terminal.title, /仅支持本机/);
});

test('new conversation page exposes inline form switching only while creating and keeps the selected directory', async t => {
  const host=pageHost(t), h=await harness(t,false,{pageHost:host.window});
  const post=snapshot=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data:{type:'workhub:page-restore',active:true,snapshot}}));
  post({route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'app'},creating:true,selected:null,pane:'detail'}});
  await settle(); await settle();
  assert.equal(h.$('#conversationCreationKind').hidden,false);
  assert.equal(h.document.querySelector('[role="dialog"]')?.textContent.includes('选择交互形式') || false,false);
  h.change('#sessionBrowserNewDirectory','/repo/app'); await settle();
  h.input('#sessionChatInput','保留我的草稿');
  h.click('[data-conversation-kind="terminal"]'); await settle();
  const switched=host.messages.findLast(message=>message.type==='workhub:conversation-kind');
  assert.equal(switched.kind,'terminal');
  assert.equal(switched.snapshot.terminal.cwd,'/repo/app');
  assert.equal(switched.snapshot.terminal.projectID,'app');
  assert.equal(switched.snapshot.conversation.creationDirectory,'/repo/app');
  assert.equal(switched.snapshot.conversation.directory,'', 'changing forms preserves the list filter independently of the draft directory');
  assert.equal(h.$('#sessionChatInput').value,'保留我的草稿');
  assert.equal(h.requests.some(request=>request.options.method==='POST' && /\/chat$|\/terminals$/.test(request.url)),false);
  post({route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'app'},selected:'session-1',pane:'detail'}});
  await settle(); await settle();
  assert.equal(h.$('#conversationCreationKind').hidden,true);
});

test('one click opens a ready composer, remembers directory per scope and restores an explicit draft directory', async t => {
  const host = pageHost(t), h = await harness(t, false, {pageHost:host.window});
  const post = conversation => h.window.dispatchEvent(new h.window.MessageEvent('message', {source:host.window, origin:'http://localhost:4317', data:{type:'workhub:page-restore', active:true, snapshot:{route:'/sessions', environment:'local', conversation}}}));
  post({scope:{kind:'project', id:'app'}, creating:true, selected:null});
  await settle(); await settle();
  assert.equal(h.currentSession().target.cwd, '/repo/app');
  assert.equal(h.$('#sessionHistoryPanel').hidden, false);
  assert.equal(h.$('#sessionBrowserNewDirectory').hidden, true);
  h.click('#sessionBrowserDirectoryChoices [data-creation-choice="/repo/app"]'); await settle();
  assert.equal(h.$('#sessionBrowserDirectoryChoices [aria-pressed="true"]').dataset.creationChoice, '/repo/app');
  const saved = h.window.WorkHubPage.snapshot().conversation;
  assert.equal(saved.creationDirectory, '/repo/app');
  post({scope:{kind:'project', id:'app'}, creating:true, selected:null});
  await settle(); await settle();
  assert.equal(h.currentSession().target.cwd, '/repo/app', 'a new draft remembers the last valid directory');
  post({scope:{kind:'project', id:'backend'}, creating:true, selected:null});
  await settle(); await settle();
  assert.equal(h.currentSession().target.cwd, '/repo/backend', 'another scope does not inherit the workspace directory');
  post({...saved, creationDirectory:'/missing'});
  await settle(); await settle();
  assert.equal(h.currentSession().target.cwd, '/repo/app', 'a removed directory falls back to a valid choice');
  post({...saved, creationDirectory:'/repo/app'});
  await settle(); await settle();
  assert.equal(h.currentSession().target.cwd, '/repo/app', 'an explicit draft overrides remembered preferences');
  assert.equal(h.requests.some(r => r.url === '/api/sessions/new'), false, 'opening a composer does not send a message');
});

test('conversation groups identify environments and duplicate IDs open in their own environment without switching', async t => {
  const h = await harness(t, false);
  h.environments.environments.push({id: 'remote', name: 'WSL · Ubuntu'});
  await h.window.loadEnvironments();
  h.setIntercept((url, options) => {
    if (url.startsWith('/api/sessions?') && options.headers['X-Environment-ID'] === 'remote') return {ok: true, json: async () => ({sessions: [{...h.sessions[0], name: 'WSL review'}]})};
  });
  await h.navigate('/sessions');
  const entries = [...h.document.querySelectorAll('[data-conversation-session]')];
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].dataset.conversationSession, entries[1].dataset.conversationSession);
  assert.match(h.$('[data-conversation-session][data-environment="local"]').closest('.session-browser-group').getAttribute('aria-label'), /本机/);
  assert.match(h.$('[data-conversation-session][data-environment="remote"]').closest('.session-browser-group').getAttribute('aria-label'), /WSL · Ubuntu/);
  h.click('[data-conversation-session][data-environment="remote"]'); await settle();
  assert.equal(h.currentSession().environment, 'remote');
  assert.equal(h.currentSession().session, 'session-1');
  assert.equal(h.$('#projectEnvironment').value, 'local');
  assert.equal(h.window.location.search, '');
  assert(h.requests.some(r => r.url.endsWith('/history') && r.options.headers['X-Environment-ID'] === 'remote'));
  h.input('#sessionChatInput', 'continue remotely'); await h.submit('#sessionChatForm');
  assert(h.requests.some(r => r.url.endsWith('/chat') && r.options.method === 'POST' && r.options.headers['X-Environment-ID'] === 'remote'));
  h.change('#sessionsEnvironment', 'remote'); await settle();
  assert.equal(h.document.querySelectorAll('[data-conversation-session]').length, 1);
  assert.equal(h.$('[data-conversation-session]').dataset.environment, 'remote');
  assert.equal(h.$('#projectEnvironment').value, 'local');
  h.click('[data-conversation-action="clear-filters"]'); await settle();
  assert.equal(h.$('#sessionsEnvironment').value, '');
  assert.equal(h.document.querySelectorAll('[data-conversation-session]').length, 2);
});

test('environment filtering rejects late results and a failed environment retains successful results', async t => {
  const h = await harness(t);
  h.environments.environments.push({id: 'remote', name: 'WSL'});
  await h.window.loadEnvironments();
  const pending = [];
  h.setIntercept((url, options) => {
    if (url.startsWith('/api/sessions?') && options.headers['X-Environment-ID'] === 'remote') return new Promise(resolve => pending.push(resolve));
  });
  await h.navigate('/sessions');
  assert(h.$('[data-conversation-session][data-environment="local"]'));
  h.change('#sessionsEnvironment', 'local'); await settle();
  for (const resolve of pending) resolve({ok: true, json: async () => ({sessions: [{id: 'late', name: 'Late remote', cwd: '/remote'}]})});
  await settle();
  assert.doesNotMatch(h.$('#sessionBrowserList').textContent, /Late remote/);
  h.setIntercept((url, options) => url.startsWith('/api/sessions?') && options.headers['X-Environment-ID'] === 'remote' ? {ok: false, json: async () => ({error: 'offline fixture'})} : undefined);
  h.change('#sessionsEnvironment', ''); await settle();
  assert(h.$('[data-conversation-session][data-environment="local"]'));
  assert.match(h.$('#sessionBrowserError').textContent, /WSL.*offline fixture/);
  h.setIntercept(null); h.click('[data-conversation-action="refresh"]'); await settle();
  assert.equal(h.$('#sessionBrowserError').hidden, true);
});

test('cross-environment scopes and creation targets preserve ownership without changing project environment', async t => {
  const h = await harness(t, false);
  h.environments.environments.push({id: 'remote', name: 'WSL'});
  const remoteData = {...h.data,projects:h.data.projects.map(project => ({...project, name:project.id === 'app' ? 'Remote project' : project.name}))};
  h.setIntercept((url, options) => {
    if (url === '/api/state' && options.headers['X-Environment-ID'] === 'remote') return {ok: true, json: async () => remoteData};
    if (url.startsWith('/api/sessions?') && options.headers['X-Environment-ID'] === 'remote') return {ok: true, json: async () => ({sessions: [{id: 'remote-session', name: 'Remote workspace session', cwd: '/repo/app'}]})};
  });
  await h.window.loadEnvironments(); await h.window.refresh(true); await h.navigate('/sessions');
  h.input('#sessionScopeSearch', 'Remote project');
  const scope = h.$('[data-conversation-scope]');
  assert.equal(JSON.parse(scope.dataset.conversationScope).environment, 'remote');
  scope.click(); await settle();
  assert.equal(h.currentSession().environment, 'remote');
  h.click('#newBrowserSession'); await settle();
  const choices = [...h.$('#sessionBrowserNewDirectory').options];
  assert.equal(h.$('#sessionBrowserNewDirectory').value, '');
  const remoteWorktree = choices.find(o => o.value.includes('/repo/app') && o.textContent.includes('WSL'));
  assert(remoteWorktree);
  h.change('#sessionBrowserNewDirectory', remoteWorktree.value); await settle();
  assert.equal(h.currentSession().environment, 'remote');
  assert.equal(h.$('#projectEnvironment').value, 'local');
  assert.equal(h.window.WorkHubConversations.current.targetEnvironment,'remote');
});

test('cross-environment assistant callbacks and read markers remain isolated for the same session ID', async t => {
  const h = await harness(t, false);
  h.environments.environments.push({id: 'remote', name: 'WSL'});
  await h.window.loadEnvironments();
  let opened;
  h.window.WorkHubAssistant = {open(options) {opened = options;}, close() {}, updateSession() {}};
  h.setIntercept((url, options) => url.startsWith('/api/sessions?') && options.headers['X-Environment-ID'] === 'remote' ? {ok: true, json: async () => ({sessions: [{...h.sessions[0], name: 'Remote duplicate'}]})} : undefined);
  await h.navigate('/sessions');
  h.click('[data-conversation-session][data-environment="remote"]'); await settle();
  assert.equal(opened.environment, 'remote');
  await opened.request('/api/sessions/session-1/chat', {method: 'POST', body: '{}'});
  assert.equal(h.requests.at(-1).options.headers['X-Environment-ID'], 'remote');
  opened.managed({...h.sessions[0], name: 'Remote renamed'}, 'rename');
  assert.match(h.$('[data-conversation-session][data-environment="remote"]').textContent, /Remote renamed/);
  assert.doesNotMatch(h.$('[data-conversation-session][data-environment="local"]').textContent, /Remote renamed/);
  const localKey = 'workhub:session-read:' + JSON.stringify(['local', 'session-1']);
  const remoteKey = 'workhub:session-read:' + JSON.stringify(['remote', 'session-1']);
  assert(h.window.localStorage.getItem(localKey));
  assert(h.window.localStorage.getItem(remoteKey));
  const localRead = h.window.localStorage.getItem(localKey);
  opened.activity('session-1', {id: 'remote-run', status: 'completed', busy: false, turn_id: 'remote-turn'});
  assert.equal(h.window.localStorage.getItem(localKey), localRead);
  assert.equal(h.$('[data-conversation-session][data-environment="local"] .session-browser-unread-dot'), null);
});


test('polling keeps the selected remote conversation while another environment responds first', async t => {
  const h = await harness(t);
  h.environments.environments.push({id: 'remote', name: 'WSL'});
  await h.window.loadEnvironments();
  let delay = false;
  const pending = [];
  h.setIntercept((url, options) => {
    if (!url.startsWith('/api/sessions?') || options.headers['X-Environment-ID'] !== 'remote') return;
    const response = {ok: true, json: async () => ({sessions: [{id: 'remote-session', name: 'Remote selected', cwd: '/remote'}]})};
    return delay ? new Promise(resolve => pending.push(() => resolve(response))) : response;
  });
  await h.navigate('/sessions');
  h.click('[data-conversation-session][data-environment="remote"]'); await settle();
  assert.equal(h.currentSession().environment, 'remote');
  delay = true;
  const refresh = h.window.refreshConversations(true); await settle();
  assert.equal(h.currentSession().environment, 'remote');
  assert.equal(h.currentSession().session, 'remote-session');
  pending.forEach(resolve => resolve()); await refresh; await settle();
  assert.equal(h.currentSession().environment, 'remote');
  assert.equal(h.currentSession().session, 'remote-session');
});

test('conversation status filters combine with search and react to activity without changing the open chat', async t => {
  const h = await harness(t, false);
  h.window.WorkHubAssistant = {open() {}, close() {}};
  h.sessions[0].chat_status = 'running';
  h.sessions.push({id:'waiting', name:'Approval needed', cwd:'/repo/backend', chat_status:'waiting'}, {id:'failed', name:'Failed check', cwd:'/external', chat_status:'failed'});
  await h.navigate('/sessions');
  const selected = h.currentSession().session;
  h.click('[data-conversation-status="running"]');
  assert.equal(h.document.querySelectorAll('[data-conversation-session]').length, 1);
  assert.equal(h.$('[data-conversation-session]').dataset.conversationSession, 'session-1');
  assert.equal(h.$('[data-status-count="running"]').textContent, '1');
  assert.equal(h.$('[data-status-count="waiting"]').textContent, '1');
  h.input('#sessionBrowserSearch', 'Backend');
  assert.match(h.$('#sessionBrowserList').textContent, /没有匹配的对话/);
  assert.equal(h.$('#sessionSearchClear').hidden, false);
  h.click('[data-conversation-status="waiting"]');
  assert.equal(h.$('[data-conversation-session]').dataset.conversationSession, 'waiting');
  assert.equal(h.currentSession().session, selected);
  h.window.browserSessionActivity('waiting', {id:'approval', status:'completed', busy:false, turn_id:'done'});
  assert.equal(h.$('[data-conversation-session]'), null);
  assert.match(h.$('#sessionBrowserList').textContent, /清除搜索与筛选/);
  h.click('[data-conversation-action="reset-list"]'); await settle();
  assert.equal(h.$('#sessionBrowserSearch').value, '');
  assert.equal(h.$('[data-conversation-status="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal(h.document.querySelectorAll('[data-conversation-session]').length, 3);
  assert.equal(h.currentSession().session, selected);
  assert.equal(h.document.activeElement.id, 'sessionBrowserSearch');
  h.click('[data-conversation-status="unread"]');
  assert.equal(h.$('[data-conversation-session]').dataset.conversationSession, 'waiting');
  assert(h.$('.session-browser-unread-dot'));
  assert.doesNotMatch(h.$('#sessionNavigationStatus').getAttribute('aria-label'), /3 个对话运行中/);
});

test('conversation keyboard browsing, search reset and filtering preserve the expected focus', async t => {
  const h = await harness(t);
  h.sessions.push({id:'older', name:'Older discussion', cwd:'/repo/backend', updated_at:1});
  await h.navigate('/sessions');
  const key = (node, value) => node.dispatchEvent(new h.window.KeyboardEvent('keydown', {key:value, bubbles:true, cancelable:true}));
  const search = h.$('#sessionBrowserSearch');
  search.focus(); key(search, 'ArrowDown');
  assert.equal(h.document.activeElement.dataset.conversationSession, 'session-1');
  key(h.document.activeElement, 'End');
  assert.equal(h.document.activeElement.dataset.conversationSession, 'older');
  h.window.browserSessionActivity('older', {id:'live', status:'waiting', busy:true});
  assert.equal(h.document.activeElement.dataset.conversationSession, 'older');
  key(h.document.activeElement, 'Home');
  assert.equal(h.document.activeElement.dataset.conversationSession, 'session-1');
  h.input('#sessionBrowserSearch', 'no results'); search.focus(); key(search, 'Escape');
  assert.equal(search.value, '');
  assert.equal(h.document.activeElement, search);
  h.$('#sessionScopePicker').open = true; await settle();
  const archive = h.$('#sessionBrowserArchived'); archive.focus();
  key(archive, 'Escape');
  assert.equal(h.$('#sessionScopePicker').open, false);
  assert.equal(h.document.activeElement, h.$('#sessionScopePicker summary'));
  h.window.setConversationDirectory('/repo/backend'); await settle();
  h.click('[data-conversation-session="older"]'); await settle();
  h.click('[data-conversation-action="back"]');
  assert.equal(h.document.activeElement.dataset.conversationSession, 'older');
});

test('conversation date groups keep pinned records unique, handle year boundaries and expose exact timestamps', async t => {
  const h = await harness(t);
  const now = new Date(2026, 0, 3, 12).getTime();
  const session = (id, day, pinned = false) => ({id, name:id, cwd:'/repo/app', updated_at:new Date(2026, 0, day, 10).getTime() / 1000, pinned});
  const markup = h.window.WorkHubUI.conversationList({sessions:[session('today', 3), session('yesterday', 2), session('last-year', 0), session('pinned-old', -20, true), session('old', -20)], showDirectory:false, now});
  const root = h.document.createElement('div'); root.innerHTML = markup;
  assert.deepEqual([...root.querySelectorAll('.session-browser-group')].map(n => n.getAttribute('aria-label')), ['已固定','今天','昨天','近 7 天','更早']);
  assert.equal(root.querySelectorAll('[data-conversation-session="pinned-old"]').length, 1);
  assert.equal(root.querySelector('[data-conversation-session="today"] time').textContent, '10:00');
  assert.match(root.querySelector('[data-conversation-session="last-year"] time').textContent, /2025/);
  assert(root.querySelector('time').getAttribute('datetime'));
  assert(root.querySelector('time').title);
});


test('read-only changes show working and staged files as inert text and reject late file results', async t => {
  const h=await harness(t);
  let release;
  h.setIntercept(url=>{
    if(!url.includes('/changes?'))return;
    const params=new URL(url,'http://localhost').searchParams;
    if(!params.has('file'))return {ok:true,json:async()=>({branch:'feature/workspace',files:[{path:'file.txt',index:'M',working:'M'},{path:'new.txt',index:'?',working:'?',untracked:true}]})};
    if(params.get('file')==='new.txt')return new Promise(resolve=>{release=resolve;});
    return {ok:true,json:async()=>({text:params.get('mode')==='index'?'+staged':'<script>inert</script>',truncated:false})};
  });
  h.click('.directory-more [data-action="changes-open"]');await settle();
  assert.equal(h.$('#changesDialog').open,false);
  assert.equal(h.$('#projectFilesPane').hidden,false);
  assert.equal(h.$('#projectFilesText script'),null);
  assert.match(h.$('#projectFilesText').textContent,/<script>inert/);
  h.click('[data-change-file="new.txt"]');await settle();
  h.change('#projectFilesMode','index');await settle();
  assert.equal(h.document.querySelectorAll('[data-change-file]').length,1);
  assert.equal(h.$('#projectFilesText').textContent,'+staged');
  release({ok:true,json:async()=>({text:'old untracked result',truncated:false})});await settle();
  assert.equal(h.$('#projectFilesText').textContent,'+staged');
});

test('a Git network operation keeps refreshing and does not overwrite a different project after closing', async t => {
  const h=await harness(t);
  await h.window.openGit('app','/workspace/workspace/app');
  let release;
  h.setIntercept((url,options)=>options.method==='POST'&&url==='/api/projects/app/git'?new Promise(resolve=>{release=resolve;}):undefined);
  const pending=h.window.gitOperation({action:'fetch',remote:'origin'},'Background fetch');
  await settle();
  assert.equal(h.$('#gitDialog .close-dialog').disabled,false);
  assert.equal(h.$('#refreshButton').disabled,false);
  h.click('#gitDialog .close-dialog');
  await h.window.openGit('backend','/repo/backend');
  assert.match(h.$('#gitTitle').textContent,/Backend/);
  await h.window.refresh();
  release({ok:true,json:async()=>({message:'App fetch completed'})});
  await pending;await settle();
  assert.match(h.$('#gitTitle').textContent,/Backend/);
  assert.equal(h.$('#gitError').hidden,true);
});

test('searchable native fields preserve disabled state, validation and controller change events', async t => {
  const h = await harness(t);
  h.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  await h.window.openGit('app', '/workspace/workspace/app'); await settle();
  h.click('.git-section-navigation a[href="#git-branches"]');
  await settle();
  const source = h.$('#gitBranchSource');
  let trigger = h.$('[data-select-trigger="gitBranchSource"]');
  assert.equal(source.style.getPropertyValue('display'), 'none');
  assert.equal(trigger.getAttribute('aria-label'), '来源分支');
  trigger.click(); await settle();
  assert(h.$('[cmdk-input]'));
  const option = [...h.document.querySelectorAll('[cmdk-item]')].find(item => item.textContent.includes('origin/master'));
  option.click(); await settle();
  assert.equal(source.value, 'refs/remotes/origin/master');
  assert.equal(h.$('#gitTrack').disabled, false);
  assert.equal(h.$('#gitTrack').checked, true);
  source.disabled = true; await settle();
  assert.equal(h.$('[data-select-trigger="gitBranchSource"]').disabled, true);
  source.disabled = false; source.value = ''; await settle();
  const invalid = new h.window.Event('invalid', {cancelable: true});
  source.dispatchEvent(invalid); await settle();
  trigger = h.$('[data-select-trigger="gitBranchSource"]');
  assert.equal(invalid.defaultPrevented, true);
  assert.equal(trigger.getAttribute('aria-invalid'), 'true');
  assert.equal(h.document.activeElement, trigger);
});

test('failed conversation refresh retains cached results but a new directory never inherits them', async t => {
  const h = await harness(t);
  await h.openConversations('project');
  assert(h.$('[data-conversation-session="session-1"]'));
  h.setIntercept(url => url.startsWith('/api/sessions?') ? {ok:false,json:async()=>({error:'fixture offline'})} : undefined);
  await h.window.refreshConversations(true); await settle();
  assert(h.$('[data-conversation-session="session-1"]'));
  assert.match(h.$('#sessionBrowserCount').getAttribute('aria-label'), /部分结果未更新/);
  assert.match(h.$('#sessionBrowserError').textContent, /保留上次结果/);
  h.window.setConversationDirectory('/workspace/workspace/app'); await settle();
  assert.equal(h.$('[data-conversation-session="session-1"]'), null);
  assert.match(h.$('#sessionBrowserCount').getAttribute('aria-label'), /数量暂不可用/);
  assert.doesNotMatch(h.$('#sessionBrowserCount').getAttribute('aria-label'), /0 个对话/);
  assert.equal(h.$('#sessionBrowserList').textContent, '');
});



test('file browser lazily expands directories, renders unchanged source and disposes previews on close', async t => {
  const h = await harness(t);
  let disposed = 0;
  let resolveLate;
  let lateSignal;
  h.window.WorkHubFileDisplay = {render(container, preview, split) {
    container.textContent = `${preview.name}\n${preview.text}\n${split ? 'split' : 'unified'}`;
    return () => { disposed++; container.replaceChildren(); };
  }};
  h.setIntercept((url, options) => {
    const query = new URL(url, 'http://localhost').searchParams;
    if (url.includes('/changes?')) return {ok:true,json:async()=>({branch:'feature/workspace',files:[]})};
    if (!url.includes('/files?')) return;
    if (query.has('file')) {
      if (query.get('file') === 'late.txt') {lateSignal=options.signal;return new Promise(resolve=>{resolveLate=resolve;});}
      return {ok:true,json:async()=>({text:'const html = "<script>inert</script>"',path:'/workspace/workspace/app/src/clean.ts'})};
    }
    return {ok:true,json:async()=>({entries:query.get('dir') === 'src' ? [{name:'clean.ts',path:'src/clean.ts',directory:false}] : [{name:'src',path:'src',directory:true},{name:'late.txt',path:'late.txt',directory:false},{name:'link',path:'link',symlink:true,directory:false}],truncated:false})};
  });
  h.click('.directory-more [data-action="changes-open"]'); await settle();
  h.change('#projectFilesMode', 'all'); await settle();
  assert.equal(h.requests.filter(r=>r.url.includes('/files?') && r.url.includes('dir=src')).length,0);
  h.click('#projectFilesFiles button[aria-expanded="false"]'); await settle();
  assert.equal(h.requests.filter(r=>r.url.includes('/files?') && r.url.includes('dir=src')).length,1);
  assert.equal(h.$('#projectFilesFiles button[title*="符号链接"]').disabled,true);
  h.click('[data-change-file="src/clean.ts"]'); await settle();
  assert.match(h.$('#projectFilesText').textContent,/src\/clean.ts.*\nconst html/);
  assert.equal(h.$('#projectFilesText script'),null);
  assert.equal(h.$('#projectFilesLayout').disabled,true);
  h.click('[data-change-file="late.txt"]'); await settle();
  assert.equal(disposed,1);
  h.click('[data-action="project-directory-files-close"]'); await settle();
  assert.equal(lateSignal.aborted,true);
  resolveLate({ok:true,json:async()=>({text:'late content'})}); await settle();
  assert.equal(h.$('#projectFilesMount').childElementCount,0);
});

test('file browser switches Pierre diff layouts without refetching and falls back safely for partial patches', async t => {
  const h = await harness(t);
  const layouts = [];
  let truncated = false;
  h.window.WorkHubFileDisplay = {render(container, preview, split) {layouts.push(split);container.textContent=preview.text;return ()=>container.replaceChildren();}};
  h.setIntercept(url => {
    if (!url.includes('/changes?')) return;
    const query = new URL(url,'http://localhost').searchParams;
    return {ok:true,json:async()=>query.has('file') ? {name:'file.ts',format:'patch',text:'<script>plain patch</script>',truncated} : {branch:'main',files:[{path:'file.ts',index:'M',working:'M'}]}};
  });
  h.click('.directory-more [data-action="changes-open"]'); await settle();
  assert.deepEqual(layouts,[true]);
  const before=h.requests.filter(r=>r.url.includes('/changes?')).length;
  h.change('#projectFilesLayout','unified'); await settle();
  assert.deepEqual(layouts,[true,false]);
  assert.equal(h.requests.filter(r=>r.url.includes('/changes?')).length,before);
  truncated=true;
  h.click('#projectFilesRefresh'); await settle();
  assert.equal(h.$('#projectFilesTruncated').hidden,false);
  assert.equal(h.$('#projectFilesText script'),null);
  assert.match(h.$('#projectFilesText').textContent,/<script>plain patch/);
  assert.equal(layouts.length,2);
});

for (const desktop of [false, true]) test(`project file dock preserves reading through refresh and resets checkout context (${desktop ? 'desktop' : 'browser'})`, async t => {
  const h = await harness(t, false, {desktop, width:1440});
  let release, signal;
  h.window.WorkHubFileDisplay = {render(container, preview) {container.textContent = preview.text; return () => container.replaceChildren();}};
  h.setIntercept((url, options) => {
    if (!url.includes('/files?')) return;
    const query = new URL(url, 'http://localhost').searchParams;
    if (!query.has('file')) return {ok:true,json:async()=>({entries:[{name:'read.ts',path:'read.ts',directory:false},{name:'late.ts',path:'late.ts',directory:false}],truncated:false})};
    if (query.get('file') === 'late.ts') {signal = options.signal; return new Promise(resolve => {release = resolve;});}
    return {ok:true,json:async()=>({text:query.get('path') + '/read.ts'})};
  });
  const open = path => h.click(`[data-directory-path="${path}"] [data-detail-focus="files"]`);
  open('/repo/app'); await settle();
  assert.equal(h.$('#projectFilesMode').value, 'all');
  assert.equal(h.$('#changesDialog').open, false);
  h.click('#projectFilesFiles [data-change-file="read.ts"]'); await settle();
  const source = h.$('#projectFilesText'); source.scrollTop = 86; source.scrollLeft = 24; source.focus();
  const reads = h.requests.filter(request => request.url.includes('/files?')).length;
  h.data.projects[0].worktrees[0].dirty = 2;
  await h.window.refresh(); await settle();
  assert.equal(h.$('#projectFilesText'), source);
  assert.equal(source.scrollTop, 86); assert.equal(source.scrollLeft, 24);
  assert.equal(h.document.activeElement, source);
  assert.equal(h.requests.filter(request => request.url.includes('/files?')).length, reads);
  h.click('[data-action="project-directory-files-expand"]');
  assert(h.$('#projectDetailWorkspace').hasAttribute('data-files-expanded'));
  assert.equal(h.$('#projectFilesText'), source);
  h.click('[data-action="project-directory-files-expand"]');
  h.click('#projectFilesFiles [data-change-file="late.ts"]'); await settle();
  open('/workspace/workspace/app'); await settle();
  assert.equal(signal.aborted, true);
  assert.equal(h.$('#projectFilesText').textContent.includes('/repo/app/read.ts'), false);
  release({ok:true,json:async()=>({text:'stale main checkout'})}); await settle();
  assert.equal(h.$('#projectFilesText').textContent.includes('stale main checkout'), false);
  h.click('#projectFilesFiles [data-change-file="read.ts"]'); await settle();
  assert.equal(h.$('#projectFilesText').textContent, '/workspace/workspace/app/read.ts');
  h.click('[data-action="project-directory-files-close"]'); await settle();
  assert.equal(h.$('#projectFilesPane').hidden, true);
  assert.equal(h.$('#projectFilesMount').childElementCount, 0);
  assert.equal(h.document.activeElement.dataset.path, '/workspace/workspace/app');
  assert.equal(h.$('.project-activity'), null);
});

test('conversation files remain beside the same chat and fullscreen retains the mounted file and reading position', async t => {
  const h = await harness(t, false, {width:1440});
  h.window.WorkHubFileDisplay = {render(container, preview) {container.textContent=preview.text;return ()=>container.replaceChildren();}};
  h.setIntercept(url=>{
    if (!url.includes('/sessions/session-1/files?')) return;
    return {ok:true,json:async()=>url.includes('file=')?{text:'const reference = 1'}:{entries:[{name:'read.ts',path:'read.ts',directory:false}],truncated:false}};
  });
  await h.openConversations('project');
  assert.equal(h.$('#toggleConversationFiles').disabled,false);
  const chat=h.$('#sessionChatInput');
  h.input('#sessionChatInput','保留我的草稿');
  h.$('#sessionHistoryScroll').scrollTop=145;
  h.click('#toggleConversationFiles'); await settle();
  assert.equal(h.$('#conversationFilesDock').hidden,false);
  assert.equal(h.$('#conversationFilesMode').value,'all');
  h.click('#conversationFilesFiles [data-change-file="read.ts"]'); await settle();
  const source=h.$('#conversationFilesText');source.scrollTop=86;
  const filesReads=()=>h.requests.filter(r=>r.url.includes('/files?')).length;
  const reads=filesReads();
  h.click('#expandConversationFiles'); await settle();
  assert.equal(h.$('#conversationFilesDialog').open,true);
  assert.equal(h.$('#conversationFilesPane').parentElement,h.$('#conversationFilesDialog'));
  assert.equal(h.$('#conversationFilesText'),source);
  assert.equal(source.scrollTop,86);
  assert.equal(h.$('#sessionChatInput'),chat);
  assert.equal(chat.value,'保留我的草稿');
  h.click('#expandConversationFiles'); await settle();
  assert.equal(h.$('#conversationFilesDialog').open,false);
  assert.equal(h.$('#conversationFilesPane').parentElement,h.$('#conversationFilesDock'));
  assert.equal(h.$('#conversationFilesText'),source);
  assert.equal(source.scrollTop,86);
  await h.window.refreshConversations(true);await settle();
  assert.equal(h.$('#conversationFilesText'),source);
  assert.equal(filesReads(),reads);
  h.click('#expandConversationFiles');await settle();
  const escape=new h.window.Event('cancel',{cancelable:true});h.$('#conversationFilesDialog').dispatchEvent(escape);await settle();
  assert.equal(escape.defaultPrevented,true);
  assert.equal(h.$('#conversationFilesDialog').open,false);
  assert.equal(h.document.activeElement,h.$('#expandConversationFiles'));
  h.click('#closeConversationFiles');await settle();
  assert.equal(h.$('#conversationFilesDock').hidden,true);
  assert.equal(h.$('#sessionHistoryPanel').hidden,false);
  assert.equal(chat.value,'保留我的草稿');
});

test('conversation file references use the active session and reject stale responses after changing conversations', async t => {
  const h=await harness(t,true,{width:1440});
  h.sessions.push({id:'outside',name:'Outside',cwd:'/outside',updated_at:1792735201});
  let release,oldSignal;
  h.window.WorkHubFileDisplay={render(container,preview){container.textContent=`${preview.name}:${preview.line}\n${preview.text}`;return ()=>container.replaceChildren();}};
  h.setIntercept((url,options)=>{
    if (!/\/sessions\/(session-1|outside)\/files\?/.test(url)) return;
    if (url.includes('file=') && url.includes('/session-1/')) {oldSignal=options.signal;return new Promise(resolve=>{release=resolve;});}
    return {ok:true,json:async()=>url.includes('file=')?{text:'outside current file'}:{entries:[{name:'read.ts',path:'read.ts',directory:false}],truncated:false}};
  });
  await h.openConversations('project');
  const wrong=new h.window.CustomEvent('workhub:open-file',{cancelable:true,detail:{session:'session-1',environment:'wsl-other',path:'read.ts',line:7}});
  assert.equal(h.window.dispatchEvent(wrong),true);
  const ref=new h.window.CustomEvent('workhub:open-file',{cancelable:true,detail:{session:'session-1',environment:'local',path:'/workspace/workspace/app/read.ts',line:7}});
  assert.equal(h.window.dispatchEvent(ref),false);await settle();
  assert.equal(h.$('#conversationFilesDock').hidden,false);
  h.click('#expandConversationFiles');await settle();
  h.window.openConversations({kind:'all',name:'全部对话'});await settle();
  h.click('[data-conversation-session="outside"]');await settle();
  assert.equal(h.$('#conversationFilesDialog').open,false);
  assert.equal(oldSignal.aborted,true);
  assert.match(h.$('#conversationFilesContext').textContent,/outside/);
  assert.equal(h.$('#conversationFilesMode').options.length,1);
  h.click('#conversationFilesFiles [data-change-file="read.ts"]');await settle();
  release({ok:true,json:async()=>({text:'stale old result'})});await settle();
  assert.match(h.$('#conversationFilesText').textContent,/outside current file/);
  assert.doesNotMatch(h.$('#conversationFilesText').textContent,/stale/);
  await h.navigate('/projects/app');
  assert.equal(h.$('#conversationFilesDock').hidden,true);
  assert.equal(h.$('#conversationFilesMount').childElementCount,0);
});

test('file references open approved additional directories in the right pane and restore it from fullscreen', async t => {
  const h=await harness(t,true,{width:1440});
  h.sessions[0].additional_directories=['/workspace/workspace/backend'];
  h.window.WorkHubFileDisplay={render(container,preview){container.textContent=`${preview.name}:${preview.line}\n${preview.text}`;return ()=>container.replaceChildren();}};
  h.setIntercept(url=>{
    if (!url.includes('/sessions/session-1/files?')) return;
    const query=new URL(url,'http://localhost').searchParams;
    if (query.get('file')==='missing.ts') return {ok:false,json:async()=>({error:'文件不存在、已移动或不可读取'})};
    return {ok:true,json:async()=>query.has('file')?{text:query.get('path')}:{entries:query.get('dir')==='src'?[{name:'read.ts',path:'src/read.ts',directory:false}]:[{name:'src',path:'src',directory:true},{name:'read.ts',path:'read.ts',directory:false}],truncated:false}};
  });
  const open=(path,line=7)=>h.window.dispatchEvent(new h.window.CustomEvent('workhub:open-file',{cancelable:true,detail:{session:'session-1',environment:'local',path,line}}));
  await h.openConversations('project');
  assert.equal(open('/workspace/workspace/backend/src/read.ts'),false);await settle();
  assert.equal(h.$('#conversationFilesDock').hidden,false);
  assert.equal(h.$('#conversationFilesDialog').open,false);
  assert.match(h.$('#conversationFilesContext').textContent,/backend/);
  assert.match(h.$('#conversationFilesText').textContent,/src\/read.ts:7\n\/workspace\/workspace\/backend/);
  assert.equal(h.$('#conversationFilesFiles [data-change-file="src/read.ts"]').getAttribute('aria-pressed'),'true');
  assert.equal(h.$('#conversationFilesMode').options.length,1);
  h.click('#expandConversationFiles');await settle();
  assert.equal(h.$('#conversationFilesDialog').open,true);
  assert.equal(open('read.ts',12),false);await settle();
  assert.equal(h.$('#conversationFilesDialog').open,false);
  assert.equal(h.$('#conversationFilesPane').parentElement,h.$('#conversationFilesDock'));
  assert.match(h.$('#conversationFilesText').textContent,/read.ts:12\n\/workspace\/workspace\/app/);
  assert.equal(h.$('#conversationFilesMode').options.length,3);
  for (const invalid of ['../read.ts','/workspace/workspace/backend/../secret','/workspace/workspace/backend/.git/config']) assert.equal(open(invalid),true);
  for (const external of ['/workspace/workspace/backend-other/read.ts','/outside/read.ts']) {
    assert.equal(open(external),false);await settle();
    const last=h.requests.filter(r=>r.url.includes('/files?') && new URL(r.url,'http://localhost').searchParams.has('file')).at(-1);
    assert.equal(new URL(last.url,'http://localhost').searchParams.get('file'),external);
    assert.match(h.$('#conversationFilesText').textContent,/outside|backend-other/);
    assert.equal(h.$('#conversationFilesDialog').open,false);
  }
  assert.equal(open('/workspace/workspace/backend/missing.ts'),false);await settle();
  assert.match(h.$('#conversationFilesError').textContent,/文件不存在、已移动/);
  assert.equal(h.$('#conversationFilesDialog').open,false);
  assert.equal(h.$('#conversationFilesDock').hidden,false);
});

test('reading splitters resize with pointer and keyboard bounds and keep the selected reference when project metadata arrives', async t => {
  const h=await harness(t,false,{width:1440});
  h.sessions[0].cwd='/reference-root';
  await h.navigate('/sessions');
  await h.window.refreshConversations(true);
  h.window.WorkHubFileDisplay={render(container,preview){container.textContent=preview.text;return ()=>container.replaceChildren();}};
  h.setIntercept(url=>url.includes('/sessions/session-1/files?')?{ok:true,json:async()=>url.includes('file=')?{text:'reference content'}:{entries:[{name:'read.ts',path:'read.ts',directory:false}],truncated:false}}:undefined);
  h.window.openSessionHistory('session-1'); await settle();
  h.window.dispatchEvent(new h.window.CustomEvent('workhub:open-file',{cancelable:true,detail:{session:'session-1',environment:'local',path:'read.ts',line:1}}));await settle();
  const source=h.$('#conversationFilesText');
  source.scrollTop=90;
  const reading=h.$('#sessionReadingLayout');
  const dock=h.$('#conversationFilesDock');
  reading.getBoundingClientRect=()=>({width:1000});
  dock.getBoundingClientRect=()=>({width:parseFloat(reading.style.getPropertyValue('--conversation-files-width'))||480});
  const separator=h.$('#conversationFilesResize');
  separator.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await settle();
  assert.equal(reading.style.getPropertyValue('--conversation-files-width'),'490px');
  const pointer=(type,x)=>{const event=new h.window.MouseEvent(type,{bubbles:true,button:0,clientX:x});Object.defineProperty(event,'pointerId',{value:1});return event;};
  separator.dispatchEvent(pointer('pointerdown',500));
  h.document.dispatchEvent(pointer('pointermove',400));
  h.document.dispatchEvent(pointer('pointerup',400));await settle();
  assert.equal(reading.style.getPropertyValue('--conversation-files-width'),'590px');
  assert.equal(h.window.localStorage.getItem('workhub:conversation-files-width:v1'),'590');
  separator.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));await settle();
  assert.equal(reading.style.getPropertyValue('--conversation-files-width'),'672px');
  const split=h.$('#conversationFilesMount .file-split-layout');
  const tree=split.querySelector('.file-tree-pane');
  split.getBoundingClientRect=()=>({width:800});
  tree.getBoundingClientRect=()=>({width:parseFloat(split.style.getPropertyValue('--file-tree-width'))||220});
  const treeSeparator=split.querySelector('[role="separator"]');
  treeSeparator.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await settle();
  assert.equal(split.style.getPropertyValue('--file-tree-width'),'230px');
  treeSeparator.dispatchEvent(pointer('pointerdown',230));
  h.document.dispatchEvent(pointer('pointermove',280));h.document.dispatchEvent(pointer('pointerup',280));await settle();
  assert.equal(split.style.getPropertyValue('--file-tree-width'),'280px');
  assert.equal(JSON.parse(h.window.localStorage.getItem('workhub:file-tree-size:v1')).width,280);
  const reads=h.requests.filter(r=>r.url.includes('/files?')).length;
  h.data.projects[0].worktrees.push({path:'/reference-root',branch:'main',status_updated_at:'2026-10-29T01:00:00Z'});
  await h.window.refresh(true);await h.window.refreshConversations(true);await settle();
  assert.equal(h.$('#conversationFilesText'),source);
  assert.equal(source.scrollTop,90);
  assert.equal(h.requests.filter(r=>r.url.includes('/files?')).length,reads);
  assert.equal(h.$('#conversationFilesMode').options.length,3);
});

function pageHost(t) {
  const dom = new JSDOM('', {url:'http://localhost:4317/'});
  t.after(()=>dom.window.close());
  const messages=[];
  dom.window.postMessage=message=>messages.push(message);
  return {window:dom.window,messages};
}

test('startup restores the selected conversation without waiting for state, inventory or full discovery', async t => {
  const host=pageHost(t), pending=[];
  const h=await harness(t,true,{pageHost:host.window,route:'/sessions',intercept:url => {
    if(url==='/api/state'||url === '/api/environments') return new Promise(resolve=>pending.push({url,resolve}));
  }});
  assert(host.messages.some(message=>message.type==='workhub:page-ready'));
  assert.equal(h.requests.some(request=>request.url==='/api/state'||request.url.startsWith('/api/sessions?')),false,'the handshake does not start discovery for a temporary scope');
  const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  post({type:'workhub:page-pane',split:false,shared:true});
  post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',title:'Saved title',conversation:{scope:{kind:'project',id:'app'},selected:'session-1',pane:'detail'}}});
  await settle();await settle();
  assert.equal(h.currentSession().session,'session-1');
  assert(h.requests.some(request=>request.url==='/api/sessions/session-1/history'));
  assert.equal(h.requests.some(request=>request.url.startsWith('/api/sessions?')),false);
  assert.equal(h.window.WorkHubPage.snapshot().conversation.session.cwd,'/workspace/workspace/app','history metadata hydrates restored file context');
  assert.equal(h.$('#sessionHistoryTitle').textContent,'Billing review');
  for(const request of pending) request.resolve({ok:true,json:async()=>request.url==='/api/state'?h.data:h.environments});
  await settle();
  assert.equal(h.currentSession().session,'session-1');
});

test('startup list loading never advertises zero conversations and local results do not wait for workspace metadata', async t => {
  const host=pageHost(t), pending=[];
  let releaseList;
  const h=await harness(t,true,{pageHost:host.window,route:'/sessions',intercept:url=>{
    if(url==='/api/state'||url === '/api/environments')return new Promise(resolve=>pending.push({url,resolve}));
    if(url.startsWith('/api/sessions?'))return new Promise(resolve=>{releaseList=resolve;});
  }});
  const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  post({type:'workhub:page-navigation'});
  post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},pane:'list'}}});
  await settle();
  assert.match(h.$('#sessionBrowserCount').getAttribute('aria-label'),/正在加载/);
  assert.doesNotMatch(h.$('#sessionBrowserCount').getAttribute('aria-label'),/0 个对话/);
  assert.equal(h.$('#sessionBrowserList').getAttribute('aria-busy'),'true');
  assert.equal(h.requests.some(request=>request.url.includes('/history')),false,'navigation does not load a conversation body');
  releaseList({ok:true,json:async()=>({sessions:h.sessions})});
  await settle();await settle();
  assert(h.$('[data-conversation-session="session-1"]'));
  assert.equal(h.$('#sessionBrowserList').getAttribute('aria-busy'),'false');
  for(const request of pending) request.resolve({ok:true,json:async()=>request.url==='/api/state'?h.data:h.environments});
  await settle();
});

test('shared startup fills an unselected reader from list results while metadata is still pending', async t => {
  const host=pageHost(t), pending=[];
  let releaseList;
  const h=await harness(t,true,{pageHost:host.window,route:'/sessions',intercept:url=>{
    if(url==='/api/state'||url === '/api/environments')return new Promise(resolve=>pending.push({url,resolve}));
    if(url.startsWith('/api/sessions?'))return new Promise(resolve=>{releaseList=resolve;});
  }});
  const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  post({type:'workhub:page-navigation'});
  post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local'}});
  post({type:'workhub:conversation-group',split:false,sessions:[],autoSelect:true});
  await settle();
  assert(!h.$('#sessionBrowser').hidden,'static list controls render with no saved conversation');
  assert.match(h.$('#sessionBrowserCount').getAttribute('aria-label'),/正在加载/);
  assert(host.messages.some(message=>message.type==='workhub:page-restored'));
  assert(!host.messages.some(message=>message.type==='workhub:conversation-select'));
  releaseList({ok:true,json:async()=>({sessions:h.sessions})});
  await settle();await settle();
  const selection=host.messages.find(message=>message.type==='workhub:conversation-select');
  assert(selection?.initial);
  assert.equal(selection.snapshot.conversation.selected,'session-1');
  assert.equal(h.requests.some(request=>request.url.includes('/history')),false,'the shared list does not fetch hidden history');
  post({type:'workhub:conversation-group',split:false,sessions:['session-1'],selected:'session-1',autoSelect:false});
  for(const request of pending) request.resolve({ok:true,json:async()=>request.url==='/api/state'?h.data:h.environments});
  await settle();
  assert.equal(host.messages.filter(message=>message.type==='workhub:conversation-select').length,1);
});

test('a late restored history cannot overwrite a newer conversation selection', async t => {
  const host=pageHost(t), history=[];
  const h=await harness(t,true,{pageHost:host.window,intercept:url=>url.endsWith('/history')?new Promise(resolve=>history.push({url,resolve})):undefined});
  const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  const restore=id=>post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',title:id,conversation:{scope:{kind:'all'},selected:id,pane:'detail'}}});
  post({type:'workhub:page-pane',split:false,shared:true});
  restore('session-1');await settle();
  restore('session-2');await settle();
  history.find(request=>request.url.includes('session-2')).resolve({ok:true,json:async()=>({session:{id:'session-2',name:'Second',cwd:'/second'},entries:[]})});
  await settle();
  history.find(request=>request.url.includes('session-1')).resolve({ok:true,json:async()=>({session:{id:'session-1',name:'First',cwd:'/first'},entries:[]})});
  await settle();
  assert.equal(h.window.WorkHubPage.snapshot().conversation.selected,'session-2');
  assert.equal(h.window.WorkHubPage.snapshot().conversation.session.cwd,'/second');
  assert.equal(h.$('#sessionHistoryTitle').textContent,'Second');
});

for(const kind of ['project']) test(`active conversation follows its ${kind} scope and clears filters only when hidden`,async t=>{
  const host=pageHost(t), h=await harness(t,true,{pageHost:host.window});
  h.sessions.push({id:'session-2',name:'Second conversation',cwd:'/repo/backend',updated_at:1999999999});
  const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  const firstScope={kind:'project',id:'app',environment:'local'};
  post({type:'workhub:page-navigation'});
  post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:firstScope,pane:'list'}}});
  await settle();await settle();
  h.input('#sessionBrowserSearch','Billing');
  const scope={kind,id:'backend',environment:'local'};
  const group={type:'workhub:conversation-group',sessions:['session-1','session-2'],selected:'session-2',full:false,listWidth:280,target:{route:'/sessions',environment:'local',conversation:{scope,selected:'session-2',session:h.sessions[1]}}};
  post(group);await settle();await settle();
  assert.equal(h.window.WorkHubPage.snapshot().conversation.scope.id,scope.id);
  assert.equal(h.$('#sessionBrowserSearch').value,'');
  assert.equal(h.$('[data-conversation-session="session-2"]').getAttribute('aria-pressed'),'true');
  h.input('#sessionBrowserSearch','Second');
  post({...group,listWidth:400});await settle();
  assert.equal(h.$('#sessionBrowserSearch').value,'Second','resizing does not reset the list filters');
  post({...group,selected:'session-1',target:{route:'/sessions',environment:'local',conversation:{scope:firstScope,selected:'session-1',session:h.sessions[0]}}});
  await settle();await settle();
  assert.equal(h.window.WorkHubPage.snapshot().conversation.scope.id,'app');
  assert.equal(h.$('[data-conversation-session="session-1"]').getAttribute('aria-pressed'),'true');
});

test('following an active remote conversation keeps colliding local IDs isolated',async t=>{
  const host=pageHost(t), h=await harness(t,true,{pageHost:host.window});
  h.environments.environments.push({id:'remote',name:'Remote'});
  const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  post({type:'workhub:page-navigation'});
  post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'app',environment:'local'},pane:'list'}}});
  await settle();await settle();
  const selected=JSON.stringify(['remote','session-1']);
  post({type:'workhub:conversation-group',sessions:['session-1',selected],selected,full:false,listWidth:280,target:{route:'/sessions',environment:'remote',conversation:{scope:{kind:'project',id:'app',environment:'remote'},selected,session:h.sessions[0]}}});
  await settle();await settle();
  const chosen=[...h.document.querySelectorAll('[data-conversation-session]')].find(node=>node.dataset.conversationSession===selected);
  assert.equal(chosen?.getAttribute('aria-pressed'),'true');
  assert.equal(h.window.WorkHubPage.snapshot().conversation.scope.environment,'remote');
  assert(h.requests.some(request=>request.url.includes('project_id=app')&&request.options.headers['X-Environment-ID']==='remote'));
});

test('page bridge exposes sidebar navigation without page-tab controls or keyboard interception', async t => {
  const host=pageHost(t), h=await harness(t,false,{pageHost:host.window,width:1440});
  assert.equal(h.$('.sidebar-new-tab'),null);
  assert.equal(h.$('.workspace-tab-menu'),null);
  const event = new h.window.KeyboardEvent('keydown',{key:'t',ctrlKey:true,bubbles:true,cancelable:true});
  h.document.body.dispatchEvent(event);
  assert.equal(event.defaultPrevented,false);
  assert.equal(h.$('.sidebar-toggle, .sidebar-resize'), null);
  assert(h.document.documentElement.hasAttribute('data-workhub-desktop'));
  assert.equal(h.window.__TAURI_INTERNALS__, undefined);
});

test('page bridge delegates sidebar conversation navigation before changing the project document', async t => {
  const host=pageHost(t);
  const h=await harness(t,false,{pageHost:host.window});
  h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data:{type:'workhub:page-restore',active:true,snapshot:{route:'/projects/backend',environment:'local'}}}));
  await settle();await settle();
  assert.equal(h.window.location.hash,'#/projects/backend');
  assert.match(h.$('#projectDetail').textContent,/Backend/);
  h.click('[data-view="sessions"]');await settle();
  assert.equal(h.window.location.hash,'#/projects/backend');
  assert.equal(h.$('#sessionsPage').hidden,true);
  assert.equal(host.messages.findLast(message=>message.type==='workhub:page-open').snapshot.route,'/sessions');
  h.click('[data-action="project-conversations"]');await settle();
  const scoped = host.messages.findLast(message=>message.type==='workhub:page-open').snapshot;
  assert.equal(scoped.conversation.scope.kind,'project');
  assert.equal(scoped.conversation.scope.id,'backend');
  assert.equal(h.window.location.hash,'#/projects/backend');
  await h.navigate('/projects/app');
  h.click('[data-directory-path="/workspace/workspace/app"] [data-action="project-conversation-new"]'); await settle();
  const draft = host.messages.findLast(message=>message.type==='workhub:page-open');
  assert.equal(draft.create,true);
  assert.equal(draft.snapshot.conversation.scope.id,'app');
  assert.equal(draft.snapshot.conversation.creationDirectory,'/workspace/workspace/app');
  h.click('[data-directory-path="/workspace/workspace/app"] [data-action="project-directory-toggle"]');
  h.click('[data-action="project-conversations"][data-session="session-1"]');
  assert.equal(host.messages.findLast(message=>message.type==='workhub:page-open').snapshot.conversation.selected, 'session-1');
  h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data:{type:'workhub:page-active',active:false}}));
  assert.equal(h.window.WorkHubPage.active,false);
  assert(h.document.documentElement.hasAttribute('data-workspace-inactive'));
  h.window.WorkHubPage.dispose();
  assert.equal(h.requests.some(request=>request.url.endsWith('/chat/stop')),false);
});

test('split conversation bridges retain independent drafts and send only to their own session', async t => {
  const host = pageHost(t);
  const first = await harness(t, false, {pageHost:host.window});
  const second = await harness(t, false, {pageHost:host.window});
  second.sessions[0].id = 'session-2'; second.sessions[0].name = 'Backend review';
  const post = (h, data, source = host.window) => h.window.dispatchEvent(new h.window.MessageEvent('message', {source, origin:'http://localhost:4317', data}));
  for (const [h, id] of [[first, 'session-1'], [second, 'session-2']]) {
    post(h, {type:'workhub:page-restore', active:true, snapshot:{route:'/sessions', environment:'local', conversation:{scope:{kind:'all'}, selected:id, pane:'detail'}}});
    await settle(); await settle();
    post(h, {type:'workhub:page-pane', split:true});
    assert(h.document.documentElement.hasAttribute('data-workspace-pane'));
    assert.equal(h.window.WorkHubPage.active, true);
  }
  first.input('#sessionChatInput', '只发给前端');
  second.input('#sessionChatInput', '只发给后端');
  first.$('#sessionChatInput').dispatchEvent(new first.window.Event('focusin', {bubbles:true}));
  assert.equal(host.messages.at(-1).type, 'workhub:page-focus');
  post(second, {type:'workhub:page-pane', split:false}, second.window);
  assert(second.document.documentElement.hasAttribute('data-workspace-pane'), 'foreign pane messages are ignored');
  await first.submit('#sessionChatForm');
  assert.equal(second.$('#sessionChatInput').value, '只发给后端');
  await second.submit('#sessionChatForm');
  for (const [h,id,text] of [[first,'session-1','只发给前端'], [second,'session-2','只发给后端']]) {
    const sends = h.requests.filter(request => request.options.method === 'POST' && request.url.endsWith('/chat'));
    assert.equal(sends.length, 1);
    assert.equal(sends[0].url, `/api/sessions/${id}/chat`);
    assert.equal(sends[0].body.text, text);
    post(h, {type:'workhub:page-pane', split:false});
    assert(!h.document.documentElement.hasAttribute('data-workspace-pane'));
    assert.equal(h.requests.some(request => request.url.endsWith('/chat/stop')), false);
  }
});

test('shared sidebar navigates to independent pages and leaves grouped conversations intact', async t => {
  const host = pageHost(t), h = await harness(t,false,{pageHost:host.window});
  const post = data => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'app'},selected:'session-1',pane:'detail'}}});
  await settle(); await settle();
  post({type:'workhub:page-pane',split:true});
  h.input('#sessionChatInput','保留在当前栏');
  h.click('[data-view="projects"]'); await settle();
  assert.equal(host.messages.findLast(message=>message.type==='workhub:page-open').snapshot.route,'/projects');
  assert.equal(h.window.WorkHubPage.snapshot().conversation.selected,'session-1');
  assert.equal(h.$('#sessionChatInput').value,'保留在当前栏');
  post({type:'workhub:page-navigation'});
  assert(h.document.documentElement.hasAttribute('data-workspace-navigation'));
  h.click('[data-view="projects"]'); await settle();
  assert.equal(host.messages.findLast(message=>message.type==='workhub:page-open').snapshot.route,'/projects');
  assert.equal(h.requests.some(request=>request.url.endsWith('/chat/stop')),false);
});

test('shared list synchronizes read markers from a visible reader and keeps background completions unread', async t => {
 const host = pageHost(t), nav = await harness(t,false,{pageHost:host.window}), reader = await harness(t,false,{pageHost:host.window});
 const post = (h,data) => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 const key = 'workhub:session-read:' + JSON.stringify(['local','session-1']);
 const values = new Map([[key,nav.window.localStorage.getItem(key)]]);
 let writes = 0;
 // Model same-origin iframe localStorage, including storage events delivered
 // to every other frame only when the value changes.
 for (const h of [nav,reader]) Object.defineProperty(h.window,'localStorage',{value:{
   getItem(key) {return values.get(key) ?? null;},
   setItem(key,value) {
     const oldValue = values.get(key) ?? null;
     if (oldValue === value) return;
     writes++; values.set(key,value);
     const other = h === nav ? reader : nav;
     setImmediate(() => {if (other.window.document) other.window.dispatchEvent(new other.window.StorageEvent('storage',{key,oldValue,newValue:value}));});
   },
 }});
 let opened;
 reader.window.WorkHubAssistant = {open(options) {opened = options; setImmediate(() => options.loaded?.({...reader.sessions[0]}));},close() {},updateSession() {}};
 post(nav,{type:'workhub:page-navigation'});
 post(nav,{type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'app'},pane:'list'}}});
 await settle(); await settle();
 post(nav,{type:'workhub:conversation-group',sessions:['session-1'],selected:'session-1',split:true});
 nav.sessions[0].completed_run = reader.sessions[0].completed_run = 'before-open';
 await nav.window.refreshConversations(true);
 const row = () => nav.$('[data-conversation-session="session-1"]');
 assert(row().querySelector('.session-browser-unread-dot'),'a selected row alone does not mark a hidden conversation read');
 assert(nav.$('.session-browser-unread-dot'));
 post(reader,{type:'workhub:page-pane',shared:true});
 post(reader,{type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'app'},selected:'session-1',pane:'detail'}}});
 await settle(); await settle();
 assert.equal(JSON.parse(values.get(key)).run,'before-open');
 assert.equal(row().querySelector('.session-browser-unread-dot'),null);
 assert.equal(nav.$('.session-browser-unread-dot'),null);
 assert.equal(nav.$('#sessionNavigationStatus').hidden,true);
 nav.sessions[0].completed_run = 'visible-run';
 await nav.window.refreshConversations(true);
 assert(row().querySelector('.session-browser-unread-dot'));
 opened.activity('session-1',{id:'visible-run',busy:false,status:'completed',turn_id:'visible-turn'});
 await settle();
 assert.equal(JSON.parse(values.get(key)).run,'visible-run');
 assert.equal(row().querySelector('.session-browser-unread-dot'),null,'visible completion is acknowledged without reopening the reader');
 opened.loaded({...reader.sessions[0],completed_run:'before-open'});
 await settle();
 assert.equal(JSON.parse(values.get(key)).run,'visible-run','late history metadata cannot replace the latest acknowledged activity');
 assert.equal(row().querySelector('.session-browser-unread-dot'),null);
 const acknowledgedWrites = writes;
 opened.activity('session-1',{id:'visible-run',busy:false,status:'completed',turn_id:'visible-turn'});
 await settle();
 assert.equal(writes,acknowledgedWrites,'repeated rendering does not broadcast identical read acknowledgements');
 post(reader,{type:'workhub:page-active',active:false});
 nav.sessions[0].completed_run = 'background-run';
 opened.activity('session-1',{id:'background-run',busy:false,status:'completed',turn_id:'background-turn'});
 await nav.window.refreshConversations(true); await settle();
 assert.equal(JSON.parse(values.get(key)).run,'visible-run');
 assert(row().querySelector('.session-browser-unread-dot'));
 const remoteKey = 'workhub:session-read:' + JSON.stringify(['remote','session-1']);
 const remoteRead = JSON.stringify({time:Date.now() / 1000,run:'background-run'});
 values.set(remoteKey,remoteRead);
 nav.window.dispatchEvent(new nav.window.StorageEvent('storage',{key:remoteKey,newValue:remoteRead}));
 assert(row().querySelector('.session-browser-unread-dot'),'reading the same ID in another environment does not clear this reminder');
 post(reader,{type:'workhub:page-active',active:true});
 await settle();
 assert.equal(JSON.parse(values.get(key)).run,'background-run');
 assert.equal(row().querySelector('.session-browser-unread-dot'),null);
});

test('shared conversation list browses scopes without reading hidden history and distinguishes locate from add', async t => {
 const host = pageHost(t), h = await harness(t,false,{pageHost:host.window});
 const post = data => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post({type:'workhub:page-navigation'});
 const historyRequests = () => h.requests.filter(request=>request.url.includes('/history')).length;
 const before = historyRequests();
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'app'},pane:'list'}}});
 await settle(); await settle();
 post({type:'workhub:conversation-group',sessions:['session-1'],selected:'session-1',full:false,listWidth:280});
 assert.equal(h.window.WorkHubPage.navigationOnly,true);
 assert.equal(historyRequests(),before,'a shared list must not load or mark the hidden chat as read');
 assert.match(h.$('[data-parallel-open]').title,/已并列/);
 assert(h.$('[data-parallel-open] svg'));
 assert.equal(h.$('[data-conversation-session="session-1"]').dataset.parallelMember,'true');
 const picker = h.$('#sessionScopePicker');
 const modes = h.$('#sessionSidebarModes');
 assert(picker.contains(modes));
 assert.equal(modes.hidden,false);
 for (const mode of ['recent','grouped']) {
   picker.open = true; await settle();
   const option = modes.querySelector(`[data-conversation-list-mode="${mode}"]`);
   option.focus();
   option.click();
   assert.equal(option.getAttribute('aria-pressed'),'true');
   assert.equal(h.window.localStorage.getItem('workhub:conversation-list-mode:v1'),mode);
   assert.equal(h.$('#sessionSidebarProjectDisplay').hidden, mode === 'recent');
   assert.equal(picker.open,false);
   assert.equal(h.document.activeElement,picker.querySelector('summary'));
   assert.equal(h.$('[data-conversation-session="session-1"]').dataset.parallelMember,'true');
 }
 h.click('[data-conversation-session="session-1"]'); await settle();
 assert.equal(host.messages.findLast(message=>message.type==='workhub:conversation-select').snapshot.conversation.selected,'session-1');
 h.click('[data-conversation-parallel="session-1"]'); await settle();
 assert.equal(host.messages.findLast(message=>message.type==='workhub:conversation-add').snapshot.conversation.scope.id,'app');
 h.$('#sessionScopePicker').open = true; await settle();
 h.click('#sessionScopeAll'); await settle(); await settle();
 assert.equal(h.window.WorkHubPage.snapshot().conversation.scope.kind,'all');
 post({type:'workhub:conversation-group',sessions:['session-1'],selected:'session-1',split:false,full:false,listWidth:400,targetTitle:'当前对话'});
 assert.equal(h.$('[data-parallel-open]'),null,'single conversations do not claim to be parallel');
 assert.equal(h.$('[data-conversation-session="session-1"]').hasAttribute('data-parallel-member'),false);
 assert.equal(h.$('#sharedConversationTarget'),null);
 assert.equal(h.$('#sessionBrowserListPane').getAttribute('aria-description'),'当前对话：当前对话');
 assert(h.document.documentElement.hasAttribute('data-workspace-single'));
 assert.equal(historyRequests(),before);
});

for (const scope of [{kind:'directory',cwd:'/workspace/workspace/app',environment:'local'}, {kind:'project',id:'app',environment:'local'}]) test(`split new conversation preserves an explicit draft across pages (${scope.kind})`, async t => {
 const host = pageHost(t), nav = await harness(t,false,{pageHost:host.window});
 const post = (h,data) => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post(nav,{type:'workhub:page-navigation'});
 post(nav,{type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope,directory:'/workspace/workspace/app',pane:'list'}}});
 await settle();await settle();
 post(nav,{type:'workhub:conversation-group',canSplit:true,sessions:[],selected:'',split:false});
 assert(nav.$('#newBrowserSession').hidden);
 nav.window.WorkHubPage.createConversation('split','local');await settle();
 const opened = host.messages.findLast(message=>message.type==='workhub:page-open').snapshot;
 assert.equal(opened.conversation.creating,true);
 assert.equal(opened.conversation.selected,null);
 assert.equal(opened.conversation.directory,'/workspace/workspace/app');
 const draft = await harness(t,false,{pageHost:host.window});
 post(draft,{type:'workhub:page-restore',active:true,snapshot:opened});await settle();await settle();
 assert.equal(draft.currentSession().session,null, 'existing conversations must not replace a new draft');
 assert.equal(draft.window.WorkHubPage.snapshot().conversation.creating,true);
 assert.equal(draft.window.WorkHubPage.snapshot().title,'新建对话');
 assert.equal(draft.$('#sessionBrowserNewDirectoryField').hidden,false);
 assert.equal(draft.currentSession().target.cwd,'/repo/app');
 assert.equal(draft.requests.some(r=>r.url.endsWith('/chat') && r.options.method==='POST'),false);
 const saved = draft.window.WorkHubPage.snapshot();
 post(draft,{type:'workhub:page-restore',active:true,snapshot:saved});await settle();await settle();
 assert.equal(draft.currentSession().session,null);
 assert.equal(draft.currentSession().target.cwd,'/repo/app');
});

test('grouped navigation expands by project name, saves display preferences and opens project actions', async t => {
  const host = pageHost(t), nav = await harness(t,false,{pageHost:host.window});
  const post = (h,data) => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  post(nav,{type:'workhub:page-navigation'});
  post(nav,{type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},pane:'list'}}});
  await settle(); await settle();
  const projectAction = '.session-workspace-heading [data-action="project-conversation-new"]';
  assert(nav.$(projectAction + '[data-id="app"]'));
  assert.equal(nav.$(projectAction + '[data-id="backend"]'),null);
  const projectHeading = () => nav.$(projectAction + '[data-id="app"]').closest('.session-workspace-heading');
  const toggle = () => projectHeading().querySelector('[data-conversation-group-toggle]');
  assert(toggle().querySelector('.session-workspace-name'));
  assert.equal(toggle().querySelector('.session-workspace-chevron, .lucide-chevron-down, .lucide-chevron-right'),null);
  assert.equal(projectHeading().querySelector('.session-workspace-count').textContent,'1');
  assert.equal(toggle().getAttribute('aria-expanded'),'true');
  toggle().querySelector('.session-workspace-name').click();
  assert.equal(projectHeading().closest('section').querySelector('[data-conversation-session]'),null);
  assert.equal(projectHeading().querySelector('.session-workspace-count').textContent,'1');
  assert.equal(toggle().getAttribute('aria-expanded'),'false');
  assert.equal(toggle().querySelector('.session-workspace-chevron, .lucide-chevron-down, .lucide-chevron-right'),null);
  toggle().querySelector('.session-workspace-name').click();
  assert(projectHeading().closest('section').querySelector('[data-conversation-session]'));
  assert.equal(host.messages.some(message=>message.type==='workhub:page-open'),false);
  const displayKey = 'workhub:conversation-project-display:v1';
  const options = '#sessionSidebarProjectDisplay';
  const list = nav.$('#sessionBrowserList');
  for (const option of ['icons', 'counts']) assert.equal(nav.$(`${options} input[name="${option}"]`).checked,true);
  nav.click(`${options} input[name="icons"]`);
  assert.equal(list.hasAttribute('data-hide-project-icons'),true);
  assert.equal(list.hasAttribute('data-hide-project-counts'),false);
  nav.click(`${options} input[name="counts"]`);
  assert.equal(list.hasAttribute('data-hide-project-counts'),true);
  const savedDisplay = nav.window.localStorage.getItem(displayKey);
  assert.deepEqual(JSON.parse(savedDisplay),{icons:false,counts:false});
  nav.window.dispatchEvent(new nav.window.StorageEvent('storage',{key:displayKey,newValue:'{"icons":true,"counts":false}'}));
  assert.equal(list.hasAttribute('data-hide-project-icons'),false);
  assert.equal(list.hasAttribute('data-hide-project-counts'),true);
  const reopened = await harness(t,false,{pageHost:host.window,storage:{[displayKey]:savedDisplay}});
  assert.equal(reopened.$('#sessionBrowserList').hasAttribute('data-hide-project-icons'),true);
  assert.equal(reopened.$('#sessionBrowserList').hasAttribute('data-hide-project-counts'),true);
  const details = projectHeading().querySelector('[data-collection-href]');
  assert(details.nextElementSibling.matches('[data-action="project-conversation-new"]'));
  details.click(); await settle();
  const opened = () => host.messages.findLast(message=>message.type==='workhub:page-open').snapshot;
  assert.equal(opened().route,'/projects/app');
  assert.equal(opened().environment,'local');
  toggle().click();
  assert.equal(toggle().getAttribute('aria-expanded'),'false');
  nav.click(projectAction + '[data-id="app"]'); await settle();
  assert.equal(opened().conversation.scope.id,'app');
  assert.equal(opened().conversation.creationDirectory,'/repo/app');
  assert.equal(toggle().getAttribute('aria-expanded'),'true');

  post(nav,{type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'app'},directory:'/repo/app',search:'existing search',statusFilter:'waiting',pane:'list'}}});
  await settle(); await settle();
  nav.window.WorkHubPage.createConversation('current','local'); await settle();
  const independent = opened();
  assert.equal(independent.conversation.scope.kind,'all');
  assert.equal(independent.conversation.directory,'');
  assert.equal(independent.conversation.creationDirectory,'');
  const draft = await harness(t,false,{pageHost:host.window});
  post(draft,{type:'workhub:page-restore',active:true,snapshot:independent});
  await settle(); await settle();
  assert.deepEqual({...draft.currentSession().target},{});
  assert.match(draft.$('#sessionBrowserDirectoryChoices [aria-pressed="true"]').textContent,/默认目录/);
  draft.click('#sessionBrowserDirectoryChoices [data-creation-choice="/repo/backend"]');
  assert.equal(draft.currentSession().target.project_id,'backend');

  const filters = () => {
    const {scope, directory, search, statusFilter} = nav.window.WorkHubPage.snapshot().conversation;
    return {project:scope.id, directory, search, statusFilter};
  };
  const previousFilters = {project:'app', directory:'/repo/app', search:'existing search', statusFilter:'waiting'};
  post(nav,{type:'workhub:conversation-group',selected:'',split:false,target:independent});
  assert.deepEqual(filters(),previousFilters);
  const created = {id:'new-session',name:'Backend work',cwd:'/repo/backend',primary_project_id:'backend'};
  post(nav,{type:'workhub:conversation-group',selected:created.id,split:false,createdConversation:true,target:{...independent,conversation:{...independent.conversation,creating:false,selected:created.id,session:created}}});
  await settle(); await settle();
  assert.deepEqual(filters(),previousFilters);
  assert.equal(nav.$('#sessionBrowserSearch').value,'existing search');
  assert.equal(nav.$('[data-conversation-status="waiting"]').getAttribute('aria-pressed'),'true');
  assert.equal(nav.$('[data-conversation-session="new-session"]'),null);
});

test('grouped navigation expands in five-row steps, resets the preview and shares one list with independent conversations', async t => {
  const host = pageHost(t), nav = await harness(t,false,{pageHost:host.window});
  const post = data => nav.window.dispatchEvent(new nav.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  nav.sessions.splice(0, 1, ...Array.from({length: 9}, (_, index) => ({
    id: 'project-' + index, name: 'Project ' + index, cwd: '/workspace/workspace/app', updated_at: 100 - index,
    primary_project_id: 'app', chat_status: index === 8 ? 'running' : '',
  })), {id:'outside', name:'Outside', cwd:'/other/worktree', updated_at:90});
  post({type:'workhub:page-navigation'});
  post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},pane:'list'}}});
  await settle();
  const project = () => nav.$('[data-collection="project"]');
  const independent = () => nav.$('[data-collection="independent"]');
  const projectRows = () => [...project().querySelectorAll('[data-conversation-session]')];
  const toggle = () => project().querySelector('[data-conversation-group-toggle]');
  const more = () => project().querySelector('[data-conversation-group-more]');
  const less = () => project().querySelector('[data-conversation-group-less]');
  assert.deepEqual(projectRows().map(row => row.dataset.conversationSession), ['project-0','project-8']);
  assert.equal(projectRows()[0].querySelector('.session-browser-item-project'),null);
  assert.equal(projectRows()[0].querySelector('.session-browser-item-branch').textContent,'feature/workspace');
  assert.equal(less(),null);
  more().click();
  assert.equal(projectRows().length,7);
  assert.equal(more().parentNode,less().parentNode);
  more().click();
  assert.equal(projectRows().length,9);
  assert.equal(more(),null);
  assert.equal(less().textContent,'收起对话');
  less().click();
  assert.equal(projectRows().length,2);
  assert.equal(nav.document.activeElement,toggle());
  more().click();
  toggle().click();
  assert.equal(projectRows().length,0);
  assert(toggle().querySelector('.session-workspace-running'));
  toggle().click();
  assert.equal(projectRows().length,2);

  const standalone = independent().querySelector('[data-conversation-session]');
  assert.equal(standalone.querySelector('.session-browser-item-location').textContent,'worktree');
  assert.equal(standalone.closest('#sessionBrowserList'),project().closest('#sessionBrowserList'));
  assert.equal(nav.$('#sessionBrowserList h2, #sessionBrowserList hr'),null);
  assert.equal(nav.$('#sessionBrowserList .session-workspace-chevron'),null);
  const unboundToggle = () => independent().querySelector('[data-conversation-group-toggle="independent"]');
  assert.equal(unboundToggle().querySelector('.session-workspace-name').textContent,'未绑定项目');
  assert.equal(independent().querySelector('.session-collection-details'),null);
  unboundToggle().click();
  assert.equal(independent().querySelector('[data-conversation-session]'),null);
  independent().querySelector('[data-conversation-standalone="true"]').click();
  assert.equal(unboundToggle().getAttribute('aria-expanded'),'true');
  assert(independent().querySelector('[data-conversation-session="outside"]'));

  const created = {id:'new-in-app', name:'New conversation', cwd:'/repo/app', primary_project_id:'app', updated_at:110};
  toggle().click();
  project().querySelector('[data-action="project-conversation-new"]').click();
  nav.sessions.push(created);
  post({type:'workhub:conversation-group',selected:created.id,split:false,createdConversation:true,target:{environment:'local',conversation:{selected:created.id,session:created}}});
  await settle();
  assert.equal(project().querySelector('[data-conversation-session="new-in-app"]')?.getAttribute('aria-pressed'),'true');
});

test('search group overrides preserve saved expansion, explain matches and support keyboard browsing', async t => {
  const host = pageHost(t), nav = await harness(t,false,{pageHost:host.window});
  nav.sessions.push({id:'backend-session', name:'Service review', cwd:'/repo/backend', primary_project_id:'backend'});
  const post = data => nav.window.dispatchEvent(new nav.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
  post({type:'workhub:page-navigation'});
  post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},pane:'list'}}});
  await settle(); await settle();
  post({type:'workhub:conversation-group',selected:'session-1',sessions:[],split:false});

  const group = name => nav.$(`[data-conversation-group-toggle][title="${name}"]`);
  const session = () => nav.$('[data-conversation-session="session-1"]');
  const search = query => nav.input('#sessionBrowserSearch',query);
  const move = key => nav.document.activeElement.dispatchEvent(new nav.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  const toggleAll = nav.$('#sessionToggleAllGroups');
  toggleAll.focus();
  toggleAll.click();
  assert.equal(nav.document.activeElement,toggleAll);
  assert.equal(toggleAll.getAttribute('aria-label'),'全部展开');
  assert(group('App').hasAttribute('data-current-conversation'));
  assert.equal(group('Backend').getAttribute('aria-expanded'),'false');
  toggleAll.click();
  assert.equal(group('App').getAttribute('aria-expanded'),'true');
  assert.equal(group('Backend').getAttribute('aria-expanded'),'true');
  group('Backend').click();
  search('feature/workspace');
  assert.equal(session().querySelector('.session-browser-item-search-match').textContent,'分支 · feature/workspace');
  toggleAll.click();
  assert.equal(group('App').getAttribute('aria-expanded'),'false');
  assert.equal(group('App').getAttribute('aria-description'),'当前对话所在项目');
  assert.equal(session(),null);
  nav.$('#sessionBrowserSearch').focus(); move('ArrowDown');
  assert.equal(nav.document.activeElement,group('App'));

  search('');
  assert.equal(group('App').getAttribute('aria-expanded'),'true');
  assert.equal(group('Backend').getAttribute('aria-expanded'),'false');
  assert.equal(session().querySelector('.session-browser-item-search-match'),null);
  nav.$('#sessionBrowserSearch').focus(); move('ArrowDown');
  assert.equal(nav.document.activeElement,session());
  move('ArrowDown');
  assert.equal(nav.document.activeElement,group('Backend'));
  move('ArrowUp');
  assert.equal(nav.document.activeElement,session());

  search('/workspace/workspace/app');
  assert.equal(session().querySelector('.session-browser-item-search-match').title,'工作目录 · /workspace/workspace/app');
  group('App').click();
  search('Billing');
  assert.equal(group('App').getAttribute('aria-expanded'),'true','a new query reveals its matches');
  search('');
  group('App').click();
  assert(group('App').hasAttribute('data-current-conversation'));
  assert(!group('Backend').hasAttribute('data-current-conversation'));
  search('Billing');
  assert.equal(group('App').getAttribute('aria-expanded'),'true','search can find results in a normally collapsed group');
  search('');
  assert.equal(group('App').getAttribute('aria-expanded'),'false');
});

test('running terminals share the conversation list, retain scope and reconnect by process identity', async t => {
 const host=pageHost(t), rows=[
  {id:'session-1',name:'Terminal Shell',project_id:'app',cwd:'/workspace/workspace/app',state:'running',attached:false,created_at:Math.floor(Date.now()/1000)},
  {id:'other',name:'Other project',project_id:'backend',cwd:'/workspace/other/backend',state:'running',attached:false,created_at:1},
  {id:'ended',name:'Ended terminal',cwd:'/workspace/workspace',state:'exited',created_at:1},
 ];
 const h=await harness(t,false,{pageHost:host.window,intercept:url=>url==='/api/terminals'?{ok:true,json:async()=>rows}:null});
 const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post({type:'workhub:page-navigation'});
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'project',id:'app',environment:'local'},pane:'list'}}});
 await settle();await settle();
 const terminal=()=>h.$('[data-conversation-terminal="session-1"]');
 assert(terminal());assert.equal(terminal().querySelector('.session-browser-item-kind'),null);
 assert.equal(terminal().querySelector('.session-browser-item-heading .sr-only').textContent,'终端');
 assert.equal(terminal().querySelector('.session-browser-item-status').getAttribute('aria-label'),'运行中');
 assert.equal(h.$('[data-conversation-terminal="other"]'),null);
 assert.equal(h.$('[data-conversation-terminal="ended"]'),null);
 assert.match(h.$('#sessionBrowserCount').getAttribute('aria-label'),/2 个对话/);
 assert.notEqual(terminal().dataset.conversationSession,'session-1','terminal and UI session IDs never collide');
 post({type:'workhub:conversation-group',split:false,sessions:[],selected:terminal().dataset.conversationSession,target:{route:'/terminals',terminal:{id:'session-1',projectID:'app'}},canSplit:true});
 assert.equal(terminal().getAttribute('aria-pressed'),'true');
 const historyCount=h.requests.filter(r=>r.url.includes('/history')).length;
 terminal().click();await settle();
 const opened=host.messages.findLast(m=>m.type==='workhub:page-open');
 assert.equal(opened.snapshot.route,'/terminals');assert.equal(opened.snapshot.terminal.id,'session-1');
 assert.equal(opened.snapshot.terminal.projectID,'app');
 assert.equal(h.requests.filter(r=>r.url.includes('/history')).length,historyCount);
 assert.equal(h.requests.some(r=>r.url==='/api/terminals'&&r.options.method==='POST'),false);
 h.input('#sessionBrowserSearch','终端');assert(terminal());assert.match(h.$('#sessionBrowserCount').getAttribute('aria-label'),/1 \/ 2 个对话/);
 h.input('#sessionBrowserSearch','no match');assert.equal(terminal(),null);
 h.input('#sessionBrowserSearch','');
 h.click('[data-conversation-status="running"]');assert(terminal());
 h.click('[data-conversation-status="waiting"]');assert.equal(terminal(),null);
 h.click('[data-conversation-status="all"]');
 const add=h.$('[data-conversation-parallel][data-conversation-terminal="session-1"]');add.click();
 assert.equal(host.messages.findLast(m=>m.type==='workhub:page-open').placement,'split');
 for (const [scope,expected] of [
  [{kind:'project',id:'backend',environment:'local'},'other'],
  [{kind:'directory',cwd:'/workspace/workspace/app',environment:'local'},'session-1'],
  [{kind:'directory',cwd:'/unrelated',environment:'local'},null],
  [{kind:'project',id:'app',environment:'remote'},null],
  [{kind:'project',id:'app',environment:'local'},'session-1'],
 ]) {
  post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope,pane:'list'}}});
  await settle();await settle();
  assert.deepEqual([...h.document.querySelectorAll('button.session-browser-item[data-conversation-terminal]')].map(b=>b.dataset.conversationTerminal),expected?[expected]:[]);
 }
 h.$('#sessionBrowserArchived').checked=true;h.$('#sessionBrowserArchived').dispatchEvent(new h.window.Event('change',{bubbles:true}));await settle();
 assert.equal(terminal(),null,'running terminals do not appear among archived UI conversations');
 h.$('#sessionBrowserArchived').checked=false;h.$('#sessionBrowserArchived').dispatchEvent(new h.window.Event('change',{bubbles:true}));await settle();
 rows[0].attached=true;post({type:'workhub:terminals-changed'});await settle();assert.equal(terminal().querySelector('.session-browser-item-status').getAttribute('aria-label'),'已打开');
 rows[0].state='exited';post({type:'workhub:terminals-changed'});await settle();assert.equal(terminal(),null);
 assert.match(h.$('#sessionBrowserCount').getAttribute('aria-label'),/1 个对话/);
});

test('parallel pane toolbar commands stay scoped to the originating conversation', async t => {
 const host = pageHost(t), h = await harness(t,false,{pageHost:host.window});
 const post = data => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post({type:'workhub:page-pane',split:true});
 post({type:'workhub:parallel-layout',split:true,zoomed:true,canZoom:true});
 assert(h.document.documentElement.hasAttribute('data-workspace-zoomed'));
 h.window.dispatchEvent(new h.window.CustomEvent('workhub:parallel-command',{detail:'zoom'}));
 assert.equal(host.messages.findLast(message=>message.type==='workhub:page-pane-command').command,'zoom');
 h.window.dispatchEvent(new h.window.CustomEvent('workhub:parallel-command',{detail:'close'}));
 assert.equal(host.messages.findLast(message=>message.type==='workhub:page-pane-command').command,'close');
 assert.equal(h.requests.some(request=>request.url.endsWith('/chat/stop')),false);
});


test('a shared single conversation restores its detail without duplicating the shared list or parallel actions', async t => {
 const host = pageHost(t), h = await harness(t,false,{pageHost:host.window});
 const post = data => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post({type:'workhub:page-pane',split:false,shared:true});
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},selected:'session-1',pane:'list'}}});
 await settle(); await settle();
 assert(h.document.documentElement.hasAttribute('data-workspace-conversation'));
 assert(!h.document.documentElement.hasAttribute('data-workspace-pane'));
 assert.equal(h.window.WorkHubPage.snapshot().conversation.pane,'detail');
 assert.equal(h.currentSession().session,'session-1');
 h.window.dispatchEvent(new h.window.CustomEvent('workhub:parallel-command',{detail:'close'}));
 assert(!host.messages.some(message=>message.type==='workhub:page-pane-command'));
});


test('delegated navigation leaves the workspace intact and shared reader layout messages retain its draft', async t => {
 const host = pageHost(t), h = await harness(t,false,{pageHost:host.window});
 const post = data => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/projects/app',environment:'local'}});
 await settle(); await settle();
 const listsBefore = h.requests.filter(request=>request.url.startsWith('/api/sessions?')).length;
 h.click('[data-view="sessions"]'); await settle(); await settle();
 assert.equal(h.window.WorkHubPage.snapshot().route,'/projects/app');
 assert(!h.document.documentElement.hasAttribute('data-workspace-conversation'));
 assert(host.messages.some(message=>message.type==='workhub:page-open' && message.snapshot.route==='/sessions'));
 assert.equal(h.requests.filter(request=>request.url.startsWith('/api/sessions?')).length,listsBefore,'only the shared navigation fetches the list');
 post({type:'workhub:page-pane',split:false,shared:true});
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},selected:'session-1',pane:'detail'}}});
 await settle(); await settle();
 h.input('#sessionChatInput','保留进入共享布局前的草稿');
 const before = h.requests.filter(request=>request.url.includes('/history')).length;
 post({type:'workhub:page-pane',split:false,shared:true});
 await settle(); await settle();
 assert.equal(h.window.WorkHubPage.snapshot().conversation.pane,'detail');
 assert.equal(h.$('#sessionBrowser').dataset.pane,'detail');
 assert.equal(h.currentSession().session,'session-1');
 assert.equal(h.$('#sessionChatInput').value,'保留进入共享布局前的草稿');
 assert.equal(h.requests.filter(request=>request.url.includes('/history')).length,before);
 h.click('[data-conversation-action="back"]'); await settle();
 assert.equal(h.window.WorkHubPage.snapshot().conversation.pane,'detail','a host-managed pane cannot reintroduce another list');
 assert(!h.requests.some(request=>request.url.endsWith('/chat/stop')));
});

test('resizing a shared list with 738 conversations does not regenerate its rows', async t => {
 const host = pageHost(t), h = await harness(t,false,{pageHost:host.window});
 for (let index=1; index<738; index++) h.sessions.push({...h.sessions[0],id:`large-${index}`,name:`对话 ${index}`});
 const post = data => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post({type:'workhub:page-navigation'});
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},pane:'list'}}});
 await settle(); await settle();
 const group = {type:'workhub:conversation-group',sessions:['session-1'],selected:'session-1',split:false,full:false,listWidth:280,targetTitle:'当前对话'};
 post(group);
 assert.equal(h.document.querySelectorAll('[data-conversation-session]').length,2);
 const row = h.$('[data-conversation-session="session-1"]'), ui = h.window.WorkHubUI;
 let renders = 0;
 h.window.WorkHubUI = {...ui,conversationList:props=>{renders++; return ui.conversationList(props);}};
 for (let width=300; width<=390; width+=10) post({...group,listWidth:width});
 assert.equal(renders,0,'width-only updates must not regenerate hundreds of rows');
 assert.equal(h.$('[data-conversation-session="session-1"]'),row);
 assert.equal(h.document.documentElement.style.getPropertyValue('--workspace-shared-list-width'),'390px');
 post({...group,selected:'large-1',targetTitle:'对话 1',listWidth:390});
 assert.equal(renders,1,'changing the active conversation still updates list selection');
 assert.equal(h.$('[data-conversation-session="large-1"]').getAttribute('aria-pressed'),'true');
});

test('dedicated conversation panes do not generate hidden lists and ordinary browsing can restore them', async t => {
 const host = pageHost(t), h = await harness(t,false,{pageHost:host.window});
 for (let index=1; index<738; index++) h.sessions.push({...h.sessions[0],id:`large-${index}`,name:`对话 ${index}`});
 const post = data => h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 const ui = h.window.WorkHubUI; let renders = 0;
 h.window.WorkHubUI = {...ui,conversationList:props=>{renders++; return ui.conversationList(props);}};
 post({type:'workhub:page-pane',split:true,shared:true});
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},selected:'session-1',pane:'detail'}}});
 await settle(); await settle();
 assert.equal(renders,0,'only the shared navigation frame should generate conversation rows');
 assert.equal(h.$('#sessionBrowserList').childElementCount,0,'previous rows must also be released');
 assert.equal(h.currentSession().session,'session-1');
 h.input('#sessionChatInput','保留对话草稿');
 await h.window.refreshConversations(true); await settle(); await settle();
 assert.equal(renders,0,'background refresh must not rebuild an invisible list');
 assert.equal(h.$('#sessionChatInput').value,'保留对话草稿');
 post({type:'workhub:page-pane',split:false,shared:false});
 h.click('[data-conversation-action="back"]'); await settle();
 assert.equal(h.document.querySelectorAll('[data-conversation-session]').length,2,'leaving host-managed conversation mode restores project previews');
 assert(renders>0);
 assert(!h.requests.some(request=>request.url.endsWith('/chat/stop')));
});

test('background list refresh updates its own status without regenerating unchanged conversation rows', async t => {
 const host=pageHost(t), h=await harness(t,false,{pageHost:host.window});
 for(let i=1;i<738;i++) h.sessions.push({...h.sessions[0],id:`large-${i}`,name:`对话 ${i}`});
 const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post({type:'workhub:page-navigation'});
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},pane:'list'}}});
 await settle();await settle();
 const ui=h.window.WorkHubUI;let renders=0;
 h.window.WorkHubUI={...ui,conversationList:props=>{renders++;return ui.conversationList(props);}};
 const row=h.$('[data-conversation-session="large-1"]');
 await h.window.refreshConversations(true);await settle();await settle();
 assert.equal(renders,0,'loading and refresh metadata do not invalidate populated rows');
 assert.equal(h.$('[data-conversation-session="large-1"]'),row);
 h.sessions[1].name='更新后的标题';
 await h.window.refreshConversations(true);await settle();await settle();
 assert.equal(renders,1,'actual visible data still updates the list');
 assert(h.$('[data-conversation-session="large-1"]').textContent.includes('更新后的标题'));
});

function expandedConversationStorage() {
 const scopeKey = JSON.stringify(['local','all','','','']);
 const groupLimits = Object.fromEntries([['local','project','app'],['local','project','backend'],['remote','project','app']].map(group => [JSON.stringify(group),1000]));
 return {['workhub:conversation-view:v1:' + scopeKey]:JSON.stringify({groupLimits})};
}

// jsdom has no layout. Model a scrollable list with 88px rows to exercise
// the actual scroll listener, batching and bounded DOM window.
function scrollableConversations(h) {
 const list=h.$('#sessionBrowserList');
 Object.defineProperty(list,'clientHeight',{configurable:true,value:300});
 Object.defineProperty(list,'scrollHeight',{configurable:true,get:()=>Number(list.dataset.loadedCount)*88+20});
 return async top=>{
  list.scrollTop=top==='bottom'?list.scrollHeight-list.clientHeight:top;
  list.dispatchEvent(new h.window.Event('scroll'));
  await new Promise(resolve=>h.window.requestAnimationFrame(resolve));await settle();
 };
}

test('conversation lists automatically append twenty rows at the bottom and keep a bounded window', async t => {
 const h=await harness(t,false,{storage:expandedConversationStorage()});
 for(let i=1;i<738;i++) h.sessions.push({...h.sessions[0],id:`batch-${i}`,name:`对话 ${i}`,chat_status:i===737?'waiting':''});
 await h.navigate('/sessions');await settle();
 const list=h.$('#sessionBrowserList'),rows=()=>[...list.querySelectorAll('[data-conversation-session]')];
 assert.equal(rows().length,19); // One slot in the first batch is the project heading.
 assert.equal(h.$('#sessionBrowserPagination'),null);
 assert.match(h.$('#sessionBrowserCount').getAttribute('aria-label'),/738 个对话/);
 const scroll=scrollableConversations(h),session=h.currentSession().session,readingState=h.currentSession();
 h.input('#sessionChatInput','自动加载保留草稿');
 await scroll('bottom');assert.equal(list.dataset.loadedCount,'40');assert.equal(rows().length,39);
 assert.equal(rows()[0].dataset.conversationSession,'session-1','appending does not replace the first batch');
 await scroll('bottom');assert.equal(list.dataset.loadedCount,'60');
 await scroll('bottom');assert.equal(list.dataset.loadedCount,'80');assert.equal(rows().length,60);
 const spacer=list.querySelector('.session-list-spacer');
 assert(spacer);
 assert(parseFloat(spacer.style.height)>0,'virtual rows retain their measured space');
 for(let i=0;i<33;i++) {await scroll('bottom');assert(rows().length<=60);}
 assert.equal(list.dataset.loadedCount,'740'); // Conversations, project heading, and preview footer.
 assert.equal(list.querySelector('[data-list-spacer="after"]'),null);
 await scroll(0);assert.equal(rows()[0].dataset.conversationSession,'session-1','scrolling up restores previous rows');
 assert.equal(h.currentSession().session,session);
 assert.equal(h.$('#sessionChatInput').value,'自动加载保留草稿');
 assert.equal(h.currentSession(),readingState,'scrolling reuses the existing conversation controller');
 h.input('#sessionBrowserSearch','对话 737');
 assert.equal(rows().length,1);assert.equal(rows()[0].dataset.conversationSession,'batch-737');
 h.input('#sessionBrowserSearch','');assert.equal(rows().length,19);
 h.click('[data-conversation-status="waiting"]');
 assert.equal(rows().length,1);assert.equal(rows()[0].dataset.conversationSession,'batch-737');
 assert(!h.requests.some(r=>r.url.endsWith('/chat/stop')));
});

test('automatic list windows survive refresh and restoration, support keyboard navigation and clamp on removal', async t => {
 const host=pageHost(t),h=await harness(t,false,{pageHost:host.window,storage:expandedConversationStorage()});
 for(let i=1;i<125;i++)h.sessions.push({...h.sessions[0],id:`batch-${i}`,name:`对话 ${i}`});
 const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},selected:'session-1',pane:'list',loadedCount:120,windowStart:80}}});await settle();await settle();
 const list=h.$('#sessionBrowserList');
 assert.equal(list.dataset.loadedCount,'120');assert.equal(list.dataset.windowStart,'80');
 await h.window.refreshConversations(true);await settle();await settle();
 assert.equal(list.dataset.windowStart,'80');
 const row=h.$('[data-conversation-session="batch-80"]');row.focus();
 row.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'PageUp',bubbles:true,cancelable:true}));
 assert.equal(h.document.activeElement.dataset.conversationSession,'batch-60');
 h.document.activeElement.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
 assert.equal(h.document.activeElement.dataset.conversationSession,'session-1');
 assert.equal(h.window.WorkHubPage.snapshot().conversation.loadedCount,120);
 h.sessions.splice(30);await h.window.refreshConversations(true);await settle();await settle();
 assert.equal(list.dataset.loadedCount,'32');assert(Number(list.dataset.windowEnd)<=32);
 assert(h.document.querySelectorAll('[data-conversation-session]').length<=30);
});

test('focusing a distant split conversation restores its window without width updates resetting browsing', async t => {
 const host=pageHost(t),h=await harness(t,false,{pageHost:host.window});
 for(let i=1;i<125;i++)h.sessions.push({...h.sessions[0],id:`batch-${i}`,name:`对话 ${i}`});
 const post=data=>h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data}));
 post({type:'workhub:page-navigation'});
 post({type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},pane:'list'}}});await settle();await settle();
 const group={type:'workhub:conversation-group',sessions:['session-1','batch-110'],selected:'session-1',full:false,listWidth:280};
 post(group);post({...group,selected:'batch-110'});
 assert.equal(h.$('[data-conversation-session="batch-110"]').getAttribute('aria-pressed'),'true');
 assert(h.document.querySelectorAll('[data-conversation-session]').length<=60);
 const scroll=scrollableConversations(h);await scroll(0);
 assert.equal(h.$('#sessionBrowserList').dataset.windowStart,'0');
 post({...group,selected:'batch-110',listWidth:400});
 assert.equal(h.$('#sessionBrowserList').dataset.windowStart,'0');
 await h.window.refreshConversations(true);await settle();await settle();
 assert.equal(h.$('#sessionBrowserList').dataset.windowStart,'0');
 post(group);assert.equal(h.$('[data-conversation-session="session-1"]').getAttribute('aria-pressed'),'true');
});

test('a restored automatic list window waits for every environment before clamping', async t => {
 const host=pageHost(t),h=await harness(t,false,{pageHost:host.window,storage:expandedConversationStorage()});
 h.environments.environments.push({id:'remote',name:'WSL'});await h.window.loadEnvironments();
 const remote=Array.from({length:124},(_,i)=>({...h.sessions[0],id:`remote-${i}`,name:`远程 ${i}`}));
 let resolveRemote;
 h.setIntercept((url,options)=>url.startsWith('/api/sessions?')&&options.headers['X-Environment-ID']==='remote'?new Promise(resolve=>{resolveRemote=resolve;}):undefined);
 h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data:{type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},selected:'session-1',loadedCount:120,windowStart:80,pane:'list'}}}}));
 await settle();await settle();assert.equal(typeof resolveRemote,'function');
 resolveRemote({ok:true,json:async()=>({sessions:remote})});await settle();await settle();
 assert.equal(h.$('#sessionBrowserList').dataset.loadedCount,'120');
 assert.equal(h.$('#sessionBrowserList').dataset.windowStart,'80');
 assert.equal(h.document.querySelectorAll('[data-conversation-session]').length,40);
});

test('appending scroll batches and evicting old rows preserve the surviving DOM nodes', async t => {
 const h=await harness(t,false,{storage:expandedConversationStorage()});
 for(let i=1;i<140;i++)h.sessions.push({...h.sessions[0],id:`stable-${i}`,name:`对话 ${i}`});
 await h.navigate('/sessions');await settle();
 const scroll=scrollableConversations(h),list=h.$('#sessionBrowserList');
 const first=h.$('[data-conversation-session="session-1"]');
 await scroll('bottom');
 assert.equal(h.$('[data-conversation-session="session-1"]'),first,'appending twenty rows must not recreate existing rows');
 await scroll('bottom');
 const survivor=h.$('[data-conversation-session="stable-40"]');
 await scroll('bottom');
 assert.equal(h.$('[data-conversation-session="stable-40"]'),survivor,'window eviction must retain surviving rows');
 assert.equal(list.querySelector('.session-browser-groups').querySelectorAll('li').length,60);
 assert.equal(list.dataset.windowEnd,list.dataset.loadedCount,'new batches must be mounted immediately at the bottom');
 assert.equal(list.querySelector('[data-list-spacer="after"]'),null,'appending must not briefly replace the new batch with blank space');
 await h.window.refreshConversations(true);await settle();await settle();
 assert.equal(h.$('[data-conversation-session="stable-40"]'),survivor);
});

test('a one pixel scroll around an estimated batch boundary does not bounce the mounted window', async t => {
 const host=pageHost(t),h=await harness(t,false,{pageHost:host.window,storage:expandedConversationStorage()});
 for(let i=1;i<100;i++)h.sessions.push({...h.sessions[0],id:`stable-${i}`,name:`对话 ${i}`});
 h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data:{type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},selected:'session-1',loadedCount:100,windowStart:20,pane:'list'}}}}));await settle();await settle();
 const list=h.$('#sessionBrowserList'),scroll=scrollableConversations(h);
 list.getBoundingClientRect=()=>({top:0,bottom:300,height:300});
 for(const row of list.querySelectorAll('[data-conversation-session]')) {
  const index=Number(row.dataset.conversationSession.split('-').at(-1)) + 1;
  row.getBoundingClientRect=()=>({top:index*88-list.scrollTop,bottom:(index+1)*88-list.scrollTop,height:88});
 }
 const anchor=h.$('[data-conversation-session="stable-40"]'),ui=h.window.WorkHubUI;let renders=0;
 h.window.WorkHubUI={...ui,conversationList:props=>{renders++;return ui.conversationList(props);}};
 for(let i=0;i<12;i++)await scroll(40*88+(i%2?1:-1));
 assert.equal(list.dataset.windowStart,'20');
 assert.equal(renders,0,'height estimates around a boundary must not trigger repeated renders');
 assert.equal(h.$('[data-conversation-session="stable-40"]'),anchor);
});


test('file tree images and outside image links use the same adjacent preview and return to selectable text', async t => {
  const h=await harness(t,true,{width:1440});
  const rendered=[];
  h.window.WorkHubFileDisplay={render(container,preview){rendered.push(preview);container.textContent=preview.text;return ()=>container.replaceChildren();}};
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1sAAAAASUVORK5CYII=';
  h.setIntercept(url=>{
    if (!url.includes('/sessions/session-1/files?')) return;
    const query=new URL(url,'http://localhost').searchParams;
    const file=query.get('file');
    return {ok:true,json:async()=>file ? file.endsWith('.png') ? {format:'image',text:'',data_url:png} : {format:'file',text:'完整文本\n可以选中复制 <script>inert</script>'} : {entries:[{name:'project.png',path:'project.png',directory:false},{name:'read.ts',path:'read.ts',directory:false}],truncated:false}};
  });
  await h.openConversations('project');
  h.click('#toggleConversationFiles');await settle();
  h.click('#conversationFilesFiles [data-change-file="project.png"]');await settle();
  assert.equal(h.$('#conversationFilesText img').getAttribute('src'),png);
  assert.equal(rendered.length,0,'image preview does not load the text/diff renderer');
  const outside='/outside/design/project.png';
  const ref=new h.window.CustomEvent('workhub:open-file',{cancelable:true,detail:{session:'session-1',environment:'local',path:outside,line:1}});
  assert.equal(h.window.dispatchEvent(ref),false);await settle();
  assert.equal(h.$('#conversationFilesDock').hidden,false);
  assert.equal(h.$('#conversationFilesDialog').open,false);
  assert.equal(h.$('#conversationFilesText img').getAttribute('src'),png);
  assert.equal(h.$('.file-preview-path').textContent,outside);
  assert.equal(h.$('#conversationFilesFiles [data-change-file="'+outside+'"]').getAttribute('aria-pressed'),'true');
  h.click('#conversationFilesFiles [data-change-file="read.ts"]');await settle();
  assert.equal(h.$('#conversationFilesText img'),null);
  assert.equal(h.$('#conversationFilesText script'),null);
  assert.match(h.$('#conversationFilesText').textContent,/完整文本\n可以选中复制 <script>inert/);
  assert.equal(rendered.length,1);
  h.click('#conversationFilesFiles [data-change-file="project.png"]');await settle();
  h.$('#conversationFilesText img').dispatchEvent(new h.window.Event('error'));await settle();
  assert.match(h.$('#conversationFilesText [role="alert"]').textContent,/图片无法显示/);
});

test('clone project mode infers the folder, uses the selected environment and registers the result', async t => {
 const h=await harness(t);
 h.setIntercept((url)=>url==='/api/projects/clone'?{ok:true,json:async()=>({id:'cloned'})}:null);
 h.window.openProject();
 assert(h.$('#projectCloneURL').disabled);
 h.change('#projectSource','clone');
 assert.equal(h.$('#projectCloneFields').hidden,false);
 assert.equal(h.$('#projectCloneURL').required,true);
 assert.match(h.$('#projectPath-label').textContent,/存放目录/);
 h.input('#projectCloneURL','git@github.com:team/repo.git');
 assert.equal(h.$('#projectCloneDirectory').value,'repo');
 h.input('#projectCloneDirectory','custom');
 h.input('#projectCloneURL','https://github.com/team/another.git');
 assert.equal(h.$('#projectCloneDirectory').value,'custom','manual folder names are retained');
 h.input('#projectPath','/home/tester/projects');h.input('#projectName','My clone');
 await h.submit('#projectForm');
 const request=h.requests.find(r=>r.url==='/api/projects/clone');
 assert.deepEqual(request.body,{name:'My clone',url:'https://github.com/team/another.git',parent:'/home/tester/projects',directory:'custom'});
 assert.equal(request.options.headers['X-Environment-ID'],'local');
 assert.equal(h.$('#projectDialog').open,false);
});

test('clone failures preserve inputs and switching back restores local registration', async t => {
 const h=await harness(t);
 h.setIntercept(url=>url==='/api/projects/clone'?{ok:false,json:async()=>({error:'Authentication failed'})}:null);
 h.window.openProject();h.change('#projectSource','clone');
 h.input('#projectCloneURL','https://github.com/team/repo.git');h.input('#projectPath','/home/tester/projects');
 await h.submit('#projectForm');
 assert(h.$('#projectDialog').open);
 assert.equal(h.$('#projectError').hidden,false);
 assert.match(h.$('#projectError').textContent,/Authentication failed/);
 assert.equal(h.$('#projectCloneURL').value,'https://github.com/team/repo.git');
 assert.equal(h.$('#projectCloneDirectory').value,'repo');
 h.change('#projectSource','local');
 assert(h.$('#projectCloneFields').hidden);
 assert(h.$('#projectCloneURL').disabled);
 assert.equal(h.$('#projectCloneURL').required,false);
 assert.match(h.$('#projectSubmit').textContent,/添加并扫描/);
});

test('clone errors stay in the dialog when its selected environment differs from the current page', async t => {
 const h=await harness(t);
 h.environments.environments.push({id:'wsl-test',name:'WSL'});
 await h.window.loadEnvironments();
 h.setIntercept(url=>url==='/api/projects/clone'?{ok:false,json:async()=>({error:'Remote authentication failed'})}:null);
 h.window.openProject(null,'wsl-test');h.change('#projectSource','clone');
 h.input('#projectCloneURL','git@github.com:team/repo.git');h.input('#projectPath','/home/tester/projects');
 await h.submit('#projectForm');
 assert.equal(h.requests.find(r=>r.url==='/api/projects/clone').options.headers['X-Environment-ID'],'wsl-test');
 assert(h.$('#projectDialog').open);
 assert.equal(h.$('#projectError').hidden,false);
 assert.match(h.$('#projectError').textContent,/Remote authentication failed/);
 assert.equal(h.$('#chooseProjectDirectory').disabled,true);
});


test('directory scan invalidates results on input changes and retains failed scan inputs', async t => {
  const h = await harness(t, false, {route:'/projects'});
  let fail = false;
  h.setIntercept(url => url === '/api/projects/scan' ? {ok:!fail,json:async()=>fail ? {error:'Directory is unavailable'} : {repositories:[],warnings:[],truncated:false}} : null);
  h.window.openProject(); h.change('#projectSource','scan'); h.input('#projectPath','/empty');
  await h.submit('#projectForm');
  assert.match(h.$('#projectScanResults').textContent,/未发现/);
  assert.equal(h.$('#projectSubmit').disabled,true);
  h.input('#projectPath','/missing');
  assert.equal(h.$('#projectSubmit').disabled,false);
  assert(h.$('#projectScanResults').hidden);
  fail = true;
  await h.submit('#projectForm');
  assert.equal(h.$('#projectPath').value,'/missing');
  assert.match(h.$('#projectError').textContent,/Directory is unavailable/);
  assert.equal(h.$('#projectSubmit').disabled,false);
  assert.equal(h.$('#projectEnvironmentSelect').disabled,false);
  h.change('#projectSource','local');
  assert.equal(h.$('#projectName').disabled,false);
  assert.equal(h.$('#projectRescan').hidden,true);
});

test('resource icons edit only the active detail, persist without browser storage and retain failed drafts', async t => {
  const saved = {local:{icons:{'project:app':{icon:'code',color:'theme'}}}};
  const h = await harness(t, false, {pins:saved, storageUnavailable:true});
  assert.equal(h.$('#conversationShortcuts, #shortcutIconSettings, #openYoluAssistant'), null);
  const trigger = h.$('.project-detail-title [data-resource-icon-edit]') || h.$('.project-detail-heading [data-resource-icon-edit]');
  trigger.focus();trigger.click();await settle();
  assert(h.$('.shortcut-icon-dialog').open);
  assert.equal(h.$('#shortcutIconEntry'),null);
  assert.equal(h.$('.shortcut-icon-dialog .shortcut-color-swatch'),null);
  assert.equal(h.$('.shortcut-icon-dialog [aria-label="名称缩写"]'),null);
  h.click('.shortcut-icon-dialog .shortcut-icon-random');await settle();
  h.click('.shortcut-icon-dialog [aria-label="火箭"]');await settle();
  await h.submit('.shortcut-icon-dialog form');
  assert.deepEqual(saved.local.icons['project:app'],{icon:'rocket',color:'theme'});
  assert.equal(h.$('.shortcut-icon-dialog').open,false);
  assert.equal(h.document.activeElement,trigger);
  await h.navigate('/projects/backend');
  assert(h.$('#projectDetail [data-resource-icon-edit]'));
  h.click('#projectDetail [data-resource-icon-edit]');await settle();
  h.click('.shortcut-icon-dialog [aria-label="问题修复"]');await settle();
  await h.window.refresh(true);await settle();
  h.setIntercept((url,options)=>url.startsWith('/api/resource-icons') && options.method === 'PUT' ? {ok:false,json:async()=>({error:'Save failed'})}:null);
  await h.submit('.shortcut-icon-dialog form');
  assert.equal(h.$('.shortcut-icon-dialog').open,true);
  assert.match(h.$('.shortcut-icon-dialog [role="alert"]').textContent,/Save failed/);
  assert.equal(h.$('.shortcut-icon-dialog [aria-label="问题修复"]').getAttribute('aria-pressed'),'true');
  h.setIntercept(null);await h.submit('.shortcut-icon-dialog form');
  assert.equal(saved.local.icons['project:backend'].icon,'bug');
  assert.equal(saved.local.icons['project:backend'].color,'theme');
  assert.equal(h.document.activeElement,h.$('#projectDetail [data-resource-icon-edit]'));
  assert.equal(saved.local.icons['project:app'].icon,'rocket');
});

test('creation directory choices show primary repositories and search all roots from a bounded picker', async t => {
  const host = pageHost(t);
  const projects = [
    {
      id: 'agent', name: 'noah-mind-agent', path: '/repos/agent',
      worktrees: [
        {path: '/repos/agent', branch: 'feature/v2.1'},
        {path: '/workspaces/wt-alpha', branch: '', detached: true, head: '1234567890'},
        {path: '/workspaces/wt-beta', branch: '', detached: true, head: '1234567890'},
        {path: '/workspaces/wt-gamma', branch: 'codex/feature-a'},
      ],
    },
    {id: 'yolu', name: 'yolu', path: '/repos/yolu', worktrees: [{path: '/repos/yolu', branch: 'main'}]},
    {id: 'mcp', name: 'noah-mind-mcp', path: '/repos/mcp', worktrees: [{path: '/repos/mcp', branch: 'main'}]},
    {id: 'svc', name: 'noah-mind-svc', path: '/repos/svc', worktrees: [{path: '/repos/svc', branch: 'main'}]},
  ];
  const draft = await harness(t, false, {pageHost: host.window, intercept: (url) => {
    if (url === '/api/state' || url.startsWith('/api/state?')) {
      return {ok: true, json: async () => ({root: '/workspace', projects, terminal: {platform: 'linux', available: true, settings: {kind: 'auto'}, supported_kinds: ['auto', 'custom'], supported_styles: ['command', 'otty'], launcher: '/usr/bin/terminal', message: '终端已就绪'}})};
    }
    return null;
  }});
  const post = data => draft.window.dispatchEvent(new draft.window.MessageEvent('message', {source: host.window, origin: 'http://localhost:4317', data}));
  post({type: 'workhub:page-restore', active: true, snapshot: {route: '/sessions', environment: 'local', conversation: {scope: {kind: 'all'}, creating: true, creationDirectory: '', pane: 'detail'}}});
  await settle(); await settle();
  const buttons = () => [...draft.document.querySelectorAll('#sessionBrowserDirectoryChoices button[data-creation-choice]')];
  const labels = buttons().map(b => b.textContent);
  assert.equal(labels[0], '默认目录（无需项目）');
  assert.ok(labels.every(label => !label.includes('· 本机')), `redundant local suffix found: ${labels.join(' | ')}`);
  assert.equal(new Set(labels).size, labels.length, `duplicate labels found: ${labels.join(' | ')}`);
  assert.ok(labels.every(label => !label.includes('detached') && !label.includes('wt-')));
  assert.equal(labels.length,5);
  assert.equal(draft.$('.creation-choices-filter'),null);
  assert.equal(draft.$('#sessionBrowserNewDirectory').options.length,5);
  assert(draft.$('#sessionBrowserDirectoryChoices .creation-more'));
});

test('creation folder shortcuts validate the selected root, retain it in snapshots and preserve drafts on cancellation', async t => {
  const host=pageHost(t);
  let selected='/home/tester/new-project';
  const h=await harness(t,false,{pageHost:host.window,intercept:(url,options)=>{
    if(url==='/api/dialogs/directory') return {ok:true,json:async()=>({path:selected})};
    if(url==='/api/session-bindings/inspect') return {ok:true,json:async()=>({directory:JSON.parse(options.body).directory,branch:'main',main_directory:selected,access:'write'})};
    return null;
  }});
  h.window.dispatchEvent(new h.window.MessageEvent('message',{source:host.window,origin:'http://localhost:4317',data:{type:'workhub:page-restore',active:true,snapshot:{route:'/sessions',environment:'local',conversation:{scope:{kind:'all'},creating:true,pane:'detail'}}}}));
  await settle();await settle();
  h.input('#sessionChatInput','保留本地目录草稿');
  h.$('.creation-directory-footer').click();await settle();await settle();
  assert.equal(h.currentSession().target.cwd,selected);
  assert.equal(h.$('#sessionBrowserNewDirectory').value,selected);
  const snapshot=h.window.WorkHubPage.snapshot();
  assert.equal(snapshot.conversation.creationLocalDirectories[0].cwd,selected);
  selected='';h.$('.creation-directory-footer').click();await settle();
  assert.equal(h.currentSession().target.cwd,'/home/tester/new-project');
});


test('default agent saves independently from the agent being configured', async t => {
  const h = await harness(t, true, {route:'/settings'});
  assert.equal(h.$('#defaultAgentSelect').value, 'codex');
  h.change('#defaultAgentSelect', 'agy'); await settle();
  assert.equal(h.data.default_agent, 'agy');
  assert.equal(h.$('#conversationDefaultProviderGroup input:checked').value, 'codex');
  h.click('#conversationDefaultProviderGroup input[value="agy"]'); await settle();
  h.click('#conversationDefaultProviderGroup input[value="codex"]'); await settle();
  assert.equal(h.data.default_agent, 'agy');
  assert.equal(h.$('#defaultAgentSelect').value, 'agy');
  h.setIntercept((url, options) => url === '/api/settings/default-agent' && options.method === 'PUT' ? {ok:false,json:async()=>({error:'Agent save failed'})} : undefined);
  h.change('#defaultAgentSelect', 'codex'); await settle();
  assert.equal(h.data.default_agent, 'agy');
  assert.equal(h.$('#defaultAgentError').hidden, false);
  assert.equal(h.$('#defaultAgentSelect').value, 'codex');
  h.setIntercept(() => undefined);
  h.click('#defaultAgentRetry'); await settle();
  assert.equal(h.data.default_agent, 'codex');
});

test('settings descriptions appear in help tips with focus and Escape support', async t => {
  const h = await harness(t, true, {route:'/settings'});
  assert.equal(h.$('.settings-row-info > p'), null);
  const tip=h.$('#sessionTitleHelp');
  const trigger=tip.parentElement.querySelector('button');
  assert.equal(tip.hidden,true);
  trigger.focus();
  assert.equal(tip.hidden,false);
  h.window.document.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(tip.hidden,true);
  h.click('#conversationDefaultPermission input[value="full"]'); await settle();
  assert.equal(h.$('#conversationDefaultPermissionHelp').hidden,true);
  assert.equal(h.$('#conversationDefaultPermissionHelp').dataset.danger,'true');
  assert.match(h.$('#conversationDefaultPermissionHelp').textContent,/沙箱/);
});
