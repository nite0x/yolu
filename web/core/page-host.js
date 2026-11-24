'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);

// A single workspace document handles page navigation. Conversation readers
// stay mounted independently so navigating away preserves each Agent's draft.
(() => {
  const desktop = document.documentElement.hasAttribute('data-workhub-desktop');
  const sharedListWidth = window.WorkHubListWidth;
  let navigation = null, compactNavigationOpen = false, conversationListWidth = 280;
  let conversationsVisible = false, conversationsPresented = false, appliedURL = location.href;
  const group = {pages:[], focused:'', zoomed:'', widths:[]};
  const historyID = crypto.randomUUID(), visits = [];
  let visitIndex = -1, restoringVisit = false, historyPending = false;
  try {
    const width = Number(localStorage.getItem('workhub:conversation-list-width:v1'));
    if (width >= 220 && width <= 520) conversationListWidth = width;
  } catch {}
  const reads = new Map();
  // Same-origin pages share startup metadata, with independent response bodies.
  // Explicit refreshes, abortable reads and writes retain their own lifecycle.
  window.WorkHubApp = {read(path,options) {
    if (options.method && options.method !== 'GET') {
      reads.clear();
      return fetch(path,options).finally(() => reads.clear());
    }
    if (/[?&]refresh=1(?:&|$)/.test(path)) {reads.clear(); return fetch(path,options);}
    const cacheable = /^\/api\/(state|environments|resource-icons)(\?|$)/.test(path) || /^\/api\/sessions\?(archived=true)?$/.test(path) || path === '/api/sessions/search';
    if (options.signal || !cacheable) return fetch(path,options);
    const key = JSON.stringify([path,options.headers]), cached = reads.get(key);
    if (cached && (!cached.updated || Date.now() - cached.updated < 1000)) return cached.promise.then(response => response.clone());
    const entry = {updated:0};
    entry.promise = fetch(path,options).then(response => {
      entry.updated = Date.now();
      if (!response.ok && reads.get(key) === entry) reads.delete(key);
      return response;
    },error => {if (reads.get(key) === entry) reads.delete(key); throw error;});
    reads.set(key,entry);
    for (const [key,value] of reads) if (value.updated && Date.now() - value.updated >= 1000) reads.delete(key);
    return entry.promise.then(response => response.clone());
  }};
  // Browser and desktop use the same top bar. Native initialization reuses
  // these containers and adds only operating-system window controls.
  let header = document.querySelector('.workhub-window-drag');
  if (!header) {
    header = document.createElement('header');
    header.className = 'workhub-window-drag';
    header.setAttribute('aria-label',uiText("窗口标题栏"));
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
  paneChrome.className = 'workspace-pane-chrome'; pages.append(paneChrome);
  const versions = page => [page, ...(page.alternate ? [page.alternate] : [])];
  const allPages = () => [workspace, ...group.pages.flatMap(versions)];
  const isConversation = snapshot => snapshot.route === '/sessions' && typeof snapshot.conversation?.selected === 'string' && !!snapshot.conversation.selected;
  const isConversationView = snapshot => isConversation(snapshot) || snapshot.route === '/sessions' && snapshot.conversation?.creating === true;
  const isTerminal = snapshot => snapshot.route === '/terminals';
  const listIdentity = snapshot => isTerminal(snapshot) && snapshot.terminal?.id ? JSON.stringify(['terminal',snapshot.environment,snapshot.terminal.id]) : snapshot.conversation?.selected;
  const isPaneView = snapshot => isConversationView(snapshot) || isTerminal(snapshot);
  // Local IDs remain plain strings; remote identities already include their environment.
  const identity = snapshot => {
    if (isTerminal(snapshot)) return snapshot.terminal?.id ? JSON.stringify(['terminal',snapshot.environment,snapshot.terminal.id]) : '';
    if (!isConversation(snapshot)) return '';
    let id = snapshot.conversation.selected;
    try { const pair = JSON.parse(id); if (Array.isArray(pair) && pair.length === 2) return JSON.stringify(pair); } catch {}
    return JSON.stringify([snapshot.environment, id]);
  };
  function normalize(value) {
    const snapshot = value && typeof value === 'object' ? value : {};
    const route = typeof snapshot.route === 'string' && /^\/(projects(?:\/[\w-]+(?:\/(?:git|worktrees))?)?|sessions|terminals|settings|issues)(?:\?[^#]*)?$/.test(snapshot.route) ? snapshot.route : '/sessions';
    return {...snapshot, route, environment:typeof snapshot.environment === 'string' ? snapshot.environment : 'local', title:typeof snapshot.title === 'string' ? snapshot.title.slice(0,200) : uiText("对话"), kind:route.split('/')[1].split('?')[0]};
  }
  function send(page,type,detail = {}) {
    if (page?.ready) page.frame.contentWindow.postMessage({type,...detail},location.origin);
  }
  const grouped = group => group.pages.length > 1;
  const sharedLayout = () => innerWidth > 760;
  const canSplit = group => group.pages.length < 3 && group.pages.every(page => isPaneView(page.snapshot));
  const conversationListBounds = () => sharedListWidth?.bounds() ?? {min:220,max:Math.max(220,Math.min(520,innerWidth - 360))};
  const renderedConversationListWidth = () => sharedListWidth?.current() ?? conversationListWidth;
  const wide = group => innerWidth - (sharedLayout() ? renderedConversationListWidth() : 0) >= Math.max(761,group.pages.length * 320 + 32);
  const visiblePages = group => !conversationsVisible ? [] : group.zoomed || !wide(group) ? [group.pages.find(page => page.id === (group.zoomed || group.focused)) || group.pages[0]].filter(Boolean) : group.pages;
  const visitKey = (snapshot, pageID) => JSON.stringify([snapshot.environment,snapshot.route,identity(snapshot) || (isPaneView(snapshot) ? pageID : '')]);
  function travel(offset) {
    if (historyPending || !visits[visitIndex + offset]) return;
    historyPending = true;
    history.go(offset);
  }
  function syncURL() {
    const page = conversationsVisible ? group.pages.find(page => page.id === group.focused) || group.pages[0] : workspace;
    if (!page) return;
    const url = new URL(location.href), snapshot = page.snapshot;
    if (snapshot.environment === 'local') url.searchParams.delete('environment'); else url.searchParams.set('environment',snapshot.environment);
    url.hash = conversationsVisible ? isConversation(snapshot) ? '/sessions?' + new URLSearchParams({session:snapshot.conversation.selected}) : '/sessions' : snapshot.route;
    if (!restoringVisit) {
      const snapshotCopy = JSON.parse(JSON.stringify(snapshot));
      const key = visitKey(snapshot,page.id), previous = visits[visitIndex];
      // Resolve the initially empty conversation destination in place.
      const resolving = previous?.snapshot.route === '/sessions' && !isPaneView(previous.snapshot) && snapshot.route === '/sessions' && previous.snapshot.environment === snapshot.environment;
      const changed = previous?.key !== key && !resolving;
      if (changed) {
        visits.splice(visitIndex + 1);
        visitIndex = visits.length;
      }
      visits[visitIndex] = {key,snapshot:snapshotCopy,pageID:page.id};
      const state = {...history.state,yoluNavigation:{id:historyID,index:visitIndex}};
      history[changed && visitIndex > 0 ? 'pushState' : 'replaceState'](state,'',url);
    }
    appliedURL = location.href;
    document.title = snapshot.title + ' · Yolu';
  }
  function renderChrome() {
    const page = currentPage();
    const controls = document.getElementById('workhubWindowControls');
    if (controls) window.WorkHubLayout.renderChrome(controls,{
      ready:!!page?.ready,
      activeView:page?.snapshot.kind,
      canGoBack:visitIndex > 0,
      canGoForward:visitIndex < visits.length - 1,
      back:() => travel(-1), forward:() => travel(1),
      navigate:view => openPage({route:'/' + view,environment:page?.snapshot.environment}),
      search:trigger => search.open(trigger),
      refresh:async () => {
        const targets = [navigation,page].filter(target => target?.ready && target.visible);
        const results = await Promise.allSettled(targets.map(async target => target.frame.contentWindow.WorkHubPage?.refresh?.()));
        if (results.some(result => result.status === 'rejected' || result.value === 'failed')) return 'failed';
        const statuses = results.map(result => result.value);
        if (statuses.includes('pending')) return 'pending';
        return statuses.includes('updated') ? 'updated' : 'cancelled';
      },
      appMenu:window.WorkHubDesktopWindow ? trigger => window.WorkHubDesktopWindow.showMenu(!!page?.ready, trigger) : undefined,
    });
  }
  function renderPaneChrome() {
    const owner = group, visible = visiblePages(group);
    window.WorkHubLayout.renderPanes(paneChrome,conversationsPresented && grouped(owner) ? {
      count:visible.length,resize:(index,width) => resizePane(owner,index,width),
      frames:visible.map(page => page.frame),container:pages,
    } : null);
    // On narrow windows keep every conversation reachable through a native selector.
    let switcher = document.getElementById('workspaceNarrowPanes');
    if (conversationsPresented && grouped(owner) && !wide(owner)) {
      if (!switcher) {switcher = document.createElement('select'); switcher.id = 'workspaceNarrowPanes'; switcher.setAttribute('aria-label',uiText("查看并列组合中的页面")); pages.append(switcher);}
      switcher.replaceChildren(...owner.pages.map((page,index) => {
        const option = document.createElement('option'); option.value = page.id;
        const title = page.snapshot.conversation?.creating && !page.snapshot.draftTitle ? uiText("新对话 {0}",index + 1) : page.snapshot.title;
        option.textContent = [title,page.snapshot.context].filter(Boolean).join(' · '); return option;
      }));
      switcher.value = owner.focused; switcher.onchange = () => {owner.zoomed = ''; focusPane(owner,switcher.value);}; switcher.hidden = false;
    } else if (switcher) switcher.hidden = true;
  }
  function paintConversationListWidth() {
    const width = renderedConversationListWidth() + 'px';
    document.body.style.setProperty('--workspace-conversation-list-width',width);
    // These frames are same-origin: resize both surfaces in the same paint,
    // without waiting for the navigation frame's message queue.
    navigation?.frame.contentDocument?.documentElement?.style.setProperty('--workspace-shared-list-width',width);
  }
  function renderNavigationModal() {
    const open = !!(navigation?.visible && (navigation.modalOpen || !sharedLayout()));
    navigation?.wrapper.toggleAttribute('data-modal',open);
    pages.toggleAttribute('inert',open);
    if (navigation) navigation.resizeHandle.hidden = !navigation.visible || open;
  }
  function currentPage() {
    return conversationsPresented ? group.pages.find(page => page.id === group.focused) || group.pages[0] : workspace;
  }
  function workspaceKeydown(event) {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    const mac = navigator.platform.startsWith('Mac');
    const direction = !event.shiftKey && (mac && event.metaKey && !event.ctrlKey && !event.altKey && ['[',']'].includes(event.key)
      ? event.key === '[' ? -1 : 1
      : !mac && event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowLeft','ArrowRight'].includes(event.key) ? event.key === 'ArrowLeft' ? -1 : 1 : 0);
    if (direction) {
      event.preventDefault(); travel(direction);
    } else if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      search.open(event.currentTarget.activeElement);
    } else if (event.key === 'Escape' && compactNavigationOpen && !navigation?.modalOpen) {
      event.preventDefault();
      compactNavigationOpen = false;
      renderLayout();
      navigationToggle.focus();
    }
  }
  function renderLayout() {
    const visible = visiblePages(group), split = grouped(group), shared = sharedLayout();
    if (!navigation) createNavigation();
    for (const page of visible) mountPage(page);
    // Prepare readers and shared navigation offscreen. Keep the current
    // workspace and its sidebar visible until the whole destination is ready.
    const destinationReady = visible.length > 0 && visible.every(page => page.restored) && (!shared || !!navigation?.restored);
    conversationsPresented = conversationsVisible && (conversationsPresented || destinationReady);
    const navVisible = shared || compactNavigationOpen;
    const splitVisible = conversationsPresented;
    navigationToggle.setAttribute('aria-expanded',String(!shared && navVisible));
    navigationToggle.textContent = !shared && navVisible ? uiText("关闭导航") : uiText("打开导航");
    if (navigation) {
      navigation.wrapper.hidden = !navVisible;
      if (navigation.visible !== navVisible) {
        navigation.visible = navVisible;
        send(navigation,'workhub:page-active',{active:navVisible});
      }
    }
    renderNavigationModal();
    paintConversationListWidth();
    document.body.toggleAttribute('data-workspace-navigation-visible',shared);
    document.body.toggleAttribute('data-workspace-conversations',splitVisible);
    pages.style.gridTemplateColumns = splitVisible ? visible.map(page => (visible.length === 1 ? 1 : group.widths[group.pages.indexOf(page)] || 1) + 'fr').join(' 8px ') : '';
    send(workspace,'workhub:page-pane',{split:false,shared:false});
    const workspaceVisible = !conversationsVisible || !conversationsPresented && !!workspace.visible;
    workspace.frame.hidden = !workspaceVisible;
    if (workspace.visible !== workspaceVisible) {
      workspace.visible = workspaceVisible;
      send(workspace,'workhub:page-active',{active:workspace.visible});
    }
    for (const page of group.pages) {
      const index = visible.indexOf(page), active = conversationsPresented && index >= 0;
      page.frame.hidden = !active;
      page.frame.style.gridColumn = active ? String(index * 2 + 1) : '';
      page.frame.dataset.focused = String((!desktop || split) && page.id === group.focused);
      send(page,'workhub:page-pane',{split,shared:true});
      if (page.visible !== active) {page.visible = active; send(page,'workhub:page-active',{active});}
      send(page,'workhub:parallel-layout',{split,focused:page.id === group.focused,zoomed:!!group.zoomed,canZoom:wide(group),canSplit:canSplit(group)});
    }
    const focused = group.pages.find(page => page.id === group.focused);
    const selected = conversationsVisible && focused ? listIdentity(focused.snapshot) : '';
    const createdConversation = !!selected && focused.createdConversation === selected;
    send(navigation,'workhub:navigation-route',{route:conversationsVisible ? '/sessions' : workspace.snapshot.route});
    send(navigation,'workhub:conversation-group',{
      targetTitle:focused?.snapshot.title,
      target:conversationsVisible ? focused?.snapshot : undefined,
      sessions:group.pages.map(page => listIdentity(page.snapshot)),selected,createdConversation,
      autoSelect:conversationsVisible && !group.pages.some(page => isTerminal(page.snapshot) || page.snapshot.conversation?.selected || page.snapshot.conversation?.creating),
      full:group.pages.length >= 3,listWidth:renderedConversationListWidth(),split,canSplit:canSplit(group),
    });
    if (createdConversation && navigation?.ready) delete focused.createdConversation;
    renderPaneChrome(); renderChrome();
    const current = currentPage();
    if (current?.visible && current.restored) search.remember(current.snapshot);
    if (!performance.getEntriesByName?.('workhub:layout-ready').length) performance.mark?.('workhub:layout-ready');
  }
  function update() {renderLayout(); syncURL(); renderChrome();}
  function focusPane(owner,id) {
    if (!owner.pages.some(page => page.id === id) || owner.focused === id) return;
    owner.focused = id;
    if (owner.zoomed) owner.zoomed = id;
    update();
  }
  function createPage(snapshot,id = crypto.randomUUID()) {
    snapshot = normalize(snapshot);
    const frame = document.createElement('iframe');
    frame.className = 'workspace-page'; frame.id = 'page-' + id; frame.title = snapshot.title; frame.hidden = true;
    const url = new URL('/',location.href); url.searchParams.set('app-page',id);
    if (id === 'shared-navigation') url.searchParams.set('app-navigation','1');
    if (snapshot.environment !== 'local') url.searchParams.set('environment',snapshot.environment);
    if (isTerminal(snapshot)) url.searchParams.set('app-terminal','1');
    url.hash = snapshot.route;
    const page = {id,snapshot,frame,url,ready:false,mounted:false};
    return page;
  }
  function mountPage(page, container = pages) {
    if (page.mounted) return;
    page.mounted = true;
    if (page.id !== 'workspace' && page.id !== 'shared-navigation') page.url.searchParams.set('app-conversation','1');
    if (grouped(group) && group.pages.includes(page)) page.url.searchParams.set('app-pane','1');
    page.url.searchParams.set('app-list-width',String(renderedConversationListWidth()));
    if (desktop) {
      page.url.searchParams.set('app-desktop','1');
      page.url.searchParams.set('app-sidebar-inset','0');
    }
    page.frame.src = page.url.href;
    // Set the initial URL before insertion. Navigating an already attached
    // blank iframe can add a child entry to the browser's joint history.
    container.append(page.frame);
  }
  function createNavigation() {
    const wrapper = document.createElement('aside'); wrapper.className = 'workspace-shared-navigation'; wrapper.setAttribute('aria-label',uiText("共享导航与对话列表"));
    wrapper.id = 'workspaceSharedList';
    const owner = group, current = owner?.pages.find(page => page.id === owner.focused) || owner?.pages[0];
    const page = createPage({...current?.snapshot,route:'/sessions',environment:current?.snapshot.environment || 'local',conversation:{...current?.snapshot.conversation,scope:pageScope(current?.snapshot || {}),pane:'list'}},'shared-navigation');
    page.frame.className = 'workspace-navigation-frame'; page.frame.removeAttribute('role'); page.frame.title = uiText("工作台导航与对话列表"); page.frame.hidden = false;
    const listSize = document.createElement('div'); listSize.className = 'workspace-shared-list-size'; listSize.setAttribute('aria-hidden','true');
    listSize.innerHTML = uiText("<div class=\"workspace-list-placeholder\"><div class=\"workspace-list-placeholder-search\"></div><p>正在读取对话…</p></div>");
    const resizeHandle = document.createElement('div'); resizeHandle.className = 'workspace-shared-list-resize'; resizeHandle.setAttribute('role','separator'); resizeHandle.tabIndex = 0;
    resizeHandle.setAttribute('aria-label',uiText("调整共享对话列表宽度")); resizeHandle.setAttribute('aria-orientation','vertical'); resizeHandle.setAttribute('aria-controls',wrapper.id);
    resizeHandle.title = uiText("拖动调整对话列表宽度，双击恢复默认");
    wrapper.append(listSize); navigation = {...page,wrapper,resizeHandle};
    mountPage(navigation,wrapper); document.body.append(wrapper,resizeHandle);
    let resizeFrame = 0;
    const paint = () => {resizeFrame = 0; paintConversationListWidth();};
    const resize = width => {
      if (sharedListWidth) { sharedListWidth.resize(width); return; }
      conversationListWidth = width;
      if (typeof requestAnimationFrame !== 'function') paint();
      else if (!resizeFrame) resizeFrame = requestAnimationFrame(paint);
    };
    const commit = () => {
      if (resizeFrame) {cancelAnimationFrame(resizeFrame); resizeFrame = 0;}
      paint(); renderLayout();
      if (sharedListWidth) sharedListWidth.save();
      else try {localStorage.setItem('workhub:conversation-list-width:v1',String(conversationListWidth));} catch {}
    };
    window.WorkHubLayout.setupSplitResize({handle:resizeHandle,container:document.body,panel:listSize,axis:'x',bounds:conversationListBounds,resize,commit});
    resizeHandle.addEventListener('dblclick',() => {resize(sharedListWidth?.defaultWidth ?? Math.min(280,conversationListBounds().max)); commit(); resizeHandle.setAttribute('aria-valuenow',String(renderedConversationListWidth()));});
  }
  function canClose(page) {
    try {return !page.ready || page.frame.contentWindow.WorkHubPage.canClose();} catch {return false;}
  }
  function dispose(page) {
    if (page.alternate) {const alternate = page.alternate; delete page.alternate; dispose(alternate);}
    send(page,'workhub:page-closing');
    try {page.frame.contentWindow.WorkHubPage?.dispose();} catch {}
    page.frame.remove();
    if (isTerminal(page.snapshot)) send(navigation,'workhub:terminals-changed');
  }
  function removePane(owner,id) {
    const index = owner.pages.findIndex(page => page.id === id);
    if (index < 0 || !canClose(owner.pages[index])) return;
    if (owner.pages.length === 1) {
      if (isTerminal(owner.pages[0].snapshot)) {
        const old = owner.pages[0], page = createPage({route:'/sessions',environment:old.snapshot.environment});
        owner.pages[0] = page; owner.focused = page.id; dispose(old); update();
      }
      return;
    }
    const [page] = owner.pages.splice(index,1); dispose(page);
    owner.widths.splice(index,1); owner.zoomed = '';
    if (owner.focused === id) owner.focused = owner.pages[Math.min(index,owner.pages.length - 1)].id;
    update();
  }
  function resizePane(owner,index,width) {
    const first = owner.pages[index].frame, next = owner.pages[index + 1].frame;
    const total = first.getBoundingClientRect().width + next.getBoundingClientRect().width;
    if (!total) return;
    const weight = owner.widths[index] + owner.widths[index + 1];
    owner.widths[index] = weight * width / total; owner.widths[index + 1] = weight - owner.widths[index];
    pages.style.gridTemplateColumns = owner.widths.map(value => value + 'fr').join(' 8px ');
  }
  function pageScope(snapshot) {
    if (isTerminal(snapshot) && snapshot.terminal?.projectID) return {kind:'project',id:snapshot.terminal.projectID,environment:snapshot.environment};
    if (snapshot.conversation?.scope) return snapshot.conversation.scope;
    return snapshot.terminal?.projectID ? {kind:'project',id:snapshot.terminal.projectID,environment:snapshot.environment} : {kind:'all'};
  }
  function preferredCreation(snapshot) {
    const scope = pageScope(snapshot), projectID = snapshot.terminal?.projectID || (scope.kind === 'project' ? scope.id : undefined);
    if (snapshot.environment !== 'local' || !projectID || window.WorkHubLayout.conversationDefaults.get('kind') !== 'terminal') return snapshot;
    return {...snapshot,route:'/terminals',title:uiText("新建终端"),terminal:{...snapshot.terminal,projectID}};
  }
  function dispatchOpen(message,owner = group,pageID = owner?.focused) {
    const snapshot = message.create && isTerminal(message.snapshot) ? {...message.snapshot,route:'/sessions',title:uiText("新建对话"),conversation:{scope:pageScope(message.snapshot),selected:null,creating:true,pane:'detail'}} : message.snapshot;
    const target = message.create ? preferredCreation(snapshot) : snapshot;
    if (target.route !== '/sessions' && !isTerminal(target)) openPage(target);
    else if (isPaneView(target)) openConversation(target,message.placement,owner,pageID);
    else openPage(target);
  }
  function switchCreation(owner,page,kind,snapshot) {
    if (owner !== group || !visiblePages(owner).includes(page) || !['ui','terminal'].includes(kind)) return;
    const source = normalize(snapshot), terminal = isTerminal(page.snapshot);
    if (terminal ? page.snapshot.terminal?.id || kind !== 'ui' : !page.snapshot.conversation?.creating || kind !== 'terminal') return;
    if (kind === 'terminal' && source.environment !== 'local' || !canClose(page)) return;
    window.WorkHubLayout.conversationDefaults.set('kind',kind);
    const scope = pageScope(source);
    const next = kind === 'terminal'
      ? {...source,route:'/terminals',title:uiText("新建终端"),terminal:{...source.terminal,projectID:source.terminal?.projectID || (scope.kind === 'project' ? scope.id : undefined)}}
      : {...source,route:'/sessions',title:uiText("新建对话"),conversation:{...source.conversation,scope,selected:null,creating:true,pane:'detail'}};
    // Keep each unfinished form mounted so changing form does not discard a
    // typed message, attachments or custom terminal options.
    const replacement = page.alternate || createPage(next);
    const contextKey = snapshot => JSON.stringify([snapshot.environment,snapshot.terminal?.projectID || '', snapshot.terminal?.cwd || '',snapshot.conversation?.creationDirectory || snapshot.conversation?.directory || '']);
    if (page.alternate && contextKey(replacement.snapshot) !== contextKey(next)) {
      replacement.snapshot = normalize(next);
      send(replacement,'workhub:page-restore',{snapshot:replacement.snapshot,active:false});
    }
    delete page.alternate;
    replacement.alternate = page;
    page.frame.hidden = true; page.visible = false;
    send(page,'workhub:page-active',{active:false});
    const index = owner.pages.indexOf(page); owner.pages[index] = replacement;
    owner.focused = replacement.id; owner.zoomed = '';
    update();
  }
  function openPage(snapshot) {
    const clean = normalize(snapshot);
    compactNavigationOpen = false;
    if (clean.route === '/sessions' || isTerminal(clean)) {
      conversationsVisible = true;
      if (!group.pages.length) {
        const page = createPage(clean); group.pages.push(page); group.widths.push(1); group.focused = page.id;
      } else if (isPaneView(clean)) {
        openConversation(clean,'current'); return;
      }
      renderLayout();
      if (clean.conversation?.scope && navigation) {
        navigation.snapshot = {...clean,route:'/sessions',conversation:{...clean.conversation,pane:'list'}};
        send(navigation,'workhub:page-restore',{snapshot:navigation.snapshot,active:true});
      }
    } else {
      if (!canClose(workspace)) return;
      conversationsVisible = false;
      workspace.snapshot = clean;
      send(workspace,'workhub:page-restore',{snapshot:clean,active:true});
    }
    update();
  }
  function openConversation(snapshot,placement = 'current',owner = group,pageID = owner.focused) {
    const clean = normalize(snapshot);
    if (!isPaneView(clean)) {openPage(clean); return;}
    compactNavigationOpen = false;
    conversationsVisible = true;
    const key = identity(clean), existing = key && owner.pages.find(page => identity(page.snapshot) === key);
    if (existing) {owner.zoomed = ''; owner.focused = existing.id; update(); existing.frame.focus(); return;}
    if (!owner.pages.length || placement === 'split') {
      if (!canSplit(owner)) return;
      const page = createPage(clean), index = Math.max(0,owner.pages.findIndex(page => page.id === pageID) + 1);
      owner.pages.splice(index,0,page); owner.widths.splice(index,0,1); owner.focused = page.id;
    } else {
      const index = owner.pages.findIndex(page => page.id === pageID), old = owner.pages[index];
      if (!old || !canClose(old)) return;
      if (isTerminal(old.snapshot) || isTerminal(clean)) {
        const page = createPage(clean); owner.pages[index] = page; owner.focused = page.id; dispose(old);
      } else {
        old.snapshot = clean; old.frame.title = clean.title;
        send(old,'workhub:page-restore',{snapshot:clean,active:true});
      }
    }
    owner.zoomed = ''; update();
  }
  window.addEventListener('message',event => {
    if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    const message = event.data;
    if (navigation?.frame.contentWindow === event.source) {
      if (message.type === 'workhub:page-ready') {
        navigation.ready = true;
        navigation.frame.contentDocument?.addEventListener('keydown', workspaceKeydown);
        send(navigation,'workhub:page-restore',{snapshot:navigation.snapshot,active:!!navigation.visible}); renderLayout();
      } else if (message.type === 'workhub:page-restored') {
        navigation.restored = true;
        navigation.wrapper.setAttribute('data-ready','');
        renderLayout();
      } else if (message.type === 'workhub:navigation-modal') {
        navigation.modalOpen = message.open === true;
        renderNavigationModal();
      }
      else if (message.type === 'workhub:global-search' && navigation.visible) search.open(navigation.frame.contentDocument?.getElementById('openGlobalSearch'));
      else if (message.type === 'workhub:conversation-select') {
        if (message.initial && (!conversationsVisible || group.pages.some(page => isPaneView(page.snapshot)))) return;
        openConversation(message.snapshot);
      } else if (message.type === 'workhub:conversation-add') openConversation(message.snapshot,'split');
      else if (message.type === 'workhub:page-open') dispatchOpen(message);
      return;
    }
    const page = allPages().find(page => page.frame.contentWindow === event.source);
    if (!page) return;
    const displayed = page === workspace || group.pages.includes(page);
    if (!displayed && !['workhub:page-ready','workhub:page-restored','workhub:page-state'].includes(message.type)) return;
    if (message.type === 'workhub:page-ready') {
      page.ready = true;
      page.frame.contentDocument?.addEventListener('keydown', workspaceKeydown);
      send(page,'workhub:page-pane',{split:page !== workspace && grouped(group),shared:page !== workspace});
      send(page,'workhub:page-restore',{snapshot:page.snapshot,active:!!page.visible});
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
        send(page,'workhub:page-restore',{snapshot:original,active:false});
        return;
      }
      if (clean.conversation?.creating && !isTerminal(clean)) clean.terminal = {...page.snapshot.terminal,...clean.terminal};
      if (isConversation(clean) && page.snapshot.conversation?.creating) page.createdConversation = listIdentity(clean);
      page.snapshot = clean; page.frame.title = clean.title;
      if (page === workspace && clean.route === '/sessions') openPage(clean);
      else if (displayed) update();
      if (isTerminal(clean)) send(navigation,'workhub:terminals-changed');
    } else if (message.type === 'workhub:global-search' && page.visible) search.open(page.frame.contentDocument?.getElementById('openGlobalSearch'));
    else if (message.type === 'workhub:terminals-changed') send(navigation,'workhub:terminals-changed');
    else if (message.type === 'workhub:conversation-kind') switchCreation(group,page,message.kind,message.snapshot);
    else if (message.type === 'workhub:page-open') dispatchOpen(message,group,page === workspace ? group.focused : page.id);
    else if (message.type === 'workhub:page-pane-command' && conversationsVisible) {
      if (message.command === 'close') removePane(group,page.id);
      else if (message.command === 'zoom' && wide(group)) {group.focused = page.id; group.zoomed = group.zoomed ? '' : page.id; update();}
    } else if (message.type === 'workhub:page-focus' && visiblePages(group).includes(page)) focusPane(group,page.id);
  });
  document.addEventListener('keydown', workspaceKeydown);
  window.addEventListener('resize',renderLayout);
  window.addEventListener('workhub:desktop-chrome',renderLayout);
  window.addEventListener('workhub:desktop-home', () => {
    const page = currentPage();
    if (page?.ready) openPage({route:'/sessions',environment:page.snapshot.environment});
  });
  function followURL() {
    const destination = history.state?.yoluNavigation;
    if (destination?.id === historyID && destination.index !== visitIndex && visits[destination.index]) {
      const previous = visitIndex, visit = visits[destination.index];
      historyPending = false;
      restoringVisit = true;
      const retained = group.pages.find(page => page.id === visit.pageID && visitKey(page.snapshot,page.id) === visit.key);
      // Reuse retained readers to preserve drafts, scroll position and splits.
      if (retained && (conversationsVisible || canClose(workspace))) {
        conversationsVisible = true; compactNavigationOpen = false;
        group.focused = retained.id;
        if (group.zoomed) group.zoomed = retained.id;
        update();
      } else if (!retained) dispatchOpen({snapshot:visit.snapshot});
      restoringVisit = false;
      const active = conversationsVisible ? group.pages.find(page => page.id === group.focused) : workspace;
      if (!active || visitKey(active.snapshot,visit.pageID) !== visit.key) {
        // Respect the existing close guard for unfinished actions.
        historyPending = true; history.go(previous - destination.index);
        return;
      }
      visits[destination.index] = {...visit,pageID:active.id,key:visitKey(active.snapshot,active.id)};
      visitIndex = destination.index;
      appliedURL = location.href;
      renderChrome();
      currentPage()?.frame.focus({preventScroll:true});
      return;
    }
    historyPending = false;
    if (appliedURL === location.href) return;
    appliedURL = location.href;
    openPage(locationSnapshot());
  }
  window.addEventListener('hashchange',followURL);
  window.addEventListener('popstate',followURL);
  function locationSnapshot() {
    const [route, query] = location.hash.slice(1).split('?');
    const environment = new URLSearchParams(location.search).get('environment') || 'local';
    const session = route === '/sessions' && new URLSearchParams(query).get('session');
    if (session) return {route, environment, conversation:{scope:{kind:'all'},selected:session,pane:'detail'}};
    return {route:location.hash.slice(1) || '/sessions',environment};
  }
  const initial = normalize(locationSnapshot());
  const workspace = createPage({...initial,route:initial.route === '/sessions' ? '/projects' : initial.route},'workspace');
  sharedListWidth?.subscribe(paintConversationListWidth);
  mountPage(workspace);
  openPage(initial);
})();
