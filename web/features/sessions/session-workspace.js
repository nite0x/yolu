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
let conversationTerminals = [], conversationTerminalLoad = null, conversationTerminalsCheckedAt = 0;
const conversationTerminalKey = id => JSON.stringify(['terminal','local',id]);
function conversationTerminalSnapshot(row) {
  return {route:'/terminals',environment:'local',title:row.name,terminal:{id:row.id,workspaceID:row.workspace_id,projectID:row.project_id}};
}
function conversationTerminalItems(view) {
  if (view.archived || view.environmentFilter && view.environmentFilter !== 'local' || conversationScopeEnvironment(view.scope) && conversationScopeEnvironment(view.scope) !== 'local') return [];
  return conversationTerminals.filter(row => row.state === 'running'
    && (view.scope.kind !== 'workspace' || row.workspace_id === view.scope.id)
    && (view.scope.kind !== 'project' || row.project_id === view.scope.id)
    && (view.scope.kind !== 'directory' || conversationPathKey(row.cwd) === conversationPathKey(view.scope.cwd))
    && (!view.directory || conversationEnvironmentKey('local',conversationPathKey(row.cwd)) === view.directory || conversationPathKey(row.cwd) === conversationPathKey(view.directory)))
    .map(row => ({id:row.id,browser_key:conversationTerminalKey(row.id),environment_id:'local',environment_name:environmentName('local'),name:row.name,cwd:row.cwd,updated_at:row.created_at,chat_status:'running',terminal:{workspaceID:row.workspace_id,projectID:row.project_id,attached:row.attached}}));
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
const conversationRequests = window.WorkHubUI.createSessionRequests();
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
    const scope = target.terminal?.workspaceID ? {kind:'workspace',id:target.terminal.workspaceID,environment:'local'} : {kind:'all'};
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
  const workspace = conversationWorkspace(environment);
  const context = session?.cwd ? window.WorkHubUI.conversationContext(session.cwd,{workspaces:workspace.workspaces,projects:workspace.projects}) : null;
  let scope = target.conversation.scope || {kind:'all'};
  if (scope.kind === 'all' && !fallback) {
    if (context?.projectID) scope = {kind:'project',id:context.projectID,environment};
    else if (context?.workspaces.length) scope = {kind:'workspace',id:context.workspaces[0].id,environment};
  } else scope = {...scope,environment:scope.environment || environment};
  const sameScope = conversationScopeKey(scope) === conversationScopeKey(view.scope);
  const filtered = !!(view.search || view.directory || view.environmentFilter || view.archived !== !!session?.archived || view.statusFilter !== 'all');
  if (!sameScope) {
    rememberConversationView(); conversationState.selection++;
    conversationState.current = view = conversationViewFor(scope);
    conversationState.rememberPageScope(activeEnvironment,scope);
  }
  Object.assign(view,{selected,requestedSession:selected,locateSelection:selected,creating:false,pane:'list'});
  // Directory context does not imply an explicit workspace link. If that workspace no
  // longer lists the conversation, try its project and then the environment.
  view.followTarget = scope.kind === 'all' ? null : {...target,conversation:{...target.conversation,session,scope:scope.kind === 'workspace' && context?.projectID ? {kind:'project',id:context.projectID,environment} : {kind:'all',environment}}};
  if (!sameScope || filtered) {
    Object.assign(view,{search:'',directory:'',environmentFilter:'',archived:!!session?.archived,statusFilter:'all',requestID:(view.requestID || 0) + 1,requestKey:null,loading:false,checkedAt:0});
    resetConversationListWindow(view);
    view.locateSelection = selected;
  }
  renderConversationBrowser();
  void refreshSessionWorkspace(false);
  rememberConversationView();
}
function conversationEnvironments() {
  const entries = [...workspaceInventory.environments, ...(typeof environmentInventory === 'undefined' ? [] : environmentInventory)];
  return [...new Map([{id: 'local', name: environmentName('local')}, ...entries].map(e => [e.id, e])).values()];
}
function conversationWorkspace(environment) {
  return environment === activeEnvironment ? state : conversationState.workspace(environment) || {projects: [], workspaces: []};
}
function conversationScopeEnvironment(scope) {
  if (scope.environment) return scope.environment;
  if (scope.kind === 'workspace') return (workspaceInventory.loaded ? workspaceInventory.workspaces : state.workspaces).find(t => t.id === scope.id)?.environment_id || activeEnvironment;
  return scope.kind === 'all' ? '' : activeEnvironment;
}
function conversationTaggedSession(session, environment) {
  return {...session, environment_id: environment, environment_name: environmentName(environment), browser_key: conversationEnvironmentKey(environment, session.id)};
}
function conversationListedSessions(result, environment) {
  return (Array.isArray(result.sessions) ? result.sessions : []).map(session => {
    const tagged = conversationTaggedSession(session, environment);
    if (result.workspace_sessions) {
      const workspaces = result.workspace_sessions[session.id];
      tagged.workspace_ids = Array.isArray(workspaces) ? workspaces : [];
    }
    return tagged;
  });
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
function navigatorWorkspaces(includeArchived = false) {
  const workspaces = workspaceInventory.loaded ? workspaceInventory.workspaces : state.workspaces;
  return workspaces.filter(workspace => includeArchived || workspace.state !== 'archived');
}
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
  let environment = conversationScopeEnvironment(scope);
  const add = (cwd, label, target, disabled = false) => {
    if (!cwd) return;
    const key = conversationEnvironmentKey(environment, conversationPathKey(cwd));
    const existing = result.find(d => d.key === key);
    if (!existing) result.push({ cwd, key, environment, label: label + ' · ' + environmentName(environment), target, disabled });
    else if (existing.disabled && !disabled) Object.assign(existing, { target, disabled });
  };
  const workspaceDirs = workspace => {
    if (workspace.has_directory !== false) add(workspace.path, uiText("工作区目录（包含其中的 Worktree）· ") + workspace.name, { workspace_id: workspace.id, cwd: workspace.path }, workspace.state === 'archived');
    for (const m of workspace.members) add(m.path, m.project_name, { workspace_id: workspace.id, project_id: m.project_id, cwd: m.path }, workspace.state === 'archived' || m.state !== 'ready' || !canOpenMember(m));
  };
  const projectDirs = project => {
    for (const tree of project.worktrees || []) add(tree.path, project.name + ' · ' + (tree.branch || 'detached HEAD'), { project_id: project.id, cwd: tree.path }, !!(project.error || tree.bare || tree.missing || tree.prunable || tree.error));
    if (!(project.worktrees || []).some(t => conversationPathKey(t.path) === conversationPathKey(project.path))) add(project.path, project.name, { project_id: project.id, cwd: project.path }, true);
  };
  const overview = conversationWorkspace(environment);
  if (environmentFilter && environment && environment !== environmentFilter) return [];
  if (scope.kind === 'workspace') {
    const workspace = overview.workspaces.find(q => q.id === scope.id) || workspaceInventory.workspaces.find(q => q.id === scope.id && (q.environment_id || 'local') === environment);
    if (workspace) workspaceDirs(workspace);
    for (const session of conversationState.current?.scope.id === scope.id ? conversationState.current.sessions : []) add(session.cwd, session.cwd, null, true);
  } else if (scope.kind === 'project') {
    const project = overview.projects.find(p => p.id === scope.id);
    if (project) projectDirs(project);
  } else {
    for (const entry of conversationEnvironments()) {
      if (environmentFilter && entry.id !== environmentFilter || scope.environment && entry.id !== scope.environment) continue;
      environment = entry.id;
      const data = conversationWorkspace(environment);
      data.projects.forEach(projectDirs);
      const workspaces = workspaceInventory.loaded ? workspaceInventory.workspaces.filter(q => (q.environment_id || 'local') === environment) : data.workspaces;
      workspaces.forEach(workspaceDirs);
      for (const session of conversationItems(environment)) add(session.cwd, session.cwd, null, true);
    }
    if (scope.kind === 'directory') {
      const matching = result.filter(d => conversationPathKey(d.cwd) === conversationPathKey(scope.cwd));
      return matching.length ? matching : [{ cwd: scope.cwd, key: conversationEnvironmentKey(scope.environment, conversationPathKey(scope.cwd)), environment: scope.environment, label: scope.cwd, target: null, disabled: true }];
    }
  }
  return result;
}
function conversationFilteredDirectories(view = conversationState.current) {
  const dirs = conversationDirectories(view.scope);
  return view.directory ? dirs.filter(d => d.key === view.directory) : dirs;
}
function conversationScopeName(scope) {
  if (scope.kind === 'all') return uiText("全部对话");
  const data = conversationWorkspace(conversationScopeEnvironment(scope));
  if (scope.kind === 'workspace') return uiText("工作区 · ") + (data.workspaces.find(q => q.id === scope.id)?.name || scope.name || scope.id);
  if (scope.kind === 'project') return uiText("项目 · ") + (data.projects.find(p => p.id === scope.id)?.name || scope.name || scope.id);
  return uiText("目录 · ") + scope.cwd;
}
function renderConversationScopes() {
  const workspaces = workspaceInventory.loaded ? workspaceInventory.workspaces : state.workspaces;
  const showEnvironments = conversationEnvironments().length > 1;
  const scopes = [
    {kind:'all', name:uiText("全部对话")},
    ...workspaces.map(q => ({kind:'workspace', id:q.id, environment:q.environment_id || activeEnvironment, name:q.name, environmentName:showEnvironments ? environmentName(q.environment_id || activeEnvironment) : ''})),
    ...conversationEnvironments().flatMap(e => conversationWorkspace(e.id).projects.map(p => ({kind:'project', id:p.id, environment:e.id, name:p.name, environmentName:showEnvironments ? environmentName(e.id) : ''}))),
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
function focusConversationListIndex(index) { conversationList.focus(conversationState.current, index); }
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
  const text = view.search.trim().toLowerCase();
  const matching = items.map(s => { const data = conversationWorkspace(s.environment_id || activeEnvironment); return {...(s.terminal ? s : sessionWithUnread(s)), context: window.WorkHubUI.conversationContext(s.cwd, {workspaces: data.workspaces, projects: data.projects}, view.scope.kind === 'workspace' ? view.scope.id : undefined)}; }).filter(s => !text || [s.name, s.terminal ? uiText("终端") : '', s.cwd, s.environment_name, s.context.project, s.context.branch, ...s.context.workspaces.map(t => t.name)].join(' ').toLowerCase().includes(text));
  const statusFilter = view.statusFilter || 'all';
  const sessions = matching.filter(s => conversationStatusMatches(s, statusFilter)).sort((a,b) => Number(!!b.pinned)-Number(!!a.pinned) || (b.updated_at||0)-(a.updated_at||0));
  view.listItems = sessions;
  view.listRows = window.WorkHubUI.conversationTree(sessions, {
    navigator: window.WorkHubPage?.navigationOnly && view.scope.kind === 'all' && !view.archived ? {
      workspaces: navigatorWorkspaces().flatMap(workspace => {
        const environment = workspace.environment_id || activeEnvironment;
        if (view.environmentFilter && view.environmentFilter !== environment) return [];
        return [{...workspace, environment, environmentName:environmentName(environment), appearance:resourceAppearance(environment, "workspace:" + workspace.id)}];
      }),
      directories: conversationEnvironments().flatMap(entry => {
        if (view.environmentFilter && view.environmentFilter !== entry.id) return [];
        return conversationWorkspace(entry.id).projects.map(project => ({cwd:project.path, key:conversationEnvironmentKey(entry.id, conversationPathKey(project.path)),
          environment:entry.id, environmentName:environmentName(entry.id), name:project.name, projectID:project.id, projectName:project.name, projectRoot:true,
          appearance:resourceAppearance(entry.id, 'project:' + project.id, project.path)}));
      }),
    } : undefined,
    workspaces: navigatorWorkspaces(true).map(workspace => ({...workspace,environment_id:workspace.environment_id || activeEnvironment})), scope: view.scope,
    selected: window.WorkHubPage?.navigationOnly ? window.WorkHubPage.parallelSelected : view.creating ? null : view.selected,
    reveal: view.locateSelection, limits: view.groupLimits, collapsed: view.collapsedGroups,
    filtered: !!text || statusFilter !== 'all' || view.archived,
  });
  if (view.locateSelection) view.collapsedGroups = view.collapsedGroups.filter(key => !view.listRows.some(row => row.kind === 'session' && row.group.key === key && conversationSessionKey(row.session) === view.locateSelection));
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
  $('#sessionActiveFilterLabel').hidden = !filterCount;
  $('#sessionActiveFilterLabel').textContent = filterLabels.join(' · ');
  $('#sessionActiveFilterLabel').title = directoryPath || '';
  const picker = $('#sessionScopePicker');
  picker.toggleAttribute('data-active', !!(directoryPath || filterLabels.length || view.scope.kind !== 'all'));
  picker.querySelector('summary').title = [conversationScopeName(view.scope), directoryPath, ...filterLabels].filter(Boolean).join(' · ');
  const showContext = !view.directory && view.scope.kind !== 'directory' && new Set(items.map(session => conversationPathKey(session.cwd))).size > 1;
  const list = $('#sessionBrowserList');
  list.setAttribute('aria-busy',String(initialLoading || view.loading));
  const rows = view.listRows.slice(start, end);
  const props = { sessions: rows.filter(row => row.kind === 'session').map(row => row.session), rows, parallel:!!window.WorkHubPage?.navigationOnly, parallelSessions:window.WorkHubPage?.parallelSessions || [], parallelFull:!!window.WorkHubPage?.parallelFull, selected: window.WorkHubPage?.navigationOnly ? window.WorkHubPage.parallelSelected : view.creating ? null : view.selected, showDirectory: showContext, showContext, loading: initialLoading, workspaceID: view.scope.kind === 'workspace' ? view.scope.id : undefined, filtered: !!text || !!filterCount || statusFilter !== 'all', error: false, canCreate: !$('#newBrowserSession').disabled };
  const emptyError = !!view.error && !items.length && !view.loading;
  const renderKey = JSON.stringify([new Date().toDateString(), emptyError, props, before, after, loaded, sessions.length]);
  if (conversationListRenderKeys.get(list) !== renderKey) {
    const spacer = (height,side) => height ? `<div class="session-list-spacer" data-list-spacer="${side}" aria-hidden="true"></div>` : '';
    const more = loaded < view.listRows.length ? `<p class="session-list-more" role="status">${uiText("向下滚动加载更多")}</p>` : '';
    const markup = emptyError ? '' : spacer(before,'before') + window.WorkHubUI.conversationList(props) + spacer(after,'after') + more;
    if (list.innerHTML !== markup) {
      const top = list.scrollTop;
      const listTop = list.getBoundingClientRect().top;
      const anchor = [...list.querySelectorAll('[data-conversation-list-row]')].find(el => {const rect = el.getBoundingClientRect(); return rect.bottom > listTop && rect.top < listTop + list.clientHeight;});
      const anchorKey = anchor?.dataset.conversationListRow, anchorTop = anchor?.getBoundingClientRect().top;
      const selected = list.contains(document.activeElement) ? document.activeElement?.dataset.conversationListRow : null;
      const focusedMenu = document.activeElement?.closest('.session-item-menu');
      const focusedMenuID = focusedMenu?.dataset.sessionMenu;
      const focusedUnlink = document.activeElement?.hasAttribute('data-conversation-unlink');
      const expandedMenu = list.querySelector('.session-item-menu[open]')?.dataset.sessionMenu;
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
        const item = row.closest('li, h3') || row;
        const height = item?.getBoundingClientRect().height || 0;
        if (height) view.listHeights.set(row.dataset.conversationListRow, height + (row.hasAttribute('data-conversation-session') ? 2 : 0));
      }
      if (expandedMenu) [...list.querySelectorAll('[data-session-menu]')].find(menu => menu.dataset.sessionMenu === expandedMenu)?.setAttribute('open', '');
      if (selected) [...list.querySelectorAll('[data-conversation-list-row]')].find(b => b.dataset.conversationListRow === selected)?.focus({ preventScroll: true });
      if (focusedMenuID) {
        const menu = [...list.querySelectorAll('[data-session-menu]')].find(menu => menu.dataset.sessionMenu === focusedMenuID);
        menu?.querySelector(focusedUnlink ? '[data-conversation-unlink]' : 'summary')?.focus({preventScroll:true});
      }
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
function renderConversationBrowser() {
  const view = conversationState.current;
  if (!view) return;
  // The host owns the only list; a conversation surface always renders its detail.
  if (document.documentElement.hasAttribute('data-workspace-conversation')) view.pane = 'detail';
  const panelWorkspace = conversationWorkspace(sessionHistoryState?.environment || activeEnvironment);
  window.WorkHubAssistant?.updateOverview?.({workspaces: panelWorkspace.workspaces, projects: panelWorkspace.projects});
  conversationHost.hidden = conversationState.mode === 'hidden';
  conversationHost.dataset.pane = view.pane;
  $('#sessionScopeLabel').textContent = conversationScopeName(view.scope);
  $('#sessionBrowserContext').textContent = conversationScopeName(view.scope) + ' · ' + (view.environmentFilter || conversationScopeEnvironment(view.scope) ? environmentName(view.environmentFilter || conversationScopeEnvironment(view.scope)) : uiText("全部环境"));
  $('#sessionsEnvironment').value = view.environmentFilter;
  $('#sessionEnvironmentField').hidden = conversationEnvironments().length < 2 || !!conversationScopeEnvironment(view.scope);
  $('#sessionScopeAll').hidden = view.scope.kind === 'all';
  $('#workspaceConversationTools').hidden = view.scope.kind !== 'workspace';
  $('#linkWorkspaceConversation').dataset.workspace = view.scope.kind === 'workspace' ? view.scope.id : '';
  $('#linkWorkspaceConversation').dataset.environment = conversationScopeEnvironment(view.scope);
  $('#sessionBrowserSearch').value = view.search;
  $('#sessionBrowserArchived').checked = !!view.archived;
  const available = conversationFilteredDirectories().filter(d => !d.disabled && d.target);
  const creationDirectories = view.creating ? conversationDirectories(view.scope, view.environmentFilter).filter(d => !d.disabled && d.target) : available;
  $('#newBrowserSession').disabled = sessionReadOnly || !available.length;
  $('#newBrowserSession').title = sessionReadOnly ? uiText("当前为只读模式，请在终端新建对话") : !available.length ? uiText("当前范围没有可用于新建对话的工作目录") : uiText("在当前栏新建对话");
  updateConversationCreationActions();
  $('#conversationCreationKind').hidden = !view.creating || !window.WorkHubPage || window.WorkHubPage.navigationOnly;
  const terminalKind = $('[data-conversation-kind="terminal"]');
  terminalKind.disabled = (view.targetEnvironment || conversationScopeEnvironment(view.scope) || activeEnvironment) !== 'local' || !!sessionHistoryState?.submitting;
  terminalKind.title = terminalKind.disabled ? uiText("终端目前仅支持本机环境，且需等待当前操作完成") : uiText("在当前栏切换为终端");
  $('#sessionBrowserNewDirectoryField').hidden = !view.creating || creationDirectories.length < 2;
  if (view.creating) {
    $('#sessionBrowserNewDirectory').innerHTML = creationDirectories.map(d => `<option value="${esc(d.key)}" title="${esc(d.cwd)}">${esc(d.target.workspace_id && !d.target.project_id ? uiText("工作区根目录") : d.label)}</option>`).join('');
    $('#sessionBrowserNewDirectory').value = view.target ? conversationEnvironmentKey(view.targetEnvironment, conversationPathKey(view.target.cwd)) : '';
    $('#sessionBrowserNewDirectory').title = view.target?.cwd || '';
    window.WorkHubUI.renderCreationChoices($('#sessionBrowserNewDirectory'), $('#sessionBrowserDirectoryChoices'));
  }
  const extraField = $('#sessionBrowserAdditionalField');
  const extraDirs = view.creating && view.target?.workspace_id ? creationDirectories.filter(d => d.environment === view.targetEnvironment && d.target?.project_id && d.cwd !== view.target.cwd) : [];
  extraField.hidden = !extraDirs.length;
  if (extraDirs.length) {
    $('#sessionBrowserAdditionalCount').textContent = uiText(" · {0} 个已选", view.target.additional_directories?.length || 0);
    const markup = extraDirs.map(d => `<label class="workspace-additional-directory"><input type="checkbox" data-additional-directory="${esc(d.cwd)}" ${view.target.additional_directories?.includes(d.cwd) ? 'checked' : ''} />${esc(d.label)}<small>${esc(d.cwd)}</small></label>`).join('');
    if ($('#sessionBrowserAdditionalDirectories').innerHTML !== markup) $('#sessionBrowserAdditionalDirectories').innerHTML = markup;
  }
  renderConversationList();
  syncConversationScopePanel();
}
async function refreshSessionWorkspace(force = false) {
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
  if (view.scope.kind === 'workspace') { params.set('workspace_id', view.scope.id); params.set('linked', 'true'); }
  if (view.scope.kind === 'project') params.set('project_id', view.scope.id);
  const cwd = selectedDirectory?.cwd || directory || (view.scope.kind === 'directory' ? view.scope.cwd : '');
  if (cwd) params.set('cwd', cwd);
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
      conversationState.rememberWorkspace(environment, data);
      if (view === conversationState.current && conversationVisible()) renderConversationBrowser();
    }).catch(() => {});
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
  const fileContext = session?.cwd ? window.WorkHubUI.conversationContext(session.cwd, {workspaces: conversationWorkspace(session.environment_id || activeEnvironment).workspaces, projects: conversationWorkspace(session.environment_id || activeEnvironment).projects}) : null;
  conversationFiles.setContext(session?.cwd ? {session: session.id, path: session.cwd, environment: session.environment_id || activeEnvironment, project: fileContext?.projectID, additionalDirectories: session.additional_directories} : undefined);
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
    return;
  }
  $('#sessionBrowserEmpty').hidden = true;
  const selection = ++conversationState.selection;
  const tools = conversationHost.querySelector('.session-browser-list-tools');
  const focusedControl = tools.contains(document.activeElement) ? document.activeElement : null;
  openSessionHistoryPanel(view.scope.kind === 'workspace' ? view.scope.id : null, session?.id || null, {
    session, environment, overview: conversationWorkspace(environment), target: view.target, browserTarget: targetKey, focusComposer:!!view.focusComposer,
    loaded(loaded) {
      if (conversationState.current !== view || selection !== conversationState.selection || loaded.id !== session?.id) return;
      const activity = conversationState.session(environment, loaded.id);
      const tagged = conversationTaggedSession({...loaded, workspace_ids:activity?.workspace_ids ?? session?.workspace_ids, chat_status:activity?.chat_status ?? loaded.chat_status, completed_run:activity?.completed_run ?? loaded.completed_run},environment);
      view.directSession = tagged;
      conversationState.record(environment, [tagged]);
      const position = view.sessions.findIndex(item => conversationSessionKey(item) === conversationSessionKey(tagged));
      if (position >= 0) view.sessions[position] = tagged;
      showConversationSelection();
      window.dispatchEvent(new CustomEvent('workhub:session-loaded'));
    },
    created(created) {
      conversationRequests.invalidate(environment);
      created = conversationTaggedSession({...created,workspace_ids:created.workspace_ids || (view.target?.workspace_id ? [view.target.workspace_id] : [])}, environment);
      conversationState.record(environment, [created]);
      if (!view.sessions.some(s => conversationSessionKey(s) === conversationSessionKey(created))) view.sessions.unshift(created);
      if (conversationState.current !== view || selection !== conversationState.selection) return;
      if (view.creationDirectory) window.WorkHubUI.conversationDefaults.set(conversationDirectoryPreference(view), view.creationDirectory);
      view.selected = conversationSessionKey(created); view.creating = false; view.target = null; view.search = ''; view.statusFilter = 'all'; resetConversationListWindow(view);
      renderConversationBrowser(); rememberConversationView();
    }
  });
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
  renderConversationBrowser(); refreshSessionWorkspace(true); showConversationSelection();
  $('#sessionBrowserList').scrollTop = conversationState.current.scrollTop;
}
function openConversationWorkspace(scope, session) {
  if (state.busy) return;
  window.dispatchEvent(new CustomEvent('workhub:chat-layout', {detail:{phase:'before'}}));
  conversationState.mode = 'page';
  selectConversationScope(scope);
  if (session) {
    const environment = conversationScopeEnvironment(conversationState.current.scope) || activeEnvironment;
    const cached = conversationItems(environment).find(s => s.id === session) || workspaceSessions.get(scope.id)?.sessions.find(s => s.id === session);
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
async function openConversationWorkspaceDetail(kind, id, environment) {
  if (state.busy || !['workspace', 'project'].includes(kind)) return;
  try {
    await selectEnvironment(environment, (kind === 'workspace' ? '/workspaces/' : '/projects/') + id);
    if (activeEnvironment === environment) focusResourcePage();
  } catch (error) { toast(error.message, true); }
}
function closeConversationWorkspace() {
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
function suspendSessionWorkspace() {
  for (const environment of conversationEnvironments()) conversationRequests.invalidate(environment.id);
  if (state.loaded) conversationState.rememberWorkspace(activeEnvironment, {...state});
  closeConversationWorkspace();
  conversationState.suspend();
  updateConversationNavigation();
}
function syncSessionWorkspace() {
  if (window.WorkHubPage?.restoring) return;
  if (conversationState.current && conversationState.current.environment !== activeEnvironment) suspendSessionWorkspace();
  if (state.view === 'sessions') {
    if (conversationState.mode !== 'page') {
      conversationState.mode = 'page';
      selectConversationScope(conversationState.pageScope(activeEnvironment) || { kind: 'all', name: uiText("全部对话") });
    }
    renderConversationBrowser();
    refreshSessionWorkspace(false);
  } else if (conversationState.mode === 'page') closeConversationWorkspace();
  updateConversationNavigation();
  refreshConversationCatalog();
}
function openSessionWorkspaceHistory(workspace, session) {
  openConversationWorkspace(workspace ? { kind: 'workspace', id: workspace } : { kind: 'all', name: uiText("全部对话") }, session);
  if (!session && !sessionReadOnly) startBrowserConversation();
}
function updateConversationCreationActions() {
  const primary = $('#newBrowserSession');
  const split = $('#newBrowserSplitSession');
  split.disabled = primary.disabled || !window.WorkHubPage?.canSplit;
  split.title = primary.disabled ? primary.title : !window.WorkHubPage?.canSplit ? uiText("最多支持三栏，请先打开对话并留出空栏") : uiText("在右侧分栏新建");
}
function startBrowserConversation(focus = true) {
  const view = conversationState.current;
  const dirs = conversationFilteredDirectories().filter(d => !d.disabled && d.target);
  if (sessionReadOnly || !dirs.length) return;
  const directory = defaultConversationDirectory(view, dirs);
  view.creating = true; view.selected = null; view.pane = 'detail';
  view.target = browserCreationTarget(directory);
  view.targetEnvironment = directory.environment;
  view.creationDirectory = directory.key;
  view.focusComposer = focus;
  conversationState.selection++;
  closeSessionHistory(false);
  renderConversationBrowser(); showConversationSelection();
  if (focus) ($('#assistantChatRoot textarea') || $('#sessionChatInput'))?.focus();
}
function conversationDirectoryPreference(view) {
  return 'directory:' + JSON.stringify([view.environment, view.scope.kind, view.scope.id || view.scope.cwd || '', conversationScopeEnvironment(view.scope)]);
}
function defaultConversationDirectory(view, dirs) {
  const selected = conversationSelectedSession(view);
  const selectedKey = selected?.cwd ? conversationEnvironmentKey(selected.environment_id || view.environment, conversationPathKey(selected.cwd)) : '';
  const preferred = [view.creating ? view.creationDirectory : '', selectedKey, view.creationDirectory, window.WorkHubUI.conversationDefaults.get(conversationDirectoryPreference(view))];
  for (const key of preferred) {
    const directory = dirs.find(d => d.key === key);
    if (directory) return directory;
  }
  return dirs.find(d => d.environment === view.environment) || dirs[0];
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
document.addEventListener('click', event => {
  const entry = event.target.closest('[data-action="workspace-conversations"], [data-action="project-conversations"]');
  if (entry) return openConversationWorkspace({ kind: entry.dataset.action === 'workspace-conversations' ? 'workspace' : 'project', id: entry.dataset.id });
  const groupControl = event.target.closest('[data-conversation-group-toggle], [data-conversation-group-more]');
  if (groupControl && conversationState.current) {
    const view = conversationState.current;
    const key = groupControl.dataset.conversationGroupToggle || groupControl.dataset.conversationGroupMore;
    const index = view.listRows.findIndex(row => row.key === groupControl.dataset.conversationListRow);
    if (groupControl.hasAttribute('data-conversation-group-toggle')) {
      view.collapsedGroups = view.collapsedGroups.includes(key) ? view.collapsedGroups.filter(value => value !== key) : [...view.collapsedGroups,key];
      view.locateSelection = null;
    } else view.groupLimits[key] = (view.groupLimits[key] || 3) + conversationBatchSize;
    renderConversationList();
    const targetIndex = groupControl.hasAttribute('data-conversation-group-toggle') ? view.listRows.findIndex(row => row.kind === 'group' && row.group.key === key) : index;
    focusConversationListIndex(targetIndex);
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
    case 'new': startBrowserConversation(); break;
    case 'link-workspace': $('#linkWorkspaceConversation').click(); break;
    case 'refresh': refreshSessionWorkspace(true); break;
    case 'clear-search':
      conversationState.current.search = ''; resetConversationListWindow(); $('#sessionBrowserSearch').value = ''; $('#sessionBrowserList').scrollTop = 0;
      renderConversationList(); $('#sessionBrowserSearch').focus(); break;
    case 'reset-list':
      conversationState.current.search = ''; $('#sessionBrowserSearch').value = '';
      resetConversationListFilters(); $('#sessionBrowserSearch').focus(); break;
    case 'clear-filters':
      resetConversationListFilters(); break;
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
  renderConversationBrowser(); refreshSessionWorkspace(true); showConversationSelection();
}
$('#sessionBrowserSearch').addEventListener('input', event => { if (conversationState.current) { conversationState.current.search = event.target.value; resetConversationListWindow(); $('#sessionBrowserList').scrollTop = 0; renderConversationList(); } });
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
  if (!conversationState.current?.creating) return;
  const directory = conversationDirectories(conversationState.current.scope, conversationState.current.environmentFilter).find(d => d.key === event.target.value && !d.disabled && d.target);
  conversationState.current.target = directory ? browserCreationTarget(directory) : null;
  conversationState.current.targetEnvironment = directory?.environment;
  conversationState.current.creationDirectory = directory?.key || '';
  if (directory) window.WorkHubUI.conversationDefaults.set(conversationDirectoryPreference(conversationState.current), directory.key);
  conversationState.selection++; closeSessionHistory(false); renderConversationBrowser(); showConversationSelection();
});
document.addEventListener('keydown', event => {
  const itemMenu = document.activeElement?.closest('.session-item-menu[open]');
  if (event.key === 'Escape' && itemMenu) { itemMenu.open = false; itemMenu.querySelector('summary').focus(); event.preventDefault(); event.stopPropagation(); return; }
  if (event.key === 'Escape' && $('#sessionScopePicker').open) { $('#sessionScopePicker').open = false; $('#sessionScopePicker summary').focus(); event.preventDefault(); event.stopPropagation(); return; }
  if (event.key === 'Escape' && event.target.id === 'sessionBrowserSearch' && conversationState.current?.search) {
    conversationState.current.search = ''; resetConversationListWindow(); event.target.value = ''; $('#sessionBrowserList').scrollTop = 0; renderConversationList(); event.preventDefault(); event.stopPropagation(); return;
  }
  const item = event.target.closest('[data-conversation-session]');
  if (!item && !(event.target.id === 'sessionBrowserSearch' && event.key === 'ArrowDown')) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
  const view = conversationState.current;
  const positions = view.listRows.map((row,index) => row.kind === 'session' ? index : -1).filter(index => index >= 0);
  if (!positions.length) return;
  const index = positions.findIndex(index => view.listRows[index].key === item?.dataset.conversationListRow);
  const lastLoaded = positions.filter(index => index < view.loadedCount).length - 1;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? lastLoaded : index + ({ArrowDown:1,ArrowUp:-1,PageDown:conversationBatchSize,PageUp:-conversationBatchSize})[event.key];
  focusConversationListIndex(positions[Math.max(0,Math.min(next,positions.length - 1))]); event.preventDefault();
}, true);
document.addEventListener('click', event => { if (!event.target.closest('#sessionScopePicker')) $('#sessionScopePicker').open = false; });
$('#linkWorkspaceConversation').addEventListener('click', () => { $('#sessionScopePicker').open = false; });
document.addEventListener('click', event => { for (const menu of document.querySelectorAll('.session-item-menu[open]')) if (!menu.contains(event.target)) menu.open = false; });
window.addEventListener('pagehide', suspendSessionWorkspace);

$('#sessionBrowserArchived').addEventListener('change', event => {
 if (!conversationState.current) return;
 const view=conversationState.current;
 view.requestedSession=null;
 conversationState.selection++;closeSessionHistory(false);
 resetConversationListWindow(view);
 view.archived=event.target.checked;view.selected=undefined;view.sessions=[];view.creating=false;view.checkedAt=0;
 view.requestID=(view.requestID||0)+1;view.requestKey=null;view.loading=false;
 rememberConversationView();renderConversationBrowser();refreshSessionWorkspace(true);showConversationSelection();
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

function browserCreationTarget(directory) {
  const target = {...directory.target};
  if (target.workspace_id) target.additional_directories = conversationDirectories(conversationState.current.scope).filter(d => d.environment === directory.environment && !d.disabled && d.target?.project_id && conversationPathKey(d.cwd) !== conversationPathKey(target.cwd)).map(d => d.cwd);
  return target;
}
$('#sessionBrowserAdditionalDirectories').addEventListener('change', event => {
  if (!event.target.matches('[data-additional-directory]') || !conversationState.current?.creating || !conversationState.current.target) return;
  conversationState.current.target = {...conversationState.current.target, additional_directories: [...$('#sessionBrowserAdditionalDirectories').querySelectorAll('input:checked')].map(input => input.dataset.additionalDirectory)};
  conversationState.selection++; closeSessionHistory(false); renderConversationBrowser(); showConversationSelection();
});
window.addEventListener('workhub:workspace-sessions', event => {
  const {workspace, environment} = event.detail;
  for (const view of conversationState.views()) {
    const scopedEnvironment = conversationScopeEnvironment(view.scope);
    if (scopedEnvironment && scopedEnvironment !== environment || view.scope.kind === 'workspace' && view.scope.id !== workspace) continue;
    view.checkedAt = 0; view.requestID = (view.requestID || 0) + 1; view.loading = false;
  }
  if (conversationVisible()) refreshSessionWorkspace(true);
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-conversation-unlink]');
  if (!button || state.busy) return;
  const environment = button.dataset.environment || activeEnvironment, workspace = button.dataset.workspace, session = button.dataset.conversationUnlink;
  mutation(uiText("正在取消对话关联"), async () => {
    const result = await api(`/api/workspaces/${encodeURIComponent(workspace)}/sessions/${encodeURIComponent(session)}`, {environment, method: 'DELETE'});
    window.dispatchEvent(new CustomEvent('workhub:workspace-sessions', {detail:{workspace, environment}}));
    toast(result.message);
  });
});
