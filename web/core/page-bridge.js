'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


// Independent conversation readers retain their controllers and drafts.
// Page navigation is owned by the application host.
(() => {
  if (!window.parent || window.parent === window) return;
  const host = window.parent;
  let active = false, restoring = true, timer, disposed = false, parallelPane = false, navigationOnly = new URLSearchParams(location.search).has('app-navigation');
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
  $('#newBrowserSession').hidden = true;
  const post = (type, detail = {}) => host.postMessage({type, ...detail}, location.origin);
  function openConversationDraft({placement, projectCreate, globalCreate, environment = activeEnvironment}) {
    const view = !globalCreate && window.WorkHubConversations.current;
    const scope = projectCreate ? {kind:'project',id:projectCreate.dataset.id,environment} : view?.scope || {kind:'all'};
    const directory = projectCreate ? {
      key:conversationEnvironmentKey(environment,conversationPathKey(projectCreate.dataset.path)),
      environment, cwd:projectCreate.dataset.path, target:{project_id:projectCreate.dataset.id},
    } : view ? defaultConversationDirectory({...view,creationDirectory:view.directory || ''}) : null;
    const keepFilters = view && !projectCreate;
    post('workhub:page-open',{create:true,placement,snapshot:{route:'/sessions',environment:directory?.environment || environment,title:uiText("新建对话"),terminal:{projectID:directory?.target?.project_id,cwd:directory?.cwd},conversation:{scope,directory:keepFilters ? view.directory || '' : '',creationDirectory:directory?.key || '',environmentFilter:keepFilters ? view.environmentFilter || '' : '',selected:null,creating:true,pane:'detail'}}});
  }
  function createConversation(placement, environment) {
    if (disposed || restoring || sessionReadOnly || state.busy || placement === 'split' && !canSplit) return;
    $('#sessionScopePicker').open = false;
    openConversationDraft({placement,environment,globalCreate:placement === 'current' || environment !== activeEnvironment});
  }
  let chromeSignature = '';
  function publishChrome() {
    if (!active || disposed) return;
    if (document.documentElement.hasAttribute('data-workhub-desktop')) return;
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
    const route = location.hash.slice(1) || '/sessions';
    const view = state.view === 'sessions' ? window.WorkHubConversations.current : null;
    const session = view ? conversationSelectedSession(view) : null;
    const project = state.projects.find(item => item.id === state.selectedProject);
    const draftTitle = view?.creating ? window.WorkHubAssistant?.draftTitle?.() || '' : '';
    const title = view ? view.creating ? draftTitle ? uiText("草稿：{0}", draftTitle) : uiText("新建对话") : session?.name || conversationScopeName(view.scope) : state.view === 'projects' && projectDetailOpen ? project?.name || uiText("项目") : state.view === 'settings' ? uiText("设置") : state.view === 'issues' ? uiText("任务") : state.view === 'projects' ? uiText("项目") : uiText("对话");
    return {
      route, environment: activeEnvironment, title, kind: state.view, draftTitle,
      terminal:view?.creating ? creationHint : undefined,
      context: view ? (() => {
        const environment = session?.environment_id || activeEnvironment;
        const context = session ? window.WorkHubUI.conversationContext(session.cwd, conversationOverview(environment), session.primary_project_id) : null;
        return (context?.project || conversationScopeName(view.scope)) + ' · ' + environmentName(environment);
      })() : '',
      status:session?.chat_status || '',
      sessionEnvironment:session?.environment_id,
      conversation: view ? {scope:view.scope, creating:!!view.creating, creationBindings:view.creating ? view.creationBindings : undefined, creationLocalDirectories:view.creationLocalDirectories, creationDirectory:view.creating ? view.creationDirectory : session?.cwd ? conversationEnvironmentKey(session.environment_id || activeEnvironment,conversationPathKey(session.cwd)) : undefined, selected:view.creating ? null : view.selected, session:session ? {id:session.id,name:session.name,cwd:session.cwd,source:session.source,provider:session.provider,primary_project_id:session.primary_project_id,additional_directories:session.additional_directories,archived:session.archived,available:session.available} : undefined, search:view.search, directory:view.directory, statusFilter:view.statusFilter, environmentFilter:view.environmentFilter, archived:view.archived, pane:view.pane, loadedCount:view.loadedCount, windowStart:view.windowStart, scrollTop:$('#sessionBrowserList').scrollTop} : null,
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
        void refreshConversations(false);
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
    if (!parallelPane && !navigationOnly) pane(false,state.view === 'sessions');
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
    const previousLocation = resourceLocation.key;
    try {
      await selectEnvironment(saved.environment || 'local', saved.route || '/sessions', 'replace', {refreshState:false});
      if (disposed || revision !== restoreRevision) return;
      if (state.view === 'sessions') {
        creationHint = {...saved.terminal};
        const savedView = saved.conversation?.scope && ["all","project","directory"].includes(saved.conversation.scope.kind) ? saved.conversation : {scope:{kind:'all'},pane:'list'};
        rememberConversationView(); closeSessionHistory(false);
        window.WorkHubConversations.current = conversationViewFor(savedView.scope);
        Object.assign(window.WorkHubConversations.current, {
          search:savedView.search || '', directory:savedView.directory || '', creationDirectory:savedView.creationDirectory || '', creationLocalDirectories:savedView.creationLocalDirectories || [], creationBindings:savedView.creationBindings || {},
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
            if (!disposed && revision === restoreRevision && view === window.WorkHubConversations.current && view.creating) startBrowserConversation(active && (!parallelPane || document.documentElement.hasAttribute('data-workspace-focused')), true);
          });
        }
        else showConversationSelection();
        // A known conversation opens directly; its list and workspace metadata
        // are independent background reads, rather than prerequisites.
        void refreshConversations(false);
        $('#sessionBrowserList').scrollTop = savedView.scrollTop || 0;
      }
    } catch (error) { if (!disposed) toast(uiText("页面加载失败：") + error.message, true); }
    finally {
      if (!disposed && revision === restoreRevision) {
        restoring = false;
        document.documentElement.removeAttribute('data-workspace-initial-route');
        performance.mark?.('workhub:selection-ready');
        visibility(active);
        if (active && !navigationOnly && previousLocation !== resourceLocation.key && state.view === 'projects') focusResourcePage();
        publish();
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
    const collection = target.closest('[data-collection-href]');
    if (collection) return {route:collection.dataset.collectionHref.slice(1),environment:collection.dataset.collectionEnvironment || activeEnvironment,title:collection.dataset.collectionName};
    const directoryProject = target.closest('[data-action="jump-project"]');
    if (directoryProject) return {route:directoryProject.hash.slice(1), environment:activeEnvironment};
    const projectButton = target.closest('[data-action="select-project"]');
    if (projectButton) return {route:'/projects/' + projectButton.dataset.id, environment:activeEnvironment, title:state.projects.find(p => p.id === projectButton.dataset.id)?.name || uiText("项目")};
    const conversations = target.closest('[data-action="project-conversations"]');
    if (conversations) {
      const selected = conversations.dataset.session ? conversationEnvironmentKey(activeEnvironment, conversations.dataset.session) : null;
      return {route:'/sessions',environment:activeEnvironment, title:uiText("对话"),conversation:{scope:{kind:'project', id:conversations.dataset.id, environment:activeEnvironment},selected,pane:'detail'}};
    }
    const nav = target.closest('[data-view]');
    if (nav) return {route:'/' + nav.dataset.view, environment:activeEnvironment};
    const link = target.closest('a[href^="#/"]');
    if (link) return {route:link.getAttribute('href').slice(1),environment:activeEnvironment};
    return null;
  }
  const open = saved => post('workhub:page-open', {snapshot:saved});
  document.addEventListener('click', event => {
    if (event.target.closest('#openGlobalSearch')) {
      post('workhub:global-search');
      return;
    }
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
      const terminal = {...creationHint,projectID:target?.project_id,cwd:target?.cwd};
      post('workhub:conversation-kind',{kind:'terminal',snapshot:{...current,terminal,conversation:{...current.conversation,creationDirectory:target?.cwd ? conversationEnvironmentKey(window.WorkHubConversations.current.targetEnvironment,conversationPathKey(target.cwd)) : current.conversation.creationDirectory}}}); return;
    }
    const projectCreate = event.target.closest('[data-action="project-conversation-new"]');
    const create = projectCreate || event.target.closest('[data-conversation-action="new"]');
    if (create && event.button === 0 && !create.disabled && !state.busy && !sessionReadOnly) {
      const placement = create.dataset.conversationPlacement || 'current';
      if (placement === 'split' && !canSplit) return;
      event.preventDefault(); event.stopImmediatePropagation();
      $('#sessionScopePicker').open = false;
      const standaloneCreate = create.dataset.conversationStandalone === 'true';
      if (navigationOnly && (projectCreate || standaloneCreate)) revealConversationCreationGroup(create);
      const globalCreate = create.id === 'newBrowserSession' || standaloneCreate;
      openConversationDraft({placement,projectCreate,globalCreate,environment:projectCreate?.dataset.environment});
      return;
    }
    if (event.target.closest('.brand[href="/"]') && !(event.metaKey || event.ctrlKey)) {
      event.preventDefault(); event.stopImmediatePropagation(); open({route:'/sessions',environment:activeEnvironment}); return;
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
  // Top-layer elements stay inside their iframe. Expand the shared navigation
  // while its dialog extends into the conversation panes.
  let navigationModal = false;
  const modalObserver = navigationOnly ? new MutationObserver(() => {
    const open = !!document.querySelector('dialog[open]');
    if (open === navigationModal) return;
    navigationModal = open;
    post('workhub:navigation-modal', {open});
  }) : null;
  modalObserver?.observe(document.body, {subtree:true, attributes:true, attributeFilter:['open']});
  const focus = event => { if (!disposed && (!restoring || event?.type === 'pointerdown')) post('workhub:page-focus'); };
  document.addEventListener('pointerdown', focus, true);
  document.addEventListener('focusin', focus);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('workhub:app-refreshed', schedule);
  window.addEventListener('workhub:session-loaded', schedule);
  window.addEventListener('workhub:chat-draft', schedule);
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
      canSplit = !!message.canSplit;
      document.documentElement.toggleAttribute('data-workspace-single',message.split === false);
      document.documentElement.style.setProperty('--workspace-shared-list-width',Math.max(220,Math.min(520,message.listWidth || 280)) + 'px');
      const listPane = document.getElementById('sessionBrowserListPane');
      if (listPane) {
        const label = (message.split === false ? uiText("当前对话：") : uiText("切换当前栏：")) + (message.targetTitle || uiText("对话"));
        if (listPane.getAttribute('aria-description') !== label) listPane.setAttribute('aria-description',label);
      }
      const view = window.WorkHubConversations.current;
      if (view && selectionChanged) {
        if (focusChanged && message.selected && message.target && !message.createdConversation) followConversationSelection(message.target);
        else {
          view.selected = parallelSelected;
          if (focusChanged) {
            view.locateSelection = message.createdConversation ? parallelSelected : null;
            view.requestedSession = null;
            view.followTarget = null;
          }
          renderConversationList();
          if (message.createdConversation) {
            const selected = parallelSelected;
            void refreshConversations(true).then(() => {
              if (!view.loading && view.locateSelection === selected) view.locateSelection = null;
            });
          }
        }
      }
      selectInitialConversation();
    }
    else if (message?.type === 'workhub:navigation-route' && navigationOnly) {
      const view = message.route.split('/')[1]?.split('?')[0];
      document.documentElement.dataset.workspaceMainView = view;
      document.querySelectorAll('.sidebar [data-view]').forEach(button => {
        const current = button.dataset.view === document.documentElement.dataset.workspaceMainView;
        button.classList.toggle('active',current);
        if (current) button.setAttribute('aria-current','page');
        else button.removeAttribute('aria-current');
      });
    }
    else if (message?.type === 'workhub:page-navigation') {navigationOnly = true; document.documentElement.setAttribute('data-workspace-navigation','');}
    else if (message?.type === 'workhub:page-restore') { visibility(!!message.active); void restore(message.snapshot); }
    else if (message?.type === 'workhub:parallel-layout') {
      canSplit = !!message.canSplit;
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
    disposed = true; clearTimeout(timer); observer.disconnect(); chromeObserver.disconnect(); chromeResize?.disconnect(); modalObserver?.disconnect();
    window.removeEventListener('workhub:chat-draft', schedule);
    window.removeEventListener('resize', publishChrome);
    document.removeEventListener('pointerdown', focus, true);
    document.removeEventListener('focusin', focus);
  }
  async function refreshFromHeader() {
    const revision = environmentRevision;
    const result = await refresh(true);
    if (result !== 'pending') return result;
    if (disposed || !active || revision !== environmentRevision) return 'cancelled';
    // The existing status poll fetches the Git results after the backend finishes.
    return new Promise(resolve => {
      const finish = status => {
        clearTimeout(timeout);
        window.removeEventListener('workhub:app-refreshed', refreshed);
        window.removeEventListener('workhub:page-visibility', visibilityChanged);
        resolve(status);
      };
      const refreshed = event => {
        if (revision !== environmentRevision) finish('cancelled');
        else if (event.detail !== 'pending') finish(event.detail);
      };
      const visibilityChanged = event => { if (!event.detail.visible) finish('cancelled'); };
      const timeout = setTimeout(() => finish('pending'), 10000);
      window.addEventListener('workhub:app-refreshed', refreshed);
      window.addEventListener('workhub:page-visibility', visibilityChanged);
    });
  }
  window.WorkHubPage = {snapshot,canClose,dispose,environmentName,refresh:refreshFromHeader,createConversation,get canCreateConversation() {return !sessionReadOnly;},get restoring() {return restoring;},get active() {return active;},get canSplit() {return canSplit;},get navigationOnly() {return navigationOnly;},get parallelSessions() {return parallelSessions;},get parallelFull() {return parallelFull;},get parallelSelected() {return parallelSelected;}};
  visibility(false);
  window.addEventListener('workhub:app-ready', () => post('workhub:page-ready'), {once:true});
})();
