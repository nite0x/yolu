'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


let settingsEnvironment = null;
let titleSettingsEnvironment = null;
let titleSettingsLoading = false;
let titleSettingsRevision = 0;
let conversationDefaultsEnvironment = null;
let conversationDefaultsRevision = 0;
let conversationDefaultsLoading = false;
const codexDiagnostics = new Map();
let codexDiagnosticsBatch = false;
let codexUnregisteredDistros = [];

function renderCodexDiagnostics() {
  const results = [...codexDiagnostics.values()];
  const loading = codexDiagnosticsBatch || results.some(result => result.loading);
  // Do not replace report DOM on the regular workspace poll: retain details,
  // selection, copy fallback and screen-reader position until a check changes.
  $('#checkCodex').disabled = loading;
  $('#checkAllCodex').disabled = loading;
  $('#copyCodexDiagnostics').disabled = loading || !results.length;
  $('#codexDiagnosticsStatus').textContent = loading ? uiText("正在检测执行环境，请稍候…") : results.length ? uiText("已检测 {0} 个环境；当前配置：{1}", results.length, environmentName()) : uiText("尚未检测");
  $('#codexUnregistered').hidden = !codexUnregisteredDistros.length;
  $('#codexUnregistered').textContent = uiText("以下 WSL 发行版尚未登记，请先使用「连接 WSL」选择用户后检测：{0}", codexUnregisteredDistros.join('、'));
}

function updateCodexDiagnostics() {
  $('#codexDiagnosticsResults').innerHTML = window.WorkHubUI.codexDiagnostics([...codexDiagnostics.values()]);
  $('#codexDiagnosticsCopy').hidden = true;
  renderCodexDiagnostics();
}

async function checkCodexEnvironment(id) {
  if (codexDiagnostics.get(id)?.loading) return;
  codexDiagnostics.set(id, { id, name: environmentName(id), report: codexDiagnostics.get(id)?.report, loading: true });
  updateCodexDiagnostics();
  try {
    const report = await api('/api/settings/codex', { environment: id, cache: 'no-store' });
    if (!report || !Array.isArray(report.checks) || !Array.isArray(report.candidates)) throw new Error(uiText("后台未返回有效检测报告，请确认 Yolu 后台版本"));
    codexDiagnostics.set(id, { id, name: environmentName(id), report });
  } catch (error) {
    codexDiagnostics.set(id, { id, name: environmentName(id), report: codexDiagnostics.get(id)?.report, error: error.message });
  }
  updateCodexDiagnostics();
}

$('#checkCodex').addEventListener('click', () => checkCodexEnvironment(activeEnvironment));
$('#checkAllCodex').addEventListener('click', async () => {
  if (codexDiagnosticsBatch || [...codexDiagnostics.values()].some(result => result.loading)) return;
  codexDiagnosticsBatch = true;
  renderCodexDiagnostics();
  try {
    await loadEnvironments();
    const pending = [...new Set(['local', ...environmentInventory.map(environment => environment.id)])];
    // Bound concurrency so a slow WSL cannot prevent other reports appearing.
    await Promise.all(Array.from({length: Math.min(2, pending.length)}, async () => {
      while (pending.length) await checkCodexEnvironment(pending.shift());
    }));
  } catch (error) {
    toast(uiText("无法读取执行环境列表：") + error.message, true);
  } finally {
    codexDiagnosticsBatch = false;
    renderCodexDiagnostics();
  }
});

function codexDiagnosticsText() {
  return uiText("Yolu · Codex 安装检测\n") + [...codexDiagnostics.values()].map(result => {
    const report = result.report;
    return [
      uiText("\n环境：{0} ({1})", result.name, result.id), result.error && uiText("本次检测失败：{0}", result.error),
      report && [
        uiText("检测时间：{0}", report.checked_at), uiText("平台：{0}；用户：{1}", report.platform, report.user || uiText("未报告")), `CODEX_HOME：${report.codex_home}`,
        uiText("CLI 程序：{0}", report.cli_path), report.cli_entry && uiText("CLI 启动入口：{0}", report.cli_entry), uiText("CLI 版本：{0}", report.version || uiText("未读取")),
        uiText("共享后台程序：{0}", report.daemon_path || uiText("未读取")), uiText("后台状态：{0}", report.daemon_status || uiText("未读取")), uiText("运行中后台版本：{0}", report.daemon_version || uiText("未读取")),
        uiText("PATH 候选：\n") + report.candidates.join('\n'), ...report.checks.map(check => `[${check.status}] ${uiText(check.name)}: ${uiText(check.message)}${check.advice ? uiText("\n建议：") + uiText(check.advice) : ''}`),
      ].filter(Boolean).join('\n'),
    ].filter(Boolean).join('\n');
  }).join('\n') + uiText("\n\n只读检测；未验证凭证有效性、模型访问或具体对话运行状态。");
}

$('#copyCodexDiagnostics').addEventListener('click', async () => {
  const text = codexDiagnosticsText();
  try {
    await navigator.clipboard.writeText(text);
    toast(uiText("检测报告已复制"));
  } catch {
    const field = $('#codexDiagnosticsCopy');
    field.value = text;
    field.hidden = false;
    field.focus();
    field.select();
    toast(uiText("请复制已选中的检测报告"));
  }
});

async function loadSessionTitleSettings() {
  const environment = activeEnvironment;
  const revision = ++titleSettingsRevision;
  titleSettingsEnvironment = environment;
  titleSettingsLoading = true;
  $('#sessionTitleFields').disabled = true;
  $('#sessionTitleReload').disabled = true;
  $('#sessionTitleError').hidden = true;
  try {
    const result = await api('/api/settings/session-title', { environment });
    if (environment !== activeEnvironment || revision !== titleSettingsRevision) return;
    const model = result.settings.model || '';
    const models = result.models || [];
    $('#sessionTitleModel').innerHTML = uiText("<option value=\"\">跟随正文模型</option>")
      + (model && !models.some(m => m.model === model) ? uiText("<option value=\"{0}\">{1}（当前不可用）</option>", esc(model), esc(model)) : '')
      + models.map(m => `<option value="${esc(m.model)}">${esc(m.displayName || m.model)}</option>`).join('');
    $('#sessionTitleModel').value = model;
    $('#sessionTitleFields').disabled = false;
  } catch (error) {
    if (environment !== activeEnvironment || revision !== titleSettingsRevision) return;
    $('#sessionTitleError').textContent = error.message;
    $('#sessionTitleError').hidden = false;
  } finally {
    if (environment === activeEnvironment && revision === titleSettingsRevision) {
      titleSettingsLoading = false;
      $('#sessionTitleReload').disabled = !state.loaded;
    }
  }
}

$('#sessionTitleReload').addEventListener('click', () => { if (state.loaded && !titleSettingsLoading) loadSessionTitleSettings(); });
$('#sessionTitleForm').addEventListener('submit', event => {
  event.preventDefault();
  const environment = activeEnvironment;
  const model = $('#sessionTitleModel').value;
  mutation(uiText("正在保存标题设置"), async () => {
    await api('/api/settings/session-title', { method: 'PUT', body: JSON.stringify({ model }) });
    if (environment === activeEnvironment) toast(uiText("标题设置已保存，将用于新对话的标题生成"));
  }, $('#sessionTitleError'));
});

async function loadConversationDefaults() {
  const environment = activeEnvironment;
  const revision = ++conversationDefaultsRevision;
  conversationDefaultsEnvironment = environment;
  conversationDefaultsLoading = true;
  $('#conversationDefaultsFields').disabled = true;
  $('#conversationDefaultsReload').disabled = true;
  $('#conversationDefaultsError').hidden = true;
  $('#conversationDefaultsStatus').textContent = '';
  try {
    const result = await api('/api/settings/conversation-defaults', {environment});
    if (environment !== activeEnvironment || revision !== conversationDefaultsRevision) return;
    const model = result.settings.model || '';
    const models = result.models || [];
    const options = [new Option(uiText('沿用 Codex 默认模型'), '')];
    if (model && !models.some(m => m.model === model)) options.push(new Option(uiText(result.models_error ? '{0}（未核对）' : '{0}（当前不可用）', model), model));
    for (const candidate of models) options.push(new Option(candidate.displayName || candidate.model, candidate.model));
    $('#conversationDefaultModel').replaceChildren(...options);
    $('#conversationDefaultModel').value = model;
    $('#conversationDefaultPermission').value = result.settings.permission || '';
    $('#conversationDefaultsStatus').textContent = result.models_error || '';
    $('#conversationDefaultsFields').disabled = false;
  } catch (error) {
    if (environment !== activeEnvironment || revision !== conversationDefaultsRevision) return;
    $('#conversationDefaultsError').textContent = error.message;
    $('#conversationDefaultsError').hidden = false;
  } finally {
    if (environment === activeEnvironment && revision === conversationDefaultsRevision) {
      conversationDefaultsLoading = false;
      $('#conversationDefaultsReload').disabled = !state.loaded;
    }
  }
}

$('#conversationDefaultsReload').addEventListener('click', () => { if (state.loaded && !conversationDefaultsLoading) loadConversationDefaults(); });
$('#conversationDefaultsForm').addEventListener('submit', event => {
  event.preventDefault();
  if ($('#conversationDefaultsFields').disabled) return;
  const environment = activeEnvironment;
  const revision = conversationDefaultsRevision;
  const settings = {model:$('#conversationDefaultModel').value, permission:$('#conversationDefaultPermission').value};
  mutation(uiText('正在保存新对话设置'), async () => {
    $('#conversationDefaultsFields').disabled = true;
    $('#conversationDefaultsReload').disabled = true;
    try {
      await api('/api/settings/conversation-defaults', {method:'PUT', environment, body:JSON.stringify(settings)});
      if (environment === activeEnvironment && revision === conversationDefaultsRevision) {
        $('#conversationDefaultsStatus').textContent = uiText('新对话设置已保存');
      }
      const host = window.top;
      for (const page of [host, ...[...host.document.querySelectorAll('iframe')].map(frame => frame.contentWindow).filter(Boolean)]) {
        page.dispatchEvent(new page.CustomEvent('workhub:conversation-defaults', {detail:{environment}}));
      }
    } finally {
      if (environment === activeEnvironment && revision === conversationDefaultsRevision) {
        $('#conversationDefaultsFields').disabled = !state.loaded;
        $('#conversationDefaultsReload').disabled = !state.loaded;
      }
    }
  }, $('#conversationDefaultsError'), {environment, key:'conversation-defaults', isCurrent:() => environment === activeEnvironment && revision === conversationDefaultsRevision});
});

function renderSettings() {
  renderCodexDiagnostics();
  if (state.view === 'settings' && !codexDiagnosticsBatch && !codexDiagnostics.has(activeEnvironment)) void checkCodexEnvironment(activeEnvironment);
  const environment = environmentInventory.find(e => e.id === activeEnvironment);
  $('#settingsEnvironment').textContent = environment?.name || (activeEnvironment === 'local' ? uiText("本机") : activeEnvironment);
  $('#settingsRoot').textContent = state.root || uiText("等待执行环境连接后读取");
  $('#terminalSettingsFields').disabled = !state.loaded || !state.terminal.settings;
  if (!state.loaded) {
    settingsEnvironment = null;
    titleSettingsEnvironment = null;
    titleSettingsRevision++;
    titleSettingsLoading = false;
    conversationDefaultsEnvironment = null;
    conversationDefaultsRevision++;
    conversationDefaultsLoading = false;
    $('#conversationDefaultsFields').disabled = true;
    $('#conversationDefaultsReload').disabled = true;
    $('#sessionTitleFields').disabled = true;
    $('#sessionTitleReload').disabled = true;
    $('#terminalStatus').textContent = uiText("等待执行环境连接后读取终端配置");
    return;
  }
  if (state.view === 'settings' && titleSettingsEnvironment !== activeEnvironment) loadSessionTitleSettings();
  if (state.view === 'settings' && conversationDefaultsEnvironment !== activeEnvironment) loadConversationDefaults();
  // Forms live outside the polled content panel. Initialize once per environment
  // so background Git updates and navigation preserve unfinished edits.
  if (settingsEnvironment !== activeEnvironment) {
    if (state.terminal.settings) loadTerminalFields();
    settingsEnvironment = activeEnvironment;
  } else if (state.terminal.settings) {
    refreshTerminalOptions();
  }
  $('#terminalStatus').textContent = (state.terminal.message || '') + (state.terminal.launcher ? uiText("\n程序：") + state.terminal.launcher : '');
  updateTerminalFields();
}

// This preference belongs to the local application, not the selected WSL user.
function showThemePreview() {
  const choice = $('#colorThemeSelect').value;
  document.querySelectorAll('[data-theme-preview]').forEach(node => { node.hidden = node.dataset.themePreview !== choice; });
}
$('#colorThemeSelect').value = window.YoluTheme.current();
showThemePreview();
$('#colorThemeSelect').addEventListener('change', showThemePreview);
$('#appearanceForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#saveAppearance');
  button.disabled = true;
  $('#appearanceStatus').textContent = '';
  try {
    const result = await api('/api/settings/appearance', {method:'PUT', environment:'local', body:JSON.stringify({color_theme:$('#colorThemeSelect').value})});
    window.YoluTheme.apply(result.color_theme);
    $('#appearanceStatus').textContent = uiText('配色已保存并应用');
  } catch (error) {
    $('#appearanceStatus').textContent = error.message || uiText('保存配色失败，请重试。');
  } finally {
    button.disabled = false;
  }
});
window.addEventListener('yolu:appearance', () => { $('#colorThemeSelect').value = window.YoluTheme.current(); showThemePreview(); });

$('#languageSelect').value = window.YoluI18n?.language || 'system';
$('#languageForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#saveLanguage');
  button.disabled = true;
  try {
    const host = window.top;
    const pages = [host, ...[...host.document.querySelectorAll('iframe')].map(frame => frame.contentWindow).filter(Boolean)];
    const saved = await Promise.all(pages.map(page => page.WorkHubAssistant?.flushDraft?.() ?? true));
    if (saved.some(ok => !ok)) throw new Error(uiText('草稿尚未保存，暂不重新加载。请保持页面打开后重试。'));
    await api('/api/settings/language', {method:'PUT', environment:'local', body:JSON.stringify({language:$('#languageSelect').value})});
    host.location.reload();
  } catch (error) {
    $('#languageStatus').textContent = error.message || uiText('保存语言失败，请重试。');
    button.disabled = false;
  }
});
