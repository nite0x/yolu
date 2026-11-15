// Tauri supplies whether the platform uses an overlaid native title bar.
(overlay => {
  'use strict';
  // Business pages live in same-origin page iframes. Invoke through the host
  // frame so a child frame never needs a separate native bridge or capability.
  let host;
  try {
    host = window.top;
    if (host.location.origin !== location.origin) return;
  } catch { return; }
  const markDesktop = () => document.documentElement?.setAttribute('data-workhub-desktop', '');
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
    host.__TAURI_INTERNALS__?.invoke('plugin:window|' + command)
      .catch(error => console.error('Window drag failed:', error));
  }
  let doubleClick;
  if (overlay) document.addEventListener('mousedown', event => {
    if (!draggable(event)) return;
    event.preventDefault();
    if (event.detail === 2) doubleClick = [event.screenX, event.screenY];
    else { doubleClick = null; invoke('start_dragging'); }
  });
  if (overlay) document.addEventListener('mouseup', event => {
    if (draggable(event) && event.detail === 2 && doubleClick &&
        event.screenX === doubleClick[0] && event.screenY === doubleClick[1]) {
      invoke('internal_toggle_maximize');
    }
    doubleClick = null;
  });
  document.addEventListener('DOMContentLoaded', () => {
    if (window !== host) return;
    const drag = document.createElement('header');
    drag.className = 'workhub-window-drag';
    if (overlay) {
      document.documentElement.setAttribute('data-workhub-window-overlay', '');
      drag.title = '拖动移动窗口，双击缩放';
      drag.setAttribute('aria-label', '窗口标题栏');
    }
    const controls = document.createElement('div');
    controls.id = 'workhubWindowControls';
    controls.className = 'workhub-window-controls shadcn-scope';
    drag.append(controls);
    document.body.append(drag);
    window.dispatchEvent(new Event('workhub:desktop-chrome'));
  }, {once:true});
})
