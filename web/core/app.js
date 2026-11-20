'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


let refreshTimer;
// The inventory is global across environments. Keep one list context while
// workspace details retain their own per-workspace memory.
const workspaceListMemory = { search: '', archived: false, status: 'all', scrollTop: 0, focus: null };
let workspaceListMounted = false;
const projectListMemory = new Map();
let projectListEnvironment = null;
let lastWorkspaceSelection = null;
let assistantContext = null;
const embeddedAssistant = document.documentElement.hasAttribute('data-workspace-assistant');
const assistantRequest = (path, options) => api(path, {...options, environment:'local'});
const assistantOptions = {
  getContext: () => {
    const {label, environmentLabel, ...context} = assistantContext || {environment_id:activeEnvironment};
    return context;
  },
  clearContext: () => { assistantContext = {environment_id:'local'}; },
  contextLabel: () => {
    const environment = assistantContext?.environment_id || activeEnvironment;
    const label = assistantContext?.label;
    return [label, environment === 'local' ? '' : assistantContext?.environmentLabel || environmentName(environment)].filter(Boolean).join(' · ');
  },
  openResource: async resource => {
    if (!resource || !['workspace', 'project', 'conversation'].includes(resource.kind) || !/^[a-zA-Z0-9_-]+$/.test(resource.id) || typeof resource.environment_id !== 'string') throw new Error(uiText("资源信息无效，请重新查询。"));
    const environment = resource.environment_id;
    if ((embeddedAssistant || window.WorkHubPage) && window.parent !== window) {
      const snapshot = resource.kind === 'conversation'
        ? {route:'/sessions',environment,title:resource.name,conversation:{scope:{kind:'all',environment},selected:conversationEnvironmentKey(environment,resource.id),pane:'detail'}}
        : {route:(resource.kind === 'workspace' ? '/workspaces/' : '/projects/') + resource.id,environment,title:resource.name};
      postAssistant('workhub:page-open', {snapshot});
    } else if (resource.kind === 'conversation') {
      await selectEnvironment(environment, '/sessions');
      if (activeEnvironment === environment) openConversationWorkspace({kind:'all',environment}, resource.id);
    } else await openConversationWorkspaceDetail(resource.kind === 'workspace' ? 'workspace' : 'project', resource.id, environment);
  },
};
function postAssistant(type, detail = {}) { window.parent.postMessage({type, ...detail}, location.origin); }
if (embeddedAssistant) {
  assistantOptions.close = () => postAssistant('workhub:assistant-close');
  assistantOptions.onActivity = activity => postAssistant('workhub:assistant-activity', {activity});
  let previousContext;
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'workhub:assistant-show') return;
    const context = event.data.context;
    if (!context) return;
    const key = JSON.stringify([context.environment_id, context.workspace_id, context.project_id]);
    if (key !== previousContext) assistantContext = context;
    previousContext = key;
    document.documentElement.removeAttribute('data-workspace-inactive');
    const page = $('#globalAssistantPage');
    page.hidden = false;
    page.focus({preventScroll:true});
    openAssistantConversation();
    window.dispatchEvent(new CustomEvent('workhub:chat-layout', {detail:{visible:true}}));
  });
  window.addEventListener('workhub:assistant-hide', () => {
    window.dispatchEvent(new CustomEvent('workhub:chat-layout', {detail:{phase:'before'}}));
    document.documentElement.setAttribute('data-workspace-inactive', '');
    void window.WorkHubAssistant.flushDraft();
  });
}
function openAssistantConversation() {
  window.WorkHubAssistant.openGlobal(assistantRequest, assistantOptions);
}
function syncWorkspacePageLayout(workspaces, detail) {
  const heading = $('.page-heading');
  const pane = $('#workspaceDetailPane');
  const move = (node, parent) => { if (node.parentElement !== parent) parent.append(node); };
  $('#workspaceBrowser').hidden = !workspaces || detail;
  pane.hidden = workspaces && !detail;
  pane.classList.toggle('workspace-pane', workspaces);
  if (workspaces) {
    move($('#newWorkspaceButton'), $('#workspaceCreateSlot'));
    move($('#panelToolbar'), $('#workspaceToolbarSlot'));
    move(heading, $('#workspaceHeadingSlot'));
  } else {
    move($('#newWorkspaceButton'), heading);
    if (heading.parentElement !== $('main')) $('main').insertBefore(heading, $('#offlineFeedback'));
    if (state.view !== 'projects' && $('#panelToolbar').parentElement !== $('#workContent')) $('#workContent').insertBefore($('#panelToolbar'), pane);
  }
}
function saveWorkspaceListView(target) {
  if (!workspaceListMounted) return;
  workspaceListMemory.search = $('#search').value;
  workspaceListMemory.archived = $('#archiveFilter').checked;
  workspaceListMemory.status = $('#workspaceStatusFilter').value;
  workspaceListMemory.scrollTop = $('#workspaceListContent').scrollTop;
  const row = target || document.activeElement?.closest?.('#workspaceListContent [data-action="open-workspace"]');
  if (row) workspaceListMemory.focus = { id: row.dataset.id, environment: row.dataset.environment };
}
function saveProjectListView(target) {
  if (projectListEnvironment === null) return;
  const row = target || document.activeElement?.closest?.('#projectListPane [data-action="select-project"]');
  const previous = projectListMemory.get(projectListEnvironment);
  projectListMemory.set(projectListEnvironment, {
    search: $('#search').value, filter: projectFilter,
    scrollTop: $('.project-list-scroll')?.scrollTop || 0, focus: row?.dataset.id || previous?.focus,
  });
}
function restoreWorkspaceListControls() {
  $('#search').value = workspaceListMemory.search;
  $('#archiveFilter').checked = workspaceListMemory.archived;
  $('#workspaceStatusFilter').value = workspaceListMemory.status;
}
function restoreWorkspaceListPosition(focus) {
  $('#workspaceListContent').scrollTop = workspaceListMemory.scrollTop;
  const saved = workspaceListMemory.focus;
  if (!focus || !saved) return;
  const row = [...document.querySelectorAll('#workspaceListContent [data-action="open-workspace"]')].find(row => row.dataset.id === saved.id && row.dataset.environment === saved.environment);
  (row || $('#workspaceListTitle')).focus({preventScroll:true});
}
function restoreProjectListPosition(focus) {
  const saved = projectListMemory.get(activeEnvironment);
  if (!saved) return;
  $('.project-list-scroll').scrollTop = saved.scrollTop;
  if (!focus || !saved.focus) return;
  const row = [...document.querySelectorAll('#projectListPane [data-action="select-project"]')].find(row => row.dataset.id === saved.focus);
  (row || $('#panelTitle')).focus({preventScroll:true});
}
function changeListFilters() {
  if (workspaceListMounted) {
    workspaceListMemory.focus = null;
    $('#workspaceListContent').scrollTop = 0;
  }
  if (projectListEnvironment !== null) {
    const saved = projectListMemory.get(projectListEnvironment);
    if (saved) saved.focus = null;
    $('.project-list-scroll').scrollTop = 0;
  }
  render();
}
window.addEventListener('pagehide', () => { saveWorkspaceListView(); saveProjectListView(); });

async function refresh(force = false) {
  if (state.refreshing) return;
  clearTimeout(refreshTimer);
  let nextRefresh = 10000;
  state.refreshing = true;
  const revision = environmentRevision;
  const needsScopedState = state.view !== 'workspaces' || !!state.selectedWorkspace || !!$('#workspaceShortcutPicker')?.open;
  $('#refreshButton').disabled = true;
  try {
    const suffix = force ? '?refresh=1' : '';
    let renderPending = false, pickerChanged = false;
    const renderPartial = () => {
      if (renderPending) return;
      renderPending = true;
      // Coalesce results that settle together, while a slow source never holds
      // back a ready one. Background status timestamps still avoid full renders.
      void Promise.resolve().then(() => {
        renderPending = false;
        if (revision !== environmentRevision) return;
        render();
        if (pickerChanged) {pickerChanged = false; refreshWorkspaceProjectPicker();}
      });
    };
    const apply = (kind,data) => {
      if (revision !== environmentRevision || !data) return;
      if (kind === 'inventory') {
        const changed = !workspaceInventory.loaded || renderStateKey(workspaceInventory) !== renderStateKey(data);
        workspaceInventory = {...data,loaded:true};
        if (changed) renderPartial();
      } else {
        const changed = !state.loaded || renderStateKey(state) !== renderStateKey(data);
        Object.assign(state,data,{loaded:true});
        if (typeof data.read_only_sessions === 'boolean') sessionReadOnly = data.read_only_sessions;
        if (changed) {pickerChanged = true; renderPartial();}
      }
    };
    const [scoped, inventory] = await Promise.allSettled([
      needsScopedState ? api('/api/state' + suffix).then(data => {apply('state',data); return data;}) : Promise.resolve(null),
      api('/api/workspace-inventory' + suffix, { environment: 'local' }).then(data => {apply('inventory',data); return data;}),
    ]);
    if (revision !== environmentRevision) return;
    const failures = [];
    if (inventory.status === 'rejected') failures.push(uiText("全部工作区刷新失败：") + inventory.reason.message);
    if (scoped.status === 'rejected') failures.push(uiText("当前环境连接失败：") + scoped.reason.message);
    for (const e of workspaceInventory.environments) if (e.error) failures.push(e.name + '：' + e.error);
    $('#offlineBanner').textContent = failures.join('\n');
    $('#offlineBanner').hidden = !failures.length;
    const pending = scoped.status === 'fulfilled' && scoped.value?.status_refreshing || inventory.status === 'fulfilled' && inventory.value.status_refreshing;
    nextRefresh = pending ? 1000 : 10000;
    $('#syncText').textContent = failures.length ? uiText("部分环境异常") : pending ? uiText("更新中…") : uiText("已更新");
    $('#syncText').title = failures.length ? failures.join('\n') : pending ? uiText("正在更新状态，当前显示最近结果") : uiText("工作台状态已更新");
    $('#syncDot').classList.toggle('offline', !!failures.length);
    $('#syncDot').classList.toggle('updating', !!pending && !failures.length);
    if (!state.loaded) { render(); refreshWorkspaceProjectPicker(); }
    else {
      updateCheckTimes();
      if (typeof refreshSessionWorkspace === 'function') refreshSessionWorkspace(false);
    }
  } catch (error) {
    if (revision !== environmentRevision || error.name === 'AbortError') return;
    $('#offlineBanner').textContent = uiText("状态刷新失败：") + error.message;
    $('#offlineBanner').hidden = false;
    $('#syncText').textContent = uiText("连接中断");
    $('#syncText').title = error.message;
    $('#syncDot').classList.remove('updating');
    $('#syncDot').classList.toggle('offline', true);
    if (!state.loaded && state.view !== 'projects') $('#content').innerHTML = window.WorkHubUI.offline();
  } finally {
    if (revision !== environmentRevision) return;
    state.refreshing = false; $('#refreshButton').disabled = false;
    if (!needsScopedState && (state.view !== 'workspaces' || state.selectedWorkspace)) nextRefresh = 0;
    refreshTimer = setTimeout(() => { if (!embeddedAssistant && !document.hidden && window.WorkHubPage?.active !== false) refresh(); }, nextRefresh);
    window.dispatchEvent(new CustomEvent('workhub:workspace-refreshed'));
  }
}

function renderStateKey(data) {
  // Once a result exists, polling metadata must not rebuild the workspace.
  // The first completed check still changes the key and enables its actions.
  return JSON.stringify([data.projects, data.workspaces, data.terminal, data.root, data.environments, data.project_count, data.read_only_sessions], function (key, value) {
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
  saveWorkspaceListView();
  saveProjectListView();
  workspaceListMounted = false;
  projectListEnvironment = null;
  const rawRoute = location.hash.slice(1);
  const route = rawRoute.split('?')[0];
  if (route === '/assistant' && state.view !== 'assistant') {
    const workspace = state.view === 'workspaces' && state.workspaces.find(item => item.id === state.selectedWorkspace);
    const project = state.view === 'projects' && projectDetailOpen && state.projects.find(item => item.id === state.selectedProject);
    assistantContext = {environment_id:activeEnvironment, ...(workspace ? {workspace_id:workspace.id} : project ? {project_id:project.id} : {}), label:workspace?.name || project?.name || ''};
  }
  const project = route.match(/^\/projects\/([a-zA-Z0-9_-]+)(?:\/(git|worktrees))?$/);
  if (project) state.selectedProject = project[1];
  projectDetailOpen = !!project;
  state.view = route === '/assistant' ? 'assistant' : route === '/settings' ? 'settings' : route === '/projects' || project ? 'projects' : route === '/sessions' ? 'sessions' : 'workspaces';
  $('#workspaceListFilters').open = false;
  const match = route.match(/^\/workspaces\/([a-zA-Z0-9_-]+)$/);
  state.selectedWorkspace = match ? match[1] : null;
  readResourceLocation(rawRoute);
  window.dispatchEvent(new CustomEvent('workhub:route-read'));
}

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
  if (previousView !== 'projects' || state.view !== 'projects' || !state.loaded) refresh();
});
function render() {
  saveWorkspaceListView();
  saveProjectListView();
  if (typeof saveWorkspaceDetail === 'function') saveWorkspaceDetail();
  const assistantView = state.view === 'assistant';
  const settingsView = state.view === 'settings';
  const sessionsView = state.view === 'sessions';
  const workspacesView = state.view === 'workspaces';
  const detailView = workspacesView && !!state.selectedWorkspace;
  const workspaceListView = workspacesView && !detailView;
  const projectsView = state.view === 'projects';
  const projectListView = projectsView && !projectDetailOpen;
  const returningToList = workspaceListView && !workspaceListMounted;
  const returningToProjects = projectListView && projectListEnvironment !== activeEnvironment;
  if (returningToList) restoreWorkspaceListControls();
  if (returningToProjects) {
    const saved = projectListMemory.get(activeEnvironment);
    $('#search').value = saved?.search || '';
    projectFilter = saved?.filter || 'all';
  }
  workspaceListMounted = workspaceListView;
  projectListEnvironment = projectListView ? activeEnvironment : null;
  syncWorkspacePageLayout(workspacesView, detailView);
  document.body.classList.toggle('workspaces-page', workspacesView);
  document.body.classList.toggle('workspace-selection-open', detailView);
  const workspace = detailView ? state.workspaces.find(q => q.id === state.selectedWorkspace) : null;
  document.body.classList.toggle('workspace-detail-page', !!workspace);
  document.body.classList.toggle('projects-page', projectsView);
  if (workspace) lastWorkspaceSelection = { id: workspace.id, environment: activeEnvironment };
  rememberResourceVisit(workspace);
  $('#workspacePageActions').hidden = !workspace;
  if (workspace) {
    $('#workspacePageActions').innerHTML = window.WorkHubUI.workspaceActions(workspace, environmentName());
  }
  document.title = assistantView ? uiText("Yolu 助手") : sessionsView ? uiText("对话 · Yolu") : settingsView ? uiText("设置 · Yolu") : workspace ? workspace.name + ' · Yolu' : projectsView ? (projectDetailOpen ? state.projects.find(p => p.id === state.selectedProject)?.name || uiText("项目") : uiText("项目")) + ' · Yolu' : workspaceListView ? uiText("工作区") + ' · Yolu' : 'Yolu';
  $('#backToWorkspaces').hidden = !detailView;
  $('#workspaceBreadcrumbSeparator').hidden = !detailView;
  $('#workspaceSwitcherTrigger').hidden = !workspace;
  $('.page-heading').hidden = projectsView || assistantView || workspaceListView;
  $('#stats').hidden = true;
  $('#panelToolbar').hidden = false;
  $('#newButton').hidden = !workspaceListView;
  $('#settingsPage').hidden = !settingsView;
  $('#workContent').hidden = settingsView || sessionsView || assistantView;
  $('#globalAssistantPage').hidden = !assistantView;
  document.body.classList.toggle('assistant-page-open', assistantView);
  if (assistantView) openAssistantConversation();
  $('#sessionsPage').hidden = !sessionsView;
  document.body.classList.toggle('sessions-page-open', sessionsView);
  $('#workspaceCount').textContent = workspaceInventory.loaded ? workspaceInventory.workspaces.filter(q => q.state !== 'archived').length : '…';
  $('#projectCount').textContent = workspaceInventory.loaded ? workspaceInventory.project_count : '…';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#eyebrow').textContent = sessionsView ? 'SESSIONS' : settingsView ? 'SETTINGS' : detailView ? 'WORKSPACE' : workspacesView ? 'WORKSPACES' : 'PROJECTS';
  $('#pageTitle').textContent = sessionsView ? uiText("对话") : settingsView ? uiText("设置") : detailView ? workspace?.name || (!state.loaded ? uiText("正在加载工作区…") : uiText("工作区不存在")) : workspacesView ? uiText("选择工作区") : uiText("项目");
  $('#pageSubtitle').textContent = settingsView ? uiText("配置执行环境、对话默认设置与终端工具。") : detailView ? uiText("查看关联项目和 Codex 对话，继续当前工作区中的开发。") : workspacesView ? uiText("围绕一项开发目标，集中管理相关项目的工作目录、分支和对话。") : uiText("登记项目，掌握它的全部工作目录、分支与工作区归属。");
  $('#pageSubtitle').hidden = workspacesView || sessionsView;
  $('#panelTitle').textContent = workspacesView ? uiText("全部工作区") : uiText("项目");
  $('#search').placeholder = workspacesView ? uiText("搜索工作区名称、说明…") : uiText("搜索项目名称、目录…");
  const listFilter = $('#workspaceListFilters');
  const projectListFilter = projectListView;
  listFilter.hidden = !workspacesView && !projectListFilter;
  const workspaceFilterCount = Number($('#archiveFilter').checked) + Number($('#workspaceStatusFilter').value !== 'all');
  const filterCount = projectListFilter ? Number(projectFilter !== 'all') + Number(activeEnvironment !== 'local') : workspaceFilterCount;
  const filterLabel = uiText("筛选") + (filterCount ? ' · ' + filterCount : '');
  listFilter.toggleAttribute('data-active', !!filterCount);
  const summary = listFilter.querySelector('summary');
  summary.title = filterLabel;
  summary.setAttribute('aria-label',filterLabel);
  $('#clearListSearch').hidden = !$('#search').value;
  $('#archiveFilterWrap').hidden = !workspacesView;
  $('#workspaceStatusFilterWrap').hidden = !workspacesView;
  $('#projectListFilters').hidden = !projectListFilter;
  $('#projectEnvironmentWrap').hidden = workspacesView;
  $('#projectAddButton').hidden = state.view !== 'projects';
  syncProjectPage();
  renderSettings();
  if (typeof syncSessionWorkspace === 'function') syncSessionWorkspace();
  if (settingsView || sessionsView || assistantView) { if (typeof syncWorkspaceDetail === 'function') syncWorkspaceDetail(null); return; }
  $('#stats').innerHTML = '';
  const focusedRow = workspaceListView && document.activeElement?.closest?.('#workspaceListContent [data-action="open-workspace"]');
  const focusedDirectory = document.activeElement?.matches('[data-directory-path]') && document.activeElement.dataset.directoryPath === resourceLocation.directory;
  const focusedProject = projectListView && document.activeElement?.closest?.('#projectListPane [data-action="select-project"]');
  if (workspaceListView) $('#workspaceListContent').innerHTML = renderWorkspaces();
  const content = detailView
    ? workspace ? workspaceDetail(workspace) : !state.loaded ? empty(uiText("暂时无法读取工作区"), uiText("请检查工作区所属环境的连接，可在设置中重新连接。")) : empty(uiText("这个工作区不存在"), uiText("可返回工作区列表，重新选择一个工作区。"))
    : projectsView ? renderProjects() : '';
  if (projectsView) renderProjectPage(content);
  else $('#content').innerHTML = content;
  if (typeof refreshSessionWorkspace === 'function') refreshSessionWorkspace(false);
  if (typeof syncWorkspaceDetail === 'function') syncWorkspaceDetail(workspace);
  syncWorkspaceDescription();
  syncMutationControls();
  if (workspaceListView) restoreWorkspaceListPosition(returningToList || !!focusedRow);
  if (projectListView) restoreProjectListPosition(returningToProjects || !!focusedProject);
  if (focusedDirectory && !document.body.classList.contains('project-tool-page')) resourceLocation.locate = true;
  locateResourceDirectory();
}

async function handleAction(action, target) {
  if (state.busy) return;
  const id = target.dataset.id;
  if (action === 'workspace-project-filter') {
    workspaceProjectFilters.set(JSON.stringify([activeEnvironment,id]), target.dataset.filter);
    render();
    document.querySelector(`.workspace-signal-filters [data-filter="${target.dataset.filter}"]`)?.focus({preventScroll:true});
    return;
  }
  if (action === 'open-workspace') {
    saveWorkspaceListView(target);
    await selectEnvironment(target.dataset.environment, '/workspaces/' + id);
    if (state.selectedWorkspace === id && activeEnvironment === target.dataset.environment) $('#pageTitle').focus({preventScroll:true});
    return;
  }
  if (action === 'clear-workspace-filters') {
    $('#search').value = ''; $('#archiveFilter').checked = false; $('#workspaceStatusFilter').value = 'all';
    changeListFilters(); $('#search').focus(); return;
  }
  if (action === 'new-project') return openProject();
  if (action === 'new-worktree') return openWorktree(id);
  if (action === 'new-workspace') return openWorkspace();
  if (action === 'edit-workspace') return openWorkspaceEdit(id);
  if (action === 'change-workspace-directory') return openWorkspaceDirectory(id, target.dataset.project);
  if (action === 'remove-workspace-project') return removeWorkspaceProject(id, target.dataset.project);
  if (action === 'add-workspace-projects') return openWorkspaceProjects(id);
  if (action === 'select-project') { saveProjectListView(target); navigate('/projects/' + id); return; }
  if (action === 'jump-project') { navigate(target.hash.slice(1)); return; }
  if (action === 'project-list') { navigate('/projects'); return; }
  if (action === 'project-filter') {
    projectFilter = target.dataset.filter;
    const picker = $('#workspaceListFilters');
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
  if (action === 'jump-workspace') {
    const directory = target.hasAttribute('data-return-directory') ? resourceLocation.directory : target.dataset.path;
    navigate(resourceDirectoryRoute('/workspaces/' + id, directory));
    return;
  }
  if (action === 'workspace-terminal') return mutation(uiText("正在打开项目终端"), async () => {
    const result = await api(`/api/projects/${id}/git`, { method: 'POST', body: JSON.stringify({ action: 'terminal', path: target.dataset.path }) });
    toast(result.message);
  }, undefined, {project:id});
  if (action === 'copy-path') return copy(target.dataset.path);
  if (action === 'command') {
    try { const plan = await api(`/api/workspaces/${id}/launch`); showCommand(plan.command); } catch (e) { toast(e.message, true); } return;
  }
  if (action === 'launch') return mutation(uiText("正在打开 Codex 终端"), async () => { const r = await api(`/api/workspaces/${id}/launch`, { method: 'POST', body: '{}' }); toast(r.message); });
  if (action === 'retry') return mutation(uiText("正在重试失败项目"), async () => { const q = await api(`/api/workspaces/${id}/retry`, { method: 'POST', body: JSON.stringify({project_id: target.dataset.project || ''}) }); toast(q.state === 'ready' ? uiText("全部项目已就绪") : uiText("仍有项目未就绪，请查看失败原因"), q.state !== 'ready'); }, undefined, {workspace:id});
  if (action === 'archive') {
    const q = state.workspaces.find(q => q.id === id);
    return mutation(uiText("正在更新工作区状态"), async () => { const r = await api(`/api/workspaces/${id}/archive`, { method: 'POST', body: JSON.stringify({ archived: q.state !== 'archived' }) }); toast(r.message); }, undefined, {workspace:id});
  }
  if (action === 'remove-project' || action === 'remove-workspace') return openRemoval(action === 'remove-project' ? 'project' : 'workspace', id);
}
document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]');
  const breadcrumb = event.target.closest('#backToWorkspaces');
  if (breadcrumb || action?.tagName === 'A') {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (breadcrumb) { navigate('/workspaces'); return; }
  }
  if (action) handleAction(action.dataset.action, action);
  const nav = event.target.closest('[data-view]'); if (nav) navigate('/' + nav.dataset.view);
  if (!window.WorkHubPage && event.target.closest('#openYoluAssistant')) navigate('/assistant');
  if (event.target.closest('.close-dialog') && !event.target.closest('dialog')?.hasAttribute('data-block-close')) event.target.closest('dialog').close();
});
$('#newButton').addEventListener('click', () => openWorkspace());
$('#refreshButton').addEventListener('click', () => refresh(true));
$('#search').addEventListener('input', changeListFilters);
$('#clearListSearch').addEventListener('click', () => {
  $('#search').value = '';
  changeListFilters();
  $('#search').focus();
});
const listFilterPicker = $('#workspaceListFilters');
const syncWorkspaceListFilter = () => window.WorkHubUI.syncListFilter(listFilterPicker, !listFilterPicker.hidden && window.WorkHubPage?.active !== false);
listFilterPicker.addEventListener('toggle',syncWorkspaceListFilter);
window.addEventListener('resize',syncWorkspaceListFilter);
window.addEventListener('workhub:page-visibility',event => { if (!event.detail.visible) listFilterPicker.open = false; });
document.addEventListener('click',event => { if (!listFilterPicker.contains(event.target)) listFilterPicker.open = false; });
document.addEventListener('keydown',event => {
  if (event.key !== 'Escape' || !listFilterPicker.open) return;
  event.preventDefault();
  listFilterPicker.open = false;
  listFilterPicker.querySelector('summary').focus({preventScroll:true});
});
$('#archiveFilter').addEventListener('change', changeListFilters);
$('#workspaceStatusFilter')?.addEventListener('change', changeListFilters);
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { if (dialog.hasAttribute('data-block-close')) event.preventDefault(); }));

$('#copyCommand').addEventListener('click', () => copy($('#commandText').value));
window.addEventListener('DOMContentLoaded', async () => {
  if (embeddedAssistant) {
    postAssistant('workhub:assistant-ready');
    return;
  }
  readRoute();
  render();
  // Hosted pages restore their scope/selection before starting any data work.
  // The shell handshake must not wait for repository or environment scans.
  window.dispatchEvent(new CustomEvent('workhub:workspace-ready'));
  if (!window.WorkHubPage) await refresh();
});
document.addEventListener('visibilitychange', () => { if (!embeddedAssistant && !document.hidden && window.WorkHubPage?.active !== false) refresh(); });

// Keep the impact and any failure visible until the user closes the dialog.
let removalContext;
async function openRemoval(kind, id) {
  const item = (kind === 'project' ? state.projects : state.workspaces).find(item => item.id === id);
  if (!item) return;
  const context = removalContext = {kind, id, environment: activeEnvironment, workspaces: []};
  const dialog = $('#removalDialog');
  $('#removalTitle').textContent = kind === 'project' ? uiText("移除项目登记") : uiText("删除工作区记录");
  $('#removalDescription').textContent = kind === 'project' ? uiText("正在检查项目“{0}”的工作区关联…", item.name) : uiText("删除工作区“{0}”的管理记录及项目、对话关联？此操作不能撤销。", item.name);
  $('#removalReferences').replaceChildren();
  $('#removalError').hidden = true;
  $('#removalConfirm').disabled = true;
  $('#removalConfirm').textContent = kind === 'project' ? uiText("移除登记") : uiText("删除工作区记录");
  if (!dialog.open) dialog.showModal();
  if (kind === 'workspace') { $('#removalConfirm').disabled = item.state === 'creating'; return; }
  try {
    const plan = await api(`/api/projects/${encodeURIComponent(id)}/removal`, {environment:context.environment});
    if (removalContext !== context || !dialog.open) return;
    context.workspaces = plan.workspaces.map(workspace => workspace.id);
    $('#removalDescription').textContent = plan.workspaces.length ? uiText("以下工作区将解除与“{0}”的关联，工作区本身和其他项目不受影响。", plan.name) : uiText("移除“{0}”的项目登记？", plan.name);
    const list = document.createElement('ul');
    for (const workspace of plan.workspaces) {
      const row = document.createElement('li'), link = document.createElement('a');
      link.textContent = workspace.name + (workspace.state === 'archived' ? uiText("（已归档）") : '');
      link.href = `?environment=${encodeURIComponent(context.environment)}#/workspaces/${encodeURIComponent(workspace.id)}`;
      link.addEventListener('click', () => dialog.close());
      row.append(link); list.append(row);
    }
    $('#removalReferences').append(list);
    $('#removalConfirm').textContent = plan.workspaces.length ? uiText("解除关联并移除登记") : uiText("移除登记");
    $('#removalConfirm').disabled = plan.workspaces.some(workspace => workspace.state === 'creating');
    if ($('#removalConfirm').disabled) { $('#removalError').textContent = uiText("关联工作区正在准备中，请完成后再移除项目"); $('#removalError').hidden = false; }
  } catch (error) {
    if (removalContext !== context || !dialog.open) return;
    $('#removalError').textContent = error.message; $('#removalError').hidden = false;
  }
}
$('#removalDialog').addEventListener('close', () => { removalContext = null; });
$('#removalForm').addEventListener('submit', async event => {
  event.preventDefault();
  const context = removalContext;
  if (!context || $('#removalConfirm').disabled) return;
  if (context.environment !== activeEnvironment) {
    $('#removalError').textContent = uiText("执行环境已切换，请关闭弹窗后重新操作。"); $('#removalError').hidden = false; return;
  }
  const current = () => removalContext === context && context.environment === activeEnvironment && $('#removalDialog').open;
  await mutation(context.kind === 'project' ? uiText("正在移除登记") : uiText("正在删除工作区记录"), async () => {
    const path = context.kind === 'project' ? `/api/projects/${encodeURIComponent(context.id)}?detach=1` : `/api/workspaces/${encodeURIComponent(context.id)}`;
    const result = await api(path, {method:'DELETE', environment:context.environment, ...(context.kind === 'project' ? {body:JSON.stringify({workspaces:context.workspaces})} : {})});
    if (current()) {
      $('#removalDialog').close();
      if (context.kind === 'workspace') location.hash = '/workspaces';
      toast(result.message + (result.context_warning ? '\n' + uiText("工作区说明更新失败：") + result.context_warning : ''), !!result.context_warning);
    }
  }, $('#removalError'), {key:context.kind + ':' + context.id, environment:context.environment, isCurrent:current});
});
