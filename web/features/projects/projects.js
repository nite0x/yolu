'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


let projectAddedCallback = null;
let projectScan = null;
let projectOpenTool;
let projectFilter = 'all';
let projectDetailOpen = false;
const projectDirectoryFilters = new Map();
function projectDirectoryFilterKey(id) { return JSON.stringify([activeEnvironment, id]); }

const projectWidthKey = 'workhub:project-list-width:v1';
let projectListWidth = 248;
let projectResizeDrag = null;
try {
  const saved = Number(localStorage.getItem(projectWidthKey));
  if (Number.isFinite(saved) && saved >= 200 && saved <= 10000) projectListWidth = saved;
} catch { /* Keep the default when storage is unavailable. */ }
$('#content').style.setProperty('--project-list-width', projectListWidth + 'px');

function projectResizeBounds() {
  const workspace = $('.project-workspace');
  if (!workspace || window.innerWidth <= (desktopListWidth ? 760 : 1020)) return null;
  const width = workspace.getBoundingClientRect().width;
  if (!width) return null;
  return desktopListWidth?.bounds() ?? (width >= 568 ? { min: 200, max: Math.floor(width - 368) } : null);
}
function syncProjectResize() {
  const handle = $('[data-project-resize]');
  const bounds = projectResizeBounds();
  if (!handle || !bounds) return;
  handle.setAttribute('aria-valuemin', String(bounds.min));
  handle.setAttribute('aria-valuemax', String(bounds.max));
  handle.setAttribute('aria-valuenow', String(desktopListWidth?.current() ?? Math.round($('#projectListPane').getBoundingClientRect().width)));
}
function resizeProjectList(width) {
  const bounds = projectResizeBounds();
  if (!bounds) return;
  if (desktopListWidth) { desktopListWidth.resize(width); return; }
  projectListWidth = Math.round(Math.max(bounds.min, Math.min(bounds.max, width)));
  $('#content').style.setProperty('--project-list-width', projectListWidth + 'px');
  syncProjectResize();
}
function rememberProjectWidth() {
  if (desktopListWidth) { desktopListWidth.save(); return; }
  try { localStorage.setItem(projectWidthKey, String(projectListWidth)); } catch { /* Retain the in-memory width. */ }
}
function finishProjectResize(event) {
  if (!projectResizeDrag || event?.pointerId != null && event.pointerId !== projectResizeDrag.id) return;
  const drag = projectResizeDrag;
  projectResizeDrag = null;
  const content = $('#content');
  document.querySelectorAll('.project-workspace[data-resizing]').forEach(node => delete node.dataset.resizing);
  if (content.hasPointerCapture?.(drag.id)) content.releasePointerCapture(drag.id);
  if (drag.moved) rememberProjectWidth();
}
document.addEventListener('pointerdown', event => {
  const handle = event.target.closest('[data-project-resize]');
  if (!handle || event.button !== 0 || projectResizeDrag || !projectResizeBounds()) return;
  event.preventDefault();
  handle.focus({ preventScroll: true });
  projectResizeDrag = { id: event.pointerId, x: event.clientX, width: desktopListWidth?.current() ?? $('#projectListPane').getBoundingClientRect().width, moved: false };
  $('.project-workspace').dataset.resizing = '';
  // Capture on the stable host so polling can replace the markup during a drag.
  $('#content').setPointerCapture?.(event.pointerId);
});
document.addEventListener('pointermove', event => {
  if (!projectResizeDrag || event.pointerId !== projectResizeDrag.id) return;
  if (!projectResizeBounds()) { finishProjectResize(event); return; }
  projectResizeDrag.moved = true;
  resizeProjectList(projectResizeDrag.width + event.clientX - projectResizeDrag.x);
  $('.project-workspace').dataset.resizing = '';
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, finishProjectResize);
document.addEventListener('keydown', event => {
  if (!event.target.closest('[data-project-resize]')) return;
  const bounds = projectResizeBounds();
  if (!bounds || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const width = desktopListWidth?.current() ?? $('#projectListPane').getBoundingClientRect().width;
  resizeProjectList(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : width + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 40 : 10));
  rememberProjectWidth();
});
document.addEventListener('dblclick', event => {
  if (desktopListWidth && event.target.closest('[data-project-resize]') && projectResizeBounds()) {
    desktopListWidth.resize(desktopListWidth.defaultWidth); desktopListWidth.save();
  }
});
if (desktopListWidth) window.addEventListener('pagehide',desktopListWidth.subscribe(syncProjectResize),{once:true});
window.addEventListener('resize', () => { if (!projectResizeBounds()) finishProjectResize(); syncProjectResize(); });
window.addEventListener('blur', () => finishProjectResize());
window.addEventListener('pagehide', () => finishProjectResize());
if (typeof ResizeObserver !== 'undefined') {
  const observer = new ResizeObserver(syncProjectResize);
  observer.observe($('#content'));
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}

function preferredProjectOpenTool() {
  if (projectOpenTool) return projectOpenTool;
  try { projectOpenTool = localStorage.getItem('workhub:project-open:v1'); } catch { /* Use the default without storage. */ }
  if (!['vscode', 'idea', 'terminal'].includes(projectOpenTool)) projectOpenTool = 'vscode';
  return projectOpenTool;
}

function rememberProjectOpenTool(choice) {
  const tool = choice.dataset.projectOpenChoice;
  if (!['vscode', 'idea', 'terminal'].includes(tool)) return;
  projectOpenTool = tool;
  try { localStorage.setItem('workhub:project-open:v1', tool); } catch { /* Keep the preference for this page. */ }
  const label = { vscode: 'VS Code', idea: 'IDEA', terminal: uiText("终端") }[tool];
  document.querySelectorAll('[data-project-open-primary]').forEach(button => {
    button.dataset.action = tool === 'terminal' ? 'workspace-terminal' : 'project-open-' + tool;
    button.setAttribute('aria-label', uiText("用 {0} 打开工作目录", label));
    button.querySelector('[data-project-open-label]').textContent = uiText("{0} 打开", label);
    button.querySelector('svg')?.replaceWith(choice.querySelector('svg').cloneNode(true));
  });
}

function positionTaskMenu(menu) {
  if (!menu.open) return;
  const panel = menu.querySelector('.task-action-menu-body, .task-project-details-body');
  if (!panel) return;
  const anchor = (menu.closest('.task-split-action') || menu).getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  const left = menu.classList.contains('task-project-details') ? anchor.right - bounds.width : anchor.left;
  panel.style.left = Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)) + 'px';
  const below = window.innerHeight - anchor.bottom;
  const top = below < bounds.height + 8 && anchor.top > below ? anchor.top - bounds.height - 6 : anchor.bottom + 6;
  panel.style.top = Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8)) + 'px';
}
document.addEventListener('toggle', event => {
  if (event.target.matches('.task-action-menu, .task-project-details')) positionTaskMenu(event.target);
}, true);
function positionOpenTaskMenus() {
  document.querySelectorAll('.task-action-menu[open], .task-project-details[open]').forEach(positionTaskMenu);
}
document.addEventListener('scroll', positionOpenTaskMenus, true);
window.addEventListener('resize', positionOpenTaskMenus);

function renderProjects() {
  const status = !state.loaded ? 'loading' : !state.projects.length ? 'empty' : undefined;
  if (!desktopWorkspace || state.view !== 'projects') {
    if (status === 'loading') return uiText("<div class=\"loading\">正在读取当前环境的项目…</div>");
    if (status === 'empty') return empty(uiText("你的项目，从这里连接"), uiText("登记本地 Git 仓库，或从 Git 克隆新项目。已有 Worktree 会自动发现。"), 'new-project', uiText("添加第一个项目"));
  }
  const text = $('#search').value.trim().toLowerCase();
  const projects = state.projects.filter(p => `${p.name} ${p.path}`.toLowerCase().includes(text));
  const visible = projects.filter(p => projectFilter === 'dirty' ? p.worktrees.some(t => (t.dirty || 0) > 0) : projectFilter === 'error' ? p.error || p.worktrees.some(t => t.missing || t.prunable || t.error) : true);
  const selected = visible.find(p => p.id === state.selectedProject) || visible[0];
  return window.WorkHubUI.projects(projects, state.selectedProject, preferredProjectOpenTool(), projectFilter, projectDetailOpen, state.requirements, projectDirectoryFilters.get(projectDirectoryFilterKey(selected?.id)) || 'all', !!text, status);
}

function renderDesktopProjects(markup) {
  const content = $('#content');
  const current = content.querySelector('.project-workspace');
  if (!current) {
    content.innerHTML = markup;
    const toolbar = $('#panelToolbar');
    const actions = toolbar.querySelector('.toolbar-actions');
    actions.prepend($('#projectAddButton'), $('#searchField'));
    $('#projectEnvironmentSlot').append($('#projectEnvironmentWrap'));
    $('#projectListFilterSlot').replaceChildren(content.querySelector('.project-filters'));
    $('#projectListPane').prepend(toolbar);
    return;
  }
  // Keep the toolbar and its focused input mounted while refreshing the rows.
  const template = document.createElement('template');
  template.innerHTML = markup;
  current.dataset.pane = template.content.querySelector('.project-workspace').dataset.pane;
  // Other views move the shared toolbar out of the project pane. Restore it
  // before refreshing its filters, retaining the search field and focus.
  const listPane = current.querySelector('#projectListPane');
  const toolbar = $('#panelToolbar');
  if (toolbar.parentElement !== listPane) listPane.prepend(toolbar);
  for (const selector of ['.project-filters', '.project-list-scroll', '#projectDetail']) {
    const target = current.querySelector(selector);
    const next = template.content.querySelector(selector);
    target.hidden = next.hidden;
    if (next.hasAttribute('aria-label')) target.setAttribute('aria-label', next.getAttribute('aria-label'));
    target.replaceChildren(...next.childNodes);
  }
}

function openProject(onAdded = null, environment = activeEnvironment) {
  if (state.busy) return;
  projectAddedCallback = onAdded;
  projectScan = null;
  $('#projectScanResults').replaceChildren();
  $('#projectScanResults').hidden = true;
  $('#projectForm').reset(); $('#projectError').hidden = true; $('#projectDialog').showModal();
  $('#projectEnvironmentSelect').innerHTML = environmentOptions();
  $('#projectEnvironmentSelect').value = environment;
  $('#projectEnvironmentSelect').disabled = !!onAdded;
  updateProjectSource();
  updateProjectDirectoryPicker();
}

let suggestedCloneDirectory = '';
function updateProjectSource() {
  const source = $('#projectSource').value;
  const clone = source === 'clone';
  const scan = source === 'scan';
  $('#projectCloneFields').hidden = !clone;
  for (const id of ['projectCloneURL', 'projectCloneDirectory']) { $("#" + id).disabled = !clone; $("#" + id).required = clone; }
  $('#projectNameField').hidden = scan;
  $('#projectName').disabled = scan;
  const fields = {
    local: {
      label: uiText("仓库目录 *"),
      help: uiText("选择本机 Git 仓库主目录，或填写项目所在环境中的绝对路径。"),
      placeholder: uiText("填写仓库主目录的绝对路径"),
    },
    clone: {
      label: uiText("存放目录 *"),
      help: uiText("选择已存在的父目录，仓库将克隆到其下的新文件夹中。"),
      placeholder: uiText("填写存放目录的绝对路径"),
    },
    scan: {
      label: uiText("扫描目录 *"),
      help: uiText("递归扫描所选环境中的全部仓库，跳过目录符号链接和 Git 元数据。"),
      placeholder: uiText("例如 ~/project"),
    },
  }[source];
  $('#projectPath-label').textContent = fields.label;
  $('#projectPath-help').textContent = fields.help;
  $('#projectPath').placeholder = fields.placeholder;
  updateProjectScanControls();
}
function resetProjectScan() {
  projectScan = null;
  $('#projectScanResults').replaceChildren();
  $('#projectScanResults').hidden = true;
  $('#projectError').hidden = true;
  updateProjectScanControls();
}
function updateProjectScanControls() {
  const scan = $('#projectSource').value === 'scan';
  const selected = projectScan?.repositories.filter(repository => repository.selected && !repository.project_id) || [];
  $('#projectRescan').hidden = !scan || !projectScan;
  const labels = {
    local: uiText("添加并扫描"),
    clone: uiText("克隆并添加"),
    scan: projectScan ? uiText("登记所选仓库（{0}）", selected.length) : uiText("扫描目录"),
  };
  $('#projectSubmit').textContent = labels[$('#projectSource').value];
  $('#projectSubmit').disabled = scan && !!projectScan && !selected.length;
  const selectAll = $('#projectScanSelectAll');
  if (selectAll && projectScan) {
    const available = projectScan.repositories.filter(repository => !repository.project_id);
    selectAll.checked = !!available.length && selected.length === available.length;
    selectAll.indeterminate = !!selected.length && selected.length < available.length;
  }
}
function renderProjectScan() {
  $('#projectScanResults').innerHTML = window.WorkHubUI.projectScanResults(projectScan);
  $('#projectScanResults').hidden = false;
  updateProjectScanControls();
}
async function scanProjectDirectory() {
  if ($('#projectDialog').dataset.mutation || !$('#projectForm').reportValidity()) return;
  const environment = $('#projectEnvironmentSelect').value;
  const path = $('#projectPath').value.trim();
  resetProjectScan();
  $('#projectScanResults').hidden = false;
  $('#projectScanResults').textContent = uiText("正在扫描目录…");
  $('#projectScanResults').setAttribute('aria-busy', 'true');
  await mutation(uiText("正在扫描目录…"), async () => {
    const result = await api('/api/projects/scan', { environment, method: 'POST', body: JSON.stringify({path}) });
    projectScan = {...result, repositories: result.repositories.map(repository => ({...repository, selected: !repository.project_id}))};
  }, $('#projectError'), {
    environment,
    isCurrent: () => $('#projectDialog').open && $('#projectEnvironmentSelect').value === environment,
  });
  $('#projectScanResults').removeAttribute('aria-busy');
  if (projectScan) renderProjectScan();
  else $('#projectScanResults').hidden = true;
  updateProjectScanControls();
}
$('#projectSource').addEventListener('change', () => { resetProjectScan(); updateProjectSource(); });
$('#projectPath').addEventListener('input', resetProjectScan);
$('#projectEnvironmentSelect').addEventListener('change', resetProjectScan);
$('#projectRescan').addEventListener('click', scanProjectDirectory);
$('#projectScanResults').addEventListener('input', event => {
  if (!projectScan || !event.target.hasAttribute('data-scan-name')) return;
  projectScan.repositories[Number(event.target.dataset.scanName)].name = event.target.value;
});
$('#projectScanResults').addEventListener('change', event => {
  if (!projectScan) return;
  if (event.target.id === 'projectScanSelectAll') {
    projectScan.repositories.forEach(repository => {
      repository.selected = !repository.project_id && event.target.checked;
    });
    $('#projectScanResults').querySelectorAll('[data-scan-select]').forEach(input => {
      input.checked = projectScan.repositories[Number(input.dataset.scanSelect)].selected;
    });
  } else if (event.target.hasAttribute('data-scan-select')) {
    projectScan.repositories[Number(event.target.dataset.scanSelect)].selected = event.target.checked;
  }
  updateProjectScanControls();
});
$('#projectCloneURL').addEventListener('input', () => {
  const field = $('#projectCloneDirectory');
  const source = $('#projectCloneURL').value.trim().split(/[?#]/)[0].replace(/\/+$/, '');
  const suggested = source.split(/[/:]/).pop()?.replace(/\.git$/, '') || '';
  if (!field.value || field.value === suggestedCloneDirectory) field.value = suggested;
  suggestedCloneDirectory = suggested;
});

function updateProjectDirectoryPicker() {
  const remote = $('#projectEnvironmentSelect').value !== 'local';
  $('#chooseProjectDirectory').disabled = remote;
  $('#projectDirectoryHint').hidden = !remote;
}

$('#projectEnvironmentSelect').addEventListener('change', updateProjectDirectoryPicker);
$('#chooseProjectDirectory').addEventListener('click', async () => {
  if (state.busy || $('#projectEnvironmentSelect').value !== 'local') return;
  const button = $('#chooseProjectDirectory');
  const environment = $('#projectEnvironmentSelect');
  const environmentWasDisabled = environment.disabled;
  environment.disabled = true;
  button.disabled = true;
  button.textContent = uiText("正在选择…");
  try {
    const title = {
      local: uiText("请在系统窗口中选择仓库文件夹"),
      clone: uiText("请在系统窗口中选择存放目录"),
      scan: uiText("请在系统窗口中选择扫描目录"),
    }[$('#projectSource').value];
    await mutation(title, async () => {
      const result = await api('/api/dialogs/directory', { environment: 'local', method: 'POST', body: '{}' });
      if (result.path && environment.value === 'local') {
        $('#projectPath').value = result.path;
        $('#projectPath').dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, $('#projectError'));
  } finally {
    environment.disabled = environmentWasDisabled;
    button.textContent = uiText("选择文件夹…");
    updateProjectDirectoryPicker();
    $('#projectPath').focus();
  }
});

async function importScannedProjects() {
  const selected = projectScan.repositories.filter(repository => repository.selected && !repository.project_id);
  if (!selected.length) return;
  const environment = $('#projectEnvironmentSelect').value;
  const onAdded = projectAddedCallback;
  let results;
  await mutation(uiText("正在批量登记仓库…"), async () => {
    const repositories = selected.map(({name, path, common_dir}) => ({name, path, common_dir}));
    const response = await api('/api/projects/import', {
      environment,
      method: 'POST',
      body: JSON.stringify({repositories}),
    });
    results = response.results;
  }, $('#projectError'), {
    environment,
    isCurrent: () => $('#projectDialog').open && $('#projectEnvironmentSelect').value === environment,
  });
  if (!results) return;
  const ids = [];
  for (const result of results) {
    const repository = selected.find(repository => repository.path === result.path);
    if (!repository) continue;
    repository.error = result.error;
    if (result.id) {
      repository.project_id = result.id;
      repository.selected = false;
      ids.push(result.id);
    }
  }
  renderProjectScan();
  const failures = results.filter(result => result.status === 'error').length;
  if (failures) {
    $('#projectError').textContent = uiText("{0} 个仓库登记成功，{1} 个失败。可修改项目名称后重试。", ids.length, failures);
    $('#projectError').hidden = false;
  } else {
    $('#projectDialog').close();
    toast(uiText("已登记 {0} 个仓库，正在扫描 Worktree", ids.length));
  }
  if (ids.length && onAdded) await onAdded(ids);
  else if (ids.length && !failures) {
    await selectEnvironment(environment, '/projects');
    state.selectedProject = ids[0]; $('#search').value = ''; render();
  }
}

$('#projectForm').addEventListener('submit', async event => {
  event.preventDefault();
  if ($('#projectDialog').dataset.mutation) return;
  if ($('#projectSource').value === 'scan') {
    if (projectScan) await importScannedProjects();
    else await scanProjectDirectory();
    return;
  }
  const data = new FormData(event.target);
  const onAdded = projectAddedCallback;
  const environment = $('#projectEnvironmentSelect').value;
  let added;
  const clone = $('#projectSource').value === 'clone';
  const payload = clone ? {name:data.get('name'), url:$('#projectCloneURL').value.trim(), parent:data.get('path'), directory:$('#projectCloneDirectory').value.trim()} : { name:data.get('name'), path:data.get('path') };
  await mutation(clone ? uiText("正在克隆并登记仓库…") : uiText("正在登记并扫描仓库"), async () => {
    added = await api(clone ? '/api/projects/clone' : '/api/projects', { environment, method: 'POST', body: JSON.stringify(payload) });
    $('#projectDialog').close(); toast(clone ? uiText("仓库已克隆并登记，正在扫描 Worktree") : uiText("项目已登记，正在扫描 Worktree"));
  }, $('#projectError'), {
    environment,
    isCurrent: () => $('#projectDialog').open && $('#projectEnvironmentSelect').value === environment,
  });
  if (added && onAdded) await onAdded(added.id);
  else if (added) {
    await selectEnvironment(environment, '/projects');
    state.selectedProject = added.id; $('#search').value = ''; render();
  }
});

document.addEventListener('click', event => {
  const choice = event.target.closest('[data-project-open-choice]');
  if (choice && !choice.disabled && !state.busy) rememberProjectOpenTool(choice);
  document.querySelectorAll('.task-action-menu[open], .project-more[open]').forEach(menu => {
    if (!menu.contains(event.target) || event.target.closest('button:not(:disabled)')) menu.open = false;
  });
  const button = event.target.closest('[data-action^="project-open-"]');
  if (!button || button.disabled || state.busy) return;
  const tool = button.dataset.action.slice('project-open-'.length);
  mutation(tool === 'remote' ? uiText("正在打开远端仓库") : uiText("正在打开项目编辑器"), async () => {
    const result = await api(`/api/projects/${encodeURIComponent(button.dataset.id)}/open`, { method: 'POST', body: JSON.stringify({ tool, path: button.dataset.path }) });
    toast(result.message);
  });
});

// Project tools are addressable pages in the workspace document. Reuse their
// existing controllers and operation guards while keeping native form state.
let projectPageKey = '';
let projectPageLoad = Promise.resolve();
let leavingProjectPage = false;
function syncProjectPage() {
  const route = location.hash.slice(1), path = route.split('?')[0];
  const match = path.match(/^\/projects\/([a-zA-Z0-9_-]+)\/(git|worktrees)$/);
  const taskGit = $('#gitDialog[open][data-task-git]');
  if (taskGit?.open && (state.view !== 'requirements' || state.selectedRequirement !== gitRequirementID || activeEnvironment !== taskGitReturn?.environment)) taskGit.close();
  const key = match ? JSON.stringify([activeEnvironment,route]) : '';
  document.body.classList.toggle('project-tool-page',!!match);
  const dialog = match ? $(match[2] === 'git' ? '#gitDialog' : '#worktreeDialog') : null;
  if (key === projectPageKey && (!dialog || dialog.open)) return projectPageLoad;
  projectPageKey = key;
  leavingProjectPage = true;
  for (const id of ['gitDialog','worktreeDialog']) {
    const dialog = $('#' + id);
    if (dialog.open) dialog.close();
  }
  leavingProjectPage = false;
  if (!match) return;
  $('main').append(dialog);
  const params = new URLSearchParams(route.split('?')[1] || '');
  if (match[2] === 'git') projectPageLoad = loadGit(match[1],params.get('path') || '',params.get('requirement') || '');
  else projectPageLoad = loadWorktree(match[1]);
  return projectPageLoad;
}
for (const id of ['gitDialog','worktreeDialog']) {
  $('#' + id).addEventListener('close',() => {
    // Close events are queued, so check the current route and displayed page.
    if (leavingProjectPage || !document.body.classList.contains('project-tool-page')) return;
    const current = location.hash.slice(1).split('?')[0].match(/^\/projects\/([\w-]+)\/(git|worktrees)$/);
    if (current && !$(current[2] === 'git' ? '#gitDialog' : '#worktreeDialog').open) navigate('/projects/' + current[1]);
  });
}
