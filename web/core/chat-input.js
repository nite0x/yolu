'use strict';

// The application database supplies startup preferences across sidecar ports.
// Broadcast saves to open panes and use storage only as a cross-window signal.
(() => {
  const signalKey = 'yolu:chat-input-signal:v1';
  const valid = value => value === 'enter' || value === 'ctrlEnter';
  let shortcut = 'enter';
  function update(value) {
    if (!valid(value)) return;
    shortcut = value;
    window.dispatchEvent(new CustomEvent('yolu:chat-input'));
  }
  function apply(value) {
    if (!valid(value)) return;
    const visit = page => {
      try {
        page.YoluChatInput?.update(value);
        for (const frame of page.document.querySelectorAll('iframe')) if (frame.contentWindow) visit(frame.contentWindow);
      } catch { /* A navigating frame receives saved preferences on load. */ }
    };
    visit(window.top);
    try { localStorage.setItem(signalKey, JSON.stringify({sendShortcut:value, changedAt:Date.now()})); } catch { /* Live application works without browser storage. */ }
  }
  window.YoluChatInput = {current:() => shortcut, update, apply};
  update(document.querySelector('meta[name="ui-send-shortcut"]')?.content);
  window.addEventListener('storage', event => {
    if (event.key !== signalKey || !event.newValue) return;
    try { update(JSON.parse(event.newValue).sendShortcut); } catch { /* Ignore malformed signals. */ }
  });
})();
