'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


let projectAddedCallback = null;
let projectScan = null;
let projectOpenTool;
let projectFilter = 'all';
let projectDetailOpen = false;
const projectDetailViews = new Map();
function projectDetailView(id) {
  const key = JSON.stringify([activeEnvironment, id]);
  if (!projectDetailViews.has(key)) projectDetailViews.set(key, {
    filter:'all', sort:'recent', cards:new Map(), conversations:{sessions:[], loading:true}, checkedAt:0, pending:null,
  });
  return projectDetailViews.get(key);
}

function refreshProjectConversations(force = false) {
  if (state.view !== 'projects' || !projectDetailOpen || window.WorkHubPage?.restoring || window.WorkHubPage?.active === false) return;
  const id = state.selectedProject;
  if (!state.projects.some(project => project.id === id && !project.error)) return;
  const view = projectDetailView(id);
  if (view.pending || (!force && Date.now() - view.checkedAt < 10000)) return view.pending;
  const environment = activeEnvironment;
  view.checkedAt = Date.now();
  if (force) {
    view.conversations = {sessions:view.conversations.sessions, loading:true};
    render();
  }
  const query = new URLSearchParams({project_id:id});
  view.pending = conversationRequests.load(api, environment, query.toString(), force)
    .then(
      result => ({sessions:Array.isArray(result.sessions) ? result.sessions : [], error:result.error}),
      error => ({sessions:view.conversations.sessions, error:error.message}),
    ).then(conversations => {
      view.pending = null;
      if (JSON.stringify(view.conversations) === JSON.stringify(conversations)) return;
      view.conversations = conversations;
      if (activeEnvironment === environment && state.view === 'projects' && state.selectedProject === id && window.WorkHubPage?.active !== false) render();
    });
  return view.pending;
}
window.addEventListener('workhub:app-refreshed', () => refreshProjectConversations());

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
    const openLabel = uiText("用 {0} 打开工作目录", label);
    button.dataset.action = tool === 'terminal' ? 'project-terminal' : 'project-open-' + tool;
    button.setAttribute('aria-label', openLabel);
    button.setAttribute('title', openLabel);
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
  const view = projectDetailView(state.selectedProject);
  return window.WorkHubUI.projects(projects, state.selectedProject, preferredProjectOpenTool(), projectFilter, projectDetailOpen, {
    ...view, directory:window.WorkHubUI.conversationPathKey(resourceLocation.directory), readOnly:sessionReadOnly,
  }, !!text, status);
}

let renderedProjectDetail = '';
let renderedProjectKey = '';
function renderProjectPage(markup) {
  const content = $('#content');
  const toolbar = $('#panelToolbar');
  const template = document.createElement('template');
  template.innerHTML = markup;
  const next = template.content.querySelector('.project-workspace');
  const current = content.querySelector('.project-workspace');
  const detail = next.querySelector('#projectDetail');
  const detailMarkup = detail.innerHTML;
  const detailKey = JSON.stringify([activeEnvironment, state.selectedProject]);
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
      } else if (renderedProjectDetail !== detailMarkup || renderedProjectKey !== detailKey) {
        const focused = target.contains(document.activeElement) ? document.activeElement : null;
        const path = focused?.closest('[data-directory-path]')?.dataset.directoryPath;
        const focusKey = focused?.dataset.detailFocus;
        target.setAttribute('aria-label', incoming.getAttribute('aria-label'));
        target.replaceChildren(...incoming.childNodes);
        if (renderedProjectKey !== detailKey) target.scrollTop = 0;
        else if (focusKey) {
          const scope = path ? [...target.querySelectorAll('[data-directory-path]')].find(card => card.dataset.directoryPath === path) : target;
          [...(scope?.querySelectorAll('[data-detail-focus]') || [])].find(node => node.dataset.detailFocus === focusKey)?.focus({preventScroll:true});
        }
      }
    }
  }
  renderedProjectDetail = detailMarkup;
  renderedProjectKey = detailKey;
  const list = $('#projectListPane');
  if (!list.contains(toolbar)) list.prepend(toolbar);
  if (!toolbar.contains($('#projectAddButton'))) toolbar.querySelector('.toolbar-actions').append($('#projectAddButton'));
  if (!$('#projectEnvironmentSlot').contains($('#projectEnvironmentWrap'))) $('#projectEnvironmentSlot').append($('#projectEnvironmentWrap'));
  $('#projectListFilterSlot').replaceChildren(next.querySelector('.project-filters'));
}

function changeProjectDirectories(action, target) {
  const view = projectDetailView(state.selectedProject);
  const pathKey = window.WorkHubUI.conversationPathKey;
  if (action === 'project-directory-reset') view.filter = 'all';
  else if (action === 'project-directory-filter') {
    const next = target.dataset.filter || 'all';
    view.filter = view.filter === next ? 'all' : next;
  } else if (action === 'project-directory-expand-all') {
    for (const card of $('#projectDetail').querySelectorAll('[data-directory-path]')) {
      const key = pathKey(card.dataset.directoryPath);
      view.cards.set(key, {...view.cards.get(key), expanded:target.dataset.expand === 'true'});
    }
  } else {
    const key = pathKey(target.dataset.path);
    const card = view.cards.get(key);
    const toggle = action === 'project-directory-toggle';
    view.cards.set(key, toggle
      ? {...card, expanded:target.getAttribute('aria-expanded') !== 'true'}
      : {expanded:true, section:target.dataset.section});
  }
  render();
}

$('#content').addEventListener('change', event => {
  const target = event.target;
  if (!target.matches('[data-project-directory-filter], [data-project-directory-sort]')) return;
  const view = projectDetailView(state.selectedProject);
  if (target.matches('[data-project-directory-filter]')) view.filter = target.value;
  else view.sort = target.value;
  render();
});

let projectChangesOrigin;
function showProjectChanges(target, plan) {
  const dialog = $('#changesDialog');
  const {id, path} = target.dataset;
  if (!id || !path) return;
  if (!dialog.open) projectChangesOrigin = target;
  const tree = state.projects.find(project => project.id === id)?.worktrees.find(tree => tree.path === path);
  $('#changesTitle').textContent = plan ? uiText("分批提交计划") : uiText("文件与改动");
  $('#changesPlanContext').textContent = tree?.branch ? `${path} · ${tree.branch}` : path;
  $('#changesCommitPlan').hidden = !plan;
  $('#changesBrowser').hidden = plan;
  for (const [selector, visible] of [['#showChangesPlan', !plan], ['#returnToChanges', plan]]) {
    const button = $(selector);
    Object.assign(button.dataset, {id, path});
    button.hidden = !visible;
  }
  if (!plan && !$('#changesBrowser').hasChildNodes()) {
    window.WorkHubUI.mountFileBrowser($('#changesBrowser'), {project:id,path,environment:activeEnvironment,request:api});
  }
  if (!dialog.open) dialog.showModal();
  else $(plan ? '#returnToChanges' : '#showChangesPlan').focus();
}
$('#changesDialog').addEventListener('close', () => {
  window.WorkHubUI.mountFileBrowser($('#changesBrowser'));
  if (projectChangesOrigin?.isConnected) projectChangesOrigin.focus({preventScroll:true});
  projectChangesOrigin = null;
});

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
  const title = tool === 'remote' ? uiText("正在打开远端仓库") : tool === 'folder' ? uiText("正在打开工作目录") : uiText("正在打开项目编辑器");
  mutation(title, async () => {
    const result = await api(`/api/projects/${encodeURIComponent(button.dataset.id)}/open`, { method: 'POST', body: JSON.stringify({ tool, path: button.dataset.path }) });
    toast(result.message);
  }, undefined, {project:button.dataset.id});
});

// Project tools are addressable pages in the workspace document. Reuse their
// existing controllers and operation guards while keeping native form state.
let projectPageKey = '';
let projectPageLoad = Promise.resolve();
let leavingProjectPage = false;
function syncProjectPage() {
  const route = location.hash.slice(1), path = route.split('?')[0];
  const match = path.match(/^\/projects\/([a-zA-Z0-9_-]+)\/(git|worktrees)$/);
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
  if (match[2] === 'git') projectPageLoad = loadGit(match[1],params.get('path') || '',params.get('section') || '');
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
