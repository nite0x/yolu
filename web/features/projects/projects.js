'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


let projectAddedCallback = null;
let projectScan = null;
let projectOpenTool;
let projectFilter = 'all';
let projectDetailOpen = false;
const projectDirectoryFilters = new Map();
function projectDirectoryFilterKey(id) { return JSON.stringify([activeEnvironment, id]); }

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

function positionWorkspaceMenu(menu) {
  if (!menu.open) return;
  const panel = menu.querySelector('.workspace-action-menu-body, .workspace-project-details-body');
  if (!panel) return;
  const anchor = (menu.closest('.workspace-split-action') || menu).getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  const left = menu.classList.contains('workspace-project-details') ? anchor.right - bounds.width : anchor.left;
  panel.style.left = Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)) + 'px';
  const below = window.innerHeight - anchor.bottom;
  const top = below < bounds.height + 8 && anchor.top > below ? anchor.top - bounds.height - 6 : anchor.bottom + 6;
  panel.style.top = Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8)) + 'px';
}
document.addEventListener('toggle', event => {
  if (event.target.matches('.workspace-action-menu, .workspace-project-details')) positionWorkspaceMenu(event.target);
}, true);
function positionOpenWorkspaceMenus() {
  document.querySelectorAll('.workspace-action-menu[open], .workspace-project-details[open]').forEach(positionWorkspaceMenu);
}
document.addEventListener('scroll', positionOpenWorkspaceMenus, true);
window.addEventListener('resize', positionOpenWorkspaceMenus);

function renderProjects() {
  const status = !state.loaded ? 'loading' : !state.projects.length ? 'empty' : undefined;
  const text = projectDetailOpen ? '' : $('#search').value.trim().toLowerCase();
  const projects = state.projects.filter(p => `${p.name} ${p.path}`.toLowerCase().includes(text));
  const directoryFilter = projectDirectoryFilters.get(projectDirectoryFilterKey(state.selectedProject)) || 'all';
  const source = state.workspaces.find(workspace => workspace.id === resourceLocation.fromWorkspace);
  return window.WorkHubUI.projects(projects, state.selectedProject, preferredProjectOpenTool(), projectFilter, projectDetailOpen, state.workspaces, directoryFilter, !!text, status, source?.id);
}

function renderProjectPage(markup) {
  const content = $('#content');
  const toolbar = $('#panelToolbar');
  const template = document.createElement('template');
  template.innerHTML = markup;
  const next = template.content.querySelector('.project-workspace');
  const current = content.querySelector('.project-workspace');
  // Keep the shared search field and both scroll containers mounted on refresh.
  if (!current) content.replaceChildren(next);
  else {
    current.dataset.pane = next.dataset.pane;
    for (const selector of ['#projectListPane', '#projectDetail']) {
      const target = current.querySelector(selector);
      const incoming = next.querySelector(selector);
      target.hidden = incoming.hidden;
      if (selector === '#projectListPane') {
        target.querySelector('.project-list-scroll').replaceChildren(...incoming.querySelector('.project-list-scroll').childNodes);
      } else {
        target.setAttribute('aria-label', incoming.getAttribute('aria-label'));
        target.replaceChildren(...incoming.childNodes);
      }
    }
  }
  const list = $('#projectListPane');
  if (!list.contains(toolbar)) list.prepend(toolbar);
  if (!toolbar.contains($('#projectAddButton'))) toolbar.querySelector('.toolbar-actions').append($('#projectAddButton'));
  if (!$('#projectEnvironmentSlot').contains($('#projectEnvironmentWrap'))) $('#projectEnvironmentSlot').append($('#projectEnvironmentWrap'));
  $('#projectListFilterSlot').replaceChildren(next.querySelector('.project-filters'));
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
  else if (ids.length && !failures) await selectEnvironment(environment, '/projects/' + encodeURIComponent(ids[0]));
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
  else if (added) await selectEnvironment(environment, '/projects/' + encodeURIComponent(added.id));
});

document.addEventListener('click', event => {
  const choice = event.target.closest('[data-project-open-choice]');
  if (choice && !choice.disabled && !state.busy) rememberProjectOpenTool(choice);
  document.querySelectorAll('.workspace-action-menu[open], .project-more[open]').forEach(menu => {
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
  const workspaceGit = $('#gitDialog[open][data-workspace-git]');
  if (workspaceGit?.open && (state.view !== 'workspaces' || state.selectedWorkspace !== gitWorkspaceID || activeEnvironment !== workspaceGitReturn?.environment)) workspaceGit.close();
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
  if (match[2] === 'git') projectPageLoad = loadGit(match[1],params.get('path') || '',params.get('workspace') || '');
  else projectPageLoad = loadWorktree(match[1]);
  return projectPageLoad;
}
for (const id of ['gitDialog','worktreeDialog']) {
  $('#' + id).addEventListener('close',() => {
    // Close events are queued, so check the current route and displayed page.
    if (leavingProjectPage || !document.body.classList.contains('project-tool-page')) return;
    const current = location.hash.slice(1).split('?')[0].match(/^\/projects\/([\w-]+)\/(git|worktrees)$/);
    if (current && !$(current[2] === 'git' ? '#gitDialog' : '#worktreeDialog').open) navigate(projectResourceRoute(current[1]));
  });
}
