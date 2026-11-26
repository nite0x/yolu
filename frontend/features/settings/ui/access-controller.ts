import {uiText} from "@/shared/i18n"
import type {BrowserAccess, MCPResult, MCPSettings, SettingsHost} from "../model/contracts"
import {control as $} from "./controls"
export function createAccessController(host: SettingsHost) {
  let browserAccessState: BrowserAccess | null = null
  let browserAccessLoading = false
  let mcpSettingsChecked = false
  let mcpSettingsBusy = false
  let mcpAgentSettings: MCPSettings | null = null
  const mcpStatusText: Record<string, string> = {
    available: "可安装",
    installed: "已安装",
    conflict: "已存在同名配置，请在 Agent 中检查 yolu。",
    missing_cli: "未找到 Agent CLI，请先安装后刷新。",
    unavailable: "无法读取 MCP 配置，请检查 Agent 后刷新。",
  }

  function renderMCPSettings() {
    const canManage = mcpAgentSettings?.can_manage !== false
    $("#mcpAgentRows").hidden = !canManage
    $("#mcpSettingsReload").hidden = !canManage
    $("#mcpSettingsReload").disabled = mcpSettingsBusy
    for (const row of $("#mcpAgentRows").querySelectorAll<HTMLElement>("[data-mcp-agent]")) {
      const id = row.dataset.mcpAgent
      if (!id) continue
      const status = mcpAgentSettings?.agents.find((item) => item.agent === id)?.status
      const install = row.querySelector<HTMLButtonElement>("[data-mcp-install]")
      const description = row.querySelector<HTMLElement>("[data-mcp-status]")
      if (!install || !description) continue
      install.disabled = mcpSettingsBusy || status !== "available"
      description.textContent = uiText(
        mcpStatusText[status || ""] || "无法读取 MCP 配置，请检查 Agent 后刷新。",
      )
    }
  }

  function showMCPSettingsError(message = "") {
    const feedback = $("#mcpSettingsError")
    feedback.textContent = message
    feedback.hidden = !message
  }

  async function loadMCPSettings() {
    if (mcpSettingsBusy) return
    mcpSettingsChecked = true
    mcpSettingsBusy = true
    $("#mcpSettingsReload").disabled = true
    for (const button of $("#mcpAgentRows").querySelectorAll<HTMLButtonElement>("[data-mcp-install]"))
      button.disabled = true
    $("#mcpSettingsStatus").textContent = uiText("正在检测 Agent…")
    showMCPSettingsError()
    try {
      const result = await host.request<MCPSettings>("/api/settings/mcp", {environment: "local"})
      if (!Array.isArray(result.agents)) throw new Error(uiText("无法读取 MCP 安装状态，请刷新后重试。"))
      mcpAgentSettings = result
      $("#mcpSettingsStatus").textContent = result.can_manage ? "" : uiText("请在主机上的 Yolu 中安装 MCP")
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      $("#mcpSettingsStatus").textContent = ""
      showMCPSettingsError(error.message || uiText("无法读取 MCP 安装状态，请刷新后重试。"))
    } finally {
      mcpSettingsBusy = false
      renderMCPSettings()
    }
  }

  $("#mcpSettingsReload").addEventListener("click", () => {
    void loadMCPSettings()
  })
  $("#mcpAgentRows").addEventListener("click", async (event) => {
    const button =
      event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-mcp-install]") : null
    if (!button || button.disabled || mcpSettingsBusy) return
    const agent = button.closest<HTMLElement>("[data-mcp-agent]")?.dataset.mcpAgent
    if (!agent || !mcpAgentSettings) return
    mcpSettingsBusy = true
    renderMCPSettings()
    $("#mcpSettingsStatus").textContent = uiText("正在安装 MCP…")
    showMCPSettingsError()
    try {
      const result = await host.request<MCPResult>("/api/settings/mcp", {
        method: "POST",
        environment: "local",
        body: JSON.stringify({agent}),
      })
      if (result.agent !== agent || !Object.hasOwn(mcpStatusText, result.status))
        throw new Error(uiText("无法读取 MCP 安装状态，请刷新后重试。"))
      const item = mcpAgentSettings?.agents.find((item) => item.agent === agent)
      if (item) item.status = result.status
      $("#mcpSettingsStatus").textContent = uiText(
        result.status === "installed"
          ? "已安装 MCP，重新打开 Agent 会话后即可使用。"
          : mcpStatusText[result.status] || "无法读取 MCP 安装状态，请刷新后重试。",
      )
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      $("#mcpSettingsStatus").textContent = ""
      showMCPSettingsError(error.message || uiText("未能保存 MCP 配置，请检查 Agent 设置与文件权限后重试。"))
    } finally {
      mcpSettingsBusy = false
      renderMCPSettings()
    }
  })

  function updateBrowserAccessDirty() {
    const button = $("#saveBrowserAccess")
    if (!button || !browserAccessState) return
    const dirty =
      $("#browserAccessEnabled").checked !== !!browserAccessState.enabled ||
      Number($("#browserAccessPort").value) !== Number(browserAccessState.port)
    button.dataset.dirty = dirty ? "true" : "false"
  }

  function renderBrowserAccess(result: BrowserAccess) {
    browserAccessState = result
    $("#browserAccessFields").hidden = !result.can_manage
    $("#browserAccessFields").disabled = !result.can_manage
    $("#browserAccessLogout").hidden = result.can_manage
    $("#browserAccessEnabled").checked = result.enabled
    $("#browserAccessPort").value = String(result.port)
    $("#browserAccessCode").value = result.code
    $("#browserAccessConnection").hidden = !result.running
    $("#browserAccessStatus").textContent = result.error
      ? uiText(result.error)
      : result.running
        ? uiText("浏览器访问已开启")
        : uiText("浏览器访问已关闭")
    updateBrowserAccessDirty()
    const addresses = $("#browserAccessAddresses")
    addresses.replaceChildren()
    if (!result.can_manage) return
    for (const address of result.addresses) {
      const row = document.createElement("li")
      const label = document.createElement("code")
      label.textContent = address
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = uiText("复制地址")
      button.setAttribute("aria-label", uiText("复制地址 {0}", address))
      button.addEventListener("click", () => host.copy(address))
      row.append(label, button)
      addresses.append(row)
    }
  }

  async function loadBrowserAccess() {
    browserAccessLoading = true
    try {
      renderBrowserAccess(
        await host.request<BrowserAccess>("/api/settings/browser-access", {environment: "local"}),
      )
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      $("#browserAccessStatus").textContent = error.message
    } finally {
      browserAccessLoading = false
    }
  }

  async function saveBrowserAccess(regenerate = false) {
    if (browserAccessLoading || !browserAccessState?.can_manage) return
    browserAccessLoading = true
    $("#browserAccessFields").disabled = true
    try {
      const enabled = regenerate ? browserAccessState.enabled : $("#browserAccessEnabled").checked
      const port = regenerate ? browserAccessState.port : Number($("#browserAccessPort").value)
      renderBrowserAccess(
        await host.request<BrowserAccess>("/api/settings/browser-access", {
          method: "PUT",
          environment: "local",
          body: JSON.stringify({enabled, port, regenerate_code: regenerate}),
        }),
      )
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      $("#browserAccessStatus").textContent = error.message
    } finally {
      browserAccessLoading = false
      $("#browserAccessFields").disabled = !browserAccessState?.can_manage
    }
  }

  $("#browserAccessEnabled").addEventListener("change", updateBrowserAccessDirty)
  $("#browserAccessPort").addEventListener("input", updateBrowserAccessDirty)
  $("#browserAccessForm").addEventListener("submit", (event) => {
    event.preventDefault()
    void saveBrowserAccess()
  })
  $("#copyBrowserAccessCode").addEventListener("click", () => host.copy($("#browserAccessCode").value))
  $("#resetBrowserAccessCode").addEventListener("click", () => {
    void saveBrowserAccess(true)
  })

  return {
    refresh() {
      if (host.context().view !== "settings") return
      if (!browserAccessState && !browserAccessLoading) void loadBrowserAccess()
      if (!mcpSettingsChecked) void loadMCPSettings()
    },
  }
}
