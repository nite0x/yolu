var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);
// Load the React chat island only when the user opens a task conversation.
(() => {
  let loading, mounted, currentWorkspace, version = 0;
  window.WorkHubAssistant = {
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
        target.textContent = uiText("聊天界面加载失败，请重新打开会话。");
        const close = document.createElement('button');
        close.type = 'button'; close.className = 'button secondary'; close.textContent = uiText("关闭");
        close.addEventListener('click', options.close); target.append(close);
      }
    },
    close() { version++; mounted?.close(); },
    flushDraft() { return mounted?.flushDraft() ?? Promise.resolve(true); },
    updateTask(task) { mounted?.updateTask(task); },
    updateWorkspace(workspace) { currentWorkspace = workspace; mounted?.updateWorkspace(workspace); },
    updateSession(session) { mounted?.updateSession(session); }
  };
})();
