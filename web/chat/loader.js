var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);
// Load the React chat island only when the user opens a task conversation.
(() => {
  let loading, mounted, currentWorkspace, globalModule, version = 0;
  window.WorkHubAssistant = {
    async openGlobal(request) {
      try {
        loading ||= import('/chat/assistant.js');
        globalModule = await loading;
        globalModule.openGlobalAssistant(request);
      } catch {
        loading = null;
        document.getElementById('globalAssistantRoot').textContent = uiText("聊天界面加载失败，请重新打开对话。");
      }
    },
    async open(options) {
      const current = ++version;
      currentWorkspace = options.workspace;
      try {
        loading ||= import('/chat/assistant.js');
        const { bridge } = await loading;
        if (current !== version) return;
        mounted = bridge;
        bridge.open({...options, workspace: currentWorkspace});
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
    updateTask(task) { mounted?.updateTask(task); },
    updateWorkspace(workspace) { currentWorkspace = workspace; mounted?.updateWorkspace(workspace); },
    updateSession(session) { mounted?.updateSession(session); }
  };
})();
