'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


// One mounted browser serves the conversation page for every entry point.
// Only the view's scope changes; session controllers remain keyed by environment
// and session ID, so drafts, attachments and reading position are shared.
const conversationState = window.WorkHubUI.createConversationState({
  storage: () => localStorage,
  scopeKey: scope => conversationScopeKey(scope),
  sessionKey: session => conversationSessionKey(session),
});
window.WorkHubConversations = conversationState;
const conversationListRenderKeys = new WeakMap();
const conversationHost = $('#sessionBrowser');
const conversationListModeKey = 'workhub:conversation-list-mode:v1';
const conversationProjectDisplayKey = 'workhub:conversation-project-display:v1';
const conversationProjectDisplay = $('#sessionSidebarProjectDisplay');
const conversationProjectDisplayDefaults = {icons: true, counts: false, recent: true};
let conversationProjectDisplayState = {...conversationProjectDisplayDefaults};
let conversationListMode = 'grouped';
try { if (localStorage.getItem(conversationListModeKey) === 'recent') conversationListMode = 'recent'; } catch { /* Keep the default when storage is unavailable. */ }
let conversationTerminals = [], conversationTerminalLoad = null, conversationTerminalsCheckedAt = 0;
const conversationTerminalKey = id => JSON.stringify(['terminal','local',id]);
function conversationTerminalSnapshot(row) {
  return {route:'/terminals',environment:'local',title:row.name,terminal:{id:row.id,projectID:row.project_id,cwd:row.cwd,sessionID:row.session_id,bindingID:row.binding_id}};
}
function conversationTerminalItems(view) {
  if (view.archived || view.environmentFilter && view.environmentFilter !== 'local' || conversationScopeEnvironment(view.scope) && conversationScopeEnvironment(view.scope) !== 'local') return [];
  return conversationTerminals.filter(row => row.state === 'running'
    && (view.scope.kind !== 'project' || row.project_id === view.scope.id)
    && (view.scope.kind !== 'directory' || conversationPathKey(row.cwd) === conversationPathKey(view.scope.cwd))
    && (!view.directory || conversationEnvironmentKey('local',conversationPathKey(row.cwd)) === view.directory || conversationPathKey(row.cwd) === conversationPathKey(view.directory)))
    .map(row => ({id:row.id,browser_key:conversationTerminalKey(row.id),environment_id:'local',environment_name:environmentName('local'),name:row.name,cwd:row.cwd,updated_at:row.created_at,terminal:{projectID:row.project_id,cwd:row.cwd,sessionID:row.session_id,bindingID:row.binding_id,attached:row.attached}}));
}
function refreshConversationTerminals(force = false) {
  if (sessionReadOnly || !conversationVisible() || document.documentElement.hasAttribute('data-workspace-conversation')) return;
  if (conversationTerminalLoad) return conversationTerminalLoad;
  if (!force && Date.now() - conversationTerminalsCheckedAt < 5000) return;
  conversationTerminalsCheckedAt = Date.now();
  conversationTerminalLoad = api('/api/terminals',{environment:'local'}).then(rows => {
    conversationTerminals = Array.isArray(rows) ? rows : [];
    if (conversationVisible()) renderConversationList();
  }).catch(error => {if (force) toast(uiText("终端列表刷新失败：") + error.message,true);}).finally(() => {conversationTerminalLoad = null;});
  return conversationTerminalLoad;
}

// The same split survives navigation and scope changes.
window.WorkHubUI.setupConversationResize(conversationHost, window);
const conversationFiles = window.WorkHubUI.createConversationFiles(document, api);
const conversationPathKey = window.WorkHubUI.conversationPathKey;
const conversationScopeKey = (scope, environment = activeEnvironment) => JSON.stringify([environment, scope.kind, scope.id || '', scope.cwd || '', scope.environment || '']);
const conversationSessionKey = session => session.browser_key || session.id;
const conversationEnvironmentKey = window.WorkHubUI.conversationEnvironmentKey;
function conversationSelectedSession(view = conversationState.current) {
  return view?.sessions.find(session => conversationSessionKey(session) === view.selected)
    || (view?.directSession && conversationSessionKey(view.directSession) === view.selected ? view.directSession : null);
}
function restoreConversationSelection(saved, title) {
  const view = conversationState.current;
  view.directSession = null;
  if (!saved.selected || saved.creating || window.WorkHubPage?.navigationOnly) return;
  let environment = activeEnvironment, id = saved.selected;
  try {
    const pair = JSON.parse(id);
    if (Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string')) [environment,id] = pair;
  } catch { /* Local session identities are plain strings. */ }
  const cached = saved.session?.id === id ? saved.session : {id,name:title || uiText("对话详情"),cwd:'',available:false};
  view.directSession = conversationTaggedSession(cached,environment);
}
function followConversationSelection(target, fallback = false) {
  if (target.route === '/terminals' && conversationState.current) {
    const scope = target.terminal?.projectID ? {kind:'project',id:target.terminal.projectID,environment:'local'} : {kind:'all'};
    if (conversationScopeKey(scope) !== conversationScopeKey(conversationState.current.scope)) selectConversationScope(scope);
    const key = target.terminal?.id ? conversationTerminalKey(target.terminal.id) : '';
    conversationState.current.selected = key; conversationState.current.locateSelection = key;
    renderConversationList();
    return;
  }
  const selected = target.conversation?.selected;
  if (!selected || !conversationState.current) return;
  let view = conversationState.current;
  if (view.listItems?.some(session => conversationSessionKey(session) === selected)) {
    view.selected = selected; view.locateSelection = selected;
    renderConversationList(); rememberConversationView();
    return;
  }
  let environment = target.environment || activeEnvironment, id = selected;
  try {const pair = JSON.parse(selected); if (Array.isArray(pair) && pair.length === 2) [environment,id] = pair;} catch {}
  const session = target.conversation.session || conversationItems(environment).find(session => session.id === id);
  const overview = conversationOverview(environment);
  const context = session?.cwd ? window.WorkHubUI.conversationContext(session.cwd, overview, session.primary_project_id) : null;
  let scope = target.conversation.scope || {kind:'all'};
  if (scope.kind === 'all' && !fallback) {
    if (context?.projectID) scope = {kind:'project',id:context.projectID,environment};
  } else scope = {...scope,environment:scope.environment || environment};
  const sameScope = conversationScopeKey(scope) === conversationScopeKey(view.scope);
  const filtered = !!(view.search || view.directory || view.environmentFilter || view.archived !== !!session?.archived || view.statusFilter !== 'all');
  if (!sameScope) {
    rememberConversationView(); conversationState.selection++;
    conversationState.current = view = conversationViewFor(scope);
    conversationState.rememberPageScope(activeEnvironment,scope);
  }
  Object.assign(view,{selected,requestedSession:selected,locateSelection:selected,creating:false,pane:'list'});
  // If the project scope no longer contains the session, try the environment.
  view.followTarget = scope.kind === 'all' ? null : {...target,conversation:{...target.conversation,session,scope:{kind:'all',environment}}};
  if (!sameScope || filtered) {
    Object.assign(view,{search:'',directory:'',environmentFilter:'',archived:!!session?.archived,statusFilter:'all',requestID:(view.requestID || 0) + 1,requestKey:null,loading:false,checkedAt:0});
    resetConversationListWindow(view);
    view.locateSelection = selected;
  }
  renderConversationBrowser();
  void refreshConversations(false);
  rememberConversationView();
}
function conversationEnvironments() {
  const entries = environmentInventory;
  return [...new Map([{id: 'local', name: environmentName('local')}, ...entries].map(e => [e.id, e])).values()];
}
function conversationOverview(environment) {
  return environment === activeEnvironment ? state : conversationState.overview(environment) || {projects: []};
}
function conversationScopeEnvironment(scope) {
  if (scope.environment) return scope.environment;
  return scope.kind === 'all' ? '' : activeEnvironment;
}
function conversationTaggedSession(session, environment) {
  return {...session, environment_id: environment, environment_name: environmentName(environment), browser_key: conversationEnvironmentKey(environment, session.id)};
}
function conversationListedSessions(result, environment) {
  return (Array.isArray(result.sessions) ? result.sessions : []).map(session => conversationTaggedSession(session, environment));
}
function conversationVisible() { return conversationState.mode !== 'hidden' && !conversationHost.hidden; }
function conversationReadingSession(id, environment = activeEnvironment) {
  const width = conversationHost.getBoundingClientRect().width;
  return !window.WorkHubPage?.navigationOnly && !document.hidden && window.WorkHubPage?.active !== false && conversationVisible() && !conversationState.current?.creating && conversationState.current?.selected === conversationEnvironmentKey(environment, id) && (conversationState.current.pane === 'detail' || !width || width > 620);
}
function conversationItems(environment) { return environment ? conversationState.sessions(environment) : conversationEnvironments().flatMap(e => conversationState.sessions(e.id)); }
const resourceIcons = window.WorkHubUI.createResourceIcons({
  request: api,
  changed: () => { renderResourceIcons(); if (conversationVisible()) renderConversationList(); },
  failed: message => toast(message, true),
});
function resourceAppearance(environment, id, path) {
  const icons = resourceIcons.icons(environment);
  return icons[id] || (path ? icons['directory:' + conversationPathKey(path)] : undefined);
}
function renderResourceIcons() {
  for (const node of document.querySelectorAll('[data-resource-icon]')) {
    const environment = node.dataset.environment || activeEnvironment;
    node.dataset.environment = environment;
    const project = node.dataset.resourceIcon.startsWith('project:') && state.projects.find(project => 'project:' + project.id === node.dataset.resourceIcon);
    const appearance = resourceAppearance(environment, node.dataset.resourceIcon, project?.path);
    const markup = window.WorkHubUI.resourceIconBadge({name:node.dataset.resourceName, identity:node.dataset.resourceIcon, appearance});
    if (node.innerHTML !== markup) node.innerHTML = markup;
    node.dataset.resourceAppearance = JSON.stringify(appearance || {});
  }
}
window.addEventListener('storage', event => {
  const prefix = 'workhub:resource-icons-updated:';
  if (event.key?.startsWith(prefix)) resourceIcons.reload(event.key.slice(prefix.length)).catch(() => {});
});
window.addEventListener('workhub:resource-icon-save', async event => {
  const {environment, key, value, resolve, reject} = event.detail;
  try { await resourceIcons.save(environment, key, value); resolve(); } catch (error) { reject(error); }
});
function syncConversationScopePanel() {
  window.WorkHubUI.syncListFilter($('#sessionScopePicker'), conversationVisible());
}
function refreshConversationCatalog(force = false) {
  if (window.WorkHubPage?.restoring || window.WorkHubPage?.active === false) return;
  const environments = conversationEnvironments();
  const icons = environments.map(entry => resourceIcons.load(entry.id));
  if (document.documentElement?.hasAttribute('data-workspace-conversation')) return Promise.allSettled(icons);
  return Promise.allSettled([...icons, ...environments.map(entry => refreshConversationEnvironment(entry.id, force))]);
}
function refreshConversationEnvironment(environment, force = false) {
  const load = conversationState.catalog(environment);
  if (load.loading) return load.pending;
  if (!force && Date.now() - load.checkedAt < 10000) return;
  load.loading = true; load.checkedAt = Date.now();
  const revision = load.revision;
  renderResourceIcons();
  load.pending = (async () => {
    try {
      const result = await conversationRequests.load(api, environment, '', force);
      if (load.revision !== revision) return;
      conversationState.record(environment, conversationListedSessions(result, environment), true);
      load.error = result.error || '';
    } catch (error) {
      if (load.revision === revision) load.error = error.message;
    } finally {
      if (load.revision === revision) {
        load.loading = false;
        updateConversationNavigation();
      }
    }
  })();
  return load.pending;
}
function conversationViewFor(scope) {
  if (scope.kind !== 'all' && !scope.environment) scope = {...scope, environment: conversationScopeEnvironment(scope)};
  return conversationState.viewFor(activeEnvironment, scope);
}
function rememberConversationView() {
  if (conversationState.current) conversationState.remember(conversationState.current, $('#sessionBrowserList').scrollTop, conversationState.mode === 'page', activeEnvironment);
}
function conversationDirectories(scope = conversationState.current?.scope, environmentFilter = conversationState.current?.environmentFilter || '') {
  if (!scope) return [];
  const result = [];
  const multipleEnvironments = conversationEnvironments().length > 1;
  let environment = conversationScopeEnvironment(scope);
  const add = (cwd, label, target, disabled = false, priority = 1) => {
    if (!cwd) return;
    const key = conversationEnvironmentKey(environment, conversationPathKey(cwd));
    const fullLabel = multipleEnvironments || environment !== 'local' ? label + ' · ' + environmentName(environment) : label;
    const existing = result.find(d => d.key === key);
    if (!existing) result.push({ cwd, key, environment, label: fullLabel, target, disabled, priority });
    else if (existing.disabled && !disabled) Object.assign(existing, { target, disabled, priority: Math.min(existing.priority, priority) });
  };
  const worktreeSegments = path => String(path || '').split(/[\\/]/).filter(Boolean);
  const disambiguatedLeaves = (trees, mainKey) => {
    const entries = trees.map(tree => {
      const segments = worktreeSegments(tree.path);
      return { key: conversationPathKey(tree.path), primary: conversationPathKey(tree.path) === mainKey, segments, name: segments.at(-1) || tree.path };
    });
    const counts = new Map();
    for (const entry of entries) if (!entry.primary) counts.set(entry.name, (counts.get(entry.name) || 0) + 1);
    for (let depth = 2; depth <= 3; depth++) {
      const colliding = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
      if (!colliding.size) break;
      counts.clear();
      for (const entry of entries) {
        if (!entry.primary && colliding.has(entry.name) && entry.segments.length >= depth) entry.name = entry.segments.slice(-depth).join('/');
        if (!entry.primary) counts.set(entry.name, (counts.get(entry.name) || 0) + 1);
      }
    }
    return new Map(entries.map(entry => [entry.key, entry.name]));
  };
  const projectDirs = project => {
    const mainKey = conversationPathKey(project.path);
    const trees = project.worktrees || [];
    const branchLabel = tree => tree.branch || (tree.head ? 'detached @ ' + String(tree.head).slice(0, 7) : 'detached HEAD');
    const branchCounts = new Map();
    for (const tree of trees) {
      const b = branchLabel(tree);
      branchCounts.set(b, (branchCounts.get(b) || 0) + 1);
    }
    const leaves = disambiguatedLeaves(trees, mainKey);
    for (const tree of trees) {
      const key = conversationPathKey(tree.path);
      const isMain = key === mainKey;
      const branch = branchLabel(tree);
      const needsLeaf = !isMain && ((branchCounts.get(branch) || 0) > 1 || !tree.branch);
      const leaf = needsLeaf ? leaves.get(key) : '';
      const suffix = leaf ? `${branch} (${leaf})` : branch;
      add(tree.path, project.name + ' · ' + suffix, { project_id: project.id, cwd: tree.path }, !!(project.error || tree.bare || tree.missing || tree.prunable || tree.error), isMain ? 0 : 1);
    }
    if (!trees.some(t => conversationPathKey(t.path) === mainKey)) add(project.path, project.name, { project_id: project.id, cwd: project.path }, !!project.error, 0);
  };
  const overview = conversationOverview(environment);
  if (environmentFilter && environment && environment !== environmentFilter) return [];
  if (scope.kind === 'project') {
    const project = overview.projects.find(p => p.id === scope.id);
    if (project) projectDirs(project);
  } else {
    for (const entry of conversationEnvironments()) {
      if (environmentFilter && entry.id !== environmentFilter || scope.environment && entry.id !== scope.environment) continue;
      environment = entry.id;
      const data = conversationOverview(environment);
      data.projects.forEach(projectDirs);
      for (const session of conversationItems(environment)) {
        if (session.provider === 'codex-cloud') continue;
        if (!window.WorkHubUI.isGeneralConversationDirectory(session.cwd)) add(session.cwd, session.cwd, {cwd:session.cwd}, false, 2);
      }
    }
    if (scope.kind === 'directory') {
      const matching = result.filter(d => conversationPathKey(d.cwd) === conversationPathKey(scope.cwd));
      return matching.length ? matching : [{ cwd: scope.cwd, key: conversationEnvironmentKey(scope.environment, conversationPathKey(scope.cwd)), environment: scope.environment, label: scope.cwd, target: {cwd:scope.cwd}, disabled: false }];
    }
    result.sort((a, b) => a.priority - b.priority);
  }
  return result;
}
function conversationScopeName(scope) {
  if (scope.kind === 'all') return uiText("全部对话");
  const data = conversationOverview(conversationScopeEnvironment(scope));
  if (scope.kind === 'project') return uiText("项目 · ") + (data.projects.find(p => p.id === scope.id)?.name || scope.name || scope.id);
  return uiText("目录 · ") + scope.cwd;
}
function renderConversationScopes() {
  const showEnvironments = conversationEnvironments().length > 1;
  const scopes = [
    {kind:'all', name:uiText("全部对话")},
    ...conversationEnvironments().flatMap(e => conversationOverview(e.id).projects.map(p => ({kind:'project', id:p.id, environment:e.id, name:p.name, environmentName:showEnvironments ? environmentName(e.id) : ''}))),
    ...conversationDirectories({kind:'all'}, '').map(d => ({kind:'directory', cwd:d.cwd, environment:d.environment, name:d.cwd, environmentName:showEnvironments ? environmentName(d.environment) : ''})),
  ];
  const search = $('#sessionScopeSearch').value.trim().toLowerCase();
  const matching = scopes.filter(s => (s.kind !== 'all' || conversationState.current.scope.kind === 'all') && (!search || [s.name, s.cwd, s.environmentName].join(' ').toLowerCase().includes(search)));
  $('#sessionScopeOptions').innerHTML = matching.length ? window.WorkHubUI.conversationScopes(matching, conversationState.current.scope) : uiText("<p class=\"session-empty\">没有匹配的范围</p>");
}
function updateConversationNavigation() {
  if (!window.document) return;
  const items = conversationItems().filter(s => !s.archived);
  const waiting = items.filter(s => s.chat_status === 'waiting').length;
  const running = items.filter(s => conversationStatusMatches(s, 'running')).length;
  const unread = items.filter(s => sessionWithUnread(s).unread).length;
  const text = waiting ? uiText("待确认") : running ? uiText("运行中") : unread ? uiText("有新消息") : '';
  const node = $('#sessionNavigationStatus');
  node.textContent = text; node.hidden = !text;
  node.setAttribute('aria-label', waiting ? uiText("{0} 个对话待确认", waiting) : running ? uiText("{0} 个对话运行中", running) : uiText("{0} 个对话有新消息", unread));
  renderResourceIcons();
}
const conversationStatusMatches = window.WorkHubUI.conversationStatusMatches;
const patchConversationList = window.WorkHubUI.patchConversationList;
const conversationList = window.WorkHubUI.createConversationList({
  list: $('#sessionBrowserList'),
  sessionKey: conversationSessionKey,
  render: () => renderConversationList(),
  remember: () => rememberConversationView(),
});
const conversationProjectOrdering = window.WorkHubUI.createConversationProjectOrdering({
  list: $('#sessionBrowserList'),
  status: $('#sessionProjectOrderStatus'),
  initialOrder: $('meta[name="conversation-project-order"]').content,
  groups: () => ({
    order: conversationState.current?.projectGroupOrder || [],
    visible: conversationState.current?.projectGroups || [],
  }),
  refresh: focusKey => {
    renderConversationList();
    if (!focusKey) return;
    const index = conversationState.current?.listRows.findIndex(row => row.kind === 'group' && row.group.key === focusKey);
    focusConversationListIndex(index);
  },
  save: order => api('/api/settings/conversation-project-order',{method:'PUT',environment:'local',body:JSON.stringify({order})}),
  saveFailed: () => toast(uiText("无法保存项目顺序"),true),
});
const conversationBatchSize = conversationList.batchSize;
function resetConversationListWindow(view = conversationState.current) { conversationList.reset(view); }
let conversationListScrollFrame = 0;
function scheduleConversationListScroll() {
  if (conversationListScrollFrame) return;
  conversationListScrollFrame = requestAnimationFrame(() => {
    conversationListScrollFrame = 0;
    syncConversationListScroll();
  });
}
function syncConversationListScroll() {
  if (!conversationVisible() || document.documentElement.hasAttribute('data-workspace-conversation')) return;
  conversationList.sync(conversationState.current);
}
function focusConversationListIndex(index, behavior) {
  if (index >= 0) conversationList.focus(conversationState.current, index, behavior);
}
$('#sessionBrowserList').addEventListener('scroll', scheduleConversationListScroll, {passive:true});
if (typeof ResizeObserver !== 'undefined') {
  const listResize = new ResizeObserver(scheduleConversationListScroll);
  listResize.observe($('#sessionBrowserList'));
  window.addEventListener('pagehide', () => {listResize.disconnect(); cancelAnimationFrame(conversationListScrollFrame);});
}
function renderConversationList() {
  const view = conversationState.current;
  if (!view || view.environment !== activeEnvironment) return;
  const items = [...view.sessions,...conversationTerminalItems(view)];
  const initialLoading = !items.length && (view.loading || !view.checkedAt && !view.error);
  // The shared navigation owns the list in host-managed conversation layouts.
  // Release rows from an earlier ordinary page instead of rendering hidden copies.
  if (document.documentElement.hasAttribute('data-workspace-conversation')) {
    const list = $('#sessionBrowserList');
    if (list.childNodes.length) list.replaceChildren();
    view.listItems = [];
    view.listRows = [];
    conversationListRenderKeys.delete(list);
    return;
  }
  const sidebarMode = window.WorkHubPage?.navigationOnly ? conversationListMode : undefined;
  const recent = sidebarMode === 'recent';
  syncConversationSearchBar();
  const modeSwitcher = $('#sessionSidebarModes');
  modeSwitcher.hidden = !sidebarMode;
  conversationProjectDisplay.hidden = sidebarMode !== 'grouped';
  for (const button of modeSwitcher.querySelectorAll('[data-conversation-list-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.conversationListMode === sidebarMode));
  }
  const text = view.search.trim().toLowerCase();
  const annotatedItems = items.map(session => {
    const overview = conversationOverview(session.environment_id || activeEnvironment);
    const context = window.WorkHubUI.conversationContext(session.cwd, session.provider === 'codex-cloud' ? undefined : overview, session.primary_project_id);
    return {...(session.terminal ? session : sessionWithUnread(session)), context};
  });
  const matching = annotatedItems.filter(session => !text || [session.name, session.terminal ? uiText("终端") : '', session.yolu_assistant ? uiText("Yolu 助手") : '', session.cwd, session.provider === 'codex-cloud' ? 'Codex Cloud' : session.environment_name, session.cloud_environment, session.context.project, session.context.branch].join(' ').toLowerCase().includes(text));
  const statusFilter = view.statusFilter || 'all';
  const filtered = !!text || statusFilter !== 'all' || view.archived;
  if (filtered) {
    const key = JSON.stringify([text,statusFilter,view.archived]);
    if (view.filteredGroupState?.key !== key) view.filteredGroupState = {key,collapsedGroups:[]};
  } else view.filteredGroupState = undefined;
  const groupState = view.filteredGroupState || view;
  const sessions = matching.filter(s => conversationStatusMatches(s, statusFilter)).sort((a,b) =>
    (recent ? 0 : Number(!!b.pinned)-Number(!!a.pinned)) || (b.updated_at||0)-(a.updated_at||0));
  const selected = window.WorkHubPage?.navigationOnly ? window.WorkHubPage.parallelSelected : view.creating ? null : view.selected;
  const projectDirectories = sidebarMode === 'grouped' ? conversationEnvironments().flatMap(entry =>
    conversationOverview(entry.id).projects.map(project => ({cwd:project.path, key:conversationEnvironmentKey(entry.id, conversationPathKey(project.path)),
      environment:entry.id, environmentName:environmentName(entry.id), name:project.name, projectID:project.id, projectName:project.name, projectRoot:true,
      appearance:resourceAppearance(entry.id, 'project:' + project.id, project.path)}))) : [];
  view.projectGroupOrder = window.WorkHubUI.conversationProjectOrder(projectDirectories, conversationProjectOrdering.order);
  view.listItems = sessions;
  view.listRows = window.WorkHubUI.conversationTree(sessions, {
    recent,
    showRecent: sidebarMode === 'grouped' && view.scope.kind === 'all' && !view.directory && !filtered && conversationProjectDisplayState.recent !== false,
    showYoluAssistant: !sessionReadOnly && view.scope.kind === 'all' && !view.directory && !filtered && (!view.environmentFilter || view.environmentFilter === 'local'),
    navigator: sidebarMode === 'grouped' ? {
      directories: projectDirectories.filter(directory => !view.environmentFilter || view.environmentFilter === directory.environment),
      projectOrder: view.projectGroupOrder,
    } : undefined,
    selected,
    selectedSession: selected ? annotatedItems.find(session => conversationSessionKey(session) === selected) : undefined,
    reveal: view.locateSelection, limits: view.groupLimits, collapsed: groupState.collapsedGroups, filtered,
  });
  if (view.locateSelection) groupState.collapsedGroups = groupState.collapsedGroups.filter(key => !view.listRows.some(row => row.kind === 'session' && row.group.key === key && row.group.collection !== 'recent' && conversationSessionKey(row.session) === view.locateSelection));
  const groupToggle = $('#sessionToggleAllGroups');
  const groups = sidebarMode === 'grouped' ? view.listRows.filter(row => row.kind === 'group' && row.group.collection !== 'recent') : [];
  view.projectGroups = groups.filter(row => row.group.collection === 'project').map(row => row.group);
  const expand = groups.length > 0 && groups.every(row => row.group.collapsed);
  const toggleLabel = expand ? uiText("全部展开") : uiText("全部收起");
  groupToggle.hidden = !groups.length;
  groupToggle.dataset.expand = String(expand);
  groupToggle.setAttribute('aria-label', toggleLabel);
  groupToggle.title = toggleLabel;
  const {loaded, start, end, before, after, scrollTarget} = conversationList.range(view);
  for (const button of document.querySelectorAll('[data-conversation-status]')) {
    const status = button.dataset.conversationStatus;
    const count = matching.filter(s => conversationStatusMatches(s, status)).length;
    button.setAttribute('aria-pressed', String(status === statusFilter));
    const badge = button.querySelector('[data-status-count]');
    badge.textContent = String(count); badge.hidden = status === 'all' || !count;
    button.setAttribute('aria-label', `${({all:uiText("全部"), running:uiText("进行中"), waiting:uiText("待确认"), unread:uiText("未读")})[status]}，${initialLoading ? uiText("正在加载") : view.error && !items.length ? uiText("数量暂不可用") : count + uiText(" 个对话")}`);
  }
  $('#sessionSearchClear').hidden = !view.search;
  const filterCount = Number(!!view.directory) + Number(!!view.archived) + Number(!!view.environmentFilter) + Number(statusFilter !== 'all');
  const directoryPath = view.directory && (conversationDirectories().find(d => d.key === view.directory)?.cwd || view.directory);
  const statusLabel = ({running:uiText("进行中"), waiting:uiText("待确认"), unread:uiText("未读")})[statusFilter] || '';
  const filterLabels = [directoryPath ? directoryPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || directoryPath : '', view.archived ? uiText("已归档") : '', view.environmentFilter ? environmentName(view.environmentFilter) : '', statusLabel].filter(Boolean);
  $('#sessionClearFilters').hidden = !filterCount;
  $('#sessionActiveFilterLabel').hidden = !filterCount && view.scope.kind === 'all';
  $('#sessionActiveFilterText').textContent = [view.scope.kind !== 'all' ? conversationScopeName(view.scope) : '', ...filterLabels].filter(Boolean).join(' · ');
  $('#sessionActiveFilterLabel').title = directoryPath || '';
  const picker = $('#sessionScopePicker');
  picker.toggleAttribute('data-active', !!(directoryPath || filterLabels.length || view.scope.kind !== 'all'));
  picker.querySelector('summary').title = [uiText("筛选对话"), conversationScopeName(view.scope), directoryPath, ...filterLabels].filter(Boolean).join(' · ');
  const showContext = !view.directory && view.scope.kind !== 'directory' && new Set(items.map(session => conversationPathKey(session.cwd))).size > 1;
  const list = $('#sessionBrowserList');
  list.setAttribute('aria-busy',String(initialLoading || view.loading));
  const rows = view.listRows.slice(start, end);
  const props = { sessions: rows.filter(row => row.kind === 'session').map(row => row.session), rows, sidebarMode, canReorderProjects:view.projectGroups.length > 1, parallel:!!sidebarMode, parallelSessions:window.WorkHubPage?.parallelSessions || [], parallelFull:!!window.WorkHubPage?.parallelFull, selected, search:text, showDirectory: showContext, showContext, loading: initialLoading, filtered: !!text || !!filterCount || statusFilter !== 'all', error: false, canCreate: !$('#newBrowserSession').disabled };
  const emptyError = !!view.error && !items.length && !view.loading;
  const renderKey = JSON.stringify([new Date().toDateString(), emptyError, props, before, after, loaded, sessions.length]);
  if (conversationListRenderKeys.get(list) !== renderKey) {
    const spacer = (height,side) => height ? `<div class="session-list-spacer" data-list-spacer="${side}" aria-hidden="true"></div>` : '';
    const more = loaded < view.listRows.length ? `<p class="session-list-more" role="status">${uiText("向下滚动加载更多")}</p>` : '';
    const markup = emptyError && !rows.length ? '' : spacer(before,'before') + window.WorkHubUI.conversationList(props) + spacer(after,'after') + more;
    if (list.innerHTML !== markup) {
      const top = list.scrollTop;
      const listTop = list.getBoundingClientRect().top;
      const anchor = [...list.querySelectorAll('[data-conversation-list-row]')].find(el => {const rect = el.getBoundingClientRect(); return rect.bottom > listTop && rect.top < listTop + list.clientHeight;});
      const anchorKey = anchor?.dataset.conversationListRow, anchorTop = anchor?.getBoundingClientRect().top;
      const selected = list.contains(document.activeElement) ? document.activeElement?.dataset.conversationListRow : null;
      patchConversationList(list,markup);
      // CSP rejects style attributes parsed from HTML. CSSOM property updates
      // preserve virtual-list geometry without allowing inline styles.
      for (const spacer of list.querySelectorAll('[data-list-spacer]')) {
        spacer.style.height = `${spacer.dataset.listSpacer === 'before' ? before : after}px`;
      }
      list.scrollTop = top;
      const newAnchor = anchorKey && [...list.querySelectorAll('[data-conversation-list-row]')].find(el => el.dataset.conversationListRow === anchorKey);
      if (newAnchor) list.scrollTop += newAnchor.getBoundingClientRect().top - anchorTop;
      // Measure only the mounted rows. Offscreen batches are represented by two
      // spacers, keeping resize layout work bounded even after long browsing.
      for (const row of list.querySelectorAll('[data-conversation-list-row]')) {
        const item = row.closest('li, .session-workspace-heading, .session-workspace-preview') || row;
        const height = item?.getBoundingClientRect().height || 0;
        if (height) view.listHeights.set(row.dataset.conversationListRow, height + (row.hasAttribute('data-conversation-session') ? 2 : 0));
      }
      if (selected) [...list.querySelectorAll('[data-conversation-list-row]')].find(b => b.dataset.conversationListRow === selected)?.focus({ preventScroll: true });
    }
    conversationListRenderKeys.set(list,renderKey);
  }
  list.dataset.loadedCount = String(loaded); list.dataset.windowStart = String(start); list.dataset.windowEnd = String(end); list.dataset.totalCount = String(sessions.length);
  if (scrollTarget) [...list.querySelectorAll('[data-conversation-session]')].find(el => el.dataset.conversationSession === scrollTarget)?.scrollIntoView({block:'nearest'});
  if (list.clientHeight && list.scrollHeight <= list.clientHeight && loaded < view.listRows.length) scheduleConversationListScroll();
  const running = sessions.filter(s => ['starting','running','stopping','handoff'].includes(s.chat_status)).length;
  const waiting = sessions.filter(s => s.chat_status === 'waiting').length;
  const unavailable = view.error && !items.length;
  const count = $('#sessionBrowserCount');
  const countText = initialLoading ? '…' : unavailable ? '—' : `${sessions.length}${text || statusFilter !== 'all' ? '/' + items.length : ''}`;
  if (count.textContent !== countText) count.textContent = countText;
  const countLabel = initialLoading ? uiText("正在加载对话…") : unavailable ? uiText("数量暂不可用") : [
    text || statusFilter !== 'all' ? uiText("{0} / {1} 个对话", sessions.length, items.length) : uiText("{0} 个对话", sessions.length),
    view.error ? uiText(" · 部分结果未更新") : '',
    running ? uiText(" · {0} 个运行中", running) : '',
    waiting ? uiText(" · {0} 个待确认", waiting) : '',
    view.loading ? uiText(" · 更新中") : '',
  ].join('');
  count.setAttribute('aria-label', countLabel);
  count.title = countLabel;
  $('#sessionBrowserError').hidden = !view.error;
  const errorMarkup = view.error ? uiText("<strong>{0}</strong><p>{1}</p><button type=\"button\" data-conversation-action=\"refresh\" class=\"session-error-retry\">重新加载</button><details><summary>错误详情</summary><pre>{2}</pre></details>", view.sessions.length ? uiText("部分对话未能刷新") : uiText("暂时无法读取对话"), view.sessions.length ? uiText("保留上次结果，你可以继续查看已有对话。") : uiText("检查执行环境连接后重试。"), esc(view.error)) : '';
  if ($('#sessionBrowserError').innerHTML !== errorMarkup) $('#sessionBrowserError').innerHTML = errorMarkup;
  for (const refresh of document.querySelectorAll('[data-conversation-action="refresh"]')) refresh.disabled = view.loading;
  updateConversationNavigation();
}
function setConversationListMode(mode) {
  if (mode === conversationListMode) return;
  conversationListMode = mode;
  if (!window.WorkHubPage?.navigationOnly || !conversationState.current) return;
  resetConversationListWindow();
  renderConversationList();
  rememberConversationView();
}
$('#sessionSidebarModes').addEventListener('click', event => {
  const mode = event.target.closest('[data-conversation-list-mode]')?.dataset.conversationListMode;
  if (!mode || !window.WorkHubPage?.navigationOnly) return;
  try { localStorage.setItem(conversationListModeKey, mode); } catch { /* Keep the current window preference. */ }
  setConversationListMode(mode);
  const picker = $('#sessionScopePicker');
  picker.open = false;
  picker.querySelector('summary').focus({preventScroll:true});
});
function syncConversationSearchBar(forceOpen) {
  const scopeBar = $('#sessionBrowserScopeBar');
  const toggle = $('#sessionSearchToggle');
  const newChat = $('#sessionSidebarNewChat');
  const input = $('#sessionBrowserSearch');
  if (!scopeBar || !toggle || !input) return;
  const navMode = !!window.WorkHubPage?.navigationOnly;
  const hasValue = !!input.value.trim();
  const open = !navMode || forceOpen === true || hasValue || (forceOpen !== false && document.activeElement === input);
  scopeBar.toggleAttribute('data-search-open', open);
  toggle.hidden = !navMode || open;
  if (newChat) newChat.hidden = !navMode || open;
  toggle.setAttribute('aria-expanded', String(open));
}
function applyConversationProjectDisplay(saved = null, rerender = false) {
  let preferences;
  try { preferences = JSON.parse(saved); } catch { /* Use defaults for malformed preferences. */ }
  const previousRecent = conversationProjectDisplayState.recent;
  const nextState = {...conversationProjectDisplayDefaults};
  for (const option of conversationProjectDisplay.querySelectorAll('input')) {
    const defaultValue = conversationProjectDisplayDefaults[option.name] !== false;
    option.checked = typeof preferences?.[option.name] === 'boolean' ? preferences[option.name] : defaultValue;
    nextState[option.name] = option.checked;
    if (option.name === 'icons' || option.name === 'counts') {
      $('#sessionBrowserList').toggleAttribute(`data-hide-project-${option.name}`, !option.checked);
    }
  }
  conversationProjectDisplayState = nextState;
  if (rerender && previousRecent !== nextState.recent && conversationState.current && conversationVisible()) {
    resetConversationListWindow();
    renderConversationList();
  }
}
try { applyConversationProjectDisplay(localStorage.getItem(conversationProjectDisplayKey)); } catch { /* Keep defaults without storage. */ }
conversationProjectDisplay.addEventListener('change', () => {
  const preferences = Object.fromEntries([...conversationProjectDisplay.querySelectorAll('input')].map(option => [option.name, option.checked]));
  const saved = JSON.stringify(preferences);
  applyConversationProjectDisplay(saved, true);
  try { localStorage.setItem(conversationProjectDisplayKey, saved); } catch { /* Keep the current window preference. */ }
});
window.addEventListener('storage', event => {
  if (event.key === conversationListModeKey || event.key === null) setConversationListMode(event.newValue === 'recent' ? 'recent' : 'grouped');
  if (event.key === conversationProjectDisplayKey || event.key === null) applyConversationProjectDisplay(event.newValue, true);
});
function renderConversationBrowser() {
  const view = conversationState.current;
  if (!view) return;
  // The host owns the only list; a conversation surface always renders its detail.
  if (document.documentElement.hasAttribute('data-workspace-conversation')) view.pane = 'detail';
  const panelOverview = conversationOverview(sessionHistoryState?.environment || activeEnvironment);
  window.WorkHubAssistant?.updateOverview?.({projects: panelOverview.projects});
  conversationHost.hidden = conversationState.mode === 'hidden';
  conversationHost.dataset.pane = view.pane;
  $('#sessionScopeLabel').textContent = conversationScopeName(view.scope);
  $('#sessionBrowserContext').textContent = conversationScopeName(view.scope) + ' · ' + (view.environmentFilter || conversationScopeEnvironment(view.scope) ? environmentName(view.environmentFilter || conversationScopeEnvironment(view.scope)) : uiText("全部环境"));
  $('#sessionsEnvironment').value = view.environmentFilter;
  $('#sessionEnvironmentField').hidden = conversationEnvironments().length < 2 || !!conversationScopeEnvironment(view.scope);
  $('#sessionScopeAll').hidden = view.scope.kind === 'all';
  $('#sessionBrowserSearch').value = view.search;
  syncConversationSearchBar();
  $('#sessionBrowserArchived').checked = !!view.archived;
  const showCreationDirectories = view.creating && !view.creatingYoluAssistant;
  $('#newBrowserSession').disabled = sessionReadOnly;
  $('#newBrowserSession').title = sessionReadOnly ? uiText("当前为只读模式，请在终端新建对话") : uiText("在当前栏新建对话");
  const sidebarNewChat = $('#sessionSidebarNewChat');
  if (sidebarNewChat) {
    sidebarNewChat.disabled = sessionReadOnly;
    sidebarNewChat.title = sessionReadOnly ? uiText("当前为只读模式，请在终端新建对话") : uiText("新建对话");
  }
  // The assistant shows setup in the empty thread and returns it here when messages appear.
  $('#sessionCreationSetupHost').hidden = !!window.WorkHubAssistant;
  $('#sessionCreationSetup').hidden = !view.creating;
  $('#conversationCreationKind').hidden = !view.creating || view.creatingYoluAssistant || !window.WorkHubPage || window.WorkHubPage.navigationOnly;
  const terminalKind = $('[data-conversation-kind="terminal"]');
  const remoteTerminal = (view.targetEnvironment || activeEnvironment) !== 'local';
  terminalKind.disabled = remoteTerminal || !!sessionHistoryState?.submitting;
  terminalKind.title = remoteTerminal ? uiText("内置终端目前仅支持本机执行环境。") : uiText("在当前栏切换为终端");
  $('#sessionBrowserNewDirectoryField').hidden = !showCreationDirectories;
  if (showCreationDirectories) {
    const creationDirectories = conversationCreationDirectories(view);
    $('#sessionBrowserNewDirectory').innerHTML = creationDirectories.map(d => `<option value="${esc(d.key)}" title="${esc(d.cwd)}" data-name="${esc(d.name)}" data-branch="${esc(d.branch)}">${esc(d.label)}</option>`).join('');
    $('#sessionBrowserNewDirectory').value = view.creationDirectory || '';
    $('#sessionBrowserNewDirectory').title = view.target?.cwd || '';
    window.WorkHubUI.renderCreationChoices($('#sessionBrowserNewDirectory'), $('#sessionBrowserDirectoryChoices'), undefined, {
      focus:focusConversationCreationInput,
      chooseFolder:(view.targetEnvironment || activeEnvironment) === 'local' ? chooseConversationCreationFolder : undefined,
      addDirectory:window.WorkHubAssistant ? () => document.dispatchEvent(new Event('workhub:creation-add-directory')) : undefined
    });
  }
  renderConversationList();
  syncConversationScopePanel();
}
async function refreshConversations(force = false) {
  if (window.WorkHubPage?.restoring || window.WorkHubPage?.active === false) return;
  // A dedicated detail page gets metadata with its history. Only the shared
  // navigation loads lists; no full discovery per parallel conversation.
  if (document.documentElement?.hasAttribute('data-workspace-conversation')) return;
  const catalog = refreshConversationCatalog(force);
  if (!conversationVisible()) return catalog;
  const terminals = refreshConversationTerminals(force);
  const view = conversationState.current;
  if (!view || view.environment !== activeEnvironment || view.loading || !force && Date.now() - view.checkedAt < 10000) return terminals;
  const directory = view.directory;
  const requestKey = JSON.stringify([view.scope, directory, !!view.archived, view.environmentFilter]);
  const scopeEnvironment = conversationScopeEnvironment(view.scope);
  let selectedDirectory = conversationDirectories().find(d => d.key === directory);
  if (directory && !selectedDirectory) {
    let identity;
    try { identity = JSON.parse(directory); } catch { /* Local directory keys are paths. */ }
    selectedDirectory = Array.isArray(identity) && identity.length === 2 ? {environment: identity[0], cwd: identity[1]} : {environment: 'local', cwd: directory};
  }
  const candidates = conversationEnvironments();
  // A restored pane can identify its environment before the inventory arrives.
  if (scopeEnvironment && !candidates.some(entry => entry.id === scopeEnvironment)) candidates.push({id:scopeEnvironment,name:environmentName(scopeEnvironment)});
  const environments = candidates.filter(e => (!scopeEnvironment || e.id === scopeEnvironment) && (!view.environmentFilter || e.id === view.environmentFilter) && (!selectedDirectory || e.id === selectedDirectory.environment));
  const params = new URLSearchParams();
  if (view.archived) params.set('archived', 'true');
  if (view.scope.kind === 'project') params.set('project_id', view.scope.id);
  const cwd = selectedDirectory?.cwd || directory || (view.scope.kind === 'directory' ? view.scope.cwd : '');
  if (cwd) params.set('cwd', cwd);
  const cachedParams = new URLSearchParams(params);
  cachedParams.set('cached', '1');
  const query = conversationState.beginQuery(view, requestKey, environments.map(e => e.id), () => activeEnvironment);
  renderConversationList();
  const current = query.current, errors = query.errors;
  function publish() {
    if (!query.publish()) return;
    if (view === conversationState.current && conversationVisible()) {
      renderConversationBrowser();
      if (!view.creating) showConversationSelection();
      window.dispatchEvent(new CustomEvent('workhub:conversation-list-ready'));
    }
    updateConversationNavigation();
  }
  await Promise.allSettled(environments.map(async ({id: environment}) => {
    // Project state supplies creation targets and context; session listing does
    // not wait for a slow repository scan in another environment.
    if (environment !== activeEnvironment) api('/api/state', {environment}).then(data => {
      if (!current()) return;
      conversationState.rememberOverview(environment, data);
      if (view === conversationState.current && conversationVisible()) renderConversationBrowser();
    }).catch(() => {});
    if (query.needsCached(environment)) {
      void conversationRequests.load(api, environment, cachedParams.toString()).then(result => {
        if (query.receiveCached(environment, conversationListedSessions(result, environment))) publish();
      }).catch(() => {});
    }
    try {
      const result = await conversationRequests.load(api, environment, params.toString(), force);
      if (!current()) return;
      const sessions = conversationListedSessions(result, environment);
      query.receive(environment, sessions, result.error ? environmentName(environment) + '：' + result.error : undefined);
    } catch (error) {
      if (!current()) return;
      query.failed(environment, environmentName(environment) + '：' + error.message);
    }
    query.settled(environment);
    publish();
  }));
  if (!current()) return;
  view.loading = false;
  const followTarget = view.followTarget;
  view.followTarget = null;
  if (view === conversationState.current && followTarget && view.requestedSession && !errors.size) {
    followConversationSelection(followTarget,true);
    return;
  }
  if (view.requestedSession) errors.set('selection', uiText("该对话暂不可用，请刷新列表重试。"));
  publish();
}
function showConversationSelection() {
  const view = conversationState.current;
  if (!view || !conversationVisible() || window.WorkHubPage?.navigationOnly) return;
  const session = view.creating ? null : conversationSelectedSession(view);
  const localCwd = session?.provider !== 'codex-cloud' && session?.cwd;
  const fileContext = localCwd ? window.WorkHubUI.conversationContext(localCwd, conversationOverview(session.environment_id || activeEnvironment), session.primary_project_id) : null;
  conversationFiles.setContext(localCwd ? {session: session.id, path: localCwd, environment: session.environment_id || activeEnvironment, project: fileContext?.projectID, additionalDirectories: session.additional_directories} : undefined);
  if (view.creating && !view.target || !view.creating && !session) {
    closeSessionHistory(false);
    $('#sessionBrowserEmpty').hidden = false;
    $('#sessionBrowserEmpty').textContent = view.creating ? uiText("选择本次对话的工作目录。") : document.documentElement.hasAttribute('data-workspace-conversation') ? uiText("选择一个对话，或新建对话开始工作。") : view.loading ? uiText("正在读取对话…") : view.error ? uiText("暂时无法读取对话，请点击列表中的刷新重试。") : uiText("这里还没有对话，可以从列表上方新建。");
    if (!view.creating && !view.loading && view.error) $('#sessionBrowserEmpty').hidden = true;
    return;
  }
  const targetKey = JSON.stringify(view.target || null);
  if (session && conversationReadingSession(session.id, session.environment_id)) saveSessionRead(session);
  if (session) rememberConversationView();
  const environment = session?.environment_id || view.targetEnvironment || conversationScopeEnvironment(view.scope) || activeEnvironment;
  if (sessionHistoryState?.environment === environment && (session ? sessionHistoryState.session === session.id : !sessionHistoryState.session && sessionHistoryState.browserTarget === targetKey)) {
    if (session) window.WorkHubAssistant?.updateSession?.(session);
    else if (view.draftExecution) {
      window.WorkHubAssistant?.selectDraftExecution?.(view.draftExecution);
      view.draftExecution = undefined;
    }
    return;
  }
  $('#sessionBrowserEmpty').hidden = true;
  const selection = ++conversationState.selection;
  const tools = conversationHost.querySelector('.session-browser-list-tools');
  const focusedControl = tools.contains(document.activeElement) ? document.activeElement : null;
  const chooseDraftDirectories = view.creating && !view.creatingYoluAssistant;
  const bindings = chooseDraftDirectories ? view.creationBindings?.[environment] : undefined;
  openSessionHistoryPanel(session?.id || null, {
    session, environment, overview: conversationOverview(environment), browserTarget: targetKey, focusComposer:!!view.focusComposer,
    target: bindings?.length ? {...view.target, bindings} : view.target,
    draftTarget: view.creating ? view.draftTarget : undefined,
    draftExecution: view.creating ? view.draftExecution : undefined,
    updateDraftBindings: chooseDraftDirectories ? bindings => {
      view.creationBindings = {...view.creationBindings,[environment]:bindings};
      window.dispatchEvent(new Event('workhub:chat-draft'));
    } : undefined,
    loaded(loaded) {
      if (conversationState.current !== view || selection !== conversationState.selection || loaded.id !== session?.id) return;
      const activity = conversationState.session(environment, loaded.id);
      const tagged = conversationTaggedSession({...loaded, chat_status:activity?.chat_status ?? loaded.chat_status, completed_run:activity?.completed_run ?? loaded.completed_run},environment);
      view.directSession = tagged;
      conversationState.record(environment, [tagged]);
      const position = view.sessions.findIndex(item => conversationSessionKey(item) === conversationSessionKey(tagged));
      if (position >= 0) view.sessions[position] = tagged;
      showConversationSelection();
      window.dispatchEvent(new CustomEvent('workhub:session-loaded'));
    },
    created(created) {
      if (chooseDraftDirectories && created.provider !== 'codex-cloud') window.WorkHubUI.recordCreationDirectory(view.creationDirectory, created.id);
      conversationRequests.invalidate(environment);
      created = conversationTaggedSession(created, environment);
      conversationState.record(environment, [created]);
      if (!view.sessions.some(s => conversationSessionKey(s) === conversationSessionKey(created))) view.sessions.unshift(created);
      if (conversationState.current !== view || selection !== conversationState.selection) return;
      view.selected = conversationSessionKey(created); view.creating = false; view.target = null;
      renderConversationBrowser(); showConversationSelection(); rememberConversationView();
      window.dispatchEvent(new CustomEvent('workhub:session-loaded'));
    }
  });
  view.draftExecution = undefined;
  view.focusComposer = false;
  // Background selection after filtering must not pull focus out of the controls.
  if (focusedControl?.isConnected && !focusedControl.closest('[hidden]') && (!focusedControl.closest('details:not([open])') || focusedControl.matches('summary'))) focusedControl.focus({preventScroll:true});
  renderConversationList();
}
function selectConversationScope(scope) {
  const pickerFocused = $('#sessionScopePicker').contains(document.activeElement);
  rememberConversationView();
  conversationState.selection++;
  closeSessionHistory(false);
  conversationState.current = conversationViewFor(scope);
  $('#sessionScopePicker').open = false;
  $('#sessionScopeSearch').value = '';
  if (pickerFocused) $('#sessionScopePicker summary').focus({preventScroll:true});
  renderConversationBrowser(); refreshConversations(true); showConversationSelection();
  $('#sessionBrowserList').scrollTop = conversationState.current.scrollTop;
}
function openConversations(scope, session) {
  if (state.busy) return;
  window.dispatchEvent(new CustomEvent('workhub:chat-layout', {detail:{phase:'before'}}));
  conversationState.mode = 'page';
  selectConversationScope(scope);
  if (session) {
    const environment = conversationScopeEnvironment(conversationState.current.scope) || activeEnvironment;
    const cached = conversationItems(environment).find(s => s.id === session);
    if (cached && !conversationState.current.sessions.some(s => conversationSessionKey(s) === conversationEnvironmentKey(environment, session))) conversationState.current.sessions.unshift(conversationTaggedSession(cached, environment));
    conversationState.current.selected = conversationEnvironmentKey(environment, session);
    conversationState.current.locateSelection = conversationState.current.selected;
    conversationState.current.pane = 'detail';
    renderConversationBrowser(); showConversationSelection();
  }
  rememberConversationView();
  navigate('/sessions');
  window.dispatchEvent(new CustomEvent('workhub:chat-layout', {detail:{visible:true}}));
}
async function openConversationProject(id, environment, path) {
  if (state.busy) return;
  try {
    await selectEnvironment(environment, resourceDirectoryRoute('/projects/' + id, path));
    if (activeEnvironment === environment) focusResourcePage();
  } catch (error) { toast(error.message, true); }
}
function closeConversations() {
  rememberConversationView();
  conversationState.selection++;
  conversationState.mode = 'hidden';
  conversationFiles.setContext();
  conversationHost.hidden = true;
  $('#sessionScopePicker').open = false;
  syncConversationScopePanel();
  closeSessionHistory(false);
  renderResourceIcons();
}
function suspendConversations() {
  for (const environment of conversationEnvironments()) conversationRequests.invalidate(environment.id);
  if (state.loaded) conversationState.rememberOverview(activeEnvironment, {...state});
  closeConversations();
  conversationState.suspend();
  updateConversationNavigation();
}
function syncConversations() {
  if (window.WorkHubPage?.restoring) return;
  if (conversationState.current && conversationState.current.environment !== activeEnvironment) suspendConversations();
  if (state.view === 'sessions') {
    if (conversationState.mode !== 'page') {
      conversationState.mode = 'page';
      selectConversationScope(conversationState.pageScope(activeEnvironment) || { kind: 'all', name: uiText("全部对话") });
    }
    renderConversationBrowser();
    refreshConversations(false);
  } else if (conversationState.mode === 'page') closeConversations();
  updateConversationNavigation();
  refreshConversationCatalog();
}
// This inventory is intentionally separate from conversationDirectories: saved
// readers and project tools still need their worktrees and historical paths.
function conversationCreationDirectories(view) {
  const dirs = [];
  for (const entry of conversationEnvironments()) {
    if (view.environmentFilter && entry.id !== view.environmentFilter || view.scope.environment && entry.id !== view.scope.environment) continue;
    const projects = window.WorkHubUI.mainCreationProjects(conversationOverview(entry.id).projects);
    for (const project of projects) {
      const branch = project.worktrees?.find(tree => conversationPathKey(tree.path) === conversationPathKey(project.path))?.branch || '';
      const key = conversationEnvironmentKey(entry.id, conversationPathKey(project.path));
      for (const session of conversationItems(entry.id)) {
        if (session.provider === 'codex-cloud') continue;
        if (session.primary_project_id === project.id || conversationPathKey(session.cwd) === conversationPathKey(project.path)) window.WorkHubUI.recordCreationDirectory(key, session.id, (session.created_at || 0) * 1000);
      }
      const name = project.name + (entry.id !== 'local' ? ' · ' + environmentName(entry.id) : '');
      dirs.push({key:conversationEnvironmentKey(entry.id, conversationPathKey(project.path)), cwd:project.path, environment:entry.id, name, branch, label:[name,branch].filter(Boolean).join(' · '), target:{project_id:project.id,cwd:project.path}});
    }
  }
  for (const directory of view.creationLocalDirectories || []) {
    if (!dirs.some(item => item.environment === directory.environment && conversationPathKey(item.cwd) === conversationPathKey(directory.cwd))) dirs.push(directory);
  }
  dirs.unshift({key:'', cwd:'', environment:conversationScopeEnvironment(view.scope) || view.environmentFilter || view.environment, name:uiText("默认目录（无需项目）"), branch:'', label:uiText("默认目录（无需项目）"), target:{}});
  return dirs;
}
function focusConversationCreationInput() {
  requestAnimationFrame(() => ($('#assistantChatRoot textarea') || $('#sessionChatInput'))?.focus({preventScroll:true}));
}
async function chooseConversationCreationFolder() {
  const view = conversationState.current;
  if (!view?.creating || view.creatingYoluAssistant) return;
  const result = await api('/api/dialogs/directory', {environment:'local', method:'POST', body:'{}'});
  if (!result.path || conversationState.current !== view || !view.creating) return;
  const directory = {key:conversationEnvironmentKey('local',conversationPathKey(result.path)), cwd:result.path, environment:'local', name:result.path.split(/[\\/]/).filter(Boolean).at(-1) || result.path, branch:'', label:result.path.split(/[\\/]/).filter(Boolean).at(-1) || result.path, target:{cwd:result.path}};
  // Resolve Git metadata through the existing binding inspector. It validates
  // the path and rejects a linked worktree instead of mounting it as a root.
  const inspected = await api('/api/session-bindings/inspect', {environment:'local',method:'POST',body:JSON.stringify({directory:result.path,access:'write'})});
  if (conversationState.current !== view || !view.creating) return;
  if (inspected.main_directory && conversationPathKey(inspected.main_directory) !== conversationPathKey(inspected.directory)) throw new Error(uiText("请选择仓库主目录"));
  if (inspected.worktree?.detached) throw new Error(uiText("请选择仓库主目录"));
  if (inspected.project_id) {
    const project = conversationOverview('local').projects.find(project => project.id === inspected.project_id);
    if (project && conversationPathKey(project.path) !== conversationPathKey(result.path)) throw new Error(uiText("请选择仓库主目录"));
    directory.target.project_id = inspected.project_id;
  }
  const registered = conversationOverview('local').projects.find(project => conversationPathKey(project.path) === conversationPathKey(inspected.directory));
  if (registered) {directory.target.project_id = registered.id; directory.name = registered.name;}
  directory.key = conversationEnvironmentKey('local', conversationPathKey(inspected.directory));
  directory.cwd = inspected.directory; directory.target.cwd = inspected.directory;
  directory.branch = inspected.branch || '';
  directory.label = [directory.name,directory.branch].filter(Boolean).join(' · ');
  view.creationLocalDirectories = [...(view.creationLocalDirectories || []).filter(item => item.key !== directory.key),directory];
  selectConversationCreationDirectory(view, directory);
  conversationState.selection++; closeSessionHistory(false); renderConversationBrowser(); showConversationSelection();
}
function selectConversationCreationDirectory(view, directory) {
  view.creationDirectory = directory?.key || '';
  view.target = directory?.target || {};
  view.targetEnvironment = directory?.environment;
  const attached = view.creationBindings?.[view.targetEnvironment];
  if (directory?.cwd && attached) {
    const key = conversationPathKey(directory.cwd);
    view.creationBindings = {...view.creationBindings,[view.targetEnvironment]:attached.filter(binding => conversationPathKey(binding.directory) !== key)};
  }
}
function conversationDirectoryPreference(view) {
  return 'directory:' + conversationScopeKey(view.scope, view.environment);
}
function defaultConversationDirectory(view, dirs = conversationCreationDirectories(view)) {
  const explicit = view.creationDirectory && dirs.find(directory => directory.key === view.creationDirectory);
  if (explicit) return explicit;
  // Old project/worktree entry points now start at their primary repository.
  const previous = conversationDirectories(view.scope, view.environmentFilter).find(directory => directory.key === (view.creationDirectory || (view.scope.kind === 'directory' ? conversationEnvironmentKey(view.scope.environment,conversationPathKey(view.scope.cwd)) : '')));
  const primary = previous?.target?.project_id && dirs.find(directory => directory.target.project_id === previous.target.project_id && directory.environment === previous.environment);
  if (primary) return primary;
  if (view.scope.kind === 'project') {
    const saved = window.WorkHubUI.conversationDefaults.get(conversationDirectoryPreference(view));
    const preferred = saved && dirs.find(directory => directory.key === saved);
    if (preferred) return preferred;
    const project = conversationOverview(conversationScopeEnvironment(view.scope)).projects.find(item => item.id === view.scope.id);
    const main = project && dirs.find(directory => conversationPathKey(directory.cwd) === conversationPathKey(project.path));
    return main || dirs[0];
  }
  return dirs[0];
}
function startBrowserConversation(focus = true, restore = false, creatingYoluAssistant = false) {
  if (sessionReadOnly) return;
  const view = conversationState.current;
  if (!restore) view.creatingYoluAssistant = creatingYoluAssistant;
  window.WorkHubUI.resetCreationChoices($('#sessionBrowserDirectoryChoices'));
  view.creating = true; view.selected = null; view.pane = 'detail';
  if (!restore) view.creationBindings = {};
  view.draftTarget = undefined;
  if (view.creatingYoluAssistant) {
    // Prepare the new default while retaining the text and attachments of older drafts.
    if (restore && view.creationDirectory) {
      const saved = view.creationLocalDirectories?.find(item => item.key === view.creationDirectory);
      const project = conversationOverview('local').projects.find(item => conversationPathKey(item.path) === view.creationDirectory);
      view.draftTarget = saved?.target || {project_id:project?.id,cwd:project?.path || view.creationDirectory};
    } else {
      view.creationDirectory = '';
    }
    view.creationBindings = {};
    view.target = {yolu_assistant:true};
    view.targetEnvironment = 'local';
  } else {
    selectConversationCreationDirectory(view, defaultConversationDirectory(view));
  }
  view.focusComposer = focus;
  conversationState.selection++;
  closeSessionHistory(false);
  renderConversationBrowser(); showConversationSelection();
  if (focus) ($('#assistantChatRoot textarea') || $('#sessionChatInput'))?.focus();
}
function browserSessionActivity(id, chat, environment = activeEnvironment) {
  const item = conversationState.session(environment, id);
  if (item) {
    item.chat_status = chat.busy ? chat.status : '';
    if (!chat.busy && chat.turn_id) item.completed_run = chat.id;
    // Dedicated readers skip list rendering, so acknowledge visible activity
    // here as well as when opening or refreshing an ordinary conversation.
    sessionWithUnread(item);
  }
  for (const view of conversationState.views()) {
    const s = view.sessions.find(s => s.id === id && s.environment_id === environment);
    if (s) { s.chat_status = chat.busy ? chat.status : ''; if (!chat.busy && chat.turn_id) s.completed_run = chat.id; }
  }
  if (conversationVisible()) renderConversationList(); else updateConversationNavigation();
}
function revealConversationCreationGroup(control) {
  const key = control.closest('[data-conversation-group]')?.dataset.conversationGroup;
  const view = conversationState.current;
  const groupState = view?.filteredGroupState || view;
  if (!key || !groupState?.collapsedGroups.includes(key)) return;
  groupState.collapsedGroups = groupState.collapsedGroups.filter(value => value !== key);
  renderConversationList();
  rememberConversationView();
}
$('#sessionToggleAllGroups').addEventListener('click', event => {
  const control = event.currentTarget;
  const view = conversationState.current;
  if (!view || control.hidden) return;
  const keys = new Set(view.listRows.filter(row => row.kind === 'group' && row.group.collection !== 'recent').map(row => row.group.key));
  const groupState = view.filteredGroupState || view;
  if (control.dataset.expand === 'true') {
    groupState.collapsedGroups = groupState.collapsedGroups.filter(key => !keys.has(key));
  } else {
    groupState.collapsedGroups = [...new Set([...groupState.collapsedGroups, ...keys])];
    if (!view.filteredGroupState) for (const key of keys) delete view.groupLimits[key];
  }
  resetConversationListWindow(view);
  renderConversationList();
  rememberConversationView();
});
document.addEventListener('click', event => {
  const entry = event.target.closest('[data-action="project-conversations"], [data-action="project-conversation-new"]');
  if (entry) {
    const create = entry.dataset.action === 'project-conversation-new';
    if (entry.disabled || state.busy || create && sessionReadOnly) return;
    event.stopPropagation();
    if (create) revealConversationCreationGroup(entry);
    const environment = entry.dataset.environment || activeEnvironment;
    openConversations({kind:'project',id:entry.dataset.id,environment}, entry.dataset.session);
    if (create) {
      conversationState.current.creationDirectory = conversationEnvironmentKey(environment,conversationPathKey(entry.dataset.path));
      startBrowserConversation();
    }
    return;
  }
  const groupControl = event.target.closest('[data-conversation-group-toggle], [data-conversation-group-more], [data-conversation-group-less]');
  if (groupControl && conversationState.current) {
    const view = conversationState.current;
    const {conversationGroupToggle: toggle, conversationGroupMore: more, conversationGroupLess: less} = groupControl.dataset;
    const key = toggle || more || less;
    const previous = view.listRows;
    view.locateSelection = null;
    if (toggle) {
      const groupState = view.filteredGroupState || view;
      if (groupState.collapsedGroups.includes(key)) groupState.collapsedGroups = groupState.collapsedGroups.filter(value => value !== key);
      else {
        groupState.collapsedGroups = [...groupState.collapsedGroups,key];
        if (!view.filteredGroupState) delete view.groupLimits[key];
      }
    } else if (less) delete view.groupLimits[key];
    else {
      const preview = previous.find(row => row.key === groupControl.dataset.conversationListRow);
      if (!preview) return;
      view.groupLimits[key] = preview.group.shown + window.WorkHubUI.projectConversationStep;
    }
    renderConversationList();
    const groupIndex = view.listRows.findIndex(row => row.kind === 'group' && row.group.key === key);
    const previousKeys = more && new Set(previous.map(row => row.key));
    const firstNewRow = more ? view.listRows.findIndex(row => row.kind === 'session' && row.group.key === key && !previousKeys.has(row.key)) : -1;
    const smooth = less && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    focusConversationListIndex(firstNewRow >= 0 ? firstNewRow : groupIndex, smooth ? 'smooth' : 'auto');
    rememberConversationView();
    return;
  }
  const session = event.target.closest('[data-conversation-session]');
  if (session && conversationState.current) {
    conversationState.current.requestedSession = null;
    conversationState.current.selected = session.dataset.conversationSession; conversationState.current.creating = false; conversationState.current.target = null; conversationState.current.pane = 'detail';
    conversationState.selection++; renderConversationBrowser(); showConversationSelection(); rememberConversationView(); return;
  }
  const scope = event.target.closest('[data-conversation-scope]');
  if (scope) { selectConversationScope(JSON.parse(scope.dataset.conversationScope)); rememberConversationView(); return; }
  const statusButton = event.target.closest('[data-conversation-status]');
  if (statusButton && conversationState.current) {
    const pickerFocused = $('#sessionScopePicker').contains(document.activeElement);
    conversationState.current.statusFilter = statusButton.dataset.conversationStatus; resetConversationListWindow();
    $('#sessionBrowserList').scrollTop = 0;
    $('#sessionScopePicker').open = false;
    if (pickerFocused) $('#sessionScopePicker summary').focus();
    renderConversationList(); return;
  }
  const button = event.target.closest('[data-conversation-action]');
  if (!button || button.disabled || state.busy) return;
  switch (button.dataset.conversationAction) {
    case 'new':
      if (button.dataset.conversationStandalone === 'true') revealConversationCreationGroup(button);
      if (button.id === 'newBrowserSession' || button.dataset.conversationStandalone === 'true') {
        selectConversationScope({kind:'all',name:uiText("全部对话")});
        conversationState.current.environmentFilter = '';
        conversationState.current.creationDirectory = '';
      }
      startBrowserConversation(true, false, button.dataset.yoluAssistant === 'true'); break;
    case 'refresh': refreshConversations(true); break;
    case 'clear-search':
      conversationState.current.search = ''; resetConversationListWindow(); $('#sessionBrowserSearch').value = ''; $('#sessionBrowserList').scrollTop = 0;
      renderConversationList(); $('#sessionBrowserSearch').focus(); break;
    case 'reset-list':
      conversationState.current.search = ''; $('#sessionBrowserSearch').value = '';
      resetConversationListFilters(); $('#sessionBrowserSearch').focus(); break;
    case 'clear-filters':
      resetConversationListFilters(); break;
    case 'clear-scope-filters': {
      const search = conversationState.current.search;
      if (conversationState.current.scope.kind !== 'all') selectConversationScope({kind:'all',name:uiText("全部对话")});
      conversationState.current.search = search;
      resetConversationListFilters(); rememberConversationView(); break;
    }
    case 'all': selectConversationScope({ kind: 'all', name: uiText("全部对话") }); rememberConversationView(); break;
    case 'back': {
      conversationState.current.pane = 'list'; conversationState.current.locateSelection = conversationState.current.selected; renderConversationBrowser();
      const selected = [...$('#sessionBrowserList').querySelectorAll('[data-conversation-session]')].find(item => item.dataset.conversationSession === conversationState.current.selected);
      (selected || $('#sessionBrowserSearch')).focus({preventScroll:true});
      selected?.scrollIntoView({block:'nearest'});
      break;
    }
  }
});
function resetConversationListFilters() {
  const view = conversationState.current;
  const pickerFocused = $('#sessionScopePicker').contains(document.activeElement);
  const reload = !!(view.environmentFilter || view.directory || view.archived);
  view.statusFilter = 'all'; view.environmentFilter = ''; view.archived = false; resetConversationListWindow(view); $('#sessionBrowserList').scrollTop = 0;
  $('#sessionBrowserArchived').checked = false;
  $('#sessionScopePicker').open = false;
  if (reload) setConversationDirectory('');
  else renderConversationBrowser();
  if (pickerFocused) $('#sessionScopePicker summary').focus();
}
function setConversationDirectory(directory) {
  if (!conversationState.current) return;
  rememberConversationView(); conversationState.selection++;
  closeSessionHistory(false);
  resetConversationListWindow();
  conversationState.current.directory = directory; conversationState.current.selected = undefined; conversationState.current.creating = false; conversationState.current.target = null; conversationState.current.pane = 'list'; conversationState.current.sessions = []; conversationState.current.checkedAt = 0;
  conversationState.current.requestedSession = null;
  // Invalidate the previous request before allowing a different directory query.
  conversationState.current.requestID = (conversationState.current.requestID || 0) + 1;
  conversationState.current.requestKey = null; conversationState.current.loading = false;
  renderConversationBrowser(); refreshConversations(true); showConversationSelection();
}
$('#sessionSearchToggle')?.addEventListener('click', () => {
  syncConversationSearchBar(true);
  $('#sessionBrowserSearch').focus();
});
$('#sessionBrowserSearch').addEventListener('focus', () => syncConversationSearchBar(true));
$('#sessionBrowserSearch').addEventListener('blur', () => {
  if (!$('#sessionBrowserSearch').value.trim()) syncConversationSearchBar(false);
});
$('#sessionBrowserSearch').addEventListener('input', event => { if (conversationState.current) { conversationState.current.search = event.target.value; syncConversationSearchBar(); resetConversationListWindow(); $('#sessionBrowserList').scrollTop = 0; renderConversationList(); } });
$('#sessionsEnvironment').addEventListener('change', event => {
  if (!conversationState.current) return;
  conversationState.current.environmentFilter = event.target.value;
  setConversationDirectory('');
});
$('#sessionScopeSearch').addEventListener('input', renderConversationScopes);
$('#sessionScopePicker').addEventListener('toggle', () => { syncConversationScopePanel(); if ($('#sessionScopePicker').open) { renderConversationScopes(); $('#sessionScopeSearch').focus({preventScroll:true}); } });
window.addEventListener('resize', syncConversationScopePanel);
document.addEventListener('scroll', syncConversationScopePanel, true);
if (typeof ResizeObserver !== 'undefined') {
  const pickerResize = new ResizeObserver(syncConversationScopePanel);
  pickerResize.observe($('#sessionBrowserListPane'));
  window.addEventListener('pagehide', () => pickerResize.disconnect());
}
$('#sessionBrowserNewDirectory').addEventListener('change', event => {
  if (!conversationState.current?.creating || conversationState.current.creatingYoluAssistant) return;
  const directory = conversationCreationDirectories(conversationState.current).find(d => d.key === event.target.value);
  selectConversationCreationDirectory(conversationState.current, directory);
  if (directory?.key) window.WorkHubUI.conversationDefaults.set(conversationDirectoryPreference(conversationState.current), directory.key);
  conversationState.selection++; closeSessionHistory(false); renderConversationBrowser(); showConversationSelection();
  focusConversationCreationInput();
});
document.addEventListener('keydown', event => {
  const itemMenu = document.activeElement?.closest('.session-item-menu[open]');
  if (event.key === 'Escape' && itemMenu) { itemMenu.open = false; itemMenu.querySelector('summary').focus(); event.preventDefault(); event.stopPropagation(); return; }
  if (event.key === 'Escape' && $('#sessionScopePicker').open) { $('#sessionScopePicker').open = false; $('#sessionScopePicker summary').focus(); event.preventDefault(); event.stopPropagation(); return; }
  if (event.key === 'Escape' && event.target.id === 'sessionBrowserSearch') {
    if (conversationState.current?.search) {
      conversationState.current.search = ''; resetConversationListWindow(); event.target.value = ''; $('#sessionBrowserList').scrollTop = 0; renderConversationList();
      syncConversationSearchBar(false);
      if (window.WorkHubPage?.navigationOnly) $('#sessionSearchToggle')?.focus();
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (window.WorkHubPage?.navigationOnly && $('#sessionBrowserScopeBar')?.hasAttribute('data-search-open')) {
      syncConversationSearchBar(false);
      $('#sessionSearchToggle')?.focus();
      event.preventDefault(); event.stopPropagation(); return;
    }
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
  const grouped = window.WorkHubPage?.navigationOnly && conversationListMode === 'grouped';
  const item = event.target.closest(grouped ? '[data-conversation-session], [data-conversation-group-toggle], [data-conversation-group-more], [data-conversation-group-less]' : '[data-conversation-session]');
  const fromSearch = event.target.id === 'sessionBrowserSearch' && event.key === 'ArrowDown';
  if (!item && !fromSearch) return;
  const view = conversationState.current;
  const positions = view?.listRows?.flatMap((row,index) => grouped || row.kind === 'session' ? [index] : []) || [];
  if (!positions.length) return;
  if (fromSearch) {
    focusConversationListIndex(positions.find(index => view.listRows[index].kind === 'session') ?? positions[0]);
    event.preventDefault();
    return;
  }
  const key = item?.dataset.conversationListRow || item?.previousElementSibling?.dataset.conversationListRow;
  const index = positions.findIndex(index => view.listRows[index].key === key);
  const lastLoaded = positions.filter(index => index < view.loadedCount).length - 1;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? lastLoaded : index + ({ArrowDown:1,ArrowUp:-1,PageDown:conversationBatchSize,PageUp:-conversationBatchSize})[event.key];
  focusConversationListIndex(positions[Math.max(0,Math.min(next,positions.length - 1))]); event.preventDefault();
}, true);
document.addEventListener('click', event => { if (!event.target.closest('#sessionScopePicker')) $('#sessionScopePicker').open = false; });
document.addEventListener('click', event => { for (const menu of document.querySelectorAll('.session-item-menu[open]')) if (!menu.contains(event.target)) menu.open = false; });
window.addEventListener('pagehide', suspendConversations);

$('#sessionBrowserArchived').addEventListener('change', event => {
 if (!conversationState.current) return;
 const view=conversationState.current;
 view.requestedSession=null;
 conversationState.selection++;closeSessionHistory(false);
 resetConversationListWindow(view);
 view.archived=event.target.checked;view.selected=undefined;view.sessions=[];view.creating=false;view.checkedAt=0;
 view.requestID=(view.requestID||0)+1;view.requestKey=null;view.loading=false;
 rememberConversationView();renderConversationBrowser();refreshConversations(true);showConversationSelection();
});
window.addEventListener('workhub:session-managed', event => {
  const {session: raw, action, environment} = event.detail;
  const session = conversationTaggedSession(raw, environment);
  conversationState.managed(session, environment, action);
  if (sessionHistoryState?.environment === environment && sessionHistoryState?.session === session.id) window.WorkHubAssistant?.updateSession?.(conversationState.session(environment, session.id));
  updateConversationNavigation();
  const view = conversationState.current;
  if (!view || !conversationVisible()) return;
  if (action === 'fork' && sessionHistoryState?.environment === environment) {
    view.archived = false;
    view.search = ''; view.statusFilter = 'all';
    view.sessions.unshift(session); view.selected = conversationSessionKey(session); view.creating = false; view.pane = 'detail';
    closeSessionHistory(false); showConversationSelection();
  } else if ((action === 'archive' || action === 'restore') && view.selected === conversationSessionKey(session)) {
    view.selected = view.sessions[0] ? conversationSessionKey(view.sessions[0]) : undefined;
    closeSessionHistory(false); showConversationSelection();
  }
  renderConversationBrowser(); rememberConversationView();
});
