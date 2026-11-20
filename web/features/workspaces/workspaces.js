'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);

let workspaceEnvironmentData = null;
let workspacePickerRevision = 0;
let workspacePickerTimer;
let workspaceDraftSlug = '';
let workspaceDraftToken = '';
let workspaceEditContext = null;
let workspaceDirectoryContext = null;
// Both workspace dialogs use the same per-project directory and branch choices.
const workspaceProjectPickers = new Map();
const expandedWorkspaceDescriptions = new Set();

function syncWorkspaceDescription() {
  const description = $('#workspaceDescription');
  const button = $('[data-action="workspace-info-toggle"]');
  if (!description?.textContent || !button) return;
  const expanded = expandedWorkspaceDescriptions.has(JSON.stringify([activeEnvironment, state.selectedWorkspace]));
  description.classList.add('workspace-description-clamped');
  button.hidden = description.scrollHeight <= description.clientHeight + 1;
  description.classList.toggle('workspace-description-clamped', !expanded);
  button.setAttribute('aria-expanded', String(expanded));
  button.textContent = expanded ? uiText("收起") : uiText("查看全部");
}

document.addEventListener('click', event => {
  if (!event.target.closest('[data-action="workspace-info-toggle"]')) return;
  const key = JSON.stringify([activeEnvironment, state.selectedWorkspace]);
  if (expandedWorkspaceDescriptions.has(key)) expandedWorkspaceDescriptions.delete(key); else expandedWorkspaceDescriptions.add(key);
  syncWorkspaceDescription();
});
window.addEventListener('resize', syncWorkspaceDescription);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncWorkspaceDescription).observe($('#workspaceProjectsView'));

function resetWorkspaceProjectPicker(selector) {
  workspaceProjectPickers.set(selector, { choices: new Map(), overviews: new Map(), rows: [], search: '', markup: null });
  const search = document.querySelector(`[data-picker-search="${selector.slice(1)}"]`);
  if (search) search.value = '';
}

function filterWorkspaceProjectPicker(selector) {
  const container = $(selector);
  const picker = workspaceProjectPickers.get(selector);
  if (!container || !picker) return;
  const query = picker.search.trim().toLocaleLowerCase();
  const rows = [...container.querySelectorAll('[data-picker-search-text]')];
  let visible = 0;
  for (const row of rows) {
    row.hidden = !row.dataset.pickerSearchText.toLocaleLowerCase().includes(query);
    if (!row.hidden) visible++;
  }
  const empty = container.querySelector('[data-picker-empty]');
  if (empty) empty.hidden = visible > 0;
  const count = document.querySelector(`[data-picker-count="${selector.slice(1)}"]`);
  if (count) {
    const selected = container.querySelectorAll('input[name="project_ids"]:checked').length;
    count.textContent = query ? uiText("找到 {0} / {1} 个项目 · 已选 {2} 个", visible, rows.length, selected) : uiText("{0} 个可选项目 · 已选 {1} 个", rows.length, selected);
  }
}

// Search only changes visibility. Filtered-out projects still participate in
// selection, validation and submission, and typing never rebuilds its field.
document.addEventListener('input', event => {
  const target = event.target;
  if (!target.dataset.pickerSearch) return;
  const selector = '#' + target.dataset.pickerSearch;
  const picker = workspaceProjectPickers.get(selector);
  if (picker) { picker.search = target.value; filterWorkspaceProjectPicker(selector); }
});
document.addEventListener('toggle', event => {
  const details = event.target;
  if (!details.matches?.('[data-picker-project]') || String(details.open) === details.dataset.pickerDefaultExpanded) return;
  const container = details.closest('#projectPicker, #workspaceProjectPicker, #workspaceDirectoryPicker');
  const choice = container && workspaceProjectPickers.get('#' + container.id)?.choices.get(details.dataset.pickerProject);
  if (choice) { choice.expanded = details.open; details.dataset.pickerDefaultExpanded = String(details.open); }
}, true);
document.addEventListener('invalid', event => {
  const details = event.target.closest?.('[data-picker-project]');
  if (details) details.open = true;
}, true);

function workspaceCreatesWorktree(mode) { return mode === 'new' || mode === 'existing'; }

function workspacePickerSelection(selector) {
  const picker = workspaceProjectPickers.get(selector);
  return [...$(selector).querySelectorAll('input[name="project_ids"]:checked')].map(input => {
    const choice = picker?.choices.get(input.value) || { mode: 'project' };
    return { project_id: input.value, mode: choice.mode, ...(choice.mode === 'new' ? { branch: choice.branch, source: choice.source } : choice.mode === 'existing' ? { branch: choice.existingBranch || '' } : choice.mode === 'worktree' ? { path: choice.path } : {}) };
  });
}

function renderWorkspaceProjectPicker(selector, projects, selected, environment, defaultBranch) {
  if (!workspaceProjectPickers.has(selector)) resetWorkspaceProjectPicker(selector);
  const picker = workspaceProjectPickers.get(selector);
  const rows = projects.map(p => {
    let choice = picker.choices.get(p.id);
    if (!choice) { choice = { mode: 'new', path: '', source: '', branch: defaultBranch, branchEdited: false }; picker.choices.set(p.id, choice); }
    if (!choice.branchEdited) choice.branch = defaultBranch;
    const v = picker.overviews.get(p.id);
    const trees = (v?.project.worktrees || p.worktrees || []).filter(t => !t.bare && !t.missing && !t.prunable && !t.error && t.path !== p.path);
    if (choice.mode === 'new' && v && !choice.source) choice.source = defaultBranchSource(v);
    return { project: p, checked: selected.has(p.id), choice, overview: v, trees, prefix: `${selector.slice(1)}-${p.id}` };
  });
  picker.rows = rows;
  const container = $(selector);
  const markup = window.WorkHubUI.projectPicker(rows);
  // Polling often changes only Git status timestamps. Preserve the mounted
  // controls and searchable-select roots when their rendered choices agree.
  if (picker.markup !== markup) {
    const focused = container.contains(document.activeElement) ? document.activeElement : null;
    const focusID = focused?.id;
    const selection = focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : null;
    const scroll = container.closest('.workspace-dialog-scroll');
    const scrollTop = scroll?.scrollTop;
    container.innerHTML = markup;
    picker.markup = markup;
    filterWorkspaceProjectPicker(selector);
    if (focusID) {
      const next = document.getElementById(focusID);
      if (next && container.contains(next)) {
        next.focus({ preventScroll: true });
        if (selection?.[0] != null && typeof next.setSelectionRange === 'function') next.setSelectionRange(...selection);
      }
    }
    if (scroll) scroll.scrollTop = scrollTop;
  }
  filterWorkspaceProjectPicker(selector);
  for (const p of projects) {
    const choice = picker.choices.get(p.id);
    if (selected.has(p.id) && choice.mode !== 'project' && !picker.overviews.has(p.id) && !choice.loading && !choice.error) {
      choice.loading = true;
      api(`/api/projects/${encodeURIComponent(p.id)}/git`, { environment }).then(v => {
        if (workspaceProjectPickers.get(selector) !== picker) return;
        picker.overviews.set(p.id, v);
      }).catch(error => { if (workspaceProjectPickers.get(selector) === picker) choice.error = error.message; }).finally(() => {
        choice.loading = false;
        if (workspaceProjectPickers.get(selector) === picker) rerenderWorkspacePicker(selector);
      });
    }
  }
}

function rerenderWorkspacePicker(selector) {
  if (selector === '#projectPicker' && $('#workspaceDialog').open) renderWorkspaceProjectOptions();
  if (selector === '#workspaceProjectPicker' && $('#workspaceProjectsDialog').open) refreshWorkspaceProjectPicker();
  if (selector === '#workspaceDirectoryPicker' && $('#workspaceDirectoryDialog').open) refreshWorkspaceDirectoryPicker();
}

function workspaceProjectPickerInput(selector, event) {
  const target = event.target;
  const row = target.closest('[data-project-id]');
  if (row && target.dataset.choice) {
    const choice = workspaceProjectPickers.get(selector).choices.get(row.dataset.projectId);
    if (target.type === 'radio' && !target.checked) return;
    choice[target.dataset.choice] = target.value;
    if (target.dataset.choice === 'branch') choice.branchEdited = true;
    if (target.dataset.choice === 'mode') choice.expanded = true;
    const data = workspaceProjectPickers.get(selector).rows.find(item => item.project.id === row.dataset.projectId);
    const summary = row.querySelector('[data-choice-summary]');
    if (summary && data) summary.textContent = window.WorkHubUI.projectChoiceSummary(data);
  }
  // Keep text inputs in place while typing; changing mode rebuilds its controls.
  if (event.type === 'change' && (target.dataset.choice === 'mode' || target.name === 'project_ids')) rerenderWorkspacePicker(selector);
}

function workspaceProjectPickerReady(selector) {
  const picker = workspaceProjectPickers.get(selector);
  return workspacePickerSelection(selector).every(m => {
    const row = picker?.rows.find(item => item.project.id === m.project_id);
    return !!row && window.WorkHubUI.projectChoiceReady(row);
  });
}

function workspaceBranchSummary(q) { return window.WorkHubUI.branchSummary(q); }

function workspaceMemberExpectedBranch(m, q) { return window.WorkHubUI.expectedBranch(m, q); }
function workspaceMemberReusesDirectory(m) { return window.WorkHubUI.reusesDirectory(m); }


const workspaceProjectFilters = new Map();
function filteredWorkspaces() {
  const text = $('#search').value.trim().toLowerCase();
  return workspaceInventory.workspaces.filter(q => window.WorkHubUI.workspaceMatches(q, $('#workspaceStatusFilter')?.value || 'all') && ($('#archiveFilter').checked || q.state !== 'archived') && `${q.name} ${q.description || ''} ${q.slug} ${q.branch} ${workspaceBranchSummary(q)} ${q.environment_name}`.toLowerCase().includes(text));
}
function renderWorkspaces() {
  if (!workspaceInventory.loaded) return uiText("<div class=\"loading\">正在读取全部环境的工作区…</div>");
  if (!workspaceInventory.workspaces.length) return empty(uiText("为下一项开发工作，创建一个工作区"), uiText("选择项目及其工作目录，围绕同一个目标组织开发工作。"), 'new-workspace', uiText("创建第一个工作区"));
  const workspaces = filteredWorkspaces();
  if (!workspaces.length) return empty(uiText("没有匹配的工作区"), uiText("可以清除搜索与状态筛选，返回未归档工作区列表。"), 'clear-workspace-filters', uiText("清除搜索与筛选"));
  return window.WorkHubUI.workspaces(workspaces, lastWorkspaceSelection?.id, lastWorkspaceSelection?.environment);
}

function canOpenMember(m) {
  return window.WorkHubUI.canOpenMember(m);
}

function workspaceDetail(q) {
  return window.WorkHubUI.workspaceDetail(q, state.projects, environmentName(), preferredProjectOpenTool(), workspaceProjectFilters.get(JSON.stringify([activeEnvironment,q.id])) || 'all');
}

function openWorkspace() {
  if (state.busy) return;
  resetWorkspaceProjectPicker('#projectPicker');
  workspaceDraftToken = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  workspaceDraftSlug = 'workspace-' + workspaceDraftToken;
  const form = $('#workspaceForm'); form.reset(); $('#workspaceError').hidden = true;
  $('#workspaceEnvironment').innerHTML = environmentOptions();
  $('#workspaceEnvironment').value = activeEnvironment;
  $('#workspaceDialog').showModal();
  loadWorkspaceProjects();
}

function renderWorkspaceProjectOptions(selectID = null) {
  const projects = workspaceEnvironmentData?.projects || [];
  const selected = new Set([...$('#projectPicker').querySelectorAll('input[name="project_ids"]:checked')].map(input => input.value));
  for (const id of Array.isArray(selectID) ? selectID : selectID ? [selectID] : []) selected.add(id);
  renderWorkspaceProjectPicker('#projectPicker', projects, selected, $('#workspaceEnvironment').value, 'codex/' + workspaceDraftSlug);
  updatePreview();
}

async function loadWorkspaceProjects(preserveSelection = false, selectID = null) {
  clearTimeout(workspacePickerTimer);
  const revision = ++workspacePickerRevision;
  const environment = $('#workspaceEnvironment').value;
  $('#workspaceSubmit').disabled = true;
  $('#workspaceError').hidden = true;
  if (!preserveSelection) {
    workspaceEnvironmentData = null;
    $('#projectPicker').textContent = uiText("正在连接执行环境…");
    resetWorkspaceProjectPicker('#projectPicker');
    $('#workspacePreview').textContent = '';
  }
  try {
    const data = await api('/api/state', { environment });
    if (revision !== workspacePickerRevision || !$('#workspaceDialog').open) return;
    workspaceEnvironmentData = { ...data, environment };
    renderWorkspaceProjectOptions(selectID);
    if (data.status_refreshing) workspacePickerTimer = setTimeout(() => loadWorkspaceProjects(true), 1000);
  } catch (error) {
    if (revision !== workspacePickerRevision || !$('#workspaceDialog').open) return;
    workspaceEnvironmentData = null;
    $('#projectPicker').textContent = '';
    $('#workspaceError').textContent = error.message;
    $('#workspaceError').hidden = false;
  }
}

function updatePreview() {
  const projects = workspaceEnvironmentData?.projects || [];
  const members = workspacePickerSelection('#projectPicker');
  const path = workspaceDisplayPath(workspaceEnvironmentData?.root || '', workspaceDraftSlug);
  $('#workspacePreview').textContent = members.length ? members.map(m => {
    const p = projects.find(p => p.id === m.project_id);
    if (!p) return '';
    return p.name + ' · ' + (workspaceCreatesWorktree(m.mode) ? workspaceDisplayPath(path, p.folder) + uiText("（新建 · ") + (m.branch || uiText("请选择分支")) + '）' : m.mode === 'project' ? p.path + uiText("（项目原目录）") : (m.path || uiText("请选择已有 Worktree")));
  }).join('\n') : uiText("选择参与项目后，确认各项目实际使用的目录。");
  $('#workspaceSubmit').disabled = !workspaceEnvironmentData || workspaceEnvironmentData.environment !== $('#workspaceEnvironment').value || !members.length || members.length > 30 || !workspaceProjectPickerReady('#projectPicker');
}

$('#workspaceEnvironment').addEventListener('change', () => loadWorkspaceProjects());
$('#workspaceDialog').addEventListener('close', () => { clearTimeout(workspacePickerTimer); workspacePickerRevision++; });
$('#registerNewWorkspaceProject').addEventListener('click', () => {
  clearTimeout(workspacePickerTimer);
  openProject(id => loadWorkspaceProjects(true, id), $('#workspaceEnvironment').value);
});

$('#projectPicker').addEventListener('input', event => workspaceProjectPickerInput('#projectPicker', event));
$('#projectPicker').addEventListener('change', event => workspaceProjectPickerInput('#projectPicker', event));
$('#projectPicker').addEventListener('click', event => {
  const id = event.target.dataset.choiceRetry;
  if (id) { delete workspaceProjectPickers.get('#projectPicker').choices.get(id).error; renderWorkspaceProjectOptions(); }
});
$('#workspaceForm').addEventListener('input', event => {
  if (event.target.name === 'name') {
    const readable = event.target.value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    workspaceDraftSlug = readable ? readable + '-' + workspaceDraftToken : 'workspace-' + workspaceDraftToken;
    renderWorkspaceProjectOptions();
  }
  updatePreview();
});
$('#workspaceForm').addEventListener('change', updatePreview);

function watchWorkspaceCreation(body, environment) {
  const dialog = $('#workspaceDialog');
  const inputs = $('#workspaceInputs'), progress = $('#workspaceProgress');
  const summary = $('#workspaceProgressSummary'), list = $('#workspaceProgressProjects');
  const projects = new Map((workspaceEnvironmentData?.projects || []).map(project => [project.id, project.name]));
  let timer, signature;
  const controller = new AbortController();
  const endpoint = '/api/workspaces/creation-progress?' + new URLSearchParams({slug:body.slug});

  function renderProgress(workspace) {
    const members = new Map((workspace?.members || []).map(member => [member.project_id, member]));
    const rows = body.project_ids.map(id => {
      const member = members.get(id);
      return [projects.get(id) || id, member?.state || 'pending', member?.error || ''];
    });
    const next = JSON.stringify([!!workspace, rows]);
    if (signature === next) return;
    signature = next;
    const ready = rows.filter(([, status]) => status === 'ready').length;
    summary.textContent = workspace ? uiText("已就绪 {0} / {1}", ready, rows.length) : uiText("正在检查参与项目…");
    list.innerHTML = rows.map(([name, status, error]) => `<li><div><strong>${esc(name)}</strong>${badge(status)}</div>${error ? `<p>${esc(uiText(error))}</p>` : ''}</li>`).join('');
  }

  async function poll() {
    try {
      const workspace = await api(endpoint, {environment, signal:controller.signal});
      if (!controller.signal.aborted && workspace?.slug === body.slug) renderProgress(workspace);
    } catch { /* The create request owns errors. Keep the last confirmed progress. */ }
    if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
  }

  renderProgress(null);
  inputs.hidden = true;
  progress.hidden = false;
  $('.workspace-dialog-scroll', dialog).scrollTop = 0;
  $('#workspaceProgressTitle').focus();
  void poll();
  return () => {
    controller.abort();
    clearTimeout(timer);
    progress.hidden = true;
    inputs.hidden = false;
  };
}

$('#workspaceForm').addEventListener('submit', async event => {
  if ($('#workspaceSubmit').disabled) { event.preventDefault(); return; }
  event.preventDefault(); const data = new FormData(event.target);
  const projectIDs = [...$('#projectPicker').querySelectorAll('input[name="project_ids"]:checked')].map(i => i.value);
  const body = { name: data.get('name'), slug: workspaceDraftSlug, description: data.get('description'), project_ids: projectIDs, members: workspacePickerSelection('#projectPicker') };
  const environment = $('#workspaceEnvironment').value;
  let created;
  await mutation(uiText("正在创建工作区并准备工作目录"), async () => {
    const stopWatching = watchWorkspaceCreation(body, environment);
    let q;
    try { q = await api('/api/workspaces', { environment, method: 'POST', body: JSON.stringify(body) }); }
    finally { stopWatching(); }
    created = q;
    if (environment === activeEnvironment) state.workspaces = [q, ...state.workspaces.filter(current => current.id !== q.id)];
    $('#search').value = ''; $('#workspaceDialog').close();
    toast(q.state === 'ready' ? uiText("工作区已创建，全部项目已就绪") : uiText("工作区已保存，部分项目创建失败，可单独重试"), q.state !== 'ready');
  }, $('#workspaceError'));
  if (created) await selectEnvironment(environment, '/workspaces/' + created.id);
  else if (!$('#workspaceError').hidden) $('#workspaceError').focus();
});

function openWorkspaceEdit(id) {
  const q = state.workspaces.find(q => q.id === id);
  if (!q || state.busy) return;
  workspaceEditContext = {id, environment: activeEnvironment};
  $('#workspaceEditName').value = q.name;
  $('#workspaceEditDescription').value = q.description || '';
  $('#workspaceEditError').hidden = true;
  $('#workspaceEditDialog').showModal();
  $('#workspaceEditName').focus();
}
$('#workspaceEditForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || !workspaceEditContext) return;
  const context = {...workspaceEditContext};
  const body = {name: $('#workspaceEditName').value, description: $('#workspaceEditDescription').value};
  await mutation(uiText("正在保存工作区信息"), async () => {
    const q = await api(`/api/workspaces/${encodeURIComponent(context.id)}`, {environment: context.environment, method: 'PATCH', body: JSON.stringify(body)});
    $('#workspaceEditDialog').close(); toast(q.context_warning ? uiText("工作区信息已保存；") + q.context_warning : uiText("工作区信息已保存"), !!q.context_warning);
  }, $('#workspaceEditError'));
});
function openWorkspaceDirectory(id, project) {
  const q = state.workspaces.find(q => q.id === id);
  const m = q?.members.find(m => m.project_id === project);
  if (!m || state.busy) return;
  const p = state.projects.find(p => p.id === project);
  if (!p) return;
  const suffix = crypto.randomUUID().replace(/-/g,'').slice(0,8);
  workspaceDirectoryContext = {id, project, environment: activeEnvironment, path: workspaceDisplayPath(q.path, p.folder.slice(0,48) + '-' + suffix)};
  resetWorkspaceProjectPicker('#workspaceDirectoryPicker');
  workspaceProjectPickers.get('#workspaceDirectoryPicker').choices.set(project, {mode: workspaceCreatesWorktree(m.mode) ? 'worktree' : (m.mode || 'project'), path: m.path, source: '', branch: 'codex/' + q.slug + '-' + suffix, branchEdited: true});
  $('#workspaceDirectoryCurrent').textContent = p.name + uiText(" · 当前使用 ") + m.path + ' · ' + (m.worktree?.branch || m.branch || 'detached HEAD');
  $('#workspaceDirectoryError').hidden = true;
  $('#workspaceDirectoryPicker').innerHTML = '';
  $('#workspaceDirectoryDialog').showModal();
  refreshWorkspaceDirectoryPicker();
}
function refreshWorkspaceDirectoryPicker() {
  const context = workspaceDirectoryContext;
  if (!context || !$('#workspaceDirectoryDialog').open || context.environment !== activeEnvironment) return;
  const q = state.workspaces.find(q => q.id === context.id);
  const p = state.projects.find(p => p.id === context.project);
  if (!q || !p) return;
  renderWorkspaceProjectPicker('#workspaceDirectoryPicker', [p], new Set([p.id]), context.environment, 'codex/' + q.slug);
  $('#workspaceDirectoryPicker input[name="project_ids"]').disabled = true;
  updateWorkspaceDirectoryPreview();
}
function updateWorkspaceDirectoryPreview() {
  if (!workspaceDirectoryContext) return;
  const selected = workspacePickerSelection('#workspaceDirectoryPicker')[0];
  const p = state.projects.find(p => p.id === workspaceDirectoryContext.project);
  const choice = workspaceProjectPickers.get('#workspaceDirectoryPicker')?.choices.get(p?.id);
  $('#workspaceDirectoryPreview').textContent = !selected ? '' : workspaceCreatesWorktree(selected.mode) ? workspaceDirectoryContext.path + (selected.mode === 'existing' ? uiText("\n使用已有分支 ") : uiText("\n新建分支 ")) + (selected.branch || uiText("请选择分支")) : selected.mode === 'project' ? p.path + uiText("（项目原目录）") : selected.path || uiText("请选择已有 Worktree");
  $('#workspaceDirectorySubmit').disabled = !selected || !workspaceProjectPickerReady('#workspaceDirectoryPicker') || !!choice?.error;
}
for (const type of ['input', 'change']) $('#workspaceDirectoryPicker').addEventListener(type, event => { workspaceProjectPickerInput('#workspaceDirectoryPicker', event); updateWorkspaceDirectoryPreview(); });
$('#workspaceDirectoryPicker').addEventListener('click', event => {
  const id = event.target.dataset.choiceRetry;
  if (id) { delete workspaceProjectPickers.get('#workspaceDirectoryPicker').choices.get(id).error; refreshWorkspaceDirectoryPicker(); }
});
$('#workspaceDirectoryForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || $('#workspaceDirectorySubmit').disabled || !workspaceDirectoryContext) return;
  const context = {...workspaceDirectoryContext};
  const selected = workspacePickerSelection('#workspaceDirectoryPicker')[0];
  if (workspaceCreatesWorktree(selected.mode)) selected.path = context.path;
  await mutation(uiText("正在更换工作目录"), async () => {
    const q = await api(`/api/workspaces/${encodeURIComponent(context.id)}/projects/${encodeURIComponent(context.project)}`, {environment: context.environment, method:'PUT', body:JSON.stringify(selected)});
    $('#workspaceDirectoryDialog').close();
    toast(q.members.find(m => m.project_id === context.project)?.state === 'ready' ? uiText("已更换工作目录，旧目录保留") : uiText("目录配置已保存，请查看准备失败原因"), q.state !== 'ready');
  }, $('#workspaceDirectoryError'));
});
async function removeWorkspaceProject(id, project) {
  const q = state.workspaces.find(q => q.id === id);
  const m = q?.members.find(m => m.project_id === project);
  if (!m || !confirm(uiText("从“{0}”移除“{1}”？\n工作目录、分支、代码和已有对话均保留。", q.name, m.project_name))) return;
  const environment = activeEnvironment;
  await mutation(uiText("正在解除项目关联"), async () => {
    const updated = await api(`/api/workspaces/${encodeURIComponent(id)}/projects/${encodeURIComponent(project)}`, {environment, method:'DELETE'});
    toast(updated.context_warning ? uiText("已解除关联；") + updated.context_warning : uiText("已移除项目关联，工作目录保留"), !!updated.context_warning);
  });
}
