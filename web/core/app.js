'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


let refreshTimer;
// The inventory is global across environments. Keep one list context while
// task details retain their own per-task workspace memory.
const taskListMemory = { search: '', archived: false, status: 'all', scrollTop: 0, focus: null };
let taskListMounted = false;
const taskSelectionStorageKey = 'workhub:selected-task:v1';
let lastTaskSelection = null;
try { lastTaskSelection = JSON.parse(localStorage.getItem(taskSelectionStorageKey) || 'null'); } catch {}
function wideTaskLayout() { return window.innerWidth > 1100; }
function rememberTaskSelection(task) {
  if (lastTaskSelection?.id === task.id && lastTaskSelection?.environment === activeEnvironment) return;
  lastTaskSelection = { id: task.id, environment: activeEnvironment };
  try { localStorage.setItem(taskSelectionStorageKey, JSON.stringify(lastTaskSelection)); } catch {}
}
function restoreTaskSelection() {
  if (!wideTaskLayout() || !taskInventory.loaded || state.busy || blockingMutationDialog()) return false;
  const tasks = filteredRequirements();
  const selected = tasks.find(q => q.id === lastTaskSelection?.id && q.environment_id === lastTaskSelection?.environment) || tasks[0];
  if (!selected) return false;
  // Replace the list entry, so opening the workspace does not add a redundant
  // history step. Explicit task selections still use normal browser history.
  selectEnvironment(selected.environment_id, '/requirements/' + selected.id, 'replace');
  return true;
}
function syncTaskPageLayout(tasks) {
  const heading = $('.page-heading');
  const pane = $('#taskDetailPane');
  const move = (node, parent) => { if (node.parentElement !== parent) parent.append(node); };
  $('#taskBrowser').hidden = !tasks;
  if (tasks) {
    move($('#newTaskButton'), $('#taskCreateSlot'));
    move($('#panelToolbar'), $('#taskToolbarSlot'));
    move($('#backToRequirements'), $('#taskHeadingSlot'));
    move(heading, $('#taskHeadingSlot'));
  } else {
    move($('#newTaskButton'), heading);
    if (heading.parentElement !== $('main')) $('main').insertBefore(heading, $('#offlineFeedback'));
    if ($('#backToRequirements').parentElement !== $('main')) $('main').insertBefore($('#backToRequirements'), heading);
    if ($('#panelToolbar').parentElement !== $('#workContent')) $('#workContent').insertBefore($('#panelToolbar'), pane);
  }
}
let taskLayoutWide = wideTaskLayout();
window.addEventListener('resize', () => {
  const wide = wideTaskLayout();
  if (wide === taskLayoutWide) return;
  taskLayoutWide = wide;
  if (state.view === 'requirements') render();
});
function saveTaskListView(target) {
  if (!taskListMounted) return;
  taskListMemory.search = $('#search').value;
  taskListMemory.archived = $('#archiveFilter').checked;
  taskListMemory.status = $('#taskStatusFilter')?.value || 'all';
  if (wideTaskLayout() || !state.selectedRequirement) taskListMemory.scrollTop = $('#taskListContent').scrollTop;
  const row = target || document.activeElement?.closest?.('[data-action="open-requirement"]');
  if (row) taskListMemory.focus = { id: row.dataset.id, environment: row.dataset.environment };
}
function suspendTaskListView() { saveTaskListView(); taskListMounted = false; }
function restoreTaskListControls() {
  $('#search').value = taskListMemory.search;
  $('#archiveFilter').checked = taskListMemory.archived;
  if ($('#taskStatusFilter')) $('#taskStatusFilter').value = taskListMemory.status;
}
function restoreTaskListPosition(focus) {
  if (!taskListMounted) return;
  if (wideTaskLayout() || !state.selectedRequirement) $('#taskListContent').scrollTop = taskListMemory.scrollTop;
  if (!focus || (!wideTaskLayout() && state.selectedRequirement)) return;
  const saved = taskListMemory.focus;
  const row = saved && [...document.querySelectorAll('[data-action="open-requirement"]')].find(row => row.dataset.id === saved.id && row.dataset.environment === saved.environment);
  (row || $('#pageTitle')).focus?.({preventScroll:true});
}
function changeListFilters() {
  if (taskListMounted) { taskListMemory.focus = null; $('#taskListContent').scrollTop = 0; }
  if (state.view === 'projects') projectDetailOpen = false;
  render();
}
$('#taskListContent').addEventListener('scroll', () => saveTaskListView(), {passive:true});
window.addEventListener('pagehide', () => saveTaskListView());

async function refresh(force = false) {
  if (state.refreshing) return;
  clearTimeout(refreshTimer);
  let nextRefresh = 10000;
  state.refreshing = true;
  const revision = environmentRevision;
  const needsScopedState = state.view !== 'requirements' || !!state.selectedRequirement || !!$('#taskShortcutPicker')?.open;
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
        if (pickerChanged) {pickerChanged = false; refreshRequirementProjectPicker();}
      });
    };
    const apply = (kind,data) => {
      if (revision !== environmentRevision || !data) return;
      if (kind === 'inventory') {
        const changed = !taskInventory.loaded || renderStateKey(taskInventory) !== renderStateKey(data);
        taskInventory = {...data,loaded:true};
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
      api('/api/task-inventory' + suffix, { environment: 'local' }).then(data => {apply('inventory',data); return data;}),
    ]);
    if (revision !== environmentRevision) return;
    const failures = [];
    if (inventory.status === 'rejected') failures.push(uiText("全部任务刷新失败：") + inventory.reason.message);
    if (scoped.status === 'rejected') failures.push(uiText("当前环境连接失败：") + scoped.reason.message);
    for (const e of taskInventory.environments) if (e.error) failures.push(e.name + '：' + e.error);
    $('#offlineBanner').textContent = failures.join('\n');
    $('#offlineBanner').hidden = !failures.length;
    const pending = scoped.status === 'fulfilled' && scoped.value?.status_refreshing || inventory.status === 'fulfilled' && inventory.value.status_refreshing;
    nextRefresh = pending ? 1000 : 10000;
    $('#syncText').textContent = failures.length ? uiText("部分环境异常") : pending ? uiText("更新中…") : uiText("已更新");
    $('#syncText').title = failures.length ? failures.join('\n') : pending ? uiText("正在更新状态，当前显示最近结果") : uiText("工作台状态已更新");
    $('#syncDot').classList.toggle('offline', !!failures.length);
    $('#syncDot').classList.toggle('updating', !!pending && !failures.length);
    if (!state.loaded) { render(); refreshRequirementProjectPicker(); }
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
    if (!state.loaded) $('#content').innerHTML = window.WorkHubUI.offline();
  } finally {
    if (revision !== environmentRevision) return;
    state.refreshing = false; $('#refreshButton').disabled = false;
    if (!needsScopedState && (state.view !== 'requirements' || state.selectedRequirement)) nextRefresh = 0;
    refreshTimer = setTimeout(() => { if (!document.hidden && window.WorkHubPage?.active !== false) refresh(); }, nextRefresh);
    window.dispatchEvent(new CustomEvent('workhub:workspace-refreshed'));
  }
}

function renderStateKey(data) {
  // Once a result exists, polling metadata must not rebuild the workspace.
  // The first completed check still changes the key and enables its actions.
  return JSON.stringify([data.projects, data.requirements, data.terminal, data.root, data.environments, data.project_count, data.read_only_sessions], function (key, value) {
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
  suspendTaskListView();
  const route = location.hash.slice(1).split('?')[0];
  const project = route.match(/^\/projects\/([a-zA-Z0-9_-]+)(?:\/(git|worktrees))?$/);
  if (project) state.selectedProject = project[1];
  projectDetailOpen = !!project;
  state.view = route === '/settings' ? 'settings' : route === '/projects' || project ? 'projects' : route === '/sessions' ? 'sessions' : 'requirements';
  const match = route.match(/^\/requirements\/([a-zA-Z0-9_-]+)$/);
  state.selectedRequirement = match ? match[1] : null;
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
  readRoute(); $('#search').value = '';
  render();
  if (!taskListMounted || state.selectedRequirement) { $('main').scrollTop = 0; $(state.view === 'sessions' ? '#sessionBrowserSearch' : state.view === 'projects' ? '#panelTitle' : '#pageTitle').focus({ preventScroll: true }); }
  if (previousView !== 'projects' || state.view !== 'projects' || !state.loaded) refresh();
});
function render() {
  saveTaskListView();
  if (typeof saveTaskWorkspace === 'function') saveTaskWorkspace();
  const settingsView = state.view === 'settings';
  const sessionsView = state.view === 'sessions';
  const reqView = state.view === 'requirements';
  const detailView = reqView && !!state.selectedRequirement;
  const returningToList = reqView && !taskListMounted;
  if (returningToList) restoreTaskListControls();
  taskListMounted = reqView;
  if (reqView && !detailView && restoreTaskSelection()) return;
  syncTaskPageLayout(reqView);
  document.body.classList.toggle('tasks-page', reqView);
  document.body.classList.toggle('task-selection-open', detailView);
  if (typeof syncTaskResize === 'function') syncTaskResize();
  const requirement = detailView ? state.requirements.find(q => q.id === state.selectedRequirement) : null;
  document.body.classList.toggle('task-detail-page', !!requirement);
  document.body.classList.toggle('projects-page', state.view === 'projects');
  $('#taskPageActions').hidden = !requirement;
  if (requirement) {
    rememberTaskSelection(requirement);
    $('#taskPageActions').innerHTML = window.WorkHubUI.taskActions(requirement, environmentName());
  }
  document.title = sessionsView ? uiText("对话 · Yolu") : settingsView ? uiText("设置 · Yolu") : requirement ? requirement.name + ' · Yolu' : 'Yolu';
  $('#backToRequirements').hidden = !detailView;
  $('.page-heading').hidden = state.view === 'projects';
  $('#stats').hidden = true;
  $('#panelToolbar').hidden = false;
  $('#newButton').hidden = settingsView || sessionsView;
  $('#settingsPage').hidden = !settingsView;
  $('#workContent').hidden = settingsView || sessionsView;
  $('#sessionsPage').hidden = !sessionsView;
  document.body.classList.toggle('sessions-page-open', sessionsView);
  $('#reqCount').textContent = taskInventory.loaded ? taskInventory.requirements.filter(q => q.state !== 'archived').length : '…';
  $('#projectCount').textContent = taskInventory.loaded ? taskInventory.project_count : '…';
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  $('#eyebrow').textContent = sessionsView ? 'SESSIONS' : settingsView ? 'SETTINGS' : detailView ? 'TASK' : reqView ? 'TASKS' : 'PROJECTS';
  $('#pageTitle').textContent = sessionsView ? uiText("对话") : settingsView ? uiText("设置") : detailView ? requirement?.name || (!state.loaded ? uiText("正在加载任务…") : uiText("任务不存在")) : reqView ? uiText("选择任务") : uiText("项目");
  $('#pageSubtitle').textContent = settingsView ? uiText("配置执行环境、对话默认设置与终端工具。") : detailView ? uiText("查看关联项目和 Codex 对话，继续当前任务中的开发。") : reqView ? uiText("围绕一项开发目标，集中管理相关项目的工作目录、分支和对话。") : uiText("登记项目，掌握它的全部工作目录、分支与任务归属。");
  $('#pageSubtitle').hidden = reqView || sessionsView;
  $('#newButton').innerHTML = `<span>＋</span> ${reqView ? uiText("创建任务") : uiText("添加项目")}`;
  $('#panelTitle').textContent = reqView ? uiText("全部任务") : taskInventory.loaded ? uiText("项目 · 当前环境 {0} / 全部 {1}", state.projects.length, taskInventory.project_count) : uiText("已登记项目");
  $('#search').placeholder = reqView ? uiText("搜索任务名称、说明…") : uiText("搜索项目名称、目录…");
  $('#taskListFilters').hidden = !reqView;
  const taskFilterCount = Number($('#archiveFilter').checked) + Number($('#taskStatusFilter').value !== 'all');
  $('#taskListFilters summary').textContent = uiText("筛选") + (taskFilterCount ? ' · ' + taskFilterCount : '');
  $('#archiveFilterWrap').hidden = !reqView;
  $('#taskStatusFilterWrap').hidden = !reqView;
  $('#projectEnvironmentWrap').hidden = reqView;
  $('#projectAddButton').hidden = state.view !== 'projects';
  syncProjectPage();
  renderSettings();
  if (typeof syncSessionWorkspace === 'function') syncSessionWorkspace();
  if (settingsView || sessionsView) { if (typeof syncTaskWorkspace === 'function') syncTaskWorkspace(null); return; }
  $('#stats').innerHTML = '';
  const focusedRow = reqView && document.activeElement?.closest?.('#taskListContent [data-action="open-requirement"]');
  if (reqView) $('#taskListContent').innerHTML = renderRequirements();
  $('#content').innerHTML = detailView
    ? requirement ? requirementDetail(requirement) : !state.loaded ? empty(uiText("暂时无法读取任务"), uiText("请检查任务所属环境的连接，可在设置中重新连接。")) : empty(uiText("这个任务不存在"), uiText("可返回任务列表，重新选择一个任务。"))
    : reqView ? empty(uiText("选择一个任务，继续工作"), uiText("从左侧选择任务，查看关联项目、分支与工作目录。")) : renderProjects();
  if (state.view === 'projects') syncProjectResize();
  if (typeof refreshSessionWorkspace === 'function') refreshSessionWorkspace(false);
  if (typeof syncTaskWorkspace === 'function') syncTaskWorkspace(requirement);
  syncTaskDescription();
  syncMutationControls();
  restoreTaskListPosition((returningToList && !detailView) || !!focusedRow);
}

async function handleAction(action, target) {
  if (state.busy) return;
  const id = target.dataset.id;
  if (action === 'task-project-filter') {
    taskProjectFilters.set(JSON.stringify([activeEnvironment,id]), target.dataset.filter);
    render();
    document.querySelector(`.task-signal-filters [data-filter="${target.dataset.filter}"]`)?.focus({preventScroll:true});
    return;
  }
  if (action === 'open-requirement') {
    saveTaskListView(target);
    await selectEnvironment(target.dataset.environment, '/requirements/' + id);
    if (state.selectedRequirement === id && activeEnvironment === target.dataset.environment) $('#pageTitle').focus({preventScroll:true});
    return;
  }
  if (action === 'clear-task-filters') {
    $('#search').value = ''; $('#archiveFilter').checked = false; $('#taskStatusFilter').value = 'all';
    changeListFilters(); $('#search').focus(); return;
  }
  if (action === 'new-project') return openProject();
  if (action === 'new-worktree') return openWorktree(id);
  if (action === 'new-requirement') return openRequirement();
  if (action === 'edit-task') return openTaskEdit(id);
  if (action === 'change-task-directory') return openTaskDirectory(id, target.dataset.project);
  if (action === 'remove-task-project') return removeTaskProject(id, target.dataset.project);
  if (action === 'add-requirement-projects') return openRequirementProjects(id);
  if (action === 'select-project') { navigate('/projects/' + id); $('#projectDetail h2')?.focus({ preventScroll: true }); return; }
  if (action === 'project-list') { navigate('/projects'); $('#content [aria-pressed="true"][data-action="select-project"]')?.focus(); return; }
  if (action === 'project-filter') { projectFilter = target.dataset.filter; projectDetailOpen = false; render(); $('#content [data-filter="' + projectFilter + '"]')?.focus(); return; }
  if (action === 'project-directory-filter') {
    projectDirectoryFilters.set(projectDirectoryFilterKey(id), target.dataset.filter);
    render();
    document.querySelector('.project-directory-filters [data-filter="' + target.dataset.filter + '"]')?.focus({preventScroll:true});
    return;
  }
  if (action === 'project-refresh') return refresh(true);
  if (action === 'clear-project-search') { $('#search').value = ''; projectDetailOpen = false; render(); $('#search').focus(); return; }
  if (action === 'jump-requirement') { navigate('/requirements/' + id); return; }
  if (action === 'workspace-terminal') return mutation(uiText("正在打开项目终端"), async () => {
    const result = await api(`/api/projects/${id}/git`, { method: 'POST', body: JSON.stringify({ action: 'terminal', path: target.dataset.path }) });
    toast(result.message);
  }, undefined, {project:id});
  if (action === 'copy-path') return copy(target.dataset.path);
  if (action === 'command') {
    try { const plan = await api(`/api/requirements/${id}/launch`); showCommand(plan.command); } catch (e) { toast(e.message, true); } return;
  }
  if (action === 'launch') return mutation(uiText("正在打开 Codex 终端"), async () => { const r = await api(`/api/requirements/${id}/launch`, { method: 'POST', body: '{}' }); toast(r.message); });
  if (action === 'retry') return mutation(uiText("正在重试失败项目"), async () => { const q = await api(`/api/requirements/${id}/retry`, { method: 'POST', body: JSON.stringify({project_id: target.dataset.project || ''}) }); toast(q.state === 'ready' ? uiText("全部项目已就绪") : uiText("仍有项目未就绪，请查看失败原因"), q.state !== 'ready'); }, undefined, {task:id});
  if (action === 'archive') {
    const q = state.requirements.find(q => q.id === id);
    return mutation(uiText("正在更新任务状态"), async () => { const r = await api(`/api/requirements/${id}/archive`, { method: 'POST', body: JSON.stringify({ archived: q.state !== 'archived' }) }); toast(r.message); }, undefined, {task:id});
  }
  if (action === 'remove-project' || action === 'remove-task') return openRemoval(action === 'remove-project' ? 'project' : 'task', id);
}
document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]');
  if (action?.dataset.action === 'open-requirement') {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
  }
  if (action) handleAction(action.dataset.action, action);
  const nav = event.target.closest('[data-view]'); if (nav) navigate('/' + nav.dataset.view);
  if (event.target.closest('.close-dialog') && !event.target.closest('dialog')?.hasAttribute('data-block-close')) event.target.closest('dialog').close();
});
$('#newButton').addEventListener('click', () => state.view === 'requirements' ? openRequirement() : openProject());
$('#refreshButton').addEventListener('click', () => refresh(true));
$('#search').addEventListener('input', changeListFilters);
$('#archiveFilter').addEventListener('change', changeListFilters);
$('#taskStatusFilter')?.addEventListener('change', changeListFilters);
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('cancel', event => { if (dialog.hasAttribute('data-block-close')) event.preventDefault(); }));

$('#copyCommand').addEventListener('click', () => copy($('#commandText').value));
window.addEventListener('DOMContentLoaded', async () => {
  readRoute();
  render();
  // Hosted pages restore their scope/selection before starting any data work.
  // The shell handshake must not wait for repository or environment scans.
  window.dispatchEvent(new CustomEvent('workhub:workspace-ready'));
  if (!window.WorkHubPage) await refresh();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && window.WorkHubPage?.active !== false) refresh(); });

// Keep the impact and any failure visible until the user closes the dialog.
let removalContext;
async function openRemoval(kind, id) {
  const item = (kind === 'project' ? state.projects : state.requirements).find(item => item.id === id);
  if (!item) return;
  const context = removalContext = {kind, id, environment: activeEnvironment, requirements: []};
  const dialog = $('#removalDialog');
  $('#removalTitle').textContent = kind === 'project' ? uiText("移除项目登记") : uiText("删除工作区记录");
  $('#removalDescription').textContent = kind === 'project' ? uiText("正在检查项目“{0}”的工作区关联…", item.name) : uiText("删除工作区“{0}”的管理记录及项目、对话关联？此操作不能撤销。", item.name);
  $('#removalReferences').replaceChildren();
  $('#removalError').hidden = true;
  $('#removalConfirm').disabled = true;
  $('#removalConfirm').textContent = kind === 'project' ? uiText("移除登记") : uiText("删除工作区记录");
  if (!dialog.open) dialog.showModal();
  if (kind === 'task') { $('#removalConfirm').disabled = item.state === 'creating'; return; }
  try {
    const plan = await api(`/api/projects/${encodeURIComponent(id)}/removal`, {environment:context.environment});
    if (removalContext !== context || !dialog.open) return;
    context.requirements = plan.requirements.map(task => task.id);
    $('#removalDescription').textContent = plan.requirements.length ? uiText("以下工作区将解除与“{0}”的关联，工作区本身和其他项目不受影响。", plan.name) : uiText("移除“{0}”的项目登记？", plan.name);
    const list = document.createElement('ul');
    for (const task of plan.requirements) {
      const row = document.createElement('li'), link = document.createElement('a');
      link.textContent = task.name + (task.state === 'archived' ? uiText("（已归档）") : '');
      link.href = `?environment=${encodeURIComponent(context.environment)}#/requirements/${encodeURIComponent(task.id)}`;
      link.addEventListener('click', () => dialog.close());
      row.append(link); list.append(row);
    }
    $('#removalReferences').append(list);
    $('#removalConfirm').textContent = plan.requirements.length ? uiText("解除关联并移除登记") : uiText("移除登记");
    $('#removalConfirm').disabled = plan.requirements.some(task => task.state === 'creating');
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
    const path = context.kind === 'project' ? `/api/projects/${encodeURIComponent(context.id)}?detach=1` : `/api/requirements/${encodeURIComponent(context.id)}`;
    const result = await api(path, {method:'DELETE', environment:context.environment, ...(context.kind === 'project' ? {body:JSON.stringify({requirements:context.requirements})} : {})});
    if (current()) {
      $('#removalDialog').close();
      if (context.kind === 'task') location.hash = '/requirements';
      toast(result.message + (result.context_warning ? '\n' + uiText("工作区说明更新失败：") + result.context_warning : ''), !!result.context_warning);
    }
  }, $('#removalError'), {key:context.kind + ':' + context.id, environment:context.environment, isCurrent:current});
});
