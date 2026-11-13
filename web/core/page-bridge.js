'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


// Independent conversation readers retain their controllers and drafts.
// Page navigation is owned by the workspace document.
(() => {
  if (!window.parent || window.parent === window) return;
  const host = window.parent;
  let active = false, restoring = true, timer, disposed = false, parallelPane = false, navigationOnly = new URLSearchParams(location.search).has('workspace-navigation');
  let restoreRevision = 0;
  let creationHint = {};
  let parallelSessions = [], parallelFull = false, parallelSelected = '', groupSignature = '', canSplit = false;
  let autoSelect = false;
  function selectInitialConversation() {
    if (!navigationOnly || !autoSelect || !window.WorkHubConversations.current?.listItems?.length || restoring || !active) return;
    const session = window.WorkHubConversations.current.listItems.find(item => !item.terminal);
    if (!session) return;
    const current = snapshot();
    autoSelect = false;
    post('workhub:conversation-select',{initial:true,snapshot:{...current,title:session.name || uiText("对话"),conversation:{...current.conversation,selected:conversationSessionKey(session),session,pane:'detail'}}});
  }
  window.addEventListener('workhub:conversation-list-ready',selectInitialConversation);
  if (navigationOnly) document.documentElement.setAttribute('data-workspace-navigation','');
  document.documentElement.setAttribute('data-workspace-page', '');
  const post = (type, detail = {}) => host.postMessage({type, ...detail}, location.origin);
  let chromeSignature = '';
  function publishChrome() {
    if (!active || disposed) return;
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const box = sidebar.getBoundingClientRect();
    const compact = window.innerWidth <= 760 && !navigationOnly;
    if (navigationOnly) document.documentElement.style.setProperty('--workspace-navigation-left',Math.round(box.right) + 'px');
    const chrome = {left:compact ? 0 : Math.round(box.right), top:compact ? Math.round(box.bottom) : 0};
    const signature = JSON.stringify(chrome);
    if (signature !== chromeSignature) {chromeSignature = signature; post('workhub:page-chrome', {chrome});}
  }
  function snapshot() {
    const route = location.hash.slice(1) || '/requirements';
    const view = state.view === 'sessions' ? window.WorkHubConversations.current : null;
    const session = view ? conversationSelectedSession(view) : null;
    const project = state.projects.find(item => item.id === state.selectedProject);
    const task = state.requirements.find(item => item.id === state.selectedRequirement);
    const title = view ? view.creating ? uiText("新建对话") : session?.name || conversationScopeName(view.scope) : state.view === 'projects' && projectDetailOpen ? project?.name || uiText("项目") : state.view === 'settings' ? uiText("设置") : state.view === 'projects' ? uiText("项目") : task?.name || uiText("任务");
    return {
      route, environment: activeEnvironment, title, kind: state.view,
      terminal:view?.creating ? creationHint : undefined,
      context: view ? (() => {
        const environment = session?.environment_id || activeEnvironment;
        const workspace = conversationWorkspace(environment);
        const context = session ? window.WorkHubUI.conversationContext(session.cwd, {tasks:workspace.requirements,projects:workspace.projects}, view.scope.kind === 'task' ? view.scope.id : undefined) : null;
        return (context?.tasks.map(task => task.name).join('、') || conversationScopeName(view.scope)) + ' · ' + environmentName(environment);
      })() : '',
      status:session?.chat_status || '',
      conversation: view ? {scope:view.scope, creating:!!view.creating, creationDirectory:view.creating ? view.creationDirectory : session?.cwd ? conversationEnvironmentKey(session.environment_id || activeEnvironment,conversationPathKey(session.cwd)) : undefined, selected:view.creating ? null : view.selected, session:session ? {id:session.id,name:session.name,cwd:session.cwd,additional_directories:session.additional_directories,archived:session.archived,available:session.available} : undefined, search:view.search, directory:view.directory, statusFilter:view.statusFilter, environmentFilter:view.environmentFilter, archived:view.archived, pane:view.pane, loadedCount:view.loadedCount, windowStart:view.windowStart, scrollTop:$('#sessionBrowserList').scrollTop} : null,
    };
  }
  function publish() {
    if (!restoring && !disposed && !navigationOnly) post('workhub:page-state', {snapshot:snapshot()});
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(publish, 100); }
  function pane(split, shared = split) {
    parallelPane = split;
    const root = document.documentElement;
    if (root.hasAttribute('data-workspace-pane') === split && root.hasAttribute('data-workspace-conversation') === shared) return;
    window.dispatchEvent(new CustomEvent('workhub:chat-layout', {detail:{phase:'before'}}));
    root.toggleAttribute('data-workspace-pane', split);
    root.toggleAttribute('data-workspace-conversation', shared);
    if (window.WorkHubConversations.current && !navigationOnly) {
      if (shared) window.WorkHubConversations.current.pane = 'detail';
      renderConversationBrowser();
      if (!restoring) {
        void refreshSessionWorkspace(false);
        if (active) showConversationSelection();
      }
    }
    chromeSignature = ''; publishChrome();
    window.dispatchEvent(new CustomEvent('workhub:chat-layout', {detail:{visible:active}}));
  }
  window.addEventListener('workhub:route-read',() => {
    if (restoring || disposed) return;
    // Apply route geometry before render() exposes the page, rather than
    // waiting for the debounced title/selection notification after data loads.
    if (!parallelPane) pane(false,state.view === 'sessions' && window.innerWidth > 760);
    publish();
  });
  function visibility(visible) {
    const changed = active !== visible;
    if (!visible) window.dispatchEvent(new CustomEvent('workhub:chat-layout', {detail:{phase:'before'}}));
    active = visible;
    document.documentElement.toggleAttribute('data-workspace-inactive', !active);
    if (changed) window.dispatchEvent(new CustomEvent('workhub:page-visibility', {detail:{visible:active}}));
    if (active) {
      chromeSignature = ''; publishChrome(); requestAnimationFrame(publishChrome);
      window.dispatchEvent(new CustomEvent('workhub:chat-layout', {detail:{visible:true}}));
      if (!restoring) { refresh(); if (window.WorkHubConversations.current && conversationVisible()) showConversationSelection(); }
    }
  }
  async function restore(saved) {
    const revision = ++restoreRevision;
    restoring = true;
    try {
      await selectEnvironment(saved.environment || 'local', saved.route || '/requirements', 'replace', {refreshState:false});
      if (disposed || revision !== restoreRevision) return;
      if (state.view === 'sessions') {
        creationHint = {...saved.terminal};
        const savedView = saved.conversation?.scope ? saved.conversation : {scope:{kind:'all'},pane:'list'};
        rememberConversationView(); closeSessionHistory(false);
        window.WorkHubConversations.current = conversationViewFor(savedView.scope);
        Object.assign(window.WorkHubConversations.current, {
          search:savedView.search || '', directory:savedView.directory || '', creationDirectory:savedView.creationDirectory || '',
          loadedCount:Number.isSafeInteger(savedView.loadedCount) && savedView.loadedCount >= 20 ? savedView.loadedCount : 20,
          windowStart:Number.isSafeInteger(savedView.windowStart) && savedView.windowStart >= 0 ? savedView.windowStart : 0, locateSelection:null,
          statusFilter:savedView.statusFilter || 'all', environmentFilter:savedView.environmentFilter || '',
          archived:!!savedView.archived, selected:savedView.selected, requestedSession:savedView.selected || null,
          pane:document.documentElement.hasAttribute('data-workspace-conversation') ? 'detail' : savedView.pane || 'detail', creating:!!savedView.creating && !sessionReadOnly && !navigationOnly, target:null,
          requestID:(window.WorkHubConversations.current.requestID || 0) + 1, requestKey:null, loading:false, checkedAt:0,
        });
        window.WorkHubConversations.mode = 'page';
        restoreConversationSelection(savedView, saved.title);
        window.WorkHubConversations.rememberPageScope(activeEnvironment, savedView.scope);
        restoring = false;
        renderConversationBrowser();
        if (savedView.creating && !sessionReadOnly && !navigationOnly) {
          const view = window.WorkHubConversations.current;
          void refresh().then(() => {
            if (!disposed && revision === restoreRevision && view === window.WorkHubConversations.current && view.creating) startBrowserConversation(active && (!parallelPane || document.documentElement.hasAttribute('data-workspace-focused')));
          });
        }
        else showConversationSelection();
        // A known conversation opens directly; its list and workspace metadata
        // are independent background reads, rather than prerequisites.
        void refreshSessionWorkspace(false);
        $('#sessionBrowserList').scrollTop = savedView.scrollTop || 0;
      }
    } catch (error) { if (!disposed) toast(uiText("页面加载失败：") + error.message, true); }
    finally {
      if (!disposed && revision === restoreRevision) {
        restoring = false;
        document.documentElement.removeAttribute('data-workspace-initial-route');
        performance.mark?.('workhub:selection-ready');
        visibility(active); publish();
        post('workhub:page-restored');
        selectInitialConversation();
      }
    }
  }
  function destination(target) {
    const current = snapshot();
    const terminalButton = target.closest('[data-conversation-terminal]');
    if (terminalButton) {
      const row = conversationTerminals.find(row => row.id === terminalButton.dataset.conversationTerminal);
      return row ? conversationTerminalSnapshot(row) : null;
    }
    const sessionButton = target.closest('[data-conversation-session], [data-conversation-parallel]');
    if (sessionButton && window.WorkHubConversations.current) {
      const key = sessionButton.dataset.conversationSession || sessionButton.dataset.conversationParallel;
      const session = window.WorkHubConversations.current.sessions.find(item => conversationSessionKey(item) === key);
      return {...current, title:session?.name || uiText("对话"), conversation:{...current.conversation, selected:key, pane:'detail'}};
    }
    const sessionAction = target.closest('[data-session-action="details"]');
    if (sessionAction) return {...current, route:'/sessions', title:uiText("对话"), conversation:{scope:sessionAction.dataset.requirement ? {kind:'task', id:sessionAction.dataset.requirement, environment:activeEnvironment} : {kind:'all'}, selected:conversationEnvironmentKey(activeEnvironment,sessionAction.dataset.session), pane:'detail'}};
    const taskButton = target.closest('[data-action="open-requirement"], [data-action="jump-requirement"]');
    if (taskButton) return {route:'/requirements/' + taskButton.dataset.id, environment:taskButton.dataset.environment || activeEnvironment, title:taskButton.textContent.trim()};
    const projectButton = target.closest('[data-action="select-project"]');
    if (projectButton) return {route:'/projects/' + projectButton.dataset.id, environment:activeEnvironment, title:state.projects.find(p => p.id === projectButton.dataset.id)?.name || uiText("项目")};
    const taskShortcut = target.closest('[data-task-shortcut]');
    if (taskShortcut) {
      const task = shortcutTasks().find(item => shortcutTaskKey(item) === taskShortcut.dataset.taskShortcut);
      if (task) return {route:'/sessions', environment:activeEnvironment, title:task.name, conversation:{scope:{kind:'task',id:task.id,environment:task.environment_id || activeEnvironment},pane:'detail'}};
    }
    const directoryShortcut = target.closest('[data-directory-shortcut]');
    if (directoryShortcut) {
      const directory = shortcutDirectories().find(item => item.key === directoryShortcut.dataset.directoryShortcut);
      if (directory) return {route:'/sessions', environment:activeEnvironment, title:directory.name, conversation:{scope:{kind:'directory',cwd:directory.cwd,environment:directory.environment},pane:'detail'}};
    }
    const conversations = target.closest('[data-action="task-conversations"], [data-action="project-conversations"]');
    if (conversations) return {route:'/sessions',environment:activeEnvironment, title:uiText("对话"),conversation:{scope:{kind:conversations.dataset.action === 'task-conversations' ? 'task' : 'project', id:conversations.dataset.id, environment:activeEnvironment},pane:'detail'}};
    const nav = target.closest('[data-view]');
    if (nav) return {route:'/' + nav.dataset.view, environment:activeEnvironment};
    const link = target.closest('a[href^="#/"]');
    if (link) return {route:link.getAttribute('href').slice(1),environment:activeEnvironment};
    return null;
  }
  const open = saved => post('workhub:page-open', {snapshot:saved});
  document.addEventListener('click', event => {
    const terminalButton = event.target.closest('[data-conversation-terminal]');
    if (terminalButton && !terminalButton.disabled && event.button === 0 && !(event.metaKey || event.ctrlKey)) {
      const saved = destination(event.target);
      if (saved) {event.preventDefault(); event.stopImmediatePropagation(); post('workhub:page-open',{snapshot:saved,placement:terminalButton.dataset.conversationParallel ? 'split' : undefined});}
      return;
    }
    const formKind = event.target.closest('[data-conversation-kind="terminal"]');
    if (formKind && !formKind.disabled && window.WorkHubConversations.current?.creating && !sessionHistoryState?.submitting) {
      event.preventDefault(); event.stopImmediatePropagation();
      const current = snapshot(), target = window.WorkHubConversations.current.target;
      const terminal = {...creationHint,taskID:target ? target.task_id : creationHint.taskID || (window.WorkHubConversations.current.scope.kind === 'task' ? window.WorkHubConversations.current.scope.id : undefined),projectID:target ? target.project_id : creationHint.projectID};
      post('workhub:conversation-kind',{kind:'terminal',snapshot:{...current,terminal,conversation:{...current.conversation,creationDirectory:target ? conversationEnvironmentKey(window.WorkHubConversations.current.targetEnvironment,conversationPathKey(target.cwd)) : current.conversation.creationDirectory}}}); return;
    }
    const projectCreate = event.target.closest('[data-action="workspace-conversation-new"]');
    if (projectCreate && !projectCreate.disabled && event.button === 0) {
      event.preventDefault(); event.stopImmediatePropagation();
      const taskID = state.selectedRequirement || '';
      const projectID = projectCreate.dataset.id || '';
      const path = projectCreate.dataset.path;
      const matches = q => q.members.some(m => m.project_id === projectID && m.path === path);
      const task = state.requirements.find(q => q.id === taskID && matches(q)) || state.requirements.find(matches);
      post('workhub:page-open',{create:true,snapshot:{route:'/sessions',environment:activeEnvironment,title:uiText("新建对话"),terminal:{taskID:task?.id,projectID},conversation:{scope:task ? {kind:'task',id:task.id,environment:activeEnvironment} : {kind:'project',id:projectID,environment:activeEnvironment},directory:path ? conversationEnvironmentKey(activeEnvironment,conversationPathKey(path)) : '',creating:true,selected:null,pane:'detail'}}}); return;
    }
    const create = event.target.closest('[data-conversation-action="new"], [data-session-action="new"]');
    if (create && event.button === 0 && !create.disabled && !state.busy) {
      const taskAction = create.dataset.sessionAction === 'new';
      const task = taskAction ? state.requirements.find(task => task.id === create.dataset.requirement) : null;
      if (taskAction ? !task || task.state !== 'ready' || sessionReadOnly : $('#newBrowserSession').disabled) return;
      const placement = create.dataset.conversationPlacement || 'current';
      if (placement === 'split' && !canSplit) return;
      event.preventDefault(); event.stopImmediatePropagation();
      $('#sessionScopePicker').open = false;
      const selectedSession = !task && window.WorkHubConversations.current ? conversationSelectedSession(window.WorkHubConversations.current) : null;
      const scope = task ? {kind:'task',id:task.id,environment:activeEnvironment} : window.WorkHubConversations.current?.scope || {kind:'all'};
      const directory = !task && window.WorkHubConversations.current ? defaultConversationDirectory(window.WorkHubConversations.current, conversationFilteredDirectories().filter(d => !d.disabled && d.target)) : null;
      post('workhub:page-open',{create:true,placement,snapshot:{route:'/sessions',environment:selectedSession?.environment_id || activeEnvironment,title:uiText("新建对话"),terminal:{taskID:task?.id || directory?.target?.task_id || (scope.kind === 'task' ? scope.id : undefined),projectID:directory?.target?.project_id},conversation:{scope,directory:task ? '' : window.WorkHubConversations.current?.directory || '',creationDirectory:directory?.key || '',environmentFilter:task ? '' : window.WorkHubConversations.current?.environmentFilter || '',selected:null,creating:true,pane:'detail'}}}); return;
    }
    if (event.target.closest('.brand[href="/"]') && !(event.metaKey || event.ctrlKey)) {
      event.preventDefault(); event.stopImmediatePropagation(); open({route:'/requirements',environment:activeEnvironment}); return;
    }
    if (!navigationOnly && !parallelPane && !document.documentElement.hasAttribute('data-workspace-conversation') && event.button === 0 && !(event.metaKey || event.ctrlKey)) {
      const saved = destination(event.target);
      if (saved && (event.target.closest('[data-view]') || saved.route === '/sessions')) {
        // The host switches complete views after their readers and navigation
        // are ready. Do not paint a temporary conversation layout here first.
        event.preventDefault(); event.stopImmediatePropagation(); open(saved); return;
      }
    }
    if (navigationOnly && event.button === 0 && !(event.metaKey || event.ctrlKey)) {
      const saved = destination(event.target);
      if (saved) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (saved.conversation?.selected) post(event.target.closest('[data-conversation-parallel]') ? 'workhub:conversation-add' : 'workhub:conversation-select',{snapshot:saved});
        else if (saved.route === '/sessions' && saved.conversation?.scope) selectConversationScope(saved.conversation.scope);
        else if (saved.route !== '/sessions') open(saved);
        return;
      }
    }
    if ((parallelPane || document.documentElement.hasAttribute('data-workspace-conversation')) && event.button === 0 && !(event.metaKey || event.ctrlKey)) {
      const saved = destination(event.target);
      if (saved) {event.preventDefault(); event.stopImmediatePropagation(); open(saved); return;}
    }
  }, true);
  document.addEventListener('click', schedule);
  document.addEventListener('input', schedule);
  document.addEventListener('change', schedule);
  const focus = event => { if (!disposed && (!restoring || event?.type === 'pointerdown')) post('workhub:page-focus'); };
  document.addEventListener('pointerdown', focus, true);
  document.addEventListener('focusin', focus);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('workhub:workspace-refreshed', schedule);
  window.addEventListener('workhub:session-loaded', schedule);
  window.addEventListener('workhub:parallel-command',event => {if (parallelPane && ['close','zoom'].includes(event.detail)) post('workhub:page-pane-command',{command:event.detail});});
  window.addEventListener('message', event => {
    if (event.source !== host || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.type === 'workhub:terminals-changed') {void refreshConversationTerminals(true);}
    else if (message?.type === 'workhub:conversation-group' && navigationOnly) {
      autoSelect = !!message.autoSelect;
      const sessions = message.split !== false && Array.isArray(message.sessions) ? message.sessions : [];
      const signature = JSON.stringify([sessions,message.selected || '',!!message.full,message.split !== false]);
      const selectionChanged = signature !== groupSignature;
      const focusChanged = (message.selected || '') !== parallelSelected;
      groupSignature = signature;
      parallelSessions = sessions; parallelFull = !!message.full; parallelSelected = message.selected || '';
      canSplit = !!message.canSplit; updateConversationCreationActions();
      document.documentElement.toggleAttribute('data-workspace-single',message.split === false);
      document.documentElement.style.setProperty('--workspace-shared-list-width',Math.max(220,Math.min(520,message.listWidth || 280)) + 'px');
      const listPane = document.getElementById('sessionBrowserListPane');
      if (listPane) {
        const label = (message.split === false ? uiText("当前对话：") : uiText("切换当前栏：")) + (message.targetTitle || uiText("对话"));
        if (listPane.getAttribute('aria-description') !== label) listPane.setAttribute('aria-description',label);
      }
      if (window.WorkHubConversations.current && selectionChanged) {
        if (focusChanged && message.target) followConversationSelection(message.target);
        else {window.WorkHubConversations.current.selected = message.selected; if (focusChanged) window.WorkHubConversations.current.locateSelection = message.selected; renderConversationList();}
      }
      selectInitialConversation();
    }
    else if (message?.type === 'workhub:page-navigation') {navigationOnly = true; document.documentElement.setAttribute('data-workspace-navigation','');}
    else if (message?.type === 'workhub:page-restore') { visibility(!!message.active); void restore(message.snapshot); }
    else if (message?.type === 'workhub:parallel-layout') {
      canSplit = !!message.canSplit; updateConversationCreationActions();
      const root = document.documentElement;
      const attributes = {'data-workspace-focused':!!message.focused,'data-workspace-zoomed':!!message.zoomed,'data-workspace-can-zoom':!!message.canZoom};
      const changed = Object.entries(attributes).some(([name,value]) => root.hasAttribute(name) !== value);
      if (changed) {
        for (const [name,value] of Object.entries(attributes)) root.toggleAttribute(name,value);
        window.dispatchEvent(new Event('workhub:parallel-layout'));
      }
    }
    else if (message?.type === 'workhub:page-pane') pane(!!message.split,message.shared ?? !!message.split);
    else if (message?.type === 'workhub:page-active') visibility(!!message.active);
    else if (message?.type === 'workhub:page-navigate' && typeof message.route === 'string') navigate(message.route);
    else if (message?.type === 'workhub:page-closing') dispose();
  });
  const observer = new MutationObserver(schedule);
  observer.observe(document.querySelector('title'), {childList:true});
  const chromeObserver = new MutationObserver(publishChrome);
  chromeObserver.observe(document.body, {attributes:true, attributeFilter:['class','style']});
  const chromeResize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publishChrome);
  if (document.querySelector('.sidebar')) chromeResize?.observe(document.querySelector('.sidebar'));
  window.addEventListener('resize', publishChrome);
  function canClose() {
    if (state.busy || blockingMutationDialog()) {toast(uiText("请等待当前操作完成后关闭视图")); return false;}
    return true;
  }
  function dispose() {
    if (disposed) return;
    // Existing pagehide handlers persist drafts and dispose UI subscriptions.
    window.dispatchEvent(new Event('pagehide'));
    disposed = true; clearTimeout(timer); observer.disconnect(); chromeObserver.disconnect(); chromeResize?.disconnect();
    window.removeEventListener('resize', publishChrome);
    document.removeEventListener('pointerdown', focus, true);
    document.removeEventListener('focusin', focus);
  }
  window.WorkHubPage = {snapshot,canClose,dispose,get restoring() {return restoring;},get active() {return active;},get canSplit() {return canSplit;},get navigationOnly() {return navigationOnly;},get parallelSessions() {return parallelSessions;},get parallelFull() {return parallelFull;},get parallelSelected() {return parallelSelected;}};
  visibility(false);
  window.addEventListener('workhub:workspace-ready', () => post('workhub:page-ready'), {once:true});
})();
