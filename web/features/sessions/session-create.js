'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);

const newSessionRequests = new Map();
function prepareNewSession(current) {
  $('#sessionHistoryTitle').textContent = uiText("新建对话");
  $('#sessionHistoryMeta').textContent = current.target?.cwd || '';
  const pending = newSessionRequests.get(newSessionKey(current));
  if (pending?.promise) void watchNewSessionCreation(current, pending);
  else $('#sessionChatInput').focus();
}

function newSessionKey(current) { return JSON.stringify([current.environment, current.target]); }

async function sendNewSession(current) {
  if (sessionHistoryState !== current || current.submitting) return;
  const text = $('#sessionChatInput').value.trim();
  if (!text) return;
  const project = current.target?.project_id || '';
  const key = newSessionKey(current);
  const old = newSessionRequests.get(key);
  const pending = old?.text === text && old.project_id === project ? old : { text, project_id: project, request_id: crypto.randomUUID(), ...current.target };
  pending.key = key;
  newSessionRequests.set(key, pending);
  if (!pending.promise) {
    const { text, project_id, request_id } = pending;
    pending.promise = api(`/api/sessions/new`, { environment: current.environment, method: 'POST', body: JSON.stringify({ text, project_id, request_id, ...current.target }) });
  }
  await watchNewSessionCreation(current, pending);
}
async function watchNewSessionCreation(current, pending) {
  current.submitting = true; current.chatError = ''; renderChatControls(current);
  const promise = pending.promise;
  try {
    const result = await promise;
    if (newSessionRequests.get(pending.key) === pending) newSessionRequests.delete(pending.key);
    // A finished request must not erase a different draft or replace a panel
    // opened while the creation was in flight.
    if (chatDrafts.get(chatDraftKey(current)) === pending.text) chatDrafts.delete(chatDraftKey(current));
    if (sessionHistoryState === current) {
      current.browserContext?.created?.(result.session);
      openSessionHistoryPanel(result.session.id, {...current.browserContext, session:result.session});
      chatDrafts.delete(chatDraftKey(current));
      sessionHistoryState.newlyCreated = true;
      sessionHistoryState.sentDraft = pending.text;
      applyChatState(sessionHistoryState, result.chat);
      if (result.chat.busy) streamChat(sessionHistoryState, result.chat.id);
    }
  } catch (error) {
    if (sessionHistoryState === current) { current.chatError = error.message; }
  } finally {
    if (pending.promise === promise) delete pending.promise;
    current.submitting = false;
    if (sessionHistoryState === current) renderChatControls(current);
  }
}
