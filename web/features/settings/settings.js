// Host adapter only. Settings state, requests and views belong to the checked feature.
const settingsController = window.WorkHubUI.mountSettings({
  context: () => ({environment:activeEnvironment, inventory:environmentInventory, view:state.view, loaded:state.loaded, root:state.root, terminal:state.terminal, readOnly:sessionReadOnly}),
  request: api, environmentName, loadEnvironments, toast, copy,
  setTerminal(value) { state.terminal = value; },
  mutation,
  choices: window.WorkHubUI,
  broadcastDefaults(environment, provider) {
    const host = window.top;
    for (const page of [host, ...[...host.document.querySelectorAll('iframe')].map(frame => frame.contentWindow).filter(Boolean)]) {
      page.dispatchEvent(new page.CustomEvent('workhub:conversation-defaults', {detail:{environment,provider}}));
    }
  },
  preferences: {
    theme: window.YoluTheme,
    shortcut: window.YoluChatInput,
    language: window.YoluI18n?.language || 'system',
    async flushDrafts() {
      const host = window.top;
      const pages = [host, ...[...host.document.querySelectorAll('iframe')].map(frame => frame.contentWindow).filter(Boolean)];
      const saved = await Promise.all(pages.map(page => page.WorkHubAssistant?.flushDraft?.() ?? true));
      return saved.every(Boolean);
    },
    reload() { window.top.location.reload(); },
  },
});
function renderSettings() { settingsController.refresh(); }
