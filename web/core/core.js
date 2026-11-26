'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


const $ = (q, root = document) => root.querySelector(q);
const token = $('meta[name="csrf-token"]').content;
let sessionReadOnly = $('meta[name="session-mode"]')?.content === 'read-only';
let activeEnvironment = new URLSearchParams(location.search).get('environment') || 'local';
let environmentRevision = 0;
function environmentName(id = activeEnvironment) {
  if (id === 'local') return uiText('本机');
  const entries = typeof environmentInventory !== 'undefined' ? environmentInventory : [];
  return entries.find(e => e.id === id)?.name || id;
}
const state = { view: 'sessions', projects: [], selectedProject: null, root: '', terminal: {}, busy: false, refreshing: false, loaded: false };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const allTrees = () => state.projects.flatMap(p => p.worktrees);
let toastTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toastMessage').textContent = message;
  if (window.WorkHubUI.notifyWorkspace) {
    $('#toast').hidden = true;
    window.WorkHubUI.notifyWorkspace(message, error);
    return;
  }
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 9000 : 4500);
}

// Legacy controllers supply context; the checked module owns transport,
// stale-response rejection and structured API errors.
const api = window.WorkHubBrowser.createAPIClient({
  token,
  context: () => ({environment:activeEnvironment, revision:environmentRevision}),
  text: message => uiText(message),
  read: (path, init) => {
    const shared = window.parent !== window ? window.parent?.WorkHubApp : null;
    return shared ? shared.read(path, init) : fetch(path, init);
  },
});

const operations = window.WorkHubUI.createOperations();
const conversationRequests = window.WorkHubUI.createSessionRequests();
function syncMutationControls() {
  const pending = operations.snapshot();
  const active = new Set(pending.map(item => String(item.id)));
  document.querySelectorAll('[data-operation-disabled]').forEach(control => {
    if (!active.has(control.dataset.operationDisabled)) {
      control.disabled = control.dataset.operationWasDisabled === 'true';
      delete control.dataset.operationDisabled; delete control.dataset.operationWasDisabled;
    }
  });
  for (const operation of pending) {
    if (operation.environment !== activeEnvironment) continue;
    const roots = operation.project ? [...document.querySelectorAll('[data-project-id]')].filter(node => node.dataset.projectId === operation.project) : [];
    const controls = roots.flatMap(root => [...root.querySelectorAll('button[data-action]:not([data-action="copy-path"]):not([data-action="changes-open"])')]);
    for (const control of controls) {
      if (!control.dataset.operationDisabled) control.dataset.operationWasDisabled = String(control.disabled);
      control.dataset.operationDisabled = String(operation.id); control.disabled = true;
    }
  }
  $('#busyPanel').hidden = !pending.length;
  if (pending.length) $('#busyTitle').textContent = pending[pending.length - 1].title + (pending.length > 1 ? uiText("（共 {0} 项操作）", pending.length) : '');
}
function blockingMutationDialog() { return document.querySelector('dialog[open][data-block-close]'); }
async function mutation(title, fn, errorElement, options = {}) {
  const scope = errorElement?.closest?.('dialog') || options.scope || null;
  const environment = options.environment || activeEnvironment;
  const key = options.key || (options.project ? 'project:' + options.project : scope?.id || title);
  const operation = operations.begin({key, environment, title, project: options.project});
  if (!operation) { toast(uiText("同一工作现场的操作仍在进行，请稍候")); return; }
  if (scope) {
    scope.dataset.mutation = String(operation.id);
    if (!options.background) scope.dataset.blockClose = '';
    for (const control of scope.querySelectorAll('button,input,select,textarea')) {
      if (options.background && control.classList.contains('close-dialog')) continue;
      control.dataset.operationWasDisabled = String(control.disabled);
      control.dataset.operationDisabled = String(operation.id); control.disabled = true;
    }
  }
  syncMutationControls();
  if (errorElement) errorElement.hidden = true;
  const isCurrent = options.isCurrent || (() => environment === activeEnvironment && (!scope || scope.dataset.mutation === String(operation.id)));
  try { await fn(); }
  catch (error) {
    if (errorElement && isCurrent()) { errorElement.textContent = error.message; errorElement.hidden = false; } else toast(title + '：' + error.message, true);
    if (error.command && isCurrent()) showCommand(error.command);
  } finally {
    operations.end(operation);
    if (scope?.dataset.mutation === String(operation.id)) { delete scope.dataset.mutation; delete scope.dataset.blockClose; }
    syncMutationControls();
    await refresh();
  }
}

function showCommand(command) {
  $('#commandTitle').textContent = uiText("终端命令");
  $('#commandDialog .dialog-description').textContent = uiText("在当前执行环境的终端执行以下命令；Windows 本机使用 PowerShell。");
  $('#commandText').value = command; if (!$('#commandDialog').open) $('#commandDialog').showModal();
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast(uiText("已复制到剪贴板")); }
  catch { showCommand(text); toast(uiText("请在弹窗中选择并复制内容")); }
}
