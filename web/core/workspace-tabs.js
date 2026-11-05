'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


(() => {
  const storageKey = 'workhub:workspace-tabs:v1';
  const tabs = [];
  let selected = '', initialized = false, saveTimer, lastSaved = '', barSignature = '', tabBarHeight = 0;
  let writes = Promise.resolve(), pickerID = 0, picker = null, navigation = null, navigationWidth = 244;
  let conversationListWidth = 280;
  try {const value = Number(localStorage.getItem('workhub:conversation-list-width:v1')); if (Number.isFinite(value) && value >= 220 && value <= 520) conversationListWidth = value;} catch {}
  try {
    const collapsed = localStorage.getItem('workhub:sidebar-collapsed:v1');
    const width = Number(localStorage.getItem('workhub:sidebar-width:v1'));
    navigationWidth = collapsed === 'true' || collapsed === null && innerWidth > 760 && innerWidth < 1100 ? (document.documentElement.hasAttribute('data-workhub-desktop') ? 60 : 72) : width >= 212 && width <= 420 ? width : 244;
  } catch {}
  const headers = {'Content-Type':'application/json', 'X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content, 'X-Environment-ID':'local'};
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
  const bar = document.getElementById('workspaceTabBar'), pages = document.getElementById('workspacePages');
  const paneChrome = document.createElement('div'), pickerRoot = document.createElement('div');
  paneChrome.className = 'workspace-pane-chrome'; pages.append(paneChrome); document.body.append(pickerRoot);
  const activeTab = () => tabs.find(tab => tab.id === selected);
  const versions = page => [page, ...(page.alternate ? [page.alternate] : [])];
  const allPages = () => tabs.flatMap(tab => tab.pages.flatMap(versions));
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
    const route = typeof snapshot.route === 'string' && /^\/(requirements(?:\/[\w-]+)?|projects|sessions|terminals|settings)$/.test(snapshot.route) ? snapshot.route : '/requirements';
    const {parallel, ...clean} = snapshot;
    return {...clean, route, environment:typeof snapshot.environment === 'string' ? snapshot.environment : 'local', title:typeof snapshot.title === 'string' ? snapshot.title.slice(0,200) : uiText("任务"), kind:route.split('/')[1]};
  }
  function tabSnapshot(tab) {
    return {...tab.pages[0].snapshot, ...(isPaneView(tab.pages[0].snapshot) ? {conversationListWidth} : {}), ...(tab.pages.length > 1 ? {parallel:{panes:tab.pages.slice(1).map(page => page.snapshot), widths:tab.widths, listWidth:conversationListWidth, focused:tab.pages.findIndex(page => page.id === tab.focused)}} : {})};
  }
  const payload = () => ({selected,tabs:tabs.map(tab => ({id:tab.id,snapshot:tabSnapshot(tab)}))});
  function flush() {
    clearTimeout(saveTimer);
    if (!initialized || !selected || typeof fetch !== 'function') return;
    const body = JSON.stringify(payload());
    if (body === lastSaved) return;
    lastSaved = body;
    writes = writes.catch(() => {}).then(async () => {
      const response = await fetch('/api/workspace-tabs', {method:'PUT',headers,body,keepalive:true});
      if (!response.ok) throw new Error(uiText("标签页保存失败"));
    }).catch(() => {lastSaved = '';});
  }
  function save() {
    if (!selected) return;
    try { localStorage.setItem(storageKey,JSON.stringify(payload())); } catch {}
    clearTimeout(saveTimer); saveTimer = setTimeout(flush,250);
  }
  function send(page,type,detail = {}) {
    if (page?.ready) page.frame.contentWindow.postMessage({type,...detail},location.origin);
  }
  const grouped = tab => !!tab && tab.pages.length > 1;
  const canSplit = tab => !!tab && tab.pages.length < 3 && tab.pages.every(page => isPaneView(page.snapshot));
  // Geometry belongs to the route, including empty/loading lists. Waiting for
  // a selected session paints the ordinary workspace before switching shells.
  const conversationLayout = tab => grouped(tab) || !!tab && tab.pages.every(page => isTerminal(page.snapshot)) || innerWidth > 760 && !!tab && tab.pages.every(page => page.snapshot.route === '/sessions' || isTerminal(page.snapshot));
  const wide = tab => innerWidth - navigationWidth - conversationListWidth >= Math.max(761,tab.pages.length * 320 + 32);
  const visiblePages = tab => !tab ? [] : !grouped(tab) ? tab.pages : tab.zoomed || !wide(tab) ? [tab.pages.find(page => page.id === (tab.zoomed || tab.focused)) || tab.pages[0]] : tab.pages;
  function syncURL(tab) {
    if (!tab) return;
    const snapshot = tab.pages[0].snapshot, url = new URL(location.href);
    if (snapshot.environment === 'local') url.searchParams.delete('environment'); else url.searchParams.set('environment',snapshot.environment);
    url.hash = snapshot.route; history.replaceState(null,'',url);
    document.title = snapshot.title + (grouped(tab) ? ' +' + (tab.pages.length - 1) : '') + ' · Yolu';
  }
  function renderChrome() {
    const controls = document.getElementById('workhubWindowControls'), tab = activeTab(), page = tab?.pages[0];
    const sidebarWidth = conversationLayout(tab) ? navigationWidth : page?.chrome?.left ?? navigationWidth;
    document.body.toggleAttribute('data-workspace-sidebar-collapsed',sidebarWidth < 120);
    document.body.style.setProperty('--workspace-window-sidebar-width',sidebarWidth + 'px');
    for (const child of [...allPages(), ...(navigation ? [navigation] : [])]) syncSidebarChrome(child.frame);
    if (!controls) return;
    window.WorkHubTabbar.renderChrome(controls,{
      collapsed:(conversationLayout(tab) ? navigationWidth : page?.chrome?.left ?? 244) < 120,ready:conversationLayout(tab) ? !!navigation?.ready : !!page?.ready,
      toggle:() => (conversationLayout(tab) ? navigation : page)?.frame.contentDocument?.querySelector('.sidebar-toggle')?.click(),
      canCreate:initialized,create:() => add({environment:activeTab()?.pages[0].snapshot.environment}),
      home:() => add({route:'/requirements',environment:activeTab()?.pages[0].snapshot.environment}),
    });
  }
  function syncSidebarChrome(frame) {
    if (!document.documentElement.hasAttribute('data-workhub-desktop')) return;
    const root = frame.contentDocument?.documentElement;
    if (!root) return;
    const inset = '0px';
    if (root.style.getPropertyValue('--workspace-sidebar-inset') !== inset) root.style.setProperty('--workspace-sidebar-inset',inset);
  }
  function alignBar(tab) {
    if (conversationLayout(tab)) {
      document.body.style.setProperty('--workspace-sidebar-width',navigationWidth + 'px');
      document.body.style.setProperty('--workspace-tabs-top','0px');
    } else if (tab?.pages[0].chrome) {
      const chrome = tab.pages[0].chrome;
      document.body.style.setProperty('--workspace-sidebar-width',chrome.left + 'px');
      document.body.style.setProperty('--workspace-tabs-top',chrome.top + 'px');
    }
    renderChrome();
  }
  function renderBar() {
    renderChrome();
    const tab = activeTab();
    const height = !document.documentElement.hasAttribute('data-workhub-desktop') && !conversationLayout(tab) ? 40 : 0;
    bar.hidden = false;
    if (height !== tabBarHeight) {
      tabBarHeight = height;
      for (const page of allPages()) send(page,'workhub:tab-layout',{height});
    }
    const items = tabs.map(tab => {
      const first = tab.pages[0].snapshot;
      return {id:tab.id,kind:first.kind,environment:first.environment,title:first.title + (grouped(tab) ? ' +' + (tab.pages.length - 1) : ''),context:grouped(tab) ? tab.pages.map(page => [page.snapshot.context,page.snapshot.title].filter(Boolean).join(' / ')).join('\n') : first.context};
    });
    const canAdd = canSplit(tab) && tab.pages.every(page => isConversation(page.snapshot) || isTerminal(page.snapshot));
    const signature = JSON.stringify([items,selected,initialized,canAdd]);
    if (signature === barSignature) return;
    barSignature = signature;
    window.WorkHubTabbar.render(bar,{tabs:items,selected,ready:initialized,select:activate,close:remove,
      create:() => add({environment:activeTab()?.pages[0].snapshot.environment}),duplicate,canAdd,addConversation:() => openPicker(activeTab()),newConversation:() => openConversation(creationSnapshot()),canSplit:canSplit(tab),splitConversation:() => openConversation(creationSnapshot(),'split')});
  }
  function renderPaneChrome() {
    const tab = activeTab(), visible = visiblePages(tab);
    window.WorkHubTabbar.renderPanes(paneChrome,grouped(tab) ? {
      tabs:tab.pages.map(page => ({id:page.id,...page.snapshot})), panes:visible.map(page => page.id),selected:tab.focused,zoomed:visible.length === 1,zoomable:wide(tab),
      choose:id => focusPane(tab,id),zoom:id => {tab.zoomed = tab.zoomed ? '' : id; tab.focused = id; renderLayout(); save();},
      replace:id => openPicker(tab,id),close:id => removePane(tab,id),resize:(index,width) => resizePane(tab,index,width),commit:save,
      frames:visible.map(page => page.frame),container:pages,
    } : null);
    // On narrow windows keep every conversation reachable without another tab row.
    let switcher = document.getElementById('workspaceNarrowPanes');
    if (grouped(tab) && !wide(tab)) {
      if (!switcher) {switcher = document.createElement('select'); switcher.id = 'workspaceNarrowPanes'; switcher.setAttribute('aria-label',uiText("查看并列组合中的页面")); pages.append(switcher);}
      switcher.replaceChildren(...tab.pages.map(page => {const option = document.createElement('option'); option.value = page.id; option.textContent = [page.snapshot.context,page.snapshot.title].filter(Boolean).join(' / '); return option;}));
      switcher.value = tab.focused; switcher.onchange = () => {tab.zoomed = ''; focusPane(tab,switcher.value);}; switcher.hidden = false;
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
    const tab = activeTab(), split = grouped(tab), shared = conversationLayout(tab);
    renderChrome();
    if (shared && !navigation) createNavigation();
    if (navigation) {navigation.wrapper.hidden = !shared; navigation.resizeHandle.hidden = !shared; if (navigation.visible !== shared) {navigation.visible = shared; send(navigation,'workhub:tab-active',{active:shared});}}
    document.body.style.setProperty('--workspace-shared-sidebar-width',navigationWidth + 'px');
    paintConversationListWidth();
    const visible = visiblePages(tab);
    document.body.toggleAttribute('data-workspace-split',split);
    document.body.toggleAttribute('data-workspace-conversations',shared);
    pages.style.gridTemplateColumns = shared ? visible.map(page => (visible.length === 1 ? 1 : tab.widths[tab.pages.indexOf(page)] || 1) + 'fr').join(' 8px ') : '';
    for (const owner of tabs) for (const page of owner.pages) {
      const index = visible.indexOf(page), active = index >= 0;
      if (active) mountPage(page,owner);
      page.frame.hidden = !active;
      page.frame.style.gridColumn = shared && active ? String(index * 2 + 1) : '';
      page.frame.dataset.focused = String(page.id === tab?.focused);
      const mode = grouped(owner), sharedPane = conversationLayout(owner);
      const modeKey = mode + ':' + sharedPane;
      if (page.mode !== modeKey) {page.mode = modeKey; send(page,'workhub:tab-pane',{split:mode,shared:sharedPane});}
      if (page.visible !== active) {page.visible = active; send(page,'workhub:tab-active',{active});}
      send(page,'workhub:parallel-layout',{split:mode,focused:page.id === owner.focused,zoomed:!!owner.zoomed,canZoom:wide(owner),canSplit:canSplit(owner)});
      page.frame.removeAttribute('aria-label'); page.frame.setAttribute('aria-labelledby', 'tab-' + owner.id);
    }
    if (navigation && shared) send(navigation,'workhub:conversation-group',{
      targetTitle:tab.pages.find(page => page.id === tab.focused)?.snapshot.title,
      target:tab.pages.find(page => page.id === tab.focused)?.snapshot,
      sessions:tab.pages.map(page => listIdentity(page.snapshot)),selected:listIdentity(tab.pages.find(page => page.id === tab.focused)?.snapshot || {}),
      autoSelect:!tab.pages.some(page => isTerminal(page.snapshot) || page.snapshot.conversation?.selected || page.snapshot.conversation?.creating),
      full:tab.pages.length >= 3,listWidth:conversationListWidth,split,canSplit:canSplit(tab),
    });
    renderPaneChrome(); alignBar(tab);
    if (tab && !performance.getEntriesByName?.('workhub:layout-ready').length) performance.mark?.('workhub:layout-ready');
  }
  function activate(id,focus = false) {
    const tab = tabs.find(tab => tab.id === id);
    if (!tab) return;
    closePicker(); selected = id;
    if (conversationLayout(tab) && navigation) {
      const navWindow = navigation.frame.contentWindow, current = tab.pages.find(page => page.id === tab.focused) || tab.pages[0];
      navWindow.dispatchEvent(new navWindow.Event('workhub:sidebar-sync'));
      const scope = pageScope(current.snapshot);
      const previous = navWindow.WorkHubTab?.snapshot()?.conversation?.scope;
      navigation.snapshot = {...current.snapshot,route:'/sessions',conversation:{...current.snapshot.conversation,scope,pane:'list'}};
      if (navigation.ready && JSON.stringify(scope) !== JSON.stringify(previous)) send(navigation,'workhub:tab-restore',{snapshot:navigation.snapshot,active:true,tabBarHeight:document.documentElement.hasAttribute('data-workhub-desktop') ? 0 : 40});
    }
    const page = tab.pages[0], child = page.frame.contentWindow;
    child.dispatchEvent(new child.Event('workhub:sidebar-sync'));
    renderLayout();
    const sidebar = page.frame.contentDocument?.querySelector('.sidebar');
    if (!conversationLayout(tab) && sidebar) {
      const box = sidebar.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) page.chrome = {left:child.innerWidth <= 760 ? 0 : Math.round(box.right),top:child.innerWidth <= 760 ? Math.round(box.bottom) : 0};
    }
    alignBar(tab); syncURL(tab); save(); renderBar();
    if (focus) {if (bar.hidden) visiblePages(tab)[0]?.frame.focus(); else document.getElementById('tab-' + id)?.focus();}
  }
  function focusPane(tab,id) {
    if (tab !== activeTab() || !tab.pages.some(page => page.id === id) || tab.focused === id) return;
    tab.focused = id; if (tab.zoomed) tab.zoomed = id;
    renderLayout(); save();
  }
  function createPage(snapshot,id = crypto.randomUUID()) {
    snapshot = normalize(snapshot);
    const frame = document.createElement('iframe'); frame.className = 'workspace-page'; frame.id = 'page-' + id; frame.setAttribute('role','tabpanel'); frame.title = snapshot.title; frame.hidden = true;
    const url = new URL('/',location.href); url.searchParams.set('workspace-tab',id); if (id === 'shared-navigation') url.searchParams.set('workspace-navigation','1');
    if (snapshot.environment !== 'local') url.searchParams.set('environment',snapshot.environment);
    if (isTerminal(snapshot)) url.searchParams.set('workspace-terminal','1');
    url.hash = snapshot.route;
    // Retain background snapshots without booting another application until
    // the page is first shown. Mounted pages keep their controllers and drafts.
    const page = {id,snapshot,frame,url,ready:false,mounted:false};
    frame.addEventListener('load',() => {
      const owner = tabs.find(tab => tab.pages.some(current => versions(current).includes(page)));
      const height = id === 'shared-navigation' ? document.documentElement.hasAttribute('data-workhub-desktop') ? 0 : 40 : tabBarHeight;
      frame.contentWindow.postMessage({type:'workhub:tab-layout',height},location.origin);
      syncSidebarChrome(frame);
      frame.contentWindow.postMessage({type:'workhub:tab-pane',split:grouped(owner),shared:conversationLayout(owner)},location.origin);
    });
    pages.append(frame); return page;
  }
  function mountPage(page,owner) {
    if (page.mounted) return;
    page.mounted = true;
    const navigationOnly = page.id === 'shared-navigation';
    if (!navigationOnly && conversationLayout(owner)) page.url.searchParams.set('workspace-conversation','1');
    if (grouped(owner)) page.url.searchParams.set('workspace-pane','1');
    page.url.searchParams.set('workspace-tab-height',String(document.documentElement.hasAttribute('data-workhub-desktop') || !navigationOnly && conversationLayout(owner) ? 0 : 40));
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
    const tab = activeTab(), current = tab?.pages.find(page => page.id === tab.focused) || tab?.pages[0];
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
      save();
    };
    window.WorkHubTabbar.setupSplitResize({handle:resizeHandle,container:document.body,panel:listSize,axis:'x',bounds,resize,commit});
    resizeHandle.addEventListener('dblclick',() => {const limit = bounds(); resize(Math.min(280,limit.max)); commit(); resizeHandle.setAttribute('aria-valuenow',String(conversationListWidth));});
    page.frame.addEventListener('load',() => page.frame.contentWindow.postMessage({type:'workhub:tab-navigation'},location.origin));
  }
  function add(snapshot,id = crypto.randomUUID(),select = true) {
    const first = createPage(snapshot,id), tab = {id,pages:[first],focused:id,zoomed:'',widths:[1]};
    if (isPaneView(first.snapshot) && Array.isArray(snapshot?.parallel?.panes)) {
      const seen = new Set([identity(first.snapshot)].filter(Boolean));
      for (const [index,value] of snapshot.parallel.panes.slice(0,2).entries()) {
        const clean = normalize(value), key = identity(clean);
        if (!isPaneView(clean) || key && seen.has(key)) continue;
        if (key) seen.add(key);
        const page = createPage(clean); tab.pages.push(page);
        // Saved positions refer to the original list, before invalid or
        // duplicate snapshots are filtered. Never move focus to another pane.
        if (snapshot.parallel.focused === index + 1) tab.focused = page.id;
      }
      const widths = snapshot.parallel.widths;
      tab.widths = Array.isArray(widths) && widths.length === tab.pages.length && widths.every(value => Number.isFinite(value) && value > 0 && value <= 100) ? widths : tab.pages.map(() => 1);
    }
    tabs.push(tab); if (select) activate(id); else save(); return tab;
  }
  function canClose(page) {
    try {return !page.ready || page.frame.contentWindow.WorkHubTab.canClose();} catch {return false;}
  }
  function dispose(page) {
    if (page.alternate) {const alternate = page.alternate; delete page.alternate; dispose(alternate);}
    send(page,'workhub:tab-closing');
    try {page.frame.contentWindow.WorkHubTab?.dispose();} catch {}
    page.frame.remove();
    if (isTerminal(page.snapshot)) send(navigation,'workhub:terminals-changed');
  }
  function remove(id) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const tab = tabs[index];
    if (!tab.pages.every(canClose)) return;
    tab.pages.forEach(dispose); tabs.splice(index,1);
    if (!tabs.length) {selected = ''; add({environment:tab.pages[0].snapshot.environment});}
    else if (selected === id) activate(tabs[Math.min(index,tabs.length - 1)].id,true);
    else {renderLayout(); renderBar(); save();}
  }
  function removePane(tab,id) {
    const index = tab.pages.findIndex(page => page.id === id);
    if (index < 0 || !canClose(tab.pages[index])) return;
    if (tab.pages.length === 1) {remove(tab.id); return;}
    closePicker(); const [page] = tab.pages.splice(index,1); dispose(page);
    tab.widths.splice(index,1); tab.zoomed = '';
    if (tab.focused === id) tab.focused = tab.pages[Math.min(index,tab.pages.length - 1)].id;
    renderLayout(); renderBar(); syncURL(tab); save();
  }
  function resizePane(tab,index,width) {
    const first = tab.pages[index].frame, next = tab.pages[index + 1].frame;
    const total = first.getBoundingClientRect().width + next.getBoundingClientRect().width;
    if (!total) return;
    const weight = tab.widths[index] + tab.widths[index + 1];
    tab.widths[index] = weight * width / total; tab.widths[index + 1] = weight - tab.widths[index];
    pages.style.gridTemplateColumns = tab.widths.map(value => value + 'fr').join(' 8px ');
  }
  function closePicker() {if (picker) {picker = null; window.WorkHubTabbar.renderPicker(pickerRoot,null);}}
  function openPicker(tab,replaceID = '') {
    if (!tab || tab !== activeTab() || !tab.pages.every(page => isPaneView(page.snapshot)) || !replaceID && tab.pages.length >= 3) return;
    closePicker();
    const page = tab.pages.find(page => page.id === replaceID) || tab.pages.find(page => page.id === tab.focused) || tab.pages[0];
    picker = {tab,replaceID};
    window.WorkHubTabbar.renderPicker(pickerRoot,{
      requestID:++pickerID,title:replaceID ? uiText("更换对话：") + page.snapshot.title : uiText("添加并列对话"),
      scope:pageScope(page.snapshot),environment:page.snapshot.environment,
      existing:tab.pages.map(page => page.snapshot.conversation?.selected).filter(Boolean),close:closePicker,
      choose:snapshot => chooseConversation(tab,replaceID,snapshot),
    });
  }
  function chooseConversation(tab,replaceID,snapshot) {
    if (!tab || tab !== activeTab() || !tab.pages.every(page => isPaneView(page.snapshot) || replaceID && page.snapshot.route === '/sessions')) return;
    const clean = normalize(snapshot), key = identity(clean);
    if (!key) return;
    const existing = tab.pages.find(page => identity(page.snapshot) === key);
    if (existing) {closePicker(); tab.zoomed = ''; focusPane(tab,existing.id); renderLayout(); existing.frame.focus(); return;}
    if (replaceID) {
      const index = tab.pages.findIndex(page => page.id === replaceID);
      if (index < 0 || !canClose(tab.pages[index])) return;
      const old = tab.pages[index];
      if (!isTerminal(old.snapshot) && !old.snapshot.conversation?.selected && !old.snapshot.conversation?.creating) {
        // Hydrate the already visible empty reader instead of booting it again.
        old.snapshot = clean; old.frame.title = clean.title;
        send(old,'workhub:tab-restore',{snapshot:clean,active:true,tabBarHeight});
      } else {
        const replacement = createPage(clean);
        tab.pages[index] = replacement; tab.focused = replacement.id; dispose(old);
      }
    } else {
      if (tab.pages.length >= 3) return;
      const page = createPage(clean); tab.pages.push(page); tab.widths.push(1); tab.focused = page.id;
    }
    tab.zoomed = ''; closePicker(); renderLayout(); renderBar(); syncURL(tab); save();
  }
  function pageScope(snapshot) {
    if (isTerminal(snapshot) && snapshot.terminal?.taskID) return {kind:'task',id:snapshot.terminal.taskID,environment:snapshot.environment};
    if (snapshot.conversation?.scope) return snapshot.conversation.scope;
    return snapshot.terminal?.taskID ? {kind:'task',id:snapshot.terminal.taskID,environment:snapshot.environment} : {kind:'all'};
  }
  function creationSnapshot() {
    const tab = activeTab(), current = tab?.pages.find(page => page.id === tab.focused)?.snapshot || {};
    const scope = pageScope(current);
    const taskID = current.terminal?.taskID || (scope.kind === 'task' ? scope.id : current.route?.startsWith('/requirements/') ? current.route.split('/')[2] : undefined);
    return preferredCreation({route:'/sessions',environment:current.environment || 'local',title:uiText("新建对话"),context:current.context,terminal:{taskID,projectID:current.terminal?.projectID},conversation:{scope:taskID ? {kind:'task',id:taskID,environment:current.environment || 'local'} : scope,directory:current.conversation?.directory || '',creationDirectory:current.conversation?.creationDirectory || current.conversation?.session?.cwd || '',selected:null,creating:true,pane:'detail'}});
  }
  function preferredCreation(snapshot) {
    const scope = pageScope(snapshot), taskID = snapshot.terminal?.taskID || (scope.kind === 'task' ? scope.id : undefined);
    if (snapshot.environment !== 'local' || !taskID || window.WorkHubTabbar.conversationDefaults.get('kind') !== 'terminal') return snapshot;
    return {...snapshot,route:'/terminals',title:uiText("新建终端"),terminal:{...snapshot.terminal,taskID}};
  }
  function dispatchOpen(message,tab = activeTab(),pageID = tab?.focused) {
    const snapshot = message.create && isTerminal(message.snapshot) ? {...message.snapshot,route:'/sessions',title:uiText("新建对话"),conversation:{scope:pageScope(message.snapshot),selected:null,creating:true,pane:'detail'}} : message.snapshot;
    openConversation(message.create ? preferredCreation(snapshot) : snapshot,message.placement,tab,pageID);
  }
  function switchCreation(tab,page,kind,snapshot) {
    if (tab !== activeTab() || !visiblePages(tab).includes(page) || !['ui','terminal'].includes(kind)) return;
    const source = normalize(snapshot), terminal = isTerminal(page.snapshot);
    if (terminal ? page.snapshot.terminal?.id || kind !== 'ui' : !page.snapshot.conversation?.creating || kind !== 'terminal') return;
    if (kind === 'terminal' && source.environment !== 'local' || !canClose(page)) return;
    window.WorkHubTabbar.conversationDefaults.set('kind',kind);
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
      send(replacement,'workhub:tab-restore',{snapshot:replacement.snapshot,active:false,tabBarHeight});
    }
    delete page.alternate;
    replacement.alternate = page;
    page.frame.hidden = true; page.visible = false;
    send(page,'workhub:tab-active',{active:false});
    const index = tab.pages.indexOf(page); tab.pages[index] = replacement;
    tab.focused = replacement.id; tab.zoomed = '';
    renderLayout(); renderBar(); syncURL(tab); save();
  }
  function openTerminal(snapshot,placement,tab = activeTab(),pageID = tab?.focused) {
    const clean = normalize(snapshot), key = identity(clean);
    if (key) for (const owner of tabs) {
      const existing = owner.pages.find(page => identity(page.snapshot) === key);
      if (existing) {activate(owner.id); owner.zoomed = ''; focusPane(owner,existing.id); renderLayout(); save(); return;}
    }
    if (!['split','current'].includes(placement)) {add(clean); return;}
    if (!tab || tab !== activeTab()) return;
    const index = tab.pages.findIndex(page => page.id === pageID);
    if (index < 0) return;
    if (placement === 'split') {
      if (!canSplit(tab)) return;
      const page = createPage(clean); tab.pages.splice(index + 1,0,page); tab.widths.splice(index + 1,0,1); tab.focused = page.id;
    } else {
      const old = tab.pages[index]; if (!canClose(old)) return;
      const page = createPage(clean); tab.pages[index] = page; tab.focused = page.id; dispose(old);
    }
    tab.zoomed = ''; closePicker(); renderLayout(); renderBar(); syncURL(tab); save();
  }
  function openConversation(snapshot,placement,tab = activeTab(),pageID = tab?.focused) {
    if (isTerminal(snapshot)) {openTerminal(snapshot,placement,tab,pageID); return;}
    if (!['split','current'].includes(placement)) {add(snapshot); return;}
    if (!tab || tab !== activeTab()) return;
    const clean = normalize(snapshot);
    if (!isConversationView(clean) || clean.conversation.creating !== true) return;
    const index = tab.pages.findIndex(page => page.id === pageID);
    if (index < 0) return;
    if (placement === 'split') {
      if (!canSplit(tab)) return;
      const page = createPage(clean);
      tab.pages.splice(index + 1,0,page); tab.widths.splice(index + 1,0,1); tab.focused = page.id;
    } else {
      const page = tab.pages[index];
      if (!canClose(page)) return;
      // Retain the mounted controllers, including the previous conversation's
      // unsent text and attachments. Only its visible selection changes.
      if (isTerminal(page.snapshot)) {const replacement = createPage(clean); tab.pages[index] = replacement; tab.focused = replacement.id; dispose(page);}
      else {page.snapshot = clean; page.frame.title = clean.title; tab.focused = page.id; send(page,'workhub:tab-restore',{snapshot:clean,active:true,tabBarHeight});}
    }
    tab.zoomed = ''; closePicker(); renderLayout(); renderBar(); syncURL(tab); save();
  }
  function keydown(event) {
    if (!initialized || !tabs.length || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 't' && !event.shiftKey) {event.preventDefault(); add({environment:activeTab().pages[0].snapshot.environment});}
    else if (key === 'w' && !event.shiftKey) {event.preventDefault(); remove(selected);}
    else if (event.key === 'Tab' || event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault(); const direction = event.shiftKey || event.key === 'PageUp' ? -1 : 1;
      activate(tabs[(tabs.findIndex(tab => tab.id === selected) + tabs.length + direction) % tabs.length].id,true);
    } else if (/^[1-9]$/.test(key)) {event.preventDefault(); const tab = tabs[key === '9' ? tabs.length - 1 : Number(key) - 1]; if (tab) activate(tab.id);}
  }
  window.addEventListener('message',event => {
    if (event.origin !== location.origin || !event.data || typeof event.data !== 'object') return;
    if (navigation?.frame.contentWindow === event.source) {
      if (event.data.type === 'workhub:tab-ready') {
        navigation.ready = true; send(navigation,'workhub:tab-navigation');
        send(navigation,'workhub:tab-restore',{snapshot:navigation.snapshot,active:conversationLayout(activeTab()),tabBarHeight:document.documentElement.hasAttribute('data-workhub-desktop') ? 0 : 40}); renderLayout(); renderChrome();
      } else if (event.data.type === 'workhub:tab-restored') {
        navigation.wrapper.setAttribute('data-ready','');
      } else if (event.data.type === 'workhub:conversation-select') {
        const tab = activeTab(), key = identity(normalize(event.data.snapshot));
        if (event.data.initial && (!conversationLayout(tab) || tab.pages.some(page => page.snapshot.conversation?.selected || page.snapshot.conversation?.creating))) return;
        const existing = tab?.pages.find(page => identity(page.snapshot) === key);
        if (existing) {tab.zoomed = ''; focusPane(tab,existing.id); renderLayout(); existing.frame.focus();}
        else if (conversationLayout(tab) && !isTerminal(tab.pages.find(page => page.id === tab.focused)?.snapshot || {})) chooseConversation(tab,tab.focused,event.data.snapshot);
        else add(event.data.snapshot);
      } else if (event.data.type === 'workhub:conversation-add') chooseConversation(activeTab(),'',event.data.snapshot);
      else if (event.data.type === 'workhub:tab-open') dispatchOpen(event.data);
      else if (event.data.type === 'workhub:tab-chrome' && Number.isFinite(event.data.chrome?.left)) {
        navigationWidth = Math.max(60,Math.min(520,event.data.chrome.left)); renderLayout(); renderBar();
      } else if (event.data.type === 'workhub:tab-key') keydown({...event.data.key,preventDefault() {}});
      return;
    }
    const tab = tabs.find(tab => tab.pages.some(page => versions(page).some(version => version.frame.contentWindow === event.source)));
    const page = tab?.pages.flatMap(versions).find(page => page.frame.contentWindow === event.source);
    if (!page) return;
    const message = event.data;
    const displayed = tab.pages.includes(page);
    if (!displayed && !['workhub:tab-ready','workhub:tab-state'].includes(message.type)) return;
    if (message.type === 'workhub:tab-ready') {
      page.ready = true;
      send(page,'workhub:tab-pane',{split:grouped(tab),shared:conversationLayout(tab)});
      send(page,'workhub:tab-restore',{snapshot:page.snapshot,active:visiblePages(activeTab()).includes(page),tabBarHeight});
      send(page,'workhub:parallel-layout',{split:grouped(tab),focused:page.id === tab.focused,zoomed:!!tab.zoomed,canZoom:wide(tab),canSplit:canSplit(tab)});
      renderChrome();
    } else if (message.type === 'workhub:tab-state') {
      const clean = normalize(message.snapshot);
      if (clean.conversation?.creating && !isTerminal(clean)) clean.terminal = {...page.snapshot.terminal,...clean.terminal};
      if (!displayed) {page.snapshot = clean; return;}
      // A grouped pane stays attached to its conversation. Navigation opens a
      // separate workspace tab, so it cannot replace another task's conversation.
      const creating = page.snapshot.conversation?.creating === true && isConversationView(clean);
      const sameTerminal = isTerminal(page.snapshot) && isTerminal(clean) && (!page.snapshot.terminal?.id || page.snapshot.terminal.id === clean.terminal?.id);
      if (grouped(tab) && !creating && !sameTerminal && (!isConversation(clean) || identity(clean) !== identity(page.snapshot))) {
        const original = page.snapshot;
        add(clean,crypto.randomUUID(),tab === activeTab());
        send(page,'workhub:tab-restore',{snapshot:original,active:visiblePages(activeTab()).includes(page),tabBarHeight});
        return;
      }
      page.snapshot = clean; page.frame.title = clean.title; renderBar(); save();
      if (isTerminal(clean)) send(navigation,'workhub:terminals-changed');
      if (tab === activeTab()) {syncURL(tab); renderLayout(); renderBar();}
    } else if (message.type === 'workhub:terminals-changed') send(navigation,'workhub:terminals-changed');
    else if (message.type === 'workhub:conversation-kind') switchCreation(tab,page,message.kind,message.snapshot);
    else if (message.type === 'workhub:tab-open') dispatchOpen(message,tab,page.id);
    else if (message.type === 'workhub:tab-pane-command' && tab === activeTab()) {
      if (message.command === 'close') removePane(tab,page.id);
      else if (message.command === 'zoom' && wide(tab)) {tab.focused = page.id; tab.zoomed = tab.zoomed ? '' : page.id; renderLayout(); save();}
    }
    else if (message.type === 'workhub:tab-parallel' && tab === activeTab()) openPicker(tab);
    else if (message.type === 'workhub:tab-focus' && visiblePages(activeTab()).includes(page)) focusPane(tab,page.id);
    else if (message.type === 'workhub:tab-chrome') {
      const chrome = message.chrome;
      if (!chrome || !Number.isFinite(chrome.left) || !Number.isFinite(chrome.top)) return;
      page.chrome = {left:Math.max(0,Math.min(innerWidth,chrome.left)),top:Math.max(0,Math.min(innerHeight,chrome.top))};
      if (tab === activeTab()) alignBar(tab);
    } else if (message.type === 'workhub:tab-key') keydown({...message.key,preventDefault() {}});
  });
  function duplicate() {
    const tab = activeTab(); if (!tab) return;
    for (const page of tab.pages) capture(page);
    const copy = JSON.parse(JSON.stringify(tabSnapshot(tab)));
    for (const snapshot of [copy,...(copy.parallel?.panes || [])]) if (isTerminal(snapshot)) {snapshot.terminal = {...snapshot.terminal,id:undefined}; snapshot.title = uiText("新建终端");}
    add(copy);
  }
  document.addEventListener('keydown',keydown);
  window.addEventListener('resize',() => {if (tabs.length) {renderLayout(); renderBar();}});
  window.addEventListener('workhub:desktop-chrome',() => {if (navigationWidth < 120) navigationWidth = 88; barSignature = ''; renderLayout(); renderBar();});
  window.addEventListener('workhub:tab-command',event => {
    if (event.detail === 'new') add({environment:activeTab()?.pages[0].snapshot.environment});
    else if (event.detail === 'close') remove(selected);
  });
  window.addEventListener('hashchange',() => {
    const tab = activeTab(); if (grouped(tab)) add({route:location.hash.slice(1),environment:tab.pages[0].snapshot.environment});
    else send(tab?.pages[0],'workhub:tab-navigate',{route:location.hash.slice(1)});
  });
  window.addEventListener('pagehide',() => {
    for (const page of allPages()) capture(page);
    save(); flush();
  });
  function capture(page) {
    try {
      const child = page.frame.contentWindow.WorkHubTab;
      if (page.ready && child && !child.restoring) page.snapshot = normalize(child.snapshot());
    } catch {}
  }
  async function start() {
    let saved;
    try {saved = JSON.parse(localStorage.getItem(storageKey));} catch {}
    if (typeof fetch === 'function') {
      try {const response = await fetch('/api/workspace-tabs',{headers}); if (!response.ok) throw new Error(); const stored = await response.json(); if (stored.initialized) saved = stored;} catch {}
    }
    initialized = true;
    const restored = Array.isArray(saved?.tabs) ? saved.tabs.filter(tab => tab && typeof tab.id === 'string' && /^[\w-]{1,100}$/.test(tab.id) && tab.snapshot && typeof tab.snapshot === 'object') : [];
    const savedWidthTab = restored.find(tab => tab.id === saved.selected && isPaneView(tab.snapshot)) || restored.find(tab => isPaneView(tab.snapshot));
    const savedListWidth = savedWidthTab?.snapshot.conversationListWidth ?? savedWidthTab?.snapshot.parallel?.listWidth;
    if (Number.isFinite(savedListWidth) && savedListWidth >= 220 && savedListWidth <= 520) conversationListWidth = savedListWidth;
    for (const tab of restored) if (!tabs.some(existing => existing.id === tab.id)) add(tab.snapshot,tab.id,false);
    // Legacy whole-workspace layouts become ordinary tabs; no pages are lost.
    if (!tabs.length) add({route:location.hash.slice(1),environment:new URLSearchParams(location.search).get('environment') || 'local'});
    else {
      const requested = location.hash.slice(1), target = tabs.find(tab => tab.id === saved.selected) || tabs[0];
      if (requested && requested !== target.pages[0].snapshot.route) add({route:requested,environment:new URLSearchParams(location.search).get('environment') || 'local'});
      else activate(target.id);
    }
  }
  renderBar(); void start();
})();
