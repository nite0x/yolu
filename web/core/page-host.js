'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);

// A single workspace document handles page navigation. Conversation readers
// stay mounted independently so navigating away preserves each Agent's draft.
(() => {
  let navigation = null, navigationWidth = 244, conversationListWidth = 280;
  let conversationsVisible = false, appliedURL = location.href;
  const group = {pages:[], focused:'', zoomed:'', widths:[]};
  try {
    const width = Number(localStorage.getItem('workhub:conversation-list-width:v1'));
    if (width >= 220 && width <= 520) conversationListWidth = width;
    const collapsed = localStorage.getItem('workhub:sidebar-collapsed:v1');
    const sidebar = Number(localStorage.getItem('workhub:sidebar-width:v1'));
    navigationWidth = collapsed === 'true' || collapsed === null && innerWidth > 760 && innerWidth < 1100 ? (document.documentElement.hasAttribute('data-workhub-desktop') ? 60 : 72) : sidebar >= 212 && sidebar <= 420 ? sidebar : 244;
  } catch {}
  const reads = new Map();
  // Same-origin pages share startup metadata, with independent response bodies.
  // Explicit refreshes, abortable reads and writes retain their own lifecycle.
  window.WorkHubWorkspace = {read(path,options) {
    if (options.method && options.method !== 'GET') {
      reads.clear();
      return fetch(path,options).finally(() => reads.clear());
    }
    if (/[?&]refresh=1(?:&|$)/.test(path)) {reads.clear(); return fetch(path,options);}
    if (options.signal || !/^\/api\/(state|task-inventory|environments|shortcut-pins)(\?|$)/.test(path)) return fetch(path,options);
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
  const pages = document.getElementById('workspacePages');
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
    const route = typeof snapshot.route === 'string' && /^\/(requirements(?:\/[\w-]+)?|projects(?:\/[\w-]+(?:\/(?:git|worktrees))?)?|sessions|terminals|settings)(?:\?[^#]*)?$/.test(snapshot.route) ? snapshot.route : '/requirements';
    return {...snapshot, route, environment:typeof snapshot.environment === 'string' ? snapshot.environment : 'local', title:typeof snapshot.title === 'string' ? snapshot.title.slice(0,200) : uiText("任务"), kind:route.split('/')[1].split('?')[0]};
  }
  function send(page,type,detail = {}) {
    if (page?.ready) page.frame.contentWindow.postMessage({type,...detail},location.origin);
  }
  const grouped = group => group.pages.length > 1;
  const sharedLayout = () => conversationsVisible && (innerWidth > 760 || grouped(group) || group.pages.some(page => isTerminal(page.snapshot)));
  const canSplit = group => group.pages.length < 3 && group.pages.every(page => isPaneView(page.snapshot));
  const wide = group => innerWidth - navigationWidth - conversationListWidth >= Math.max(761,group.pages.length * 320 + 32);
  const visiblePages = group => !conversationsVisible ? [] : group.zoomed || !wide(group) ? [group.pages.find(page => page.id === (group.zoomed || group.focused)) || group.pages[0]].filter(Boolean) : group.pages;
  function syncURL() {
    const page = conversationsVisible ? group.pages.find(page => page.id === group.focused) || group.pages[0] : workspace;
    if (!page) return;
    const url = new URL(location.href), snapshot = page.snapshot;
    if (snapshot.environment === 'local') url.searchParams.delete('environment'); else url.searchParams.set('environment',snapshot.environment);
    url.hash = conversationsVisible ? '/sessions' : snapshot.route;
    if (url.href !== location.href) history.pushState(null,'',url);
    appliedURL = location.href;
    document.title = snapshot.title + ' · Yolu';
  }
  function renderChrome() {
    const page = conversationsVisible ? sharedLayout() ? navigation : group.pages[0] : workspace;
    const sidebarWidth = sharedLayout() ? navigationWidth : page?.chrome?.left ?? navigationWidth;
    document.body.toggleAttribute('data-workspace-sidebar-collapsed',sidebarWidth < 120);
    document.body.style.setProperty('--workspace-window-sidebar-width',sidebarWidth + 'px');
    const controls = document.getElementById('workhubWindowControls');
    if (controls) window.WorkHubLayout.renderChrome(controls,{
      collapsed:sidebarWidth < 120,ready:!!page?.ready,
      toggle:() => page?.frame.contentDocument?.querySelector('.sidebar-toggle')?.click(),
      home:() => openPage({route:'/requirements',environment:page?.snapshot.environment}),
    });
  }
  function renderPaneChrome() {
    const owner = group, visible = visiblePages(group);
    window.WorkHubLayout.renderPanes(paneChrome,conversationsVisible && grouped(owner) ? {
      count:visible.length,resize:(index,width) => resizePane(owner,index,width),
      frames:visible.map(page => page.frame),container:pages,
    } : null);
    // On narrow windows keep every conversation reachable through a native selector.
    let switcher = document.getElementById('workspaceNarrowPanes');
    if (conversationsVisible && grouped(owner) && !wide(owner)) {
      if (!switcher) {switcher = document.createElement('select'); switcher.id = 'workspaceNarrowPanes'; switcher.setAttribute('aria-label',uiText("查看并列组合中的页面")); pages.append(switcher);}
      switcher.replaceChildren(...owner.pages.map(page => {const option = document.createElement('option'); option.value = page.id; option.textContent = [page.snapshot.context,page.snapshot.title].filter(Boolean).join(' / '); return option;}));
      switcher.value = owner.focused; switcher.onchange = () => {owner.zoomed = ''; focusPane(owner,switcher.value);}; switcher.hidden = false;
    } else if (switcher) switcher.hidden = true;
  }
  function paintConversationListWidth() {
    const width = conversationListWidth + 'px';
    document.body.style.setProperty('--workspace-conversation-list-width',width);
    // These frames are same-origin: resize both surfaces in the same paint,
    // without waiting for the navigation frame's message queue.
    navigation?.frame.contentDocument?.documentElement?.style.setProperty('--workspace-shared-list-width',width);
  }
  function renderLayout() {
    const visible = visiblePages(group), split = grouped(group), shared = sharedLayout();
    if (shared && !navigation) createNavigation();
    if (navigation) {
      navigation.wrapper.hidden = !shared;
      navigation.resizeHandle.hidden = !shared;
      if (navigation.visible !== shared) {
        navigation.visible = shared;
        send(navigation,'workhub:page-active',{active:shared});
      }
    }
    document.body.style.setProperty('--workspace-shared-sidebar-width',navigationWidth + 'px');
    paintConversationListWidth();
    document.body.toggleAttribute('data-workspace-conversations',shared);
    pages.style.gridTemplateColumns = shared ? visible.map(page => (visible.length === 1 ? 1 : group.widths[group.pages.indexOf(page)] || 1) + 'fr').join(' 8px ') : '';
    send(workspace,'workhub:page-pane',{split:false,shared:false});
    workspace.frame.hidden = conversationsVisible;
    if (workspace.visible !== !conversationsVisible) {
      workspace.visible = !conversationsVisible;
      send(workspace,'workhub:page-active',{active:workspace.visible});
    }
    for (const page of group.pages) {
      const index = visible.indexOf(page), active = index >= 0;
      if (active) mountPage(page);
      page.frame.hidden = !active;
      page.frame.style.gridColumn = shared && active ? String(index * 2 + 1) : '';
      page.frame.dataset.focused = String(page.id === group.focused);
      send(page,'workhub:page-pane',{split,shared});
      if (page.visible !== active) {page.visible = active; send(page,'workhub:page-active',{active});}
      send(page,'workhub:parallel-layout',{split,focused:page.id === group.focused,zoomed:!!group.zoomed,canZoom:wide(group),canSplit:canSplit(group)});
    }
    if (navigation && shared) send(navigation,'workhub:conversation-group',{
      targetTitle:group.pages.find(page => page.id === group.focused)?.snapshot.title,
      target:group.pages.find(page => page.id === group.focused)?.snapshot,
      sessions:group.pages.map(page => listIdentity(page.snapshot)),selected:listIdentity(group.pages.find(page => page.id === group.focused)?.snapshot || {}),
      autoSelect:!group.pages.some(page => isTerminal(page.snapshot) || page.snapshot.conversation?.selected || page.snapshot.conversation?.creating),
      full:group.pages.length >= 3,listWidth:conversationListWidth,split,canSplit:canSplit(group),
    });
    renderPaneChrome(); renderChrome();
    if (!performance.getEntriesByName?.('workhub:layout-ready').length) performance.mark?.('workhub:layout-ready');
  }
  function update() {renderLayout(); syncURL();}
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
    const url = new URL('/',location.href); url.searchParams.set('workspace-page',id);
    if (id === 'shared-navigation') url.searchParams.set('workspace-navigation','1');
    if (snapshot.environment !== 'local') url.searchParams.set('environment',snapshot.environment);
    if (isTerminal(snapshot)) url.searchParams.set('workspace-terminal','1');
    url.hash = snapshot.route;
    const page = {id,snapshot,frame,url,ready:false,mounted:false};
    pages.append(frame); return page;
  }
  function mountPage(page) {
    if (page.mounted) return;
    page.mounted = true;
    if (sharedLayout() && page.id !== 'workspace' && page.id !== 'shared-navigation') page.url.searchParams.set('workspace-conversation','1');
    if (grouped(group) && group.pages.includes(page)) page.url.searchParams.set('workspace-pane','1');
    page.url.searchParams.set('workspace-list-width',String(conversationListWidth));
    page.url.searchParams.set('workspace-sidebar-width',String(navigationWidth));
    if (document.documentElement.hasAttribute('data-workhub-desktop')) {
      page.url.searchParams.set('workspace-desktop','1');
      page.url.searchParams.set('workspace-sidebar-inset','0');
    }
    page.frame.src = page.url.href;
  }
  function createNavigation() {
    const wrapper = document.createElement('aside'); wrapper.className = 'workspace-shared-navigation'; wrapper.setAttribute('aria-label',uiText("共享导航与对话列表"));
    wrapper.id = 'workspaceSharedList';
    const owner = group, current = owner?.pages.find(page => page.id === owner.focused) || owner?.pages[0];
    const page = createPage({...current?.snapshot,route:'/sessions',environment:current?.snapshot.environment || 'local',conversation:{...current?.snapshot.conversation,scope:pageScope(current?.snapshot || {}),pane:'list'}},'shared-navigation');
    page.frame.className = 'workspace-navigation-frame'; page.frame.removeAttribute('role'); page.frame.title = uiText("工作台导航与对话列表"); page.frame.hidden = false;
    const listSize = document.createElement('div'); listSize.className = 'workspace-shared-list-size'; listSize.setAttribute('aria-hidden','true');
    listSize.innerHTML = uiText("<div class=\"workspace-list-placeholder\"><strong>对话</strong><div class=\"workspace-list-placeholder-search\"></div><div class=\"workspace-list-placeholder-filters\"></div><p>正在读取对话…</p></div>");
    const resizeHandle = document.createElement('div'); resizeHandle.className = 'workspace-shared-list-resize'; resizeHandle.setAttribute('role','separator'); resizeHandle.tabIndex = 0;
    resizeHandle.setAttribute('aria-label',uiText("调整共享对话列表宽度")); resizeHandle.setAttribute('aria-orientation','vertical'); resizeHandle.setAttribute('aria-controls',wrapper.id);
    resizeHandle.title = uiText("拖动调整对话列表宽度，双击恢复默认");
    wrapper.append(page.frame,listSize); document.body.append(wrapper,resizeHandle); navigation = {...page,wrapper,resizeHandle};
    mountPage(navigation);
    const bounds = () => ({min:220,max:Math.max(220,Math.min(520,innerWidth - navigationWidth - 360))});
    let resizeFrame = 0;
    const paint = () => {resizeFrame = 0; paintConversationListWidth();};
    const resize = width => {
      conversationListWidth = width;
      if (typeof requestAnimationFrame !== 'function') paint();
      else if (!resizeFrame) resizeFrame = requestAnimationFrame(paint);
    };
    const commit = () => {
      if (resizeFrame) {cancelAnimationFrame(resizeFrame); resizeFrame = 0;}
      paint(); renderLayout();
      try {localStorage.setItem('workhub:conversation-list-width:v1',String(conversationListWidth));} catch {}

    };
    window.WorkHubLayout.setupSplitResize({handle:resizeHandle,container:document.body,panel:listSize,axis:'x',bounds,resize,commit});
    resizeHandle.addEventListener('dblclick',() => {const limit = bounds(); resize(Math.min(280,limit.max)); commit(); resizeHandle.setAttribute('aria-valuenow',String(conversationListWidth));});
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
    if (isTerminal(snapshot) && snapshot.terminal?.taskID) return {kind:'task',id:snapshot.terminal.taskID,environment:snapshot.environment};
    if (snapshot.conversation?.scope) return snapshot.conversation.scope;
    return snapshot.terminal?.taskID ? {kind:'task',id:snapshot.terminal.taskID,environment:snapshot.environment} : {kind:'all'};
  }
  function preferredCreation(snapshot) {
    const scope = pageScope(snapshot), taskID = snapshot.terminal?.taskID || (scope.kind === 'task' ? scope.id : undefined);
    if (snapshot.environment !== 'local' || !taskID || window.WorkHubLayout.conversationDefaults.get('kind') !== 'terminal') return snapshot;
    return {...snapshot,route:'/terminals',title:uiText("新建终端"),terminal:{...snapshot.terminal,taskID}};
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
    const scope = pageScope(source), environment = source.environment;
    const next = kind === 'terminal'
      ? {...source,route:'/terminals',title:uiText("新建终端"),terminal:{taskID:source.terminal?.taskID || (scope.kind === 'task' ? scope.id : undefined),projectID:source.terminal?.projectID}}
      : {...source,route:'/sessions',title:uiText("新建对话"),conversation:{...source.conversation,scope:source.terminal?.taskID ? {kind:'task',id:source.terminal.taskID,environment} : scope,selected:null,creating:true,pane:'detail'}};
    // Keep each unfinished form mounted so changing form does not discard a
    // typed message, attachments or custom terminal options.
    const replacement = page.alternate || createPage(next);
    const contextKey = snapshot => JSON.stringify([snapshot.environment,snapshot.terminal?.taskID || (pageScope(snapshot).kind === 'task' ? pageScope(snapshot).id : ''),snapshot.terminal?.projectID || '',snapshot.conversation?.creationDirectory || snapshot.conversation?.directory || '']);
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
      workspace.frame.contentWindow.dispatchEvent(new workspace.frame.contentWindow.Event('workhub:sidebar-sync'));
    }
    update();
  }
  function openConversation(snapshot,placement = 'current',owner = group,pageID = owner.focused) {
    const clean = normalize(snapshot);
    if (!isPaneView(clean)) {openPage(clean); return;}
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
        send(navigation,'workhub:page-restore',{snapshot:navigation.snapshot,active:conversationsVisible}); renderLayout();
      } else if (message.type === 'workhub:page-restored') navigation.wrapper.setAttribute('data-ready','');
      else if (message.type === 'workhub:conversation-select') {
        if (message.initial && (!conversationsVisible || group.pages.some(page => isPaneView(page.snapshot)))) return;
        openConversation(message.snapshot);
      } else if (message.type === 'workhub:conversation-add') openConversation(message.snapshot,'split');
      else if (message.type === 'workhub:page-open') dispatchOpen(message);
      else if (message.type === 'workhub:page-chrome' && Number.isFinite(message.chrome?.left)) {
        navigationWidth = Math.max(60,Math.min(520,message.chrome.left)); renderLayout();
      }
      return;
    }
    const page = allPages().find(page => page.frame.contentWindow === event.source);
    if (!page) return;
    const displayed = page === workspace || group.pages.includes(page);
    if (!displayed && !['workhub:page-ready','workhub:page-state'].includes(message.type)) return;
    if (message.type === 'workhub:page-ready') {
      page.ready = true;
      send(page,'workhub:page-pane',{split:page !== workspace && grouped(group),shared:page !== workspace && sharedLayout()});
      send(page,'workhub:page-restore',{snapshot:page.snapshot,active:page === workspace ? !conversationsVisible : visiblePages(group).includes(page)});
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
      page.snapshot = clean; page.frame.title = clean.title;
      if (page === workspace && clean.route === '/sessions') openPage(clean);
      else if (displayed) update();
      if (isTerminal(clean)) send(navigation,'workhub:terminals-changed');
    } else if (message.type === 'workhub:terminals-changed') send(navigation,'workhub:terminals-changed');
    else if (message.type === 'workhub:conversation-kind') switchCreation(group,page,message.kind,message.snapshot);
    else if (message.type === 'workhub:page-open') dispatchOpen(message,group,page === workspace ? group.focused : page.id);
    else if (message.type === 'workhub:page-pane-command' && conversationsVisible) {
      if (message.command === 'close') removePane(group,page.id);
      else if (message.command === 'zoom' && wide(group)) {group.focused = page.id; group.zoomed = group.zoomed ? '' : page.id; update();}
    } else if (message.type === 'workhub:page-focus' && visiblePages(group).includes(page)) focusPane(group,page.id);
    else if (message.type === 'workhub:page-chrome' && Number.isFinite(message.chrome?.left)) {page.chrome = message.chrome; renderChrome();}
  });
  window.addEventListener('resize',renderLayout);
  window.addEventListener('workhub:desktop-chrome',renderLayout);
  function followURL() {
    if (appliedURL === location.href) return;
    appliedURL = location.href;
    openPage({route:location.hash.slice(1),environment:new URLSearchParams(location.search).get('environment') || 'local'});
  }
  window.addEventListener('hashchange',followURL);
  window.addEventListener('popstate',followURL);
  const initial = {route:location.hash.slice(1),environment:new URLSearchParams(location.search).get('environment') || 'local'};
  const workspace = createPage({...initial,route:initial.route === '/sessions' ? '/requirements' : initial.route},'workspace');
  mountPage(workspace);
  openPage(initial);
})();
