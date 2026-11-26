const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
require('tsx/cjs');
const { workspaceUI } = require('../frontend/app/bridge/workspace-ui.tsx');
const { JSDOM } = require('jsdom');
const markup = html => new JSDOM(html).window.document;

function snapshot(updatedAt = '2026-10-22T05:23:13Z', refreshing = false) {
  const tree = { path: '/workspace/app', branch: 'codex/workspace', dirty: 0, refreshing };
  if (updatedAt) tree.status_updated_at = updatedAt;
  return {
    root: '/workspace', terminal: {}, status_refreshing: refreshing,
    projects: [{ id: 'app', name: 'app', path: '/repo/app', has_master: true, refreshing, ...(updatedAt ? { status_updated_at: updatedAt } : {}), worktrees: [tree] }],
  };
}

function harness({ readOnly = false } = {}) {
  const elements = new Map();
  let mockDocument;
  const element = selector => {
    if (!elements.has(selector)) {
      let html = '';
      elements.set(selector, {
        get ownerDocument() { return mockDocument; },
        content: selector === 'meta[name="ui-language"]' ? 'zh-CN' : selector === 'meta[name="session-mode"]' ? (readOnly ? 'read-only' : 'interactive') : 'token',
        value: '', checked: false, hidden: false, writes: 0, scrollTop: 0, dataset: {},
        style: {setProperty() {}}, getBoundingClientRect() { return {width: 0}; },
        append() {}, insertBefore() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, getAttribute() { return null; }, replaceChildren() {}, hasAttribute() { return false; },
        querySelector: element, contains() { return false; }, closest() { return null; },
        classList: { toggle() {}, remove() {}, add() {}, contains() { return false; } }, addEventListener() {}, querySelectorAll() { return []; },
        get innerHTML() { return html; },
        set innerHTML(value) { html = value; this.writes++; }
      });
    }
    return elements.get(selector);
  };
  const times = [];
  const timers = [];
  const ready = [];
  const requests = [];
  let result;
  let failure;
  const context = vm.createContext({
    document: {
      body: element('body'),
      documentElement: element('html'),
      querySelector: element,
      getElementById: id => element("#" + id),
      querySelectorAll: selector => selector === '#content time[data-status-path]' ? times : [],
      addEventListener() {}
    },
    window: { WorkHubUI: workspaceUI, dispatchEvent() {}, addEventListener(event, handler) { if (event === 'DOMContentLoaded') ready.push(handler); } }, Headers, Response, URL, location: { hash: '#/projects/app', search: '' }, URLSearchParams, DOMException, CustomEvent: class {},
    setTimeout: (callback, delay) => { timers.push(delay); return timers.length; },
    clearTimeout() {}, renderSettings() {}, loadGit() {}, loadWorktree() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (failure) throw failure;
      if (url.startsWith('/api/shortcut-pins?')) return { ok: true, json: async () => ({workspaces:[], directories:[], initialized:true}) };
      if (url === '/api/environments') return { ok: true, json: async () => ({ environments: [{ id: 'local', name: '本机' }], distributions: [], platform: result?.terminal?.platform, wsl_supported: result?.terminal?.platform === 'darwin' ? false : undefined }) };
      if (url.endsWith('/sessions') || url.startsWith('/api/sessions?')) return { ok: true, json: async () => ({ sessions: [] }) };
      return { ok: true, json: async () => structuredClone(result) };
    }
  });
  mockDocument = context.document;
  context.document.defaultView = context.window;
  // This VM isolates state refresh. Full settings DOM flows live in app-ui.test.cjs.
  const scripts = ['ui/browser-runtime.js', 'core/core.js', 'features/projects/projects.js', 'core/app.js', 'core/resource-navigation.js'];
  for (const file of scripts) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../web', file), 'utf8'), context, { filename: file });
  }
  vm.runInContext("renderProjectPage = (markup) => { $('#content').innerHTML = markup; };",context);
  vm.runInContext("var environmentInventory = [];",context);
  context.readRoute();
  return {
    context, element, times, timers, requests,
    async start(data) { result = data; ready.forEach(handler => handler()); await new Promise(resolve => setImmediate(resolve)); },
    async refresh(data, force = false) { result = data; failure = null; await context.refresh(force); },
    async fail() { failure = new Error('offline'); await context.refresh(); }
  };
}

test('explicit environment calls survive navigation while old ambient calls are rejected', async () => {
  const h = harness();
  await h.refresh(snapshot());
  const ambient = vm.runInContext("api('/api/state')", h.context);
  const explicit = vm.runInContext("api('/api/state', {environment:'wsl-ubuntu'})", h.context);
  vm.runInContext('environmentRevision += 2', h.context);
  await assert.rejects(ambient, /执行环境已切换/);
  await explicit;
  assert.equal(new Headers(h.requests.at(-1).options.headers).get('X-Environment-ID'), 'wsl-ubuntu');
});

test('background refresh keeps the worktree cards and only updates the open Git status time', async () => {
  const h = harness();
  h.context.projectDetailView('app').cards.set('/workspace/app', {expanded:true, section:'git'});
  await h.refresh(snapshot());
  await h.context.refreshProjectConversations();
  const content = h.element('#content');
  const writes = content.writes;
  assert.match(content.innerHTML, /上次检查 <time/);
  let datetime = '2026-10-22T05:23:13Z';
  const time = {
    dataset: { statusPath: '/workspace/app' },
    textContent: new Date(datetime).toLocaleTimeString('zh-CN', { hour12: false }),
    getAttribute() { return datetime; }, setAttribute(name, value) { datetime = value; }
  };
  h.times.push(time);
  // The backend returns its previous result while a scan is running.
  await h.refresh(snapshot('2026-10-22T05:23:13Z', true));
  assert.equal(content.writes, writes);
  assert.equal(h.timers.at(-1), 1000);
  assert.doesNotMatch(content.innerHTML, /更新中/);
  // A completed scan with identical Git data must not replace focused buttons.
  await h.refresh(snapshot('2026-10-22T05:23:24Z'));
  assert.equal(content.writes, writes);
  assert.equal(h.times[0], time);
  assert.equal(datetime, '2026-10-22T05:23:24Z');
  assert.equal(time.textContent, new Date(datetime).toLocaleTimeString('zh-CN', { hour12: false }));
  assert.equal(h.timers.at(-1), 10000);
  await h.refresh(snapshot('2026-10-22T05:23:24Z', true), true);
  assert.equal(content.writes, writes);
});

test('the first completed check enables project actions even with no Git changes', async () => {
  const h = harness();
  await h.refresh(snapshot(null, true));
  assert.match(h.element('#content').innerHTML, /正在检查/);
  assert.equal(markup(h.element('#content').innerHTML).querySelector('[data-project-open-primary]').disabled, true);
  await h.context.refreshProjectConversations();
  const writes = h.element('#content').writes;
  await h.refresh(snapshot());
  assert.equal(h.element('#content').writes, writes + 1);
  assert.equal(markup(h.element('#content').innerHTML).querySelector('[data-project-open-primary]').disabled, false);
  assert.equal(markup(h.element('#content').innerHTML).querySelector('.directory-local-status').textContent, '干净');
});

test('real status changes are rendered, including errors and branch drift', async () => {
  for (const patch of [{ dirty: 2 }, { branch: 'other' }, { missing: true }, { error: 'Git failed' }, { ahead: 1, behind: 2, compare_available: true }]) {
    const h = harness();
    await h.refresh(snapshot());
    await h.context.refreshProjectConversations();
    const writes = h.element('#content').writes;
    const next = snapshot('2026-10-22T05:23:24Z');
    Object.assign(next.projects[0].worktrees[0], patch);
    await h.refresh(next);
    assert.equal(h.element('#content').writes, writes + 1, JSON.stringify(patch));
  }
});

test('connection failures retain the last worktree cards and recover without rebuilding them', async () => {
  const h = harness();
  await h.refresh(snapshot());
  await h.context.refreshProjectConversations();
  const writes = h.element('#content').writes;
  await h.fail();
  assert.equal(h.element('#content').writes, writes);
  assert.equal(h.element('#offlineBanner').hidden, false);
  await h.refresh(snapshot('2026-10-22T05:23:24Z'));
  assert.equal(h.element('#content').writes, writes);
  assert.equal(h.element('#offlineBanner').hidden, true);
});
