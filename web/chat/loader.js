var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);
// Load the React chat island only when the user opens a workspace conversation.
(() => {
  let loading, mounted, currentOverview, globalModule, version = 0;
  window.WorkHubAssistant = {
    async openGlobal(request, options) {
      try {
        loading ||= import('/chat/assistant.js');
        globalModule = await loading;
        globalModule.openGlobalAssistant(request, options);
      } catch {
        loading = null;
        const target = document.getElementById('globalAssistantRoot');
        target.textContent = uiText("聊天界面加载失败，请重新打开对话。");
        if (options.close) {
          const close = document.createElement('button');
          close.type = 'button'; close.className = 'button secondary'; close.textContent = uiText("关闭");
          close.addEventListener('click', options.close);
          target.append(close);
        }
      }
    },
    async open(options) {
      const current = ++version;
      currentOverview = options.overview;
      try {
        loading ||= import('/chat/assistant.js');
        const { bridge } = await loading;
        if (current !== version) return;
        mounted = bridge;
        bridge.open({...options, overview: currentOverview});
      } catch (error) {
        loading = null;
        if (current !== version) return;
        const target = document.getElementById('assistantChatRoot');
        target.textContent = uiText("聊天界面加载失败，请重新打开对话。");
        const close = document.createElement('button');
        close.type = 'button'; close.className = 'button secondary'; close.textContent = uiText("关闭");
        close.addEventListener('click', options.close); target.append(close);
      }
    },
    close() { version++; mounted?.close(); },
    async flushDraft() { const saved = await Promise.all([mounted?.flushDraft() ?? true, globalModule?.flushGlobalAssistantDraft() ?? true]); return saved.every(Boolean); },
    updateWorkspace(workspace) { mounted?.updateWorkspace(workspace); },
    updateOverview(overview) { currentOverview = overview; mounted?.updateOverview(overview); },
    updateSession(session) { mounted?.updateSession(session); }
  };
})();
