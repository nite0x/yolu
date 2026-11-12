'use strict';

// The server-provided preference is authoritative at startup, including when
// the desktop sidecar starts on a different port. Storage is only a live signal
// for other same-origin windows; it never overrides the saved bootstrap value.
(() => {
  const signalKey = 'yolu:appearance-signal:v1';
  const palettes = {mint:'#203f42', classic:'#e4eaff', light:'#ffffff', dark:'#161a1f'};
  const valid = value => value === 'system' || Object.hasOwn(palettes, value);
  const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)');
  let preference = 'mint';
  function resolve(choice) {
    return choice === 'system' ? (systemDark?.matches ? 'dark' : 'light') : choice;
  }
  function update(choice) {
    if (!valid(choice)) return;
    preference = choice;
    const palette = resolve(choice);
    const root = document.documentElement;
    root.dataset.colorPreference = choice;
    root.dataset.colorTheme = palette;
    root.dataset.colorScheme = palette === 'dark' ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = palettes[palette];
    window.dispatchEvent(new CustomEvent('yolu:appearance', {detail: {colorTheme:choice, palette}}));
  }
  function apply(choice) {
    if (!valid(choice)) return;
    // Apply directly even when browser storage is unavailable. This includes
    // the page host, the shared sidebar, and each open conversation pane.
    const visit = page => {
      try {
        page.YoluTheme?.update(choice);
        for (const frame of page.document.querySelectorAll('iframe')) if (frame.contentWindow) visit(frame.contentWindow);
      } catch { /* Ignore frames that are navigating or not same-origin. */ }
    };
    visit(window.top);
    try { localStorage.setItem(signalKey, JSON.stringify({colorTheme:choice, changedAt:Date.now()})); } catch { /* Live application does not require storage. */ }
  }
  window.YoluTheme = {current:() => preference, palette:() => resolve(preference), update, apply};
  const initial = document.querySelector('meta[name="ui-color-theme"]')?.content;
  update(valid(initial) ? initial : 'mint');
  // Every frame listens itself, so "system" follows the OS without a broadcast.
  systemDark?.addEventListener?.('change', () => { if (preference === 'system') update('system'); });
  window.addEventListener('storage', event => {
    if (event.key !== signalKey || !event.newValue) return;
    try { update(JSON.parse(event.newValue).colorTheme); } catch { /* Ignore unrelated or malformed storage values. */ }
  });
})();
