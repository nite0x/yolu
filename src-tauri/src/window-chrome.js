// Injected by the macOS host only. Browser pages keep their existing layout.
(() => {
  'use strict';
  // Business pages live in same-origin page iframes. Invoke through the host
  // frame so a child frame never needs a separate native bridge or capability.
  let host;
  try {
    host = window.top;
    if (host.location.origin !== location.origin) return;
  } catch { return; }
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
  document.addEventListener('mousedown', event => {
    if (!draggable(event)) return;
    event.preventDefault();
    if (event.detail === 2) doubleClick = [event.screenX, event.screenY];
    else { doubleClick = null; invoke('start_dragging'); }
  });
  document.addEventListener('mouseup', event => {
    if (draggable(event) && event.detail === 2 && doubleClick &&
        event.screenX === doubleClick[0] && event.screenY === doubleClick[1]) {
      invoke('internal_toggle_maximize');
    }
    doubleClick = null;
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.setAttribute('data-workhub-desktop', '');
    if (window !== host) return;
    const drag = document.createElement('header');
    drag.className = 'workhub-window-drag';
    drag.title = '拖动移动窗口，双击缩放';
    drag.setAttribute('aria-label', '窗口标题栏');
    const controls = document.createElement('div');
    controls.id = 'workhubWindowControls';
    controls.className = 'workhub-window-controls shadcn-scope';
    drag.append(controls);
    document.body.append(drag);
    window.dispatchEvent(new Event('workhub:desktop-chrome'));
  }, {once:true});
})();
