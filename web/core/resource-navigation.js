'use strict';

// Keep the directory in the route so direct links and browser history work
// through both the shared page host and the standalone workspace document.
let resourceLocation = { key: '', directory: '', fromWorkspace: '', locate: false };
function resourceDirectoryRoute(route, directory) {
  return directory ? route + '?' + new URLSearchParams({directory}) : route;
}
function readResourceLocation(route) {
  const key = JSON.stringify([activeEnvironment, route]);
  if (key === resourceLocation.key) return;
  const [pathname, query] = route.split('?');
  const params = new URLSearchParams(query);
  const directory = params.get('directory') || '';
  resourceLocation = { key, directory, fromWorkspace: params.get('fromWorkspace') || '', locate: !!directory && /^\/(workspaces|projects)\/[\w-]+$/.test(pathname) };
  if (!resourceLocation.locate) return;
  if (state.view === 'projects' && projectDetailOpen) projectDirectoryFilters.delete(projectDirectoryFilterKey(state.selectedProject));
  if (state.view === 'workspaces' && state.selectedWorkspace) workspaceProjectFilters.delete(JSON.stringify([activeEnvironment, state.selectedWorkspace]));
}
function projectResourceRoute(id, tool = '', params = new URLSearchParams()) {
  if (state.view === 'projects' && state.selectedProject === id && resourceLocation.directory) {
    params.set('directory', resourceLocation.directory);
    if (resourceLocation.fromWorkspace) params.set('fromWorkspace', resourceLocation.fromWorkspace);
  }
  return '/projects/' + id + (tool ? '/' + tool : '') + (params.size ? '?' + params : '');
}
function locateResourceDirectory() {
  if (!resourceLocation.locate) return;
  const view = state.view === 'projects' && projectDetailOpen ? $('#projectDetail') : state.selectedWorkspace ? $('#workspaceProjectsView') : null;
  if (!view) return;
  const pathKey = window.WorkHubUI.conversationPathKey;
  const row = [...view.querySelectorAll('[data-directory-path]')].find(row => pathKey(row.dataset.directoryPath) === pathKey(resourceLocation.directory));
  if (!row) return;
  resourceLocation.locate = false;
  row.focus({preventScroll:true});
  row.scrollIntoView?.({block:'nearest'});
}
function focusResourcePage() {
  if (document.activeElement?.matches('[data-directory-path]') || document.body.classList.contains('project-tool-page')) return;
  if (state.view === 'projects' && projectDetailOpen) ($('#projectDetail h2') || $('#projectDetail [data-action="project-list"]'))?.focus({preventScroll:true});
  else if (state.view === 'workspaces' && state.selectedWorkspace) $('#pageTitle').focus({preventScroll:true});
  else if (state.view === 'workspaces' && !document.activeElement?.closest('#workspaceBrowser')) $('#workspaceListTitle').focus({preventScroll:true});
  else if (state.view === 'projects' && !document.activeElement?.closest('#projectListPane')) $('#panelTitle').focus({preventScroll:true});
  else if (state.view === 'sessions') $('#sessionBrowserSearch')?.focus({preventScroll:true});
}

const resourceRecentKey = 'workhub:recent-resources:v1';
let resourceRecent = {workspace: [], project: []};
try {
  const saved = JSON.parse(localStorage.getItem(resourceRecentKey) || 'null');
  for (const kind of ['workspace', 'project']) if (Array.isArray(saved?.[kind])) resourceRecent[kind] = saved[kind].filter(key => typeof key === 'string').slice(0, 12);
} catch { /* The switcher still works with an in-memory history. */ }
function resourceVisitKey(id, environment) { return JSON.stringify([environment, id]); }
function rememberResourceVisit(workspace) {
  const kind = workspace ? 'workspace' : state.view === 'projects' && projectDetailOpen ? 'project' : null;
  const item = workspace || (kind === 'project' && state.projects.find(project => project.id === state.selectedProject));
  if (!item) return;
  const key = resourceVisitKey(item.id, activeEnvironment), recent = resourceRecent[kind];
  if (recent[0] === key) return;
  resourceRecent[kind] = [key, ...recent.filter(entry => entry !== key)].slice(0, 12);
  try { localStorage.setItem(resourceRecentKey, JSON.stringify(resourceRecent)); } catch { /* Keep the history in memory. */ }
}

const resourceSwitcher = $('#resourceSwitcher');
const resourceSwitcherInput = $('#resourceSwitcherSearch');
const resourceSwitcherResults = $('#resourceSwitcherResults');
let resourceSwitcherKind = null;
let resourceSwitcherOrigin = '';
function renderResourceSwitcher() {
  const query = resourceSwitcherInput.value.trim().toLowerCase();
  const kind = resourceSwitcherKind;
  const workspaces = kind === 'workspace';
  const current = resourceVisitKey(workspaces ? state.selectedWorkspace : state.selectedProject, activeEnvironment);
  const source = workspaces ? workspaceInventory.workspaces : state.projects;
  const entries = source.map(item => {
    const environment = workspaces ? item.environment_id : activeEnvironment;
    const meta = workspaces ? [item.environment_name, item.state === 'archived' ? uiText("已归档") : ''].filter(Boolean).join(' · ') : item.path;
    return {id:item.id, key:resourceVisitKey(item.id, environment), name:item.name, meta, environment, archived:item.state === 'archived', description:item.description};
  }).filter(item => query ? [item.name, item.description, item.meta].join(' ').toLowerCase().includes(query) : !item.archived || item.key === current);
  const recent = query ? [] : resourceRecent[kind].slice(0, 6).map(key => entries.find(item => item.key === key)).filter(Boolean);
  const sections = [
    [uiText("最近使用"), recent],
    [query ? '' : workspaces ? uiText("全部工作区") : uiText("全部项目"), entries.filter(item => !recent.includes(item))],
  ];
  resourceSwitcherResults.replaceChildren();
  for (const [title, items] of sections) {
    if (!items.length) continue;
    const group = document.createElement('div');
    if (title) {
      const heading = document.createElement('h3');
      heading.textContent = title;
      group.append(heading);
    }
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'resource-switcher-option';
      button.dataset.id = item.id;
      button.dataset.environment = item.environment;
      if (item.key === current) button.setAttribute('aria-current', 'true');
      const name = document.createElement('strong');
      name.textContent = item.name;
      const meta = document.createElement('span');
      meta.textContent = item.meta;
      button.append(name, meta);
      group.append(button);
    }
    resourceSwitcherResults.append(group);
  }
  $('#resourceSwitcherClear').hidden = !resourceSwitcherInput.value;
  $('#resourceSwitcherEmpty').hidden = !!entries.length;
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-resource-switcher]');
  if (!trigger || state.busy || resourceSwitcher.open) return;
  resourceSwitcherKind = trigger.dataset.resourceSwitcher;
  resourceSwitcherOrigin = resourceLocation.key;
  $('#resourceSwitcherTitle').textContent = trigger.getAttribute('aria-label');
  resourceSwitcherInput.placeholder = resourceSwitcherKind === 'workspace' ? uiText("搜索工作区名称、说明…") : uiText("搜索项目名称、目录…");
  resourceSwitcherInput.value = '';
  renderResourceSwitcher();
  resourceSwitcher.showModal();
  resourceSwitcherInput.focus();
});
resourceSwitcher.addEventListener('close', () => {
  if (resourceSwitcherOrigin === resourceLocation.key) {
    document.querySelector(`[data-resource-switcher="${resourceSwitcherKind}"]`)?.focus({preventScroll:true});
  }
});
resourceSwitcherInput.addEventListener('input', renderResourceSwitcher);
$('#resourceSwitcherClear').addEventListener('click', () => {
  resourceSwitcherInput.value = '';
  renderResourceSwitcher();
  resourceSwitcherInput.focus();
});
resourceSwitcher.addEventListener('keydown', event => {
  if (event.isComposing || !['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
  const choices = [...resourceSwitcherResults.querySelectorAll('button')];
  if (!choices.length) return;
  const index = choices.indexOf(document.activeElement);
  if (event.key === 'Enter' && event.target === resourceSwitcherInput) {
    event.preventDefault();
    choices[0].click();
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? Math.min(index + 1, choices.length - 1) : index < 0 ? choices.length - 1 : index - 1;
    (choices[next] || resourceSwitcherInput).focus();
  }
});
resourceSwitcherResults.addEventListener('click', event => {
  const choice = event.target.closest('button');
  if (!choice || state.busy) return;
  resourceSwitcher.close();
  if (choice.hasAttribute('aria-current')) return;
  const id = encodeURIComponent(choice.dataset.id);
  if (resourceSwitcherKind === 'project') navigate('/projects/' + id);
  else void selectEnvironment(choice.dataset.environment, '/workspaces/' + id);
});
window.addEventListener('workhub:route-read', () => {
  if (resourceSwitcher.open && resourceSwitcherOrigin !== resourceLocation.key) resourceSwitcher.close();
});
