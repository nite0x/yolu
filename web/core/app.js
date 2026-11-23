'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


let refreshTimer, refreshRequest;
const projectListMemory = new Map();
let projectListEnvironment = null;

function saveProjectListView(target) {
  if (projectListEnvironment === null) return;
  const row = target || document.activeElement?.closest?.('#projectListPane [data-action="select-project"]');
  const previous = projectListMemory.get(projectListEnvironment);
  projectListMemory.set(projectListEnvironment, {
    search: $('#search').value, filter: projectFilter,
    scrollTop: $('.project-list-scroll')?.scrollTop || 0, focus: row?.dataset.id || previous?.focus,
  });
}
function restoreProjectListPosition(focus) {
  const saved = projectListMemory.get(activeEnvironment);
  const list = $('.project-list-scroll');
  if (!saved || !list) return;
  list.scrollTop = saved.scrollTop;
  if (!focus || !saved.focus) return;
  const row = [...document.querySelectorAll('#projectListPane [data-action="select-project"]')].find(row => row.dataset.id === saved.focus);
  (row || $('#panelTitle')).focus({preventScroll:true});
}
function changeListFilters() {
  if (projectListEnvironment !== null) {
    const saved = projectListMemory.get(projectListEnvironment);
    if (saved) saved.focus = null;
    const list = $('.project-list-scroll');
    if (list) list.scrollTop = 0;
  }
  render();
}
window.addEventListener('pagehide', () => saveProjectListView());

function refresh(force = false) {
  const revision = environmentRevision;
  if (state.refreshing) {
    if (!force) return refreshRequest;
    return refreshRequest.then(() => revision === environmentRevision ? refresh(true) : 'cancelled');
  }
  refreshRequest = refreshProjectState(force, revision);
  return refreshRequest;
}

async function refreshProjectState(force, revision) {
  clearTimeout(refreshTimer);
  let nextRefresh = 10000;
  let result = 'cancelled';
  state.refreshing = true;
  $('#refreshButton').disabled = true;
  try {
    const data = await api('/api/state' + (force ? '?refresh=1' : ''));
    if (revision !== environmentRevision) return 'cancelled';
    const changed = !state.loaded || renderStateKey(state) !== renderStateKey(data);
    Object.assign(state, data, {loaded:true});
    if (typeof data.read_only_sessions === 'boolean') sessionReadOnly = data.read_only_sessions;
    const failures = environmentInventory.filter(e => e.error).map(e => e.name + '：' + e.error);
    $('#offlineBanner').textContent = failures.join('\n');
    $('#offlineBanner').hidden = !failures.length;
    const pending = !!data.status_refreshing;
    nextRefresh = pending ? 1000 : 10000;
    $('#syncText').textContent = failures.length ? uiText("部分环境异常") : pending ? uiText("更新中…") : uiText("已更新");
    $('#syncText').title = failures.length ? failures.join('\n') : pending ? uiText("正在更新状态，当前显示最近结果") : uiText("状态已更新");
    $('#syncDot').classList.toggle('offline', !!failures.length);
    $('#syncDot').classList.toggle('updating', pending && !failures.length);
    if (changed) render();
    else updateCheckTimes();
    if (typeof refreshConversations === 'function') void refreshConversations(false);
    result = failures.length ? 'failed' : pending ? 'pending' : 'updated';
  } catch (error) {
    if (revision !== environmentRevision || error.name === 'AbortError') return 'cancelled';
    $('#offlineBanner').textContent = uiText("状态刷新失败：") + error.message;
    $('#offlineBanner').hidden = false;
    $('#syncText').textContent = uiText("连接中断");
    $('#syncText').title = error.message;
    $('#syncDot').classList.remove('updating');
    $('#syncDot').classList.add('offline');
    result = 'failed';
  } finally {
    if (revision === environmentRevision) {
      state.refreshing = false;
      $('#refreshButton').disabled = false;
      refreshTimer = setTimeout(() => { if (!document.hidden && window.WorkHubPage?.active !== false) void refresh(); }, nextRefresh);
      window.dispatchEvent(new CustomEvent('workhub:app-refreshed', {detail:result}));
    }
  }
  return result;
}

function renderStateKey(data) {
  return JSON.stringify([data.projects, data.terminal, data.root, data.read_only_sessions], function (key, value) {
    if (key === 'refreshing' && this.status_updated_at) return undefined;
    if (key === 'status_updated_at') return Boolean(value);
    return value;
  });
}

function updateCheckTimes() {
  const trees = new Map(allTrees().map(t => [t.path, t]));
  document.querySelectorAll('#content time[data-status-path]').forEach(time => {
    const updatedAt = trees.get(time.dataset.statusPath)?.status_updated_at;
    if (!updatedAt) return;
    const checked = new Date(updatedAt).toLocaleTimeString(window.YoluI18n?.locale || 'zh-CN', { hour12: false });
    if (time.textContent !== checked) time.textContent = checked;
    if (time.getAttribute('datetime') !== updatedAt) time.setAttribute('datetime', updatedAt);
  });
}

function readRoute() {
  saveProjectListView();
  projectListEnvironment = null;
  const rawRoute = location.hash.slice(1);
  const route = rawRoute.split('?')[0];
  const project = route.match(/^\/projects\/([a-zA-Z0-9_-]+)(?:\/(git|worktrees))?$/);
  state.selectedProject = project ? project[1] : null;
  projectDetailOpen = !!project;
  state.view = route === '/settings' ? 'settings' : route === '/issues' ? 'issues' : route === '/projects' || project ? 'projects' : 'sessions';
  $('#projectFilters').open = false;
  readResourceLocation(rawRoute);
  window.dispatchEvent(new CustomEvent('workhub:route-read'));
}

$('#openLinear').addEventListener('click', async event => {
  if (!document.documentElement.hasAttribute('data-workhub-platform')) return;
  event.preventDefault();
  try { await api('/api/issues/open-linear', {method:'POST',environment:'local'}); }
  catch (error) { toast(error.message,true); }
});

function navigate(route) {
  if (location.hash === '#' + route) { readRoute(); render(); return; }
  const previous = location.href, url = new URL(previous);
  url.hash = route;
  history[window.WorkHubPage ? 'replaceState' : 'pushState'](null,'',url);
  window.dispatchEvent(new HashChangeEvent('hashchange',{oldURL:previous,newURL:url.href}));
}
window.addEventListener('hashchange', () => {
  const previousView = state.view;
  readRoute();
  render();
  focusResourcePage();
  if (previousView !== 'projects' || state.view !== 'projects' || !state.loaded) void refresh();
});
function render() {
  saveProjectListView();
  const projectsView = state.view === 'projects';
  const sessionsView = state.view === 'sessions';
  const projectListView = projectsView && !projectDetailOpen;
  const returningToProjects = projectListView && projectListEnvironment !== activeEnvironment;
  if (returningToProjects) {
    const saved = projectListMemory.get(activeEnvironment);
    $('#search').value = saved?.search || '';
    projectFilter = saved?.filter || 'all';
  }
  projectListEnvironment = projectListView ? activeEnvironment : null;
  document.body.classList.toggle('projects-page', projectsView);
  document.body.classList.toggle('sessions-page-open', sessionsView);
  rememberResourceVisit();
  let title = uiText("对话");
  if (projectsView) title = state.projects.find(p => projectDetailOpen && p.id === state.selectedProject)?.name || uiText("项目");
  else if (state.view === 'settings') title = uiText("设置");
  else if (state.view === 'issues') title = uiText("任务");
  document.title = title + ' · Yolu';
  $('#settingsPage').hidden = state.view !== 'settings';
  $('#issuesPage').hidden = state.view !== 'issues';
  $('#workContent').hidden = !projectsView;
  $('#sessionsPage').hidden = !sessionsView;
  $('#projectCount').textContent = state.loaded ? state.projects.length : '…';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === (document.documentElement.dataset.workspaceMainView || state.view);
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const listFilter = $('#projectFilters');
  listFilter.hidden = !projectListView;
  const filterCount = Number(projectFilter !== 'all') + Number(activeEnvironment !== 'local');
  const filterLabel = uiText("筛选") + (filterCount ? ' · ' + filterCount : '');
  listFilter.toggleAttribute('data-active', !!filterCount);
  const summary = listFilter.querySelector('summary');
  summary.title = filterLabel;
  summary.setAttribute('aria-label', filterLabel);
  $('#clearListSearch').hidden = !$('#search').value;
  syncProjectPage();
  renderSettings();
  if (typeof syncConversations === 'function') syncConversations();
  if (!projectsView) return;
  const focusedDirectory = document.activeElement?.matches('[data-directory-path]') && document.activeElement.dataset.directoryPath === resourceLocation.directory;
  const focusedProject = projectListView && document.activeElement?.closest?.('#projectListPane [data-action="select-project"]');
  renderProjectPage(renderProjects());
  syncMutationControls();
  if (projectListView) restoreProjectListPosition(returningToProjects || !!focusedProject);
  if (focusedDirectory && !document.body.classList.contains('project-tool-page')) resourceLocation.locate = true;
  locateResourceDirectory();
  if (typeof renderResourceIcons === 'function') renderResourceIcons();
}

async function handleAction(action, target) {
  if (state.busy) return;
  const id = target.dataset.id;
  if (action === 'new-project') return openProject();
  if (action === 'new-worktree') return openWorktree(id);
  if (action === 'select-project') { saveProjectListView(target); navigate('/projects/' + id); return; }
  if (action === 'jump-project') { navigate(target.hash.slice(1)); return; }
  if (action === 'project-list') { navigate('/projects'); return; }
  if (action === 'project-filter') {
    projectFilter = target.dataset.filter;
    const picker = $('#projectFilters');
    const wasOpen = picker.open;
    changeListFilters();
    picker.open = false;
    (wasOpen ? picker.querySelector('summary') : $('#search')).focus({preventScroll:true});
    return;
  }
  if (action === 'project-directory-filter') {
    projectDirectoryFilters.set(projectDirectoryFilterKey(id), target.dataset.filter);
    render();
    document.querySelector('.project-directory-filters [data-filter="' + target.dataset.filter + '"]')?.focus({preventScroll:true});
    return;
  }
  if (action === 'project-refresh') return refresh(true);
  if (action === 'clear-project-search') { $('#search').value = ''; changeListFilters(); $('#search').focus(); return; }
  if (action === 'project-terminal') return mutation(uiText("正在打开项目终端"), async () => {
    const result = await api(`/api/projects/${id}/git`, { method: 'POST', body: JSON.stringify({ action: 'terminal', path: target.dataset.path }) });
    toast(result.message);
  }, undefined, {project:id});
  if (action === 'changes-open') {
    const path = target.dataset.path;
    $('#changesTitle').textContent = uiText("文件与改动");
    window.WorkHubUI.mountFileBrowser($('#changesBrowser'), {project:id,path,environment:activeEnvironment,request:api});
    $('#changesDialog').showModal();
    return;
  }
  if (action === 'copy-path') return copy(target.dataset.path);
  if (action === 'remove-project') return openRemoval(id);
  if (action === 'remove-worktree') return openWorktreeRemoval(id, target.dataset.path);
}
document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]');
  if (action?.tagName === 'A') {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
  }
  if (action) handleAction(action.dataset.action, action);
  const nav = event.target.closest('[data-view]'); if (nav) navigate('/' + nav.dataset.view);
  if (event.target.closest('.close-dialog') && !event.target.closest('dialog')?.hasAttribute('data-block-close')) event.target.closest('dialog').close();
});
$('#refreshButton').addEventListener('click', () => refresh(true));
$('#search').addEventListener('input', changeListFilters);
$('#clearListSearch').addEventListener('click', () => {
  $('#search').value = '';
  changeListFilters();
  $('#search').focus();
});
const listFilterPicker = $('#projectFilters');
const syncProjectListFilter = () => window.WorkHubUI.syncListFilter(listFilterPicker, !listFilterPicker.hidden && window.WorkHubPage?.active !== false);
listFilterPicker.addEventListener('toggle',syncProjectListFilter);
window.addEventListener('resize',syncProjectListFilter);
window.addEventListener('workhub:page-visibility',event => { if (!event.detail.visible) listFilterPicker.open = false; });
document.addEventListener('click',event => { if (!listFilterPicker.contains(event.target)) listFilterPicker.open = false; });
document.addEventListener('keydown',event => {
  if (event.key !== 'Escape' || !listFilterPicker.open) return;
  event.preventDefault();
  listFilterPicker.open = false;
  listFilterPicker.querySelector('summary').focus({preventScroll:true});
});
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { if (dialog.hasAttribute('data-block-close')) event.preventDefault(); }));

$('#changesDialog').addEventListener('close', () => window.WorkHubUI.mountFileBrowser($('#changesBrowser')));
$('#copyCommand').addEventListener('click', () => copy($('#commandText').value));
window.addEventListener('DOMContentLoaded', async () => {
  readRoute();
  render();
  // Hosted pages restore their scope/selection before starting any data work.
  // The shell handshake must not wait for repository or environment scans.
  window.dispatchEvent(new CustomEvent('workhub:app-ready'));
  if (!window.WorkHubPage) await refresh();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && window.WorkHubPage?.active !== false) refresh(); });

let removalContext;
function showRemoval(title, label, context) {
  const dialog = $('#removalDialog');
  removalContext = context;
  $('#removalTitle').textContent = title;
  $('#removalDescription').textContent = uiText("正在检查关联和状态…");
  $('#removalReferences').replaceChildren();
  $('#removalPreserved').hidden = !!context.path;
  $('#removalError').hidden = true;
  $('#removalConfirm').disabled = true;
  $('#removalConfirm').textContent = label;
  if (!dialog.open) dialog.showModal();
}
function removalCurrent(context) {
  return removalContext === context && context.environment === activeEnvironment && $('#removalDialog').open;
}
function removalError(error) {
  $('#removalError').textContent = error.message;
  $('#removalError').hidden = false;
}
async function openRemoval(id) {
  const environment = activeEnvironment;
  const context = {id, environment};
  showRemoval(uiText("移除项目登记"), uiText("移除登记"), context);
  try {
    const plan = await api(`/api/projects/${encodeURIComponent(id)}/removal`, {environment});
    if (!removalCurrent(context)) return;
    $('#removalDescription').textContent = uiText("移除“{0}”的项目登记？", plan.name);
    if (plan.sessions?.length) {
      const heading = document.createElement('p');
      heading.textContent = uiText("以下对话会保留其目录关联。");
      const list = document.createElement('ul');
      for (const session of plan.sessions) {
        const row = document.createElement('li');
        row.textContent = session.name || session.id;
        list.append(row);
      }
      $('#removalReferences').append(heading, list);
    }
    $('#removalConfirm').disabled = false;
  } catch (error) { if (removalCurrent(context)) removalError(error); }
}
async function openWorktreeRemoval(id, path) {
  const environment = activeEnvironment;
  const context = {id, environment, path};
  showRemoval(uiText("移除 Worktree"), uiText("移除 Worktree"), context);
  try {
    const plan = await api(`/api/projects/${encodeURIComponent(id)}/worktree?` + new URLSearchParams({path}), {environment});
    if (!removalCurrent(context)) return;
    $('#removalDescription').textContent = uiText("工作目录 {0} · 分支 {1}", plan.path, plan.branch || 'HEAD');
    const list = document.createElement('ul');
    for (const reason of plan.reasons || []) {
      const row = document.createElement('li');
      row.textContent = uiText(reason);
      list.append(row);
    }
    $('#removalReferences').append(list);
    context.fingerprint = plan.fingerprint;
    $('#removalConfirm').disabled = !plan.cleanable;
  } catch (error) { if (removalCurrent(context)) removalError(error); }
}
$('#removalDialog').addEventListener('close', () => { removalContext = null; });
$('#removalForm').addEventListener('submit', async event => {
  event.preventDefault();
  const context = removalContext;
  if (!context || !removalCurrent(context) || $('#removalConfirm').disabled) return;
  const {id, environment, path, fingerprint} = context;
  await mutation(path ? uiText("正在移除 Worktree") : uiText("正在移除登记"), async () => {
    const result = await api(`/api/projects/${encodeURIComponent(id)}` + (path ? '/worktree' : ''), {
      method:'DELETE', environment, ...(path ? {body:JSON.stringify({path,fingerprint})} : {}),
    });
    if (!removalCurrent(context)) return;
    $('#removalDialog').close();
    if (!path) navigate('/projects');
    toast(result.message);
  }, $('#removalError'), {project:id, environment, isCurrent:() => removalCurrent(context)});
});
