'use strict';

// The server-provided preference is authoritative at startup, including when
// the desktop sidecar starts on a different port. Storage is only a live signal
// for other same-origin windows; it never overrides the saved bootstrap value.
(() => {
  const signalKey = 'yolu:appearance-signal:v1';
  const valid = value => value === 'mint' || value === 'classic';
  function update(choice) {
    if (!valid(choice)) return;
    document.documentElement.dataset.colorTheme = choice;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = choice === 'mint' ? '#203f42' : '#e4eaff';
    window.dispatchEvent(new CustomEvent('yolu:appearance', {detail: {colorTheme:choice}}));
  }
  function apply(choice) {
    if (!valid(choice)) return;
    // Apply directly even when browser storage is unavailable. This includes
    // the outer tab bar, the shared sidebar, and each open workspace pane.
    const visit = page => {
      try {
        page.YoluTheme?.update(choice);
        for (const frame of page.document.querySelectorAll('iframe')) if (frame.contentWindow) visit(frame.contentWindow);
      } catch { /* Ignore frames that are navigating or not same-origin. */ }
    };
    visit(window.top);
    try { localStorage.setItem(signalKey, JSON.stringify({colorTheme:choice, changedAt:Date.now()})); } catch { /* Live application does not require storage. */ }
  }
  window.YoluTheme = {current:() => document.documentElement.dataset.colorTheme || 'mint', update, apply};
  const initial = document.querySelector('meta[name="ui-color-theme"]')?.content;
  update(valid(initial) ? initial : 'mint');
  window.addEventListener('storage', event => {
    if (event.key !== signalKey || !event.newValue) return;
    try { update(JSON.parse(event.newValue).colorTheme); } catch { /* Ignore unrelated or malformed storage values. */ }
  });
})();
