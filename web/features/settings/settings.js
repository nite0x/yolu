'use strict';
var uiText = (message, ...values) => globalThis.YoluI18n ? globalThis.YoluI18n.text(message, ...values) : message.replace(/\{(\d+)\}/g, (match, index) => Number(index) < values.length ? String(values[Number(index)]) : match);


let settingsEnvironment = null;
let browserAccessState = null;
let browserAccessLoading = false;
let mcpSettingsChecked = false;
let mcpSettingsBusy = false;
let mcpAgentSettings = null;
let titleSettingsEnvironment = null;
let titleSettingsLoading = false;
let titleSettingsRevision = 0;
let titleSaveRevision = 0;
let conversationDefaultsEnvironment = null;
let conversationDefaultsRevision = 0;
let conversationDefaultsLoading = false;
let conversationDefaultModels = [];
const conversationDefaultsSaveRevisions = new Map();
let appearanceSaveRevision = 0;
let chatInputSaveRevision = 0;
const codexDiagnostics = new Map();
const agyDiagnostics = new Map();
const codexInstallationMonitors = new Set();
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
  const container = $('#codexDiagnosticsResults');
  const openDetails = new Set([...container.querySelectorAll('details[open]')].map(details => details.closest('[data-codex-environment]').dataset.codexEnvironment));
  container.innerHTML = window.WorkHubUI.codexDiagnostics([...codexDiagnostics.values()].map(result => ({ ...result, readOnly: sessionReadOnly })));
  for (const section of container.querySelectorAll('[data-codex-environment]')) {
    if (openDetails.has(section.dataset.codexEnvironment)) section.querySelector('details')?.setAttribute('open', '');
  }
  $('#codexDiagnosticsCopy').hidden = true;
  renderCodexDiagnostics();
}

function setCodexDiagnostic(id, changes) {
  codexDiagnostics.set(id, { ...codexDiagnostics.get(id), id, name: environmentName(id), ...changes });
  updateCodexDiagnostics();
}

async function checkCodexEnvironment(id) {
  const current = codexDiagnostics.get(id);
  if (current?.loading || current?.install?.status === 'running') return;
  setCodexDiagnostic(id, { loading: true, error: null });
  try {
    const report = await api('/api/settings/codex', { environment: id, cache: 'no-store' });
    if (!report || !Array.isArray(report.checks) || !Array.isArray(report.candidates)) throw new Error(uiText("后台未返回有效检测报告，请确认 Yolu 后台版本"));
    setCodexDiagnostic(id, { report, install: report.install_state, loading: false });
    if (report.install_state?.status === 'running') void monitorCodexInstallation(id);
  } catch (error) {
    setCodexDiagnostic(id, { loading: false, error: error.message });
  }
}

async function monitorCodexInstallation(id) {
  if (codexInstallationMonitors.has(id)) return;
  codexInstallationMonitors.add(id);
  try {
    let failures = 0;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const install = await api('/api/settings/codex/install', { environment: id, cache: 'no-store' });
        if (install?.status === 'running') {
          failures = 0;
          if (install.stage !== codexDiagnostics.get(id)?.install?.stage) setCodexDiagnostic(id, { install });
          continue;
        }
        const installError = !install?.status ? uiText("未找到安装记录，请重新检测当前版本。") : null;
        setCodexDiagnostic(id, { install, installError });
        break;
      } catch (error) {
        if (++failures < 3) continue;
        setCodexDiagnostic(id, { install: null, installError: error.message });
        break;
      }
    }
  } finally {
    codexInstallationMonitors.delete(id);
  }
  await checkCodexEnvironment(id);
}

$('#codexDiagnosticsResults').addEventListener('click', async event => {
  const button = event.target.closest('button[data-codex-install]');
  if (!button || button.disabled || sessionReadOnly) return;
  const id = button.closest('[data-codex-environment]').dataset.codexEnvironment;
  const result = codexDiagnostics.get(id);
  const plan = result?.report?.install_plan;
  if (!plan?.action || result.loading || result.error || result.install?.status === 'running') return;
  setCodexDiagnostic(id, { install: { status: 'running', action: plan.action }, installError: null });
  try {
    const install = await api('/api/settings/codex/install', { method: 'POST', environment: id, body: JSON.stringify(plan) });
    if (install?.status !== 'running') throw new Error(uiText("后台未返回有效的 Codex 安装状态，请重新检测。"));
    setCodexDiagnostic(id, { install });
    void monitorCodexInstallation(id);
  } catch (error) {
    setCodexDiagnostic(id, { install: null, installError: error.message });
    await checkCodexEnvironment(id);
  }
});

$('#checkCodex').addEventListener('click', () => checkCodexEnvironment(activeEnvironment));
function renderAgyDiagnostics() {
  const results = [...agyDiagnostics.values()];
  const loading = results.some(result => result.loading);
  const button = $('#checkAgy');
  if (button) button.disabled = loading;
  const status = $('#agyDiagnosticsStatus');
  if (status) status.textContent = loading ? uiText("正在检测执行环境，请稍候…") : results.length ? uiText("已检测 {0} 个环境；当前配置：{1}", results.length, environmentName()) : uiText("尚未检测");
}
function updateAgyDiagnostics() {
  const container = $('#agyDiagnosticsResults');
  if (container && window.WorkHubUI.agyDiagnostics) {
    container.innerHTML = window.WorkHubUI.agyDiagnostics([...agyDiagnostics.values()]);
  }
  renderAgyDiagnostics();
}
function setAgyDiagnostic(id, changes) {
  agyDiagnostics.set(id, { ...agyDiagnostics.get(id), id, name: environmentName(id), ...changes });
  updateAgyDiagnostics();
}
async function checkAgyEnvironment(id) {
  const current = agyDiagnostics.get(id);
  if (current?.loading) return;
  setAgyDiagnostic(id, { loading: true, error: null });
  try {
    const report = await api('/api/settings/agy', { environment: id, cache: 'no-store' });
    if (!report || !Array.isArray(report.checks)) throw new Error(uiText("后台未返回有效检测报告，请确认 Yolu 后台版本"));
    setAgyDiagnostic(id, { report, loading: false });
  } catch (error) {
    setAgyDiagnostic(id, { loading: false, error: error.message });
  }
}
$('#checkAgy')?.addEventListener('click', () => checkAgyEnvironment(activeEnvironment));
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

function syncModelsReloadButton() {
  const button = $('#conversationDefaultsReload');
  if (!button) return;
  const loading = conversationDefaultsLoading || titleSettingsLoading;
  button.disabled = !state.loaded || loading;
  button.dataset.loading = loading ? 'true' : 'false';
}

async function loadSessionTitleSettings() {
  const environment = activeEnvironment;
  const revision = ++titleSettingsRevision;
  titleSettingsEnvironment = environment;
  titleSettingsLoading = true;
  $('#sessionTitleFields').disabled = true;
  syncModelsReloadButton();
  $('#sessionTitleError').hidden = true;
  if ($('#sessionTitleStatus')) $('#sessionTitleStatus').textContent = '';
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
      syncModelsReloadButton();
    }
  }
}

async function saveSessionTitleModel() {
  if ($('#sessionTitleFields').disabled) return;
  const environment = activeEnvironment;
  const model = $('#sessionTitleModel').value;
  const revision = ++titleSaveRevision;
  const loadRev = titleSettingsRevision;
  $('#sessionTitleError').hidden = true;
  if ($('#sessionTitleStatus')) $('#sessionTitleStatus').textContent = uiText('保存中…');
  try {
    await api('/api/settings/session-title', { method: 'PUT', environment, body: JSON.stringify({ model }) });
    if (environment !== activeEnvironment || revision !== titleSaveRevision || loadRev !== titleSettingsRevision) return;
    if ($('#sessionTitleStatus')) $('#sessionTitleStatus').textContent = uiText('已保存');
  } catch (error) {
    if (environment !== activeEnvironment || revision !== titleSaveRevision || loadRev !== titleSettingsRevision) return;
    if ($('#sessionTitleStatus')) $('#sessionTitleStatus').textContent = '';
    $('#sessionTitleError').textContent = error.message;
    $('#sessionTitleError').hidden = false;
  }
}

$('#sessionTitleModel').addEventListener('change', () => { void saveSessionTitleModel(); });
$('#sessionTitleForm').addEventListener('submit', event => {
  event.preventDefault();
  void saveSessionTitleModel();
});

function setConversationDefaultOptions(select, defaultLabel, options, value, unavailableLabel) {
  const selected = options.some(option => option.value === value);
  if (value && !selected && unavailableLabel) options.unshift(new Option(uiText(unavailableLabel, value), value));
  select.replaceChildren(new Option(defaultLabel, ''), ...options);
  select.value = selected || unavailableLabel ? value : '';
}

function selectedProvider() {
  return $('#conversationDefaultProviderGroup input[name="conversation_default_provider"]:checked')?.value || 'codex';
}

function selectedSegmentValue(containerId, inputName) {
  return $(`#${containerId} input[name="${inputName}"]:checked`)?.value ?? '';
}

function renderSegmentOptions(container, inputName, items, value, unavailableLabel) {
  const list = [...items];
  const matched = list.some(item => item.value === value);
  if (value && !matched && unavailableLabel) {
    list.splice(1, 0, { value, label: uiText(unavailableLabel, value), unavailable: true });
  }
  const activeValue = matched || (value && unavailableLabel) ? value : '';
  const onlyDefault = list.length <= 1;
  container.dataset.disabled = onlyDefault ? 'true' : 'false';
  const nodes = list.map(item => {
    const label = document.createElement('label');
    if (item.danger) label.dataset.danger = 'true';
    if (item.unavailable) label.dataset.unavailable = 'true';
    const input = document.createElement('input');
    input.type = 'radio';
    input.className = 'sr-only';
    input.name = inputName;
    input.value = item.value;
    input.checked = item.value === activeValue;
    if (onlyDefault) input.disabled = true;
    const text = document.createElement('span');
    text.textContent = item.label;
    label.append(input, text);
    return label;
  });
  container.replaceChildren(...nodes);
}

function updatePermissionHelp(provider, permission) {
  const help = $('#conversationDefaultPermissionHelp');
  if (!help) return;
  help.textContent = provider === 'agy' ? uiText('选择「跳过权限检查」后，Antigravity 会自动批准操作。') : [
    uiText('按目录授权的对话使用其目录访问权限。'),
    uiText('完全访问权限允许读取和修改电脑上的文件并执行命令。'),
  ].join(' ');
  help.dataset.danger = permission === 'full' ? 'true' : 'false';
}

function renderConversationModelOptions(provider, effort, speed, unavailableLabel) {
  const {findChatModel, effortLabel, serviceTierLabel} = window.WorkHubUI;
  const model = findChatModel(conversationDefaultModels, $('#conversationDefaultModel').value);
  const effortOptions = [...new Set(model?.supportedReasoningEfforts?.map(item => item.reasoningEffort).filter(Boolean))];
  const tiers = new Map((model?.serviceTiers || []).filter(tier => tier.id).map(tier => [tier.id, tier]));
  const effortContainer = $('#conversationDefaultEffort');
  const speedSelect = $('#conversationDefaultSpeed');
  const effortItems = effortOptions.length
    ? [{ value: '', label: uiText('默认') }, ...effortOptions.map(value => ({ value, label: effortLabel(value) }))]
    : [{ value: '', label: uiText('使用模型默认强度') }];
  renderSegmentOptions(effortContainer, 'conversation_default_effort', effortItems, effort, unavailableLabel);
  if (provider === 'agy') {
    speedSelect.replaceChildren(new Option(uiText('Antigravity 由模型决定响应速度'), ''));
  } else {
    setConversationDefaultOptions(speedSelect, uiText('沿用 Codex 默认速度'), [...tiers.values()].map(tier => new Option(serviceTierLabel(tier), tier.id)), speed, unavailableLabel);
  }
  speedSelect.disabled = speedSelect.options.length === 1;
}

function conversationDefaultsPath(provider, reload = false) {
  return '/api/settings/conversation-defaults' + (provider === 'agy' ? '?provider=agy' + (reload ? '&refresh=1' : '') : '');
}

function conversationDefaultValues() {
  return {
    model: $('#conversationDefaultModel').value,
    effort: selectedSegmentValue('conversationDefaultEffort', 'conversation_default_effort'),
    serviceTier: $('#conversationDefaultSpeed').value,
    permission: selectedSegmentValue('conversationDefaultPermission', 'conversation_default_permission'),
  };
}

function setConversationDefaultsStatus(text, muted = false) {
  const status = $('#conversationDefaultsStatus');
  if (!status) return;
  status.textContent = text;
  status.dataset.state = muted ? 'muted' : '';
}

async function loadConversationDefaults(reload = false) {
  const environment = activeEnvironment;
  const provider = selectedProvider();
  const revision = ++conversationDefaultsRevision;
  conversationDefaultsEnvironment = environment;
  conversationDefaultsLoading = true;
  $('#conversationDefaultProviderGroup').disabled = false;
  $('#conversationDefaultsFields').disabled = true;
  syncModelsReloadButton();
  $('#conversationDefaultsError').hidden = true;
  setConversationDefaultsStatus(uiText('正在读取…'), true);
  try {
    const result = await api(conversationDefaultsPath(provider, reload), {environment});
    if (environment !== activeEnvironment || revision !== conversationDefaultsRevision) return;
    conversationDefaultModels = result.models || [];
    const unavailableLabel = result.models_error ? '{0}（未核对）' : '{0}（当前不可用）';
    const settings = result.settings || {};
    const models = conversationDefaultModels.map(model => new Option(model.displayName || model.model, model.model));
    setConversationDefaultOptions($('#conversationDefaultModel'), provider === 'agy' ? uiText('沿用 Antigravity 默认模型') : uiText('沿用 Codex 默认模型'), models, settings.model || '', unavailableLabel);
    renderConversationModelOptions(provider, settings.effort || '', settings.serviceTier || '', unavailableLabel);
    const permissions = [
      { value: '', label: uiText('沿用默认') },
      ...window.WorkHubUI.permissionChoices(provider).map(choice => ({ value: choice.value, label: choice.label, danger: !!choice.danger })),
    ];
    renderSegmentOptions($('#conversationDefaultPermission'), 'conversation_default_permission', permissions, settings.permission || '', unavailableLabel);
    updatePermissionHelp(provider, selectedSegmentValue('conversationDefaultPermission', 'conversation_default_permission'));
    setConversationDefaultsStatus(result.models_error ? uiText(result.models_error) : '', true);
    $('#conversationDefaultsFields').disabled = result.available === false;
  } catch (error) {
    if (environment !== activeEnvironment || revision !== conversationDefaultsRevision) return;
    setConversationDefaultsStatus('');
    $('#conversationDefaultsError').textContent = error.message;
    $('#conversationDefaultsError').hidden = false;
  } finally {
    if (environment === activeEnvironment && revision === conversationDefaultsRevision) {
      conversationDefaultsLoading = false;
      syncModelsReloadButton();
    }
  }
}

async function saveConversationDefaults() {
  if ($('#conversationDefaultsFields').disabled) return;
  const environment = activeEnvironment;
  const provider = selectedProvider();
  const key = JSON.stringify([environment, provider]);
  const saveRev = (conversationDefaultsSaveRevisions.get(key) || 0) + 1;
  conversationDefaultsSaveRevisions.set(key, saveRev);
  const loadRev = conversationDefaultsRevision;
  const settings = conversationDefaultValues();
  $('#conversationDefaultsError').hidden = true;
  setConversationDefaultsStatus(uiText('保存中…'), true);
  try {
    await api(conversationDefaultsPath(provider), {method:'PUT', environment, body:JSON.stringify(settings)});
    if (environment === activeEnvironment && provider === selectedProvider() && loadRev === conversationDefaultsRevision && conversationDefaultsSaveRevisions.get(key) === saveRev) {
      setConversationDefaultsStatus(uiText('已保存'));
    }
    const host = window.top;
    for (const page of [host, ...[...host.document.querySelectorAll('iframe')].map(frame => frame.contentWindow).filter(Boolean)]) {
      page.dispatchEvent(new page.CustomEvent('workhub:conversation-defaults', {detail:{environment, provider}}));
    }
  } catch (error) {
    if (environment !== activeEnvironment || provider !== selectedProvider() || loadRev !== conversationDefaultsRevision || conversationDefaultsSaveRevisions.get(key) !== saveRev) return;
    setConversationDefaultsStatus('');
    $('#conversationDefaultsError').textContent = error.message;
    $('#conversationDefaultsError').hidden = false;
  }
}

$('#conversationDefaultProviderGroup').addEventListener('change', () => { if (state.loaded) void loadConversationDefaults(); });
$('#conversationDefaultModel').addEventListener('change', () => {
  const provider = selectedProvider();
  renderConversationModelOptions(provider, selectedSegmentValue('conversationDefaultEffort', 'conversation_default_effort'), $('#conversationDefaultSpeed').value);
});
$('#conversationDefaultsFields').addEventListener('change', () => {
  if ($('#conversationDefaultsFields').disabled) return;
  const provider = selectedProvider();
  updatePermissionHelp(provider, selectedSegmentValue('conversationDefaultPermission', 'conversation_default_permission'));
  void saveConversationDefaults();
});
$('#conversationDefaultsReload').addEventListener('click', () => {
  if (!state.loaded) return;
  if (!conversationDefaultsLoading) void loadConversationDefaults(true);
  if (!titleSettingsLoading) void loadSessionTitleSettings();
});
$('#conversationDefaultsForm').addEventListener('submit', event => {
  event.preventDefault();
  void saveConversationDefaults();
});

function renderSettings() {
  if (state.view === 'settings' && !browserAccessState && !browserAccessLoading) void loadBrowserAccess();
  if (state.view === 'settings' && !mcpSettingsChecked) void loadMCPSettings();
  renderCodexDiagnostics();
  renderAgyDiagnostics();
  if (state.view === 'settings' && !codexDiagnosticsBatch && !codexDiagnostics.has(activeEnvironment)) void checkCodexEnvironment(activeEnvironment);
  if (state.view === 'settings' && !agyDiagnostics.has(activeEnvironment)) void checkAgyEnvironment(activeEnvironment);
  const environment = environmentInventory.find(e => e.id === activeEnvironment);
  const envLabel = environment?.name || (activeEnvironment === 'local' ? uiText("本机") : activeEnvironment);
  $('#settingsEnvironment').textContent = envLabel;
  if ($('#settingsConversationEnv')) $('#settingsConversationEnv').textContent = uiText('当前环境：{0}', envLabel);
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
    $('#conversationDefaultProviderGroup').disabled = true;
    $('#conversationDefaultsFields').disabled = true;
    $('#sessionTitleFields').disabled = true;
    syncModelsReloadButton();
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
function syncThemeSelection(choice) {
  for (const input of document.querySelectorAll('#colorThemeGroup input[name="color_theme"]')) {
    input.checked = input.value === choice;
  }
}
syncThemeSelection(window.YoluTheme.current());
$('#colorThemeGroup').addEventListener('change', async event => {
  const input = event.target.closest('input[name="color_theme"]');
  if (!input) return;
  const choice = input.value;
  const previous = window.YoluTheme.current();
  const revision = ++appearanceSaveRevision;
  window.YoluTheme.apply(choice);
  $('#appearanceError').hidden = true;
  $('#appearanceStatus').textContent = uiText('保存中…');
  $('#appearanceStatus').dataset.state = 'muted';
  try {
    const result = await api('/api/settings/appearance', {method:'PUT', environment:'local', body:JSON.stringify({color_theme:choice})});
    if (revision !== appearanceSaveRevision) return;
    window.YoluTheme.apply(result.color_theme);
    $('#appearanceStatus').textContent = uiText('已保存');
    $('#appearanceStatus').dataset.state = '';
  } catch (error) {
    if (revision !== appearanceSaveRevision) return;
    window.YoluTheme.apply(previous);
    syncThemeSelection(previous);
    $('#appearanceStatus').textContent = '';
    $('#appearanceError').textContent = error.message || uiText('保存配色失败，请重试。');
    $('#appearanceError').hidden = false;
  }
});
$('#appearanceForm').addEventListener('submit', event => { event.preventDefault(); });

const mcpStatusText = {
  available: '可安装',
  installed: '已安装',
  conflict: '已存在同名配置，请在 Agent 中检查 yolu。',
  missing_cli: '未找到 Agent CLI，请先安装后刷新。',
  unavailable: '无法读取 MCP 配置，请检查 Agent 后刷新。',
};

function renderMCPSettings() {
  const canManage = mcpAgentSettings?.can_manage !== false;
  $('#mcpAgentRows').hidden = !canManage;
  $('#mcpSettingsReload').hidden = !canManage;
  $('#mcpSettingsReload').disabled = mcpSettingsBusy;
  for (const row of $('#mcpAgentRows').querySelectorAll('[data-mcp-agent]')) {
    const id = row.dataset.mcpAgent;
    const status = mcpAgentSettings?.agents.find(item => item.agent === id)?.status;
    row.querySelector('[data-mcp-install]').disabled = mcpSettingsBusy || status !== 'available';
    row.querySelector('[data-mcp-status]').textContent = uiText(mcpStatusText[status] || '无法读取 MCP 配置，请检查 Agent 后刷新。');
  }
}

function showMCPSettingsError(message = '') {
  const feedback = $('#mcpSettingsError');
  feedback.textContent = message;
  feedback.hidden = !message;
}

async function loadMCPSettings() {
  if (mcpSettingsBusy) return;
  mcpSettingsChecked = true;
  mcpSettingsBusy = true;
  $('#mcpSettingsReload').disabled = true;
  for (const button of $('#mcpAgentRows').querySelectorAll('[data-mcp-install]')) button.disabled = true;
  $('#mcpSettingsStatus').textContent = uiText('正在检测 Agent…');
  showMCPSettingsError();
  try {
    const result = await api('/api/settings/mcp', {environment:'local'});
    if (!Array.isArray(result.agents)) throw new Error(uiText('无法读取 MCP 安装状态，请刷新后重试。'));
    mcpAgentSettings = result;
    $('#mcpSettingsStatus').textContent = result.can_manage ? '' : uiText('请在主机上的 Yolu 中安装 MCP');
  } catch (error) {
    $('#mcpSettingsStatus').textContent = '';
    showMCPSettingsError(error.message || uiText('无法读取 MCP 安装状态，请刷新后重试。'));
  } finally {
    mcpSettingsBusy = false;
    renderMCPSettings();
  }
}

$('#mcpSettingsReload').addEventListener('click', () => { void loadMCPSettings(); });
$('#mcpAgentRows').addEventListener('click', async event => {
  const button = event.target.closest('[data-mcp-install]');
  if (!button || button.disabled || mcpSettingsBusy) return;
  const agent = button.closest('[data-mcp-agent]').dataset.mcpAgent;
  mcpSettingsBusy = true;
  renderMCPSettings();
  $('#mcpSettingsStatus').textContent = uiText('正在安装 MCP…');
  showMCPSettingsError();
  try {
    const result = await api('/api/settings/mcp', {method:'POST', environment:'local', body:JSON.stringify({agent})});
    if (result.agent !== agent || !Object.hasOwn(mcpStatusText, result.status)) throw new Error(uiText('无法读取 MCP 安装状态，请刷新后重试。'));
    const item = mcpAgentSettings.agents.find(item => item.agent === agent);
    item.status = result.status;
    $('#mcpSettingsStatus').textContent = uiText(result.status === 'installed' ? '已安装 MCP，重新打开 Agent 会话后即可使用。' : mcpStatusText[result.status] || '无法读取 MCP 安装状态，请刷新后重试。');
  } catch (error) {
    $('#mcpSettingsStatus').textContent = '';
    showMCPSettingsError(error.message || uiText('未能保存 MCP 配置，请检查 Agent 设置与文件权限后重试。'));
  } finally {
    mcpSettingsBusy = false;
    renderMCPSettings();
  }
});

function updateBrowserAccessDirty() {
  const button = $('#saveBrowserAccess');
  if (!button || !browserAccessState) return;
  const dirty = $('#browserAccessEnabled').checked !== !!browserAccessState.enabled || Number($('#browserAccessPort').value) !== Number(browserAccessState.port);
  button.dataset.dirty = dirty ? 'true' : 'false';
}

function renderBrowserAccess(result) {
  browserAccessState = result;
  $('#browserAccessFields').hidden = !result.can_manage;
  $('#browserAccessFields').disabled = !result.can_manage;
  $('#browserAccessLogout').hidden = result.can_manage;
  $('#browserAccessEnabled').checked = result.enabled;
  $('#browserAccessPort').value = result.port;
  $('#browserAccessCode').value = result.code;
  $('#browserAccessConnection').hidden = !result.running;
  $('#browserAccessStatus').textContent = result.error ? uiText(result.error) : result.running ? uiText('浏览器访问已开启') : uiText('浏览器访问已关闭');
  updateBrowserAccessDirty();
  const addresses = $('#browserAccessAddresses');
  addresses.replaceChildren();
  if (!result.can_manage) return;
  for (const address of result.addresses) {
    const row = document.createElement('li');
    const label = document.createElement('code');
    label.textContent = address;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = uiText('复制地址');
    button.setAttribute('aria-label', uiText('复制地址 {0}', address));
    button.addEventListener('click', () => copy(address));
    row.append(label, button);
    addresses.append(row);
  }
}

async function loadBrowserAccess() {
  browserAccessLoading = true;
  try {
    renderBrowserAccess(await api('/api/settings/browser-access', {environment:'local'}));
  } catch (error) {
    $('#browserAccessStatus').textContent = error.message;
  } finally {
    browserAccessLoading = false;
  }
}

async function saveBrowserAccess(regenerate = false) {
  if (browserAccessLoading || !browserAccessState?.can_manage) return;
  browserAccessLoading = true;
  $('#browserAccessFields').disabled = true;
  try {
    const enabled = regenerate ? browserAccessState.enabled : $('#browserAccessEnabled').checked;
    const port = regenerate ? browserAccessState.port : Number($('#browserAccessPort').value);
    renderBrowserAccess(await api('/api/settings/browser-access', {method:'PUT', environment:'local', body:JSON.stringify({enabled, port, regenerate_code:regenerate})}));
  } catch (error) {
    $('#browserAccessStatus').textContent = error.message;
  } finally {
    browserAccessLoading = false;
    $('#browserAccessFields').disabled = !browserAccessState?.can_manage;
  }
}

$('#browserAccessEnabled').addEventListener('change', updateBrowserAccessDirty);
$('#browserAccessPort').addEventListener('input', updateBrowserAccessDirty);
$('#browserAccessForm').addEventListener('submit', event => {
  event.preventDefault();
  void saveBrowserAccess();
});
$('#copyBrowserAccessCode').addEventListener('click', () => copy($('#browserAccessCode').value));
$('#resetBrowserAccessCode').addEventListener('click', () => { void saveBrowserAccess(true); });
window.addEventListener('yolu:appearance', () => { syncThemeSelection(window.YoluTheme.current()); });

function syncSendShortcut(value) {
  for (const input of document.querySelectorAll('#sendShortcutGroup input[name="send_shortcut"]')) {
    input.checked = input.value === value;
  }
}
syncSendShortcut(window.YoluChatInput.current());
window.addEventListener('yolu:chat-input', () => { syncSendShortcut(window.YoluChatInput.current()); });
$('#sendShortcutGroup').addEventListener('change', async event => {
  const input = event.target.closest('input[name="send_shortcut"]');
  if (!input) return;
  const choice = input.value;
  const revision = ++chatInputSaveRevision;
  $('#chatInputError').hidden = true;
  $('#chatInputStatus').textContent = uiText('保存中…');
  try {
    const result = await api('/api/settings/chat-input', {method:'PUT', environment:'local', body:JSON.stringify({send_shortcut:choice})});
    if (revision !== chatInputSaveRevision) return;
    window.YoluChatInput.apply(result.send_shortcut);
    syncSendShortcut(result.send_shortcut);
    $('#chatInputStatus').textContent = uiText('已保存并应用');
  } catch (error) {
    if (revision !== chatInputSaveRevision) return;
    syncSendShortcut(window.YoluChatInput.current());
    $('#chatInputStatus').textContent = '';
    $('#chatInputError').textContent = error.message || uiText('保存对话输入设置失败，请重试。');
    $('#chatInputError').hidden = false;
  }
});
$('#chatInputForm').addEventListener('submit', event => { event.preventDefault(); });

const savedLanguage = window.YoluI18n?.language || 'system';
$('#languageSelect').value = savedLanguage;
function updateLanguageActions() {
  const dirty = $('#languageSelect').value !== savedLanguage;
  $('#saveLanguage').hidden = !dirty;
  $('#cancelLanguage').hidden = !dirty;
  if (!dirty) $('#languageStatus').textContent = '';
}
updateLanguageActions();
$('#languageSelect').addEventListener('change', updateLanguageActions);
$('#cancelLanguage').addEventListener('click', () => {
  $('#languageSelect').value = savedLanguage;
  updateLanguageActions();
});
$('#languageForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#saveLanguage');
  const cancel = $('#cancelLanguage');
  button.disabled = true;
  cancel.disabled = true;
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
    cancel.disabled = false;
  }
});
