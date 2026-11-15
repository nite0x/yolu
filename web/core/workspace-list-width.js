'use strict';

// Same-origin pages use the host's setting so resizing takes effect before a
// page switch, even when browser storage is unavailable.
(() => {
  const root = document.documentElement;
  if (!root.hasAttribute('data-workhub-desktop')) return;
  let width;
  try { if (window.parent !== window) width = window.parent.WorkHubListWidth; } catch {}
  if (!width) {
    const key = 'workhub:desktop-list-width:v1';
    const min = 240, max = 520, defaultWidth = 280;
    let preferred = defaultWidth;
    try {
      for (const [candidate, low, high] of [[key,min,max], ['workhub:task-list-width:v1',240,640], ['workhub:project-list-width:v1',200,640], ['workhub:conversation-list-width:v1',220,520]]) {
        const saved = Number(localStorage.getItem(candidate));
        if (Number.isFinite(saved) && saved >= low && saved <= high) {
          preferred = Math.round(Math.max(min,Math.min(max,saved)));
          break;
        }
      }
    } catch {}
    const listeners = new Set();
    const bounds = () => ({min,max:Math.max(min,Math.min(max,window.innerWidth - 52 - 368))});
    const current = () => Math.min(preferred,bounds().max);
    const publish = () => { for (const listener of listeners) listener(current()); };
    width = {
      defaultWidth, bounds, current,
      resize(value) { preferred = Math.round(Math.max(min,Math.min(max,value))); publish(); },
      save() { try { localStorage.setItem(key,String(preferred)); } catch {} },
      subscribe(listener) { listeners.add(listener); listener(current()); return () => listeners.delete(listener); },
    };
    window.addEventListener('resize',publish);
  }
  window.WorkHubListWidth = width;
  const unsubscribe = width.subscribe(value => root.style.setProperty('--workspace-list-width',value + 'px'));
  window.addEventListener('pagehide',unsubscribe,{once:true});
})();
