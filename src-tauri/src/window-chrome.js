// Tauri supplies the platform before either the startup or backend page loads.
(platform => {
  'use strict';
  const overlay = platform === 'macos' || platform === 'windows';
  // Business pages live in same-origin page iframes. Invoke through the host
  // frame so a child frame never needs a separate native bridge or capability.
  let host;
  try {
    host = window.top;
    if (host.location.origin !== location.origin) return;
  } catch { return; }
  const markDesktop = () => {
    document.documentElement?.setAttribute('data-workhub-desktop', '');
    document.documentElement?.setAttribute('data-workhub-platform', platform);
  };
  if (document.documentElement) markDesktop();
  else {
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      markDesktop();
      observer.disconnect();
    });
    observer.observe(document, {childList:true});
  }
  const interactive = 'a,button,input,textarea,select,label,summary,[role="button"],[role="tab"],[role="menuitem"],[role="separator"],[contenteditable]:not([contenteditable="false"]),[data-no-window-drag]';
  const regions = '.workhub-window-drag,.sidebar,.page-heading,.session-browser-header,.session-chat-header';
  function draggable(event) {
    const target = event.target;
    return event.button === 0 && target instanceof Element &&
      !target.closest(interactive) && !!target.closest(regions);
  }
  function invoke(command) {
    return host.__TAURI_INTERNALS__?.invoke('plugin:window|' + command);
  }
  function run(command) {
    return invoke(command)?.catch(error => console.error('Window command failed:', error));
  }
  let doubleClick;
  if (overlay) document.addEventListener('mousedown', event => {
    if (!draggable(event)) return;
    event.preventDefault();
    if (event.detail === 2) doubleClick = [event.screenX, event.screenY];
    else { doubleClick = null; run('start_dragging'); }
  });
  if (overlay) document.addEventListener('mouseup', event => {
    if (draggable(event) && event.detail === 2 && doubleClick &&
        event.screenX === doubleClick[0] && event.screenY === doubleClick[1]) {
      run('internal_toggle_maximize');
    }
    doubleClick = null;
  });
  if (platform === 'windows' && window === host) {
    window.WorkHubDesktopWindow = {
      showMenu: (ready = false) => host.__TAURI_INTERNALS__?.invoke('show_app_menu', {ready})
        .catch(error => console.error('Application menu failed:', error)),
    };
  }
  document.addEventListener('DOMContentLoaded', () => {
    if (window !== host) return;
    const drag = document.querySelector('.workhub-window-drag') || document.createElement('header');
    drag.className = 'workhub-window-drag';
    if (overlay) {
      document.documentElement.setAttribute('data-workhub-window-overlay', '');
      drag.setAttribute('aria-label', window.YoluI18n?.text('窗口标题栏') || '窗口标题栏');
    }
    const controls = document.getElementById('workhubWindowControls') || document.createElement('div');
    controls.id = 'workhubWindowControls';
    controls.className = 'workhub-window-controls shadcn-scope';
    drag.append(controls);
    if (platform === 'windows') {
      // The startup/error page has no React layout, so provide its menu here.
      // The workspace replaces this fallback when it mounts its shared chrome.
      if (!controls.hasChildNodes()) {
        const brand = document.createElement('button');
        brand.type = 'button';
        brand.className = 'window-brand-trigger';
        brand.textContent = 'Yolu ▾';
        brand.setAttribute('aria-label', window.YoluI18n?.text('Yolu 菜单') || 'Yolu 菜单');
        brand.setAttribute('aria-haspopup', 'menu');
        const showMenu = () => window.WorkHubDesktopWindow.showMenu();
        brand.addEventListener('click', showMenu);
        brand.addEventListener('keydown', event => {
          if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
          event.preventDefault();
          showMenu();
        });
        controls.append(brand);

      }

      const actions = document.createElement('div');
      actions.className = 'workhub-window-actions';
      const button = (action, label) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'workhub-window-action';
        control.dataset.windowAction = action;
        const text = window.YoluI18n?.text(label) || label;
        control.setAttribute('aria-label', text);
        control.title = text;
        const icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        control.append(icon);
        actions.append(control);
        return control;
      };
      button('minimize', '最小化').addEventListener('click', () => run('minimize'));
      const maximize = button('maximize', '最大化');
      let revision = 0;
      async function updateMaximized() {
        const current = ++revision;
        try {
          const maximized = await invoke('is_maximized');
          if (current !== revision) return;
          maximize.dataset.maximized = String(!!maximized);
          const label = maximized ? '还原' : '最大化';
          const text = window.YoluI18n?.text(label) || label;
          maximize.setAttribute('aria-label', text);
          maximize.title = text;
        } catch (error) { console.error('Window state failed:', error); }
      }
      maximize.addEventListener('click', async () => {
        await run('internal_toggle_maximize');
        await updateMaximized();
      });
      button('close', '关闭窗口').addEventListener('click', () => run('close'));
      window.addEventListener('resize', updateMaximized);
      window.addEventListener('focus', updateMaximized);
      void updateMaximized();
      drag.append(actions);
    }
    document.body.append(drag);
    window.dispatchEvent(new Event('workhub:desktop-chrome'));
  }, {once:true});
})
