'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);

const sessionReadMemory = new Map();
function sessionReadKey(session, environment = activeEnvironment) { return 'workhub:session-read:' + JSON.stringify([environment, session]); }
function sessionReadProgress(session) {
  const key = sessionReadKey(session.id, session.environment_id || activeEnvironment);
  if (sessionReadMemory.has(key)) return sessionReadMemory.get(key);
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && Number.isFinite(saved.time)) { sessionReadMemory.set(key, saved); return saved; }
  } catch { /* Reading remains usable when browser storage is unavailable. */ }
  return saveSessionRead(session);
}
function saveSessionRead(session) {
  const key = sessionReadKey(session.id, session.environment_id || activeEnvironment);
  const previous = sessionReadMemory.get(key);
  if (previous && previous.time >= (session.updated_at || 0) && previous.run === (session.completed_run || '')) return previous;
  const saved = { time: Math.max(Date.now() / 1000, session.updated_at || 0), run: session.completed_run || '' };
  sessionReadMemory.set(key, saved);
  try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* Keep an in-memory fallback. */ }
  return saved;
}
window.addEventListener('storage', event => {
  if (!event.key?.startsWith('workhub:session-read:')) return;
  // A reader and the shared list live in separate frames. Reload the latest
  // marker rather than retaining this frame's earlier cached unread state.
  sessionReadMemory.delete(event.key);
  if (typeof conversationVisible === 'function' && conversationVisible()) renderConversationList();
  else if (typeof updateConversationNavigation === 'function') updateConversationNavigation();
});
function sessionWithUnread(session) {
  const seen = sessionReadProgress(session);
  const open = typeof sessionHistoryState !== 'undefined' && sessionHistoryState?.session === session.id && (!sessionHistoryState.environment || sessionHistoryState.environment === (session.environment_id || activeEnvironment)) && !document.hidden && (typeof conversationReadingSession === 'function' ? conversationReadingSession(session.id, session.environment_id || activeEnvironment) : !document.getElementById('sessionHistoryPanel')?.hidden);
  if (open) saveSessionRead(session);
  return { ...session, unread: !open && ((session.updated_at || 0) > seen.time || !!session.completed_run && session.completed_run !== seen.run) };
}
function updateSessionChatActivity(session, chat, environment = activeEnvironment) {
  if (session && typeof browserSessionActivity === 'function') browserSessionActivity(session, chat, environment);
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-session-action="resume"]');
  if (!target || target.disabled) return;
  const path = `/api/sessions/${encodeURIComponent(target.dataset.session)}/resume`;
  const environment = sessionHistoryState?.environment || activeEnvironment;
  const flags = {};
  for (;;) {
    try {
      const result = await api(path, {environment,method:'POST',body:JSON.stringify(flags)});
      toast(result.message); return;
    } catch (error) {
      const flag = error.code === 'native_permissions_confirmation' ? 'native_permissions' : error.code === 'directory_conflict' ? 'allow_shared' : '';
      if (!flag || flags[flag]) { if (error.command) showCommand(error.command); toast(error.message,true); return; }
      if (!confirm(error.message)) return;
      flags[flag] = true;
    }
  }
});
