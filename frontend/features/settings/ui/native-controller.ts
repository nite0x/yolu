import {uiText} from "@/shared/i18n"
import type {SettingsHost} from "../model/contracts"
import {createSettingsSaveQueue} from "../runtime/save-queue"
import {createAccessController} from "./access-controller"
import {createAgentSettingsController} from "./agent-controller"
import {control as $} from "./controls"
import {createDiagnosticsController, type DiagnosticViews} from "./diagnostics-controller"
import {mountPreferences} from "./preferences"
import {createTerminalSettingsController} from "./terminal-controller"

/** One settings owner per workspace; legacy code only supplies host context. */
export function createSettingsController(host: SettingsHost, views: DiagnosticViews) {
  let settingsEnvironment: string | null = null
  const saves = createSettingsSaveQueue()
  const diagnostics = createDiagnosticsController(host, views)
  const agents = createAgentSettingsController(host, saves)
  const access = createAccessController(host)
  const terminal = createTerminalSettingsController(host, saves)
  const disposePreferences = mountPreferences(host, saves)
  window.addEventListener("pagehide", disposePreferences, {once: true})
  return {
    enqueue: saves.enqueue,
    terminal,
    setUnregistered: diagnostics.setUnregistered,
    refresh() {
      diagnostics.refresh()
      agents.refresh()
      access.refresh()
      const context = host.context()
      const environment = context.inventory.find((environment) => environment.id === context.environment)
      const label =
        environment?.name || (context.environment === "local" ? uiText("本机") : context.environment)
      $("#settingsEnvironment").textContent = label
      $("#settingsTitleEnv").textContent = uiText("执行环境：{0} · 仅用于新对话", label)
      $("#settingsRoot").textContent = context.root || uiText("等待执行环境连接后读取")
      $("#terminalSettingsFields").disabled = !context.loaded || !context.terminal.settings
      if (!context.loaded) {
        settingsEnvironment = null
        $("#terminalStatus").textContent = uiText("等待执行环境连接后读取终端配置")
        return
      }
      if (settingsEnvironment !== context.environment) {
        if (context.terminal.settings) terminal.loadTerminalFields()
        settingsEnvironment = context.environment
      } else if (context.terminal.settings) terminal.refreshTerminalOptions()
      $("#terminalStatus").textContent =
        (context.terminal.message || "") +
        (context.terminal.launcher ? uiText("\n程序：") + context.terminal.launcher : "")
      terminal.updateTerminalFields()
    },
  }
}
