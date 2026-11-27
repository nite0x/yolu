'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);

// A single workspace document handles page navigation. Conversation readers
// stay mounted as flat iframes positioned by the recursive binary layout tree,
// so splitting, closing, resizing, maximizing, or moving panes never reloads
// an iframe or interrupts an active Agent runtime.
(() => {
  const desktop = document.documentElement.hasAttribute('data-workhub-desktop');
  const sharedListWidth = window.WorkHubListWidth;
  const layoutEngine = window.WorkHubLayout.paneLayout;
  const constraints = layoutEngine.constraints;
  let navigation = null, compactNavigationOpen = false, conversationListWidth = 280;
  let conversationsVisible = false, conversationsPresented = false, appliedURL = location.href;
  const panePages = new Map(); // Map<paneId, HostPage>
  const conversationMeta = new Map(); // Map<conversationId, PersistedConversationMeta>
  const historyID = crypto.randomUUID(), visits = [];
  let visitIndex = -1, restoringVisit = false, historyPending = false;
  try {
    const width = Number(localStorage.getItem('workhub:conversation-list-width:v1'));
    if (width >= 220 && width <= 520) conversationListWidth = width;
  } catch {}
  const protocol = window.WorkHubBrowser;
  window.WorkHubApp = protocol.createRequestCache((path, options) => fetch(path, options));

  // Browser and desktop use the same top bar. Native initialization reuses
  // these containers and adds only operating-system window controls.
  let header = document.querySelector('.workhub-window-drag');
  if (!header) {
    header = document.createElement('header');
    header.className = 'workhub-window-drag';
    header.setAttribute('aria-label', uiText("窗口标题栏"));
    document.body.prepend(header);
  }
  if (!document.getElementById('workhubWindowControls')) {
    const controls = document.createElement('div');
    controls.id = 'workhubWindowControls';
    controls.className = 'workhub-window-controls shadcn-scope';
    header.append(controls);
  }
  const pages = document.getElementById('workspacePages');
  const navigationToggle = document.getElementById('workspaceNavigationToggle');
  navigationToggle.addEventListener('click', () => {
    compactNavigationOpen = !compactNavigationOpen;
    renderLayout();
  });
  const searchToken = document.querySelector('meta[name="csrf-token"]').content;
  const search = window.WorkHubLayout.createGlobalSearch(document.getElementById('globalSearch'), {
    async read(path, environment) {
      const response = await window.WorkHubApp.read(path, {headers: {'Content-Type':'application/json', 'X-CSRF-Token':searchToken, 'X-Environment-ID':environment}});
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    },
    navigate(snapshot) {
      dispatchOpen({snapshot});
      currentPage()?.frame.focus({preventScroll:true});
    },
  });
  const paneChrome = document.createElement('div');
  paneChrome.className = 'workspace-pane-chrome';
  pages.append(paneChrome);

  const persistence = layoutEngine.createPersistence({
    context: 'default',
    debounceMs: 250,
    saveRemote: async (context, payload, saveOptions) => {
      if (typeof fetch !== 'function') return;
      const response = await fetch('/api/settings/pane-layout?context=' + encodeURIComponent(context), {
        method: 'PUT',
        headers: {'Content-Type': 'application/json', 'X-CSRF-Token': searchToken},
        body: JSON.stringify(payload),
        ...(saveOptions?.keepalive ? {keepalive: true} : {}),
      });
      if (!response.ok) throw new Error(String(response.status));
    },
  });

  const bootstrapMeta = document.querySelector('meta[name="pane-layout"]')?.content || '';
  const bootstrapRaw = bootstrapMeta && bootstrapMeta !== '__PANE_LAYOUT__' ? bootstrapMeta : '';
  const initialRestored = persistence.load(bootstrapRaw);
  let allowInitialAutoSelect = !initialRestored.restored;
  const store = layoutEngine.createStore(initialRestored.layout, constraints);
  for (const [id, meta] of Object.entries(initialRestored.conversations || {})) {
    conversationMeta.set(id, meta);
  }

  const versions = page => [page, ...(page.alternate ? [page.alternate] : [])];
  const allPages = () => [workspace, ...[...panePages.values()].flatMap(versions)];
  const isConversation = snapshot => snapshot.route === '/sessions' && typeof snapshot.conversation?.selected === 'string' && !!snapshot.conversation.selected;
  const isConversationView = snapshot => isConversation(snapshot) || snapshot.route === '/sessions' && snapshot.conversation?.creating === true;
  const isTerminal = snapshot => snapshot.route === '/terminals';
  const listIdentity = snapshot => isTerminal(snapshot) && snapshot.terminal?.id ? JSON.stringify(['terminal', snapshot.environment, snapshot.terminal.id]) : snapshot.conversation?.selected;
  const isPaneView = snapshot => isConversationView(snapshot) || isTerminal(snapshot);

  // Local IDs remain plain strings; remote identities already include their environment.
  const identity = snapshot => {
    if (isTerminal(snapshot)) return snapshot.terminal?.id ? JSON.stringify(['terminal', snapshot.environment, snapshot.terminal.id]) : '';
    if (!isConversation(snapshot)) return '';
    let id = snapshot.conversation.selected;
    try { const pair = JSON.parse(id); if (Array.isArray(pair) && pair.length === 2) return JSON.stringify(pair); } catch {}
    return JSON.stringify([snapshot.environment, id]);
  };
  const normalizeSessionIdentity = (sessionId, environment = 'local') => {
    try { const pair = JSON.parse(sessionId); if (Array.isArray(pair) && pair.length === 2) return JSON.stringify(pair); } catch {}
    return JSON.stringify([environment || 'local', sessionId]);
  };
  const paneContentKey = (snapshot, paneId) => identity(snapshot) || (isTerminal(snapshot) ? `terminal:${paneId}` : `draft:${paneId}`);

  function normalize(value) {
    const snapshot = value && typeof value === 'object' ? value : {};
    const route = typeof snapshot.route === 'string' && /^\/(projects(?:\/[\w-]+(?:\/(?:git|worktrees))?)?|sessions|terminals|settings|issues)(?:\?[^#]*)?$/.test(snapshot.route) ? snapshot.route : '/sessions';
    return {...snapshot, route, environment:typeof snapshot.environment === 'string' ? snapshot.environment : 'local', title:typeof snapshot.title === 'string' ? snapshot.title.slice(0, 200) : uiText("对话"), kind:route.split('/')[1].split('?')[0]};
  }
  function send(page, type, detail = {}) {
    if (page?.ready) protocol.postPageMessage(page.frame.contentWindow, location.origin, type, detail);
  }

  const sharedLayout = () => innerWidth > 760;
  const conversationListBounds = () => sharedListWidth?.bounds() ?? {min:220, max:Math.max(220, Math.min(520, innerWidth - 360))};
  const renderedConversationListWidth = () => sharedListWidth?.current() ?? conversationListWidth;
  function layoutViewport() {
    const box = pages.getBoundingClientRect?.();
    const fallbackWidth = Math.max(0, innerWidth - (sharedLayout() ? renderedConversationListWidth() : 0));
    const fallbackHeight = Math.max(0, (typeof innerHeight === 'number' && innerHeight > 0 ? innerHeight : 900) - (desktop ? 36 : 0));
    return {
      width: box && box.width > 0 ? box.width : fallbackWidth,
      height: box && box.height > 0 ? box.height : fallbackHeight,
    };
  }
  function activePaneId() {
    const layout = store.getLayout();
    return layout.activePaneId || layoutEngine.listPanes(layout.root)[0]?.id || '';
  }
  function currentView() {
    return layoutEngine.computeLayoutView(store.getLayout(), store.getInteraction(), layoutViewport(), constraints);
  }
  function canSplitActive() {
    const layout = store.getLayout();
    const id = activePaneId();
    if (!id) return false;
    const caps = layoutEngine.getPaneCapabilities(layout, store.getInteraction(), id, layoutViewport(), constraints);
    if (!caps.canSplitRight && !caps.canSplitDown) return false;
    const panes = layoutEngine.listPanes(layout.root);
    return panes.every(pane => {
      if (pane.content.type === 'empty') return true;
      const mounted = panePages.get(pane.id);
      if (mounted) return isPaneView(mounted.snapshot);
      return !pane.content.conversationId.startsWith('landing:');
    });
  }

  function snapshotForConversationId(conversationId) {
    const meta = conversationMeta.get(conversationId);
    if (meta) {
      return normalize({
        route: '/sessions',
        environment: meta.environment,
        title: meta.title,
        conversation: {scope: {kind: 'all'}, selected: meta.selected || conversationId, pane: 'detail'},
      });
    }
    let env = 'local', selected = conversationId;
    try {
      const pair = JSON.parse(conversationId);
      if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string') {
        env = pair[0];
        selected = env === 'local' ? pair[1] : conversationId;
      }
    } catch {}
    return normalize({
      route: '/sessions',
      environment: env,
      title: uiText("对话"),
      conversation: {scope: {kind: 'all'}, selected, pane: 'detail'},
    });
  }

  function collectPersistableLayout() {
    const raw = store.getLayout();
    const meta = {};
    const sanitizeNode = node => {
      if (node.type === 'split') {
        return {...node, children: [sanitizeNode(node.children[0]), sanitizeNode(node.children[1])]};
      }
      if (node.content.type !== 'conversation') return node;
      const page = panePages.get(node.id);
      if (!page) {
        if (node.content.conversationId.startsWith('landing:')) return {...node, content: {type: 'empty'}};
        const known = conversationMeta.get(node.content.conversationId);
        if (known) meta[node.content.conversationId] = known;
        return node;
      }
      if (isConversation(page.snapshot)) {
        const key = identity(page.snapshot);
        meta[key] = {
          environment: page.snapshot.environment,
          route: '/sessions',
          title: page.snapshot.title,
          selected: page.snapshot.conversation.selected,
        };
        conversationMeta.set(key, meta[key]);
        return {...node, content: {type: 'conversation', conversationId: key}};
      }
      // Unsaved drafts and ephemeral terminal launchers degrade cleanly to empty panes across restarts.
      return {...node, content: {type: 'empty'}};
    };
    return {
      layout: {...raw, root: sanitizeNode(raw.root)},
      conversations: meta,
    };
  }

  function schedulePersist() {
    const payload = collectPersistableLayout();
    persistence.scheduleSave(payload.layout, payload.conversations);
  }

  const visitKey = (snapshot, pageID) => JSON.stringify([snapshot.environment, snapshot.route, identity(snapshot) || (isPaneView(snapshot) ? pageID : '')]);
  function travel(offset) {
    if (historyPending || !visits[visitIndex + offset]) return;
    historyPending = true;
    history.go(offset);
  }
  function syncURL() {
    const activeId = activePaneId();
    const activePage = panePages.get(activeId);
    const page = conversationsVisible ? activePage : workspace;
    if (!page) {
      if (conversationsVisible) {
        const url = new URL(location.href);
        url.searchParams.delete('environment');
        url.hash = '/sessions';
        if (!restoringVisit) history.replaceState({...history.state, yoluNavigation:{id:historyID, index:Math.max(0, visitIndex)}}, '', url);
        appliedURL = location.href;
        document.title = uiText("对话") + ' · Yolu';
      }
      return;
    }
    const url = new URL(location.href), snapshot = page.snapshot;
    if (snapshot.environment === 'local') url.searchParams.delete('environment'); else url.searchParams.set('environment', snapshot.environment);
    url.hash = conversationsVisible ? isConversation(snapshot) ? '/sessions?' + new URLSearchParams({session:snapshot.conversation.selected}) : '/sessions' : snapshot.route;
    if (!restoringVisit) {
      const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
      const key = visitKey(snapshot, page.id), previous = visits[visitIndex];
      const resolving = previous?.snapshot.route === '/sessions' && !isPaneView(previous.snapshot) && snapshot.route === '/sessions' && previous.snapshot.environment === snapshot.environment;
      const changed = previous?.key !== key && !resolving;
      if (changed) {
        visits.splice(visitIndex + 1);
        visitIndex = visits.length;
      }
      visits[visitIndex] = {key, snapshot:snapshotCopy, pageID:page.id};
      const state = {...history.state, yoluNavigation:{id:historyID, index:visitIndex}};
      history[changed && visitIndex > 0 ? 'pushState' : 'replaceState'](state, '', url);
    }
    appliedURL = location.href;
    document.title = snapshot.title + ' · Yolu';
  }

  function currentPage() {
    if (!conversationsPresented) return workspace;
    const active = panePages.get(activePaneId());
    if (active) return active;
    for (const pane of layoutEngine.listPanes(store.getLayout().root)) {
      const candidate = panePages.get(pane.id);
      if (candidate) return candidate;
    }
    return workspace;
  }

  function renderChrome() {
    const page = currentPage();
    const navigator = navigation?.restored && navigation.frame.contentWindow.WorkHubPage;
    const controls = document.getElementById('workhubWindowControls');
    const activeView = conversationsPresented ? 'sessions' : page?.snapshot.kind;
    const ready = conversationsPresented ? (!!navigation?.restored || !!page?.ready || layoutEngine.listPanes(store.getLayout().root).some(p => p.content.type === 'empty')) : !!page?.ready;
    if (controls) window.WorkHubLayout.renderChrome(controls, {
      ready,
      activeView,
      canGoBack: visitIndex > 0,
      canGoForward: visitIndex < visits.length - 1,
      back: () => travel(-1),
      forward: () => travel(1),
      navigate: view => openPage({route:'/' + view, environment:page?.snapshot.environment || 'local'}),
      canCreateConversation: ready && !!navigator?.canCreateConversation,
      canSplitConversation: canSplitActive(),
      createConversation: placement => {
        const current = currentPage();
        if (ready && (placement !== 'split' || canSplitActive())) {
          navigator?.createConversation(placement, current?.snapshot.environment || 'local');
        }
      },
      search: trigger => search.open(trigger),
      refresh: async () => {
        const targets = [navigation, page].filter(target => target?.ready && target.visible);
        const results = await Promise.allSettled(targets.map(async target => target.frame.contentWindow.WorkHubPage?.refresh?.()));
        if (results.some(result => result.status === 'rejected' || result.value === 'failed')) return 'failed';
        const statuses = results.map(result => result.value);
        if (statuses.includes('pending')) return 'pending';
        return statuses.includes('updated') ? 'updated' : 'cancelled';
      },
      appMenu: window.WorkHubDesktopWindow ? trigger => window.WorkHubDesktopWindow.showMenu(ready, trigger) : undefined,
    });
  }

  function inheritedContextFromPane(paneId) {
    const page = panePages.get(paneId);
    if (!page) return undefined;
    const snap = page.snapshot;
    const scope = pageScope(snap);
    return {
      environment: snap.environment || 'local',
      projectId: snap.terminal?.projectID || (scope.kind === 'project' ? scope.id : undefined),
      cwd: snap.terminal?.cwd || snap.conversation?.creationDirectory || snap.conversation?.directory || snap.conversation?.session?.cwd || undefined,
      scope,
    };
  }

  function recentConversationsForEmptyPane() {
    try {
      const fromBridge = navigation?.frame.contentWindow?.WorkHubPage?.recentConversations?.(5);
      if (Array.isArray(fromBridge) && fromBridge.length > 0) return fromBridge;
    } catch {}
    return search.recentConversations?.() || [];
  }

  function createConversationInPane(paneId, context) {
    const env = context?.environment || 'local';
    const scope = context?.scope || (context?.projectId ? {kind: 'project', id: context.projectId, environment: env} : {kind: 'all'});
    const draft = {
      route: '/sessions',
      environment: env,
      title: uiText("新建对话"),
      terminal: context?.projectId || context?.cwd ? {projectID: context.projectId, cwd: context.cwd} : undefined,
      conversation: {
        scope,
        creationDirectory: context?.cwd || '',
        selected: null,
        creating: true,
        pane: 'detail',
      },
    };
    openConversation(preferredCreation(draft), 'current', paneId);
  }

  function narrowPaneOptions() {
    const panes = layoutEngine.listPanes(store.getLayout().root);
    return panes.map((pane, index) => {
      if (pane.content.type === 'empty') {
        return {paneId: pane.id, label: uiText("空白面板")};
      }
      const page = panePages.get(pane.id);
      if (!page) return {paneId: pane.id, label: uiText("对话")};
      const title = page.snapshot.conversation?.creating && !page.snapshot.draftTitle && !page.snapshot.conversation.creatingYoluAssistant
        ? uiText("新对话 {0}", index + 1)
        : page.snapshot.title;
      return {paneId: pane.id, label: [title, page.snapshot.context].filter(Boolean).join(' · ')};
    });
  }

  function applyPaneFrameGeometry(view) {
    const compactOffset = view.isCompactFocusMode && view.isSplit;
    const dragId = store.getInteraction().draggingPaneId;
    for (const [paneId, page] of panePages) {
      const rect = view.paneRects.get(paneId);
      const active = conversationsPresented && !!rect;
      page.frame.hidden = !active;
      if (active) {
        page.frame.style.left = `${(rect.x * 100).toFixed(4)}%`;
        page.frame.style.width = `${(rect.width * 100).toFixed(4)}%`;
        if (compactOffset) {
          page.frame.style.top = '37px';
          page.frame.style.height = 'calc(100% - 37px)';
        } else {
          page.frame.style.top = `${(rect.y * 100).toFixed(4)}%`;
          page.frame.style.height = `${(rect.height * 100).toFixed(4)}%`;
        }
      } else {
        page.frame.style.left = '';
        page.frame.style.top = '';
        page.frame.style.width = '';
        page.frame.style.height = '';
      }
      page.frame.dataset.focused = String((!desktop || view.isSplit) && paneId === view.activePaneId);
      page.frame.dataset.dragSource = String(dragId === paneId);
    }
  }

  // Stable callback object so React.memo on LayoutNodeView/SplitContainer/PaneContainer
  // stays effective and SplitContainer's resize effect never tears down mid-drag.
  const paneLayoutHandlers = {
    onCreateConversation: (paneId, context) => createConversationInPane(paneId, context),
    onPickConversation: (paneId, trigger) => {
      store.focus(paneId);
      search.open(trigger, {
        conversationsOnly: true,
        onSelect: target => openConversation(target, 'current', paneId),
      });
    },
    onOpenRecentConversation: (paneId, item) => {
      openConversation({
        route: '/sessions',
        environment: item.environment || 'local',
        title: item.title,
        conversation: {scope: {kind: 'all'}, selected: item.id, pane: 'detail'},
      }, 'current', paneId);
    },
    onSplit: (paneId, placement) => splitPaneInDirection(paneId, placement),
    onToggleMaximize: paneId => toggleMaximizePane(paneId),
    onClose: paneId => closePaneById(paneId),
    onFocus: paneId => focusPane(paneId),
    onSelectNarrowPane: paneId => {
      store.setMaximized(null);
      focusPane(paneId);
    },
    onResizeStart: splitId => {
      store.setResizingSplit(splitId);
      renderPaneChrome();
    },
    onResize: (splitId, ratio) => {
      store.resize(splitId, ratio);
      // Fast path during drag: only update rects and dividers, zero DB writes.
      applyPaneFrameGeometry(currentView());
      renderPaneChrome();
    },
    onResizeCommit: splitId => {
      store.setResizingSplit(null);
      if (splitId) schedulePersist();
      renderLayout();
    },
    onResetRatio: splitId => {
      store.resetSplit(splitId);
      schedulePersist();
      renderLayout();
    },
    onDragStart: paneId => startPaneDrag(paneId),
    onDragMove: (clientX, clientY) => updatePaneDrag(clientX, clientY),
    onDragEnd: () => commitPaneDrag(),
    onDragCancel: () => cancelPaneDrag(),
  };

  function renderPaneChrome() {
    if (!conversationsPresented) {
      layoutEngine.render(paneChrome, null);
      return;
    }
    const navigator = navigation?.restored && navigation.frame.contentWindow.WorkHubPage;
    layoutEngine.render(paneChrome, {
      layout: store.getLayout(),
      interaction: store.getInteraction(),
      viewport: layoutViewport(),
      container: pages,
      constraints,
      recentConversations: recentConversationsForEmptyPane(),
      canCreateConversation: navigator ? !!navigator.canCreateConversation : true,
      narrowPaneOptions: narrowPaneOptions(),
      ...paneLayoutHandlers,
    });
  }

  function paintConversationListWidth() {
    const width = renderedConversationListWidth() + 'px';
    document.body.style.setProperty('--workspace-conversation-list-width', width);
    navigation?.frame.contentDocument?.documentElement?.style.setProperty('--workspace-shared-list-width', width);
  }
  function renderNavigationModal() {
    const open = !!(navigation?.visible && (navigation.modalOpen || !sharedLayout()));
    navigation?.wrapper.toggleAttribute('data-modal', open);
    pages.toggleAttribute('inert', open);
    if (navigation) navigation.resizeHandle.hidden = !navigation.visible || open;
  }

  let dragContainerBox = null;
  function startPaneDrag(paneId) {
    const view = currentView();
    if (!view.isSplit || view.isCompactFocusMode || store.getInteraction().maximizedPaneId) return;
    store.startDrag(paneId);
    dragContainerBox = pages.getBoundingClientRect();
    pages.setAttribute('data-pane-dragging', '');
    document.body.setAttribute('data-pane-dragging', '');
    applyPaneFrameGeometry(currentView());
    renderPaneChrome();
  }
  function updatePaneDrag(clientX, clientY) {
    const interaction = store.getInteraction();
    const sourcePaneId = interaction.draggingPaneId;
    if (!sourcePaneId) return;
    const prevTarget = interaction.dropTarget;
    const box = dragContainerBox || pages.getBoundingClientRect();
    const target = layoutEngine.resolveDropTarget(
      store.getLayout().root,
      box,
      {clientX, clientY},
      sourcePaneId,
    );
    store.updateDropTarget(target);
    const nextTarget = store.getInteraction().dropTarget;
    if (
      prevTarget?.targetPaneId !== nextTarget?.targetPaneId ||
      prevTarget?.zone !== nextTarget?.zone
    ) {
      renderPaneChrome();
    }
  }
  function commitPaneDrag() {
    dragContainerBox = null;
    pages.removeAttribute('data-pane-dragging');
    document.body.removeAttribute('data-pane-dragging');
    const changed = store.commitDrag();
    if (changed) {
      schedulePersist();
      update();
    } else {
      applyPaneFrameGeometry(currentView());
      renderPaneChrome();
    }
  }
  function cancelPaneDrag() {
    if (!store.getInteraction().draggingPaneId && !pages.hasAttribute('data-pane-dragging')) return;
    dragContainerBox = null;
    pages.removeAttribute('data-pane-dragging');
    document.body.removeAttribute('data-pane-dragging');
    store.cancelDrag();
    applyPaneFrameGeometry(currentView());
    renderPaneChrome();
  }

  function splitPaneInDirection(targetPaneId, placement) {
    const layout = store.getLayout();
    const caps = layoutEngine.getPaneCapabilities(layout, store.getInteraction(), targetPaneId, layoutViewport(), constraints);
    const allowed = placement === 'right' ? caps.canSplitRight
      : placement === 'down' ? caps.canSplitDown
        : placement === 'left' ? caps.canSplitLeft
          : caps.canSplitUp;
    if (!allowed) return null;
    allowInitialAutoSelect = false;
    const context = inheritedContextFromPane(targetPaneId);
    const createdId = store.split(targetPaneId, placement, {
      content: {type: 'empty', ...(context ? {context} : {})},
    });
    if (!createdId) return null;
    search.preload?.();
    schedulePersist();
    update();
    return createdId;
  }

  function toggleMaximizePane(paneId) {
    const view = currentView();
    if (!view.isSplit || view.isCompactFocusMode) return;
    store.toggleMaximize(paneId);
    update();
  }

  function focusAdjacentPane(direction) {
    const nextId = store.focusDirection(direction);
    if (!nextId) return;
    schedulePersist();
    update();
    const targetPage = panePages.get(nextId);
    if (targetPage) {
      targetPage.frame.focus({preventScroll: true});
    } else {
      const emptyBtn = paneChrome.querySelector(`[data-pane-id="${CSS.escape(nextId)}"] .pane-layout-empty-primary`);
      emptyBtn?.focus?.({preventScroll: true});
    }
  }

  function workspaceKeydown(event) {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    const mac = navigator.platform.startsWith('Mac');
    const direction = !event.shiftKey && (mac && event.metaKey && !event.ctrlKey && !event.altKey && ['[', ']'].includes(event.key)
      ? event.key === '[' ? -1 : 1
      : !mac && event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft', 'ArrowRight'].includes(event.key) ? event.key === 'ArrowLeft' ? -1 : 1 : 0);
    if (direction) {
      event.preventDefault();
      travel(direction);
      return;
    }
    if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      search.open(event.currentTarget.activeElement);
      return;
    }
    if (event.key === 'Escape' && store.getInteraction().draggingPaneId) {
      event.preventDefault();
      cancelPaneDrag();
      return;
    }
    if (event.key === 'Escape' && compactNavigationOpen && !navigation?.modalOpen) {
      event.preventDefault();
      compactNavigationOpen = false;
      renderLayout();
      navigationToggle.focus();
      return;
    }
    const frameHasModal = !!event.currentTarget?.querySelector?.('dialog[open]');
    if (conversationsVisible && !navigation?.modalOpen && !document.getElementById('globalSearch')?.open && !frameHasModal) {
      const command = layoutEngine.matchPaneShortcut(event, mac);
      if (command) {
        event.preventDefault();
        const activeId = activePaneId();
        switch (command) {
          case 'pane.splitRight': splitPaneInDirection(activeId, 'right'); break;
          case 'pane.splitDown': splitPaneInDirection(activeId, 'down'); break;
          case 'pane.splitLeft': splitPaneInDirection(activeId, 'left'); break;
          case 'pane.splitUp': splitPaneInDirection(activeId, 'up'); break;
          case 'pane.focusLeft': focusAdjacentPane('left'); break;
          case 'pane.focusRight': focusAdjacentPane('right'); break;
          case 'pane.focusUp': focusAdjacentPane('up'); break;
          case 'pane.focusDown': focusAdjacentPane('down'); break;
          case 'pane.toggleMaximize': toggleMaximizePane(activeId); break;
          case 'pane.close': closePaneById(activeId); break;
        }
      }
    }
  }

  function ensurePagesForVisiblePanes(view, shared) {
    if (!conversationsVisible) return;
    for (const pane of view.visiblePanes) {
      if (pane.content.type === 'empty') continue;
      let page = panePages.get(pane.id);
      if (!page) {
        page = createPage(snapshotForConversationId(pane.content.conversationId), pane.id);
        panePages.set(pane.id, page);
      }
      if (shared && !navigation.restored && !workspace.mounted && !isPaneView(page.snapshot)) continue;
      mountPage(page);
    }
  }

  function renderLayout(includeChrome = true) {
    const view = currentView();
    const split = view.isSplit;
    const shared = sharedLayout();
    const viewport = layoutViewport();
    if (!navigation) createNavigation();

    ensurePagesForVisiblePanes(view, shared);

    // Prepare readers and shared navigation offscreen. Keep the current
    // workspace and its sidebar visible until the whole destination is ready.
    const visibleFramePages = view.visiblePanes
      .map(pane => pane.content.type === 'empty' ? null : panePages.get(pane.id))
      .filter(Boolean);
    const hasEmptyVisible = view.visiblePanes.some(pane => pane.content.type === 'empty');
    const destinationReady =
      (visibleFramePages.length > 0 || hasEmptyVisible) &&
      visibleFramePages.every(page => page.restored) &&
      (!shared || !!navigation?.restored);
    conversationsPresented = conversationsVisible && (conversationsPresented || destinationReady);

    const navVisible = shared || compactNavigationOpen;
    const splitVisible = conversationsPresented;
    navigationToggle.setAttribute('aria-expanded', String(!shared && navVisible));
    navigationToggle.textContent = !shared && navVisible ? uiText("关闭导航") : uiText("打开导航");
    if (navigation) {
      navigation.wrapper.hidden = !navVisible;
      if (navigation.visible !== navVisible) {
        navigation.visible = navVisible;
        send(navigation, 'workhub:page-active', {active: navVisible});
      }
    }
    renderNavigationModal();
    paintConversationListWidth();
    document.body.toggleAttribute('data-workspace-navigation-visible', shared);
    document.body.toggleAttribute('data-workspace-conversations', splitVisible);

    send(workspace, 'workhub:page-pane', {split: false, shared: false});
    const workspaceVisible = !conversationsVisible || !conversationsPresented && !!workspace.visible;
    workspace.frame.hidden = !workspaceVisible;
    if (workspace.visible !== workspaceVisible) {
      workspace.visible = workspaceVisible;
      send(workspace, 'workhub:page-active', {active: workspace.visible});
    }

    applyPaneFrameGeometry(view);

    const layout = store.getLayout();
    const interaction = store.getInteraction();
    for (const [paneId, page] of panePages) {
      const active = conversationsPresented && view.paneRects.has(paneId);
      const caps = layoutEngine.getPaneCapabilities(layout, interaction, paneId, viewport, constraints);
      send(page, 'workhub:page-pane', {split, shared: true});
      if (page.visible !== active) {
        page.visible = active;
        send(page, 'workhub:page-active', {active});
      }
      send(page, 'workhub:parallel-layout', {
        split,
        focused: paneId === view.activePaneId,
        zoomed: !!view.maximizedPaneId,
        compact: view.isCompactFocusMode,
        canZoom: caps.canZoom,
        canSplit: caps.canSplit,
        canSplitRight: caps.canSplitRight,
        canSplitDown: caps.canSplitDown,
        canSplitLeft: caps.canSplitLeft,
        canSplitUp: caps.canSplitUp,
        canClose: caps.canClose,
      });
    }

    const focusedPage = panePages.get(view.activePaneId);
    const selected = conversationsVisible && focusedPage ? listIdentity(focusedPage.snapshot) : '';
    const createdConversation = !!selected && focusedPage.createdConversation === selected;
    const allOpenSessions = view.allPanes
      .map(pane => {
        const p = panePages.get(pane.id);
        return p ? listIdentity(p.snapshot) : pane.content.type === 'conversation' && !pane.content.conversationId.startsWith('landing:') ? pane.content.conversationId : null;
      })
      .filter(Boolean);
    const hasAnyRealPane = view.allPanes.some(pane => {
      if (pane.content.type === 'conversation' && !pane.content.conversationId.startsWith('landing:')) return true;
      const p = panePages.get(pane.id);
      return p ? isPaneView(p.snapshot) : false;
    });
    const full = view.allPanes.length >= constraints.maxPanes;
    const canSplit = canSplitActive();

    send(navigation, 'workhub:navigation-route', {route: conversationsVisible ? '/sessions' : workspace.snapshot.route});
    send(navigation, 'workhub:conversation-group', {
      targetTitle: focusedPage?.snapshot.title,
      target: conversationsVisible ? focusedPage?.snapshot : undefined,
      sessions: allOpenSessions,
      selected,
      createdConversation,
      autoSelect: allowInitialAutoSelect && conversationsVisible && !hasAnyRealPane && !view.isSplit,
      full,
      listWidth: renderedConversationListWidth(),
      split,
      canSplit,
    });
    if (createdConversation && navigation?.ready) delete focusedPage.createdConversation;

    renderPaneChrome();
    if (includeChrome) renderChrome();
    const current = currentPage();
    if (current?.visible && current.restored) search.remember(current.snapshot);
    if (!performance.getEntriesByName?.('workhub:layout-ready').length) performance.mark?.('workhub:layout-ready');
  }

  function update() {
    renderLayout(false);
    syncURL();
    renderChrome();
  }

  function focusPane(paneId) {
    const layout = store.getLayout();
    if (!layoutEngine.findPane(layout.root, paneId)) return;
    const maximized = store.getInteraction().maximizedPaneId;
    if (layout.activePaneId === paneId && (!maximized || maximized === paneId)) return;
    store.focus(paneId);
    schedulePersist();
    update();
  }

  function createPage(snapshot, id = crypto.randomUUID()) {
    snapshot = normalize(snapshot);
    const frame = document.createElement('iframe');
    frame.className = 'workspace-page';
    frame.id = 'page-' + id;
    frame.title = snapshot.title;
    frame.hidden = true;
    return {id, snapshot, frame, ready: false, mounted: false, restored: false, visible: false};
  }

  function mountPage(page, container = pages) {
    if (page.mounted) return;
    const {id, snapshot} = page;
    page.mounted = true;
    const url = new URL('/', location.href);
    url.searchParams.set('app-page', id);
    if (id === 'shared-navigation') url.searchParams.set('app-navigation', '1');
    else if (id !== 'workspace') url.searchParams.set('app-conversation', '1');
    if (snapshot.environment !== 'local') url.searchParams.set('environment', snapshot.environment);
    if (isTerminal(snapshot)) url.searchParams.set('app-terminal', '1');
    if (layoutEngine.countPanes(store.getLayout().root) > 1 && panePages.get(id) === page) url.searchParams.set('app-pane', '1');
    url.searchParams.set('app-list-width', String(renderedConversationListWidth()));
    url.hash = snapshot.route;
    if (desktop) {
      url.searchParams.set('app-desktop', '1');
      url.searchParams.set('app-sidebar-inset', '0');
    }
    page.frame.src = url.href;
    // Set the initial URL before insertion. Navigating an already attached
    // blank iframe can add a child entry to the browser's joint history.
    container.append(page.frame);
  }

  function createNavigation() {
    const wrapper = document.createElement('aside');
    wrapper.className = 'workspace-shared-navigation';
    wrapper.setAttribute('aria-label', uiText("共享导航与对话列表"));
    wrapper.id = 'workspaceSharedList';
    const current = panePages.get(activePaneId()) || panePages.values().next().value;
    const page = createPage({
      ...current?.snapshot,
      route: '/sessions',
      environment: current?.snapshot.environment || 'local',
      conversation: {...current?.snapshot.conversation, scope: pageScope(current?.snapshot || {}), pane: 'list'},
    }, 'shared-navigation');
    page.frame.className = 'workspace-navigation-frame';
    page.frame.removeAttribute('role');
    page.frame.title = uiText("工作台导航与对话列表");
    page.frame.hidden = false;
    const listSize = document.createElement('div');
    listSize.className = 'workspace-shared-list-size';
    listSize.setAttribute('aria-hidden', 'true');
    listSize.innerHTML = uiText("<div class=\"workspace-list-placeholder\"><div class=\"workspace-list-placeholder-search\"></div><p>正在读取对话…</p></div>");
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'workspace-shared-list-resize';
    resizeHandle.setAttribute('role', 'separator');
    resizeHandle.tabIndex = 0;
    resizeHandle.setAttribute('aria-label', uiText("调整共享对话列表宽度"));
    resizeHandle.setAttribute('aria-orientation', 'vertical');
    resizeHandle.setAttribute('aria-controls', wrapper.id);
    resizeHandle.title = uiText("拖动调整对话列表宽度，双击恢复默认");
    wrapper.append(listSize);
    navigation = {...page, wrapper, resizeHandle};
    mountPage(navigation, wrapper);
    document.body.append(wrapper, resizeHandle);
    let resizeFrame = 0;
    const paint = () => { resizeFrame = 0; paintConversationListWidth(); };
    const resize = width => {
      if (sharedListWidth) { sharedListWidth.resize(width); return; }
      conversationListWidth = width;
      if (typeof requestAnimationFrame !== 'function') paint();
      else if (!resizeFrame) resizeFrame = requestAnimationFrame(paint);
    };
    const commit = () => {
      if (resizeFrame) { cancelAnimationFrame(resizeFrame); resizeFrame = 0; }
      paint();
      renderLayout();
      if (sharedListWidth) sharedListWidth.save();
      else try { localStorage.setItem('workhub:conversation-list-width:v1', String(conversationListWidth)); } catch {}
    };
    window.WorkHubLayout.setupSplitResize({handle: resizeHandle, container: document.body, panel: listSize, axis: 'x', bounds: conversationListBounds, resize, commit});
    resizeHandle.addEventListener('dblclick', () => {
      resize(sharedListWidth?.defaultWidth ?? Math.min(280, conversationListBounds().max));
      commit();
      resizeHandle.setAttribute('aria-valuenow', String(renderedConversationListWidth()));
    });
  }

  function canClose(page) {
    try { return !page.ready || page.frame.contentWindow.WorkHubPage.canClose(); } catch { return false; }
  }
  function dispose(page) {
    if (page.alternate) { const alternate = page.alternate; delete page.alternate; dispose(alternate); }
    send(page, 'workhub:page-closing');
    try { page.frame.contentWindow.WorkHubPage?.dispose(); } catch {}
    page.frame.remove();
    if (isTerminal(page.snapshot)) send(navigation, 'workhub:terminals-changed');
  }
  function disposeAlternate(page) {
    if (!page?.alternate) return;
    const alternate = page.alternate;
    delete page.alternate;
    dispose(alternate);
  }

  function closePaneById(paneId) {
    const layout = store.getLayout();
    const target = layoutEngine.findPane(layout.root, paneId);
    if (!target) return;
    const page = panePages.get(paneId);
    if (page && !canClose(page)) return;
    allowInitialAutoSelect = false;
    if (page) {
      dispose(page);
      panePages.delete(paneId);
    }
    store.close(paneId);
    schedulePersist();
    update();
  }

  function pageScope(snapshot) {
    if (isTerminal(snapshot) && snapshot.terminal?.projectID) return {kind: 'project', id: snapshot.terminal.projectID, environment: snapshot.environment};
    if (snapshot.conversation?.scope) return snapshot.conversation.scope;
    return snapshot.terminal?.projectID ? {kind: 'project', id: snapshot.terminal.projectID, environment: snapshot.environment} : {kind: 'all'};
  }
  function preferredCreation(snapshot) {
    const scope = pageScope(snapshot), projectID = snapshot.terminal?.projectID || (scope.kind === 'project' ? scope.id : undefined);
    if (snapshot.environment !== 'local' || !projectID || window.WorkHubLayout.conversationDefaults.get('kind') !== 'terminal') return snapshot;
    return {...snapshot, route: '/terminals', title: uiText("新建终端"), terminal: {...snapshot.terminal, projectID}};
  }
  function dispatchOpen(message, pageID = activePaneId()) {
    const snapshot = message.create && isTerminal(message.snapshot)
      ? {...message.snapshot, route: '/sessions', title: uiText("新建对话"), conversation: {scope: pageScope(message.snapshot), selected: null, creating: true, pane: 'detail'}}
      : message.snapshot;
    const target = message.create ? preferredCreation(snapshot) : snapshot;
    if (target.route !== '/sessions' && !isTerminal(target)) openPage(target);
    else if (isPaneView(target)) openConversation(target, message.placement, pageID);
    else openPage(target);
  }

  function switchCreation(page, kind, snapshot) {
    const view = currentView();
    if (!view.paneRects.has(page.id) || panePages.get(page.id) !== page) return;
    const source = normalize(snapshot), terminal = isTerminal(page.snapshot);
    if (terminal ? page.snapshot.terminal?.id || kind === 'terminal' : !page.snapshot.conversation?.creating || kind !== 'terminal') return;
    if (kind !== 'ui' && source.environment !== 'local' || !canClose(page)) return;
    window.WorkHubLayout.conversationDefaults.set('kind', kind === 'cloud' ? 'ui' : kind);
    const scope = pageScope(source);
    const next = kind === 'terminal'
      ? {...source, route: '/terminals', title: uiText("新建终端"), terminal: {...source.terminal, projectID: source.terminal?.projectID || (scope.kind === 'project' ? scope.id : undefined)}}
      : {...source, route: '/sessions', title: uiText("新建对话"), conversation: {...source.conversation, scope, selected: null, creating: true, pane: 'detail', draftExecution: kind === 'cloud' ? 'cloud' : 'local'}};
    const replacement = page.alternate || createPage(next, page.id);
    const contextKey = snap => JSON.stringify([snap.environment, snap.terminal?.projectID || '', snap.terminal?.cwd || '', snap.conversation?.creationDirectory || snap.conversation?.directory || '']);
    if (page.alternate) {
      if (kind !== 'cloud' && contextKey(replacement.snapshot) !== contextKey(next)) {
        replacement.snapshot = normalize(next);
        send(replacement, 'workhub:page-restore', {snapshot: replacement.snapshot, active: false});
      } else if (terminal) {
        replacement.snapshot = {...replacement.snapshot, conversation: {...replacement.snapshot.conversation, draftExecution: next.conversation.draftExecution}};
        send(replacement, 'workhub:conversation-kind', {snapshot: replacement.snapshot, kind});
      }
    }
    delete page.alternate;
    replacement.alternate = page;
    page.frame.hidden = true;
    page.visible = false;
    send(page, 'workhub:page-active', {active: false});
    panePages.set(page.id, replacement);
    store.setMaximized(null);
    update();
  }

  function openPage(snapshot) {
    const clean = normalize(snapshot);
    compactNavigationOpen = false;
    if (clean.route === '/sessions' || isTerminal(clean)) {
      conversationsVisible = true;
      if (isPaneView(clean)) {
        openConversation(clean, 'current');
        return;
      }
      const panes = layoutEngine.listPanes(store.getLayout().root);
      if (panes.length === 1 && panes[0].content.type === 'empty' && !panePages.size && allowInitialAutoSelect) {
        const page = createPage(clean, panes[0].id);
        panePages.set(panes[0].id, page);
        store.bindContent(panes[0].id, {type: 'conversation', conversationId: `landing:${panes[0].id}`});
      }
      if (clean.conversation?.scope && navigation) {
        navigation.snapshot = {...clean, route: '/sessions', conversation: {...clean.conversation, pane: 'list'}};
        send(navigation, 'workhub:page-restore', {snapshot: navigation.snapshot, active: true});
      }
    } else {
      if (!canClose(workspace)) return;
      cancelPaneDrag();
      conversationsVisible = false;
      workspace.snapshot = clean;
      mountPage(workspace);
      send(workspace, 'workhub:page-restore', {snapshot: clean, active: true});
    }
    update();
  }

  function findExistingPaneForIdentity(key) {
    if (!key) return null;
    for (const [paneId, page] of panePages) {
      if (identity(page.snapshot) === key) return paneId;
    }
    const found = layoutEngine.findPaneByConversationId(store.getLayout().root, key);
    return found?.id || null;
  }

  function openConversation(snapshot, placement = 'current', targetPaneId = activePaneId()) {
    const clean = normalize(snapshot);
    if (!isPaneView(clean)) { openPage(clean); return; }
    allowInitialAutoSelect = false;
    compactNavigationOpen = false;
    conversationsVisible = true;

    const key = identity(clean);
    const existingPaneId = findExistingPaneForIdentity(key);
    if (existingPaneId) {
      store.setMaximized(null);
      store.focus(existingPaneId);
      schedulePersist();
      update();
      panePages.get(existingPaneId)?.frame.focus();
      return;
    }

    const layout = store.getLayout();
    const basePaneId = layoutEngine.findPane(layout.root, targetPaneId) ? targetPaneId : activePaneId();

    if (placement === 'split') {
      const caps = layoutEngine.getPaneCapabilities(layout, store.getInteraction(), basePaneId, layoutViewport(), constraints);
      const splitDirection = caps.canSplitRight ? 'right' : caps.canSplitDown ? 'down' : null;
      if (!splitDirection) return;
      const newPaneId = crypto.randomUUID();
      const contentId = paneContentKey(clean, newPaneId);
      const createdId = store.split(basePaneId, splitDirection, {
        newPaneId,
        content: {type: 'conversation', conversationId: contentId},
      });
      if (!createdId) return;
      const page = createPage(clean, createdId);
      panePages.set(createdId, page);
      store.setMaximized(null);
      schedulePersist();
      update();
      return;
    }

    const old = panePages.get(basePaneId);
    if (old) {
      if (!canClose(old)) return;
      disposeAlternate(old);
      const contentId = paneContentKey(clean, basePaneId);
      store.bindContent(basePaneId, {type: 'conversation', conversationId: contentId});
      if (isTerminal(old.snapshot) || isTerminal(clean)) {
        const page = createPage(clean, basePaneId);
        panePages.set(basePaneId, page);
        dispose(old);
      } else {
        old.snapshot = clean;
        old.frame.title = clean.title;
        send(old, 'workhub:page-restore', {snapshot: clean, active: true});
      }
    } else {
      const contentId = paneContentKey(clean, basePaneId);
      store.bindContent(basePaneId, {type: 'conversation', conversationId: contentId});
      const page = createPage(clean, basePaneId);
      panePages.set(basePaneId, page);
    }
    store.setMaximized(null);
    schedulePersist();
    update();
  }

  window.addEventListener('message', event => {
    if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    const message = protocol.readPageMessage(event.data);
    if (!message) return;

    if (navigation?.frame.contentWindow === event.source) {
      if (message.type === 'workhub:page-ready') {
        navigation.ready = true;
        navigation.frame.contentDocument?.addEventListener('keydown', workspaceKeydown);
        send(navigation, 'workhub:page-restore', {snapshot: navigation.snapshot, active: !!navigation.visible});
        renderLayout();
      } else if (message.type === 'workhub:page-restored') {
        navigation.restored = true;
        navigation.wrapper.setAttribute('data-ready', '');
        renderLayout();
      } else if (message.type === 'workhub:navigation-modal') {
        navigation.modalOpen = message.open === true;
        renderNavigationModal();
      } else if (message.type === 'workhub:global-search' && navigation.visible) {
        search.open(navigation.frame.contentDocument?.getElementById('openGlobalSearch'));
      } else if (message.type === 'workhub:conversation-select') {
        const hasRealPane = [...panePages.values()].some(p => isPaneView(p.snapshot)) ||
          layoutEngine.listPanes(store.getLayout().root).some(p => p.content.type === 'conversation' && !p.content.conversationId.startsWith('landing:'));
        if (message.initial && (!allowInitialAutoSelect || !conversationsVisible || hasRealPane)) return;
        openConversation(message.snapshot);
      } else if (message.type === 'workhub:conversation-add') {
        openConversation(message.snapshot, 'split');
      } else if (message.type === 'workhub:page-open') {
        dispatchOpen(message);
      }
      return;
    }

    const page = allPages().find(candidate => candidate.mounted && candidate.frame.contentWindow === event.source);
    if (!page) return;
    const displayed = page === workspace || panePages.get(page.id) === page;
    if (!displayed && !['workhub:page-ready', 'workhub:page-restored', 'workhub:page-state'].includes(message.type)) return;

    if (message.type === 'workhub:page-ready') {
      page.ready = true;
      page.frame.contentDocument?.addEventListener('keydown', workspaceKeydown);
      send(page, 'workhub:page-pane', {split: page !== workspace && currentView().isSplit, shared: page !== workspace});
      send(page, 'workhub:page-restore', {snapshot: page.snapshot, active: !!page.visible});
      renderLayout();
    } else if (message.type === 'workhub:page-restored') {
      page.restored = true;
      renderLayout();
    } else if (message.type === 'workhub:page-state') {
      const clean = normalize(message.snapshot);
      if (page === workspace && conversationsVisible && clean.route === '/sessions') return;
      if (page !== workspace && clean.route !== '/sessions' && !isTerminal(clean)) {
        const original = page.snapshot;
        openPage(clean);
        send(page, 'workhub:page-restore', {snapshot: original, active: false});
        return;
      }
      if (clean.conversation?.creating && !isTerminal(clean)) clean.terminal = {...page.snapshot.terminal, ...clean.terminal};
      const prevSnap = page.snapshot;
      if (isConversation(clean) && prevSnap.conversation?.creating) {
        page.createdConversation = listIdentity(clean);
        disposeAlternate(page);
      } else if (isTerminal(clean) && clean.terminal?.id && !prevSnap.terminal?.id) {
        disposeAlternate(page);
      }
      page.snapshot = clean;
      page.frame.title = clean.title;
      if (displayed && page !== workspace && isPaneView(clean) && layoutEngine.findPane(store.getLayout().root, page.id)) {
        const prevKey = identity(prevSnap);
        const nextKey = identity(clean);
        const nextContentId = paneContentKey(clean, page.id);
        store.bindContent(page.id, {type: 'conversation', conversationId: nextContentId});
        if (nextKey !== prevKey || clean.title !== prevSnap.title || clean.environment !== prevSnap.environment) {
          schedulePersist();
        }
      }
      if (page === workspace && clean.route === '/sessions') openPage(clean);
      else if (displayed) update();
      if (isTerminal(clean)) send(navigation, 'workhub:terminals-changed');
    } else if (message.type === 'workhub:conversation-missing' && page !== workspace && displayed) {
      const currentIdentity = identity(page.snapshot);
      const missingIdentity = normalizeSessionIdentity(message.sessionId, message.environment || page.snapshot.environment);
      if (currentIdentity && currentIdentity !== missingIdentity) return;
      allowInitialAutoSelect = false;
      dispose(page);
      panePages.delete(page.id);
      store.bindContent(page.id, {type: 'empty'});
      schedulePersist();
      update();
    } else if (message.type === 'workhub:global-search' && page.visible) {
      search.open(page.frame.contentDocument?.getElementById('openGlobalSearch'));
    } else if (message.type === 'workhub:terminals-changed') {
      send(navigation, 'workhub:terminals-changed');
    } else if (message.type === 'workhub:conversation-kind') {
      switchCreation(page, message.kind, message.snapshot);
    } else if (message.type === 'workhub:page-open') {
      dispatchOpen(message, page === workspace ? activePaneId() : page.id);
    } else if (message.type === 'workhub:page-pane-command' && conversationsVisible) {
      switch (message.command) {
        case 'close': closePaneById(page.id); break;
        case 'zoom': toggleMaximizePane(page.id); break;
        case 'split-right': splitPaneInDirection(page.id, 'right'); break;
        case 'split-down': splitPaneInDirection(page.id, 'down'); break;
        case 'split-left': splitPaneInDirection(page.id, 'left'); break;
        case 'split-up': splitPaneInDirection(page.id, 'up'); break;
      }
    } else if (message.type === 'workhub:page-pane-drag' && conversationsVisible && page !== workspace) {
      if (message.phase === 'start') {
        startPaneDrag(page.id);
      } else if (message.phase === 'move' && typeof message.clientX === 'number' && typeof message.clientY === 'number') {
        const frameBox = page.frame.getBoundingClientRect();
        updatePaneDrag(frameBox.left + message.clientX, frameBox.top + message.clientY);
      } else if (message.phase === 'end') {
        commitPaneDrag();
      } else if (message.phase === 'cancel') {
        cancelPaneDrag();
      }
    } else if (message.type === 'workhub:page-focus' && currentView().paneRects.has(page.id)) {
      focusPane(page.id);
    }
  });

  document.addEventListener('keydown', workspaceKeydown);
  let resizePending = 0;
  window.addEventListener('resize', () => {
    if (typeof requestAnimationFrame !== 'function') { renderLayout(); return; }
    if (!resizePending) resizePending = requestAnimationFrame(() => { resizePending = 0; renderLayout(); });
  });
  window.addEventListener('workhub:desktop-chrome', renderLayout);
  window.addEventListener('pagehide', () => persistence.flush());
  window.addEventListener('workhub:desktop-home', () => {
    const page = currentPage();
    if (page?.ready) openPage({route: '/sessions', environment: page.snapshot.environment});
  });

  function followURL() {
    const destination = history.state?.yoluNavigation;
    if (destination?.id === historyID && destination.index !== visitIndex && visits[destination.index]) {
      const previous = visitIndex, visit = visits[destination.index];
      historyPending = false;
      restoringVisit = true;
      const retained = panePages.get(visit.pageID);
      const retainedMatches = retained && visitKey(retained.snapshot, retained.id) === visit.key;
      if (retainedMatches && (conversationsVisible || canClose(workspace))) {
        conversationsVisible = true;
        compactNavigationOpen = false;
        store.focus(retained.id);
        update();
      } else if (!retainedMatches) {
        dispatchOpen({snapshot: visit.snapshot});
      }
      restoringVisit = false;
      const active = conversationsVisible ? panePages.get(activePaneId()) : workspace;
      if (!active || visitKey(active.snapshot, visit.pageID) !== visit.key) {
        historyPending = true;
        history.go(previous - destination.index);
        return;
      }
      visits[destination.index] = {...visit, pageID: active.id, key: visitKey(active.snapshot, active.id)};
      visitIndex = destination.index;
      appliedURL = location.href;
      renderChrome();
      currentPage()?.frame.focus({preventScroll: true});
      return;
    }
    historyPending = false;
    if (appliedURL === location.href) return;
    appliedURL = location.href;
    openPage(locationSnapshot());
  }
  window.addEventListener('hashchange', followURL);
  window.addEventListener('popstate', followURL);

  function locationSnapshot() {
    const [route, query] = location.hash.slice(1).split('?');
    const environment = new URLSearchParams(location.search).get('environment') || 'local';
    const session = route === '/sessions' && new URLSearchParams(query).get('session');
    if (session) return {route, environment, conversation: {scope: {kind: 'all'}, selected: session, pane: 'detail'}};
    return {route: location.hash.slice(1) || '/sessions', environment};
  }

  const initial = normalize(locationSnapshot());
  const workspace = createPage(initial, 'workspace');
  sharedListWidth?.subscribe(paintConversationListWidth);
  openPage(initial);
})();
