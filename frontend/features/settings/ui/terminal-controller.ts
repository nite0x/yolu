import {uiText} from "@/shared/i18n"
import type {SettingsHost, TerminalAvailability} from "../model/contracts"
import type {createSettingsSaveQueue} from "../runtime/save-queue"
import {control as $} from "./controls"

const escapeHTML = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c] || c,
  )
export function createTerminalSettingsController(
  host: SettingsHost,
  saves: ReturnType<typeof createSettingsSaveQueue>,
) {
  const enqueueSettingsSave = saves.enqueue
  const terminalLabels: Record<string, string> = {
    "macos-terminal": "Terminal（macOS）",
    "windows-terminal": "Windows Terminal",
    powershell: uiText("PowerShell（Windows 本机）"),
    otty: "Otty",
    custom: uiText("自定义路径"),
    auto: uiText("系统终端"),
  }
  const terminalStyleLabels: Record<string, string> = {
    otty: "Otty",
    "windows-terminal": "Windows Terminal",
    command: uiText("其他终端（支持 -e 程序 参数）"),
  }
  let terminalOptionsKey = ""

  function renderTerminalOptions() {
    const terminal = host.context().terminal
    const saved = terminal.settings
    if (!saved) return
    const kinds = [
      ...(terminal.supported_kinds || ["windows-terminal", "powershell", "otty", "custom", "auto"]),
    ]
    const styles = [...(terminal.supported_styles || ["otty", "windows-terminal", "command"])]
    if (!kinds.includes(saved.kind)) kinds.push(saved.kind)
    if (saved.kind === "custom" && !styles.includes(saved.style)) styles.push(saved.style)
    $("#terminalKind").innerHTML = kinds
      .map(
        (kind) =>
          `<option value="${escapeHTML(kind)}">${escapeHTML(kind === "auto" ? (terminal.platform === "darwin" ? uiText("系统终端（macOS）") : uiText("系统终端（Linux）")) : terminalLabels[kind] || kind)}</option>`,
      )
      .join("")
    $("#terminalStyle").innerHTML = styles
      .map(
        (style) =>
          `<option value="${escapeHTML(style)}">${escapeHTML(terminalStyleLabels[style] || style)}</option>`,
      )
      .join("")
    $("#terminalPath").placeholder =
      terminal.platform === "darwin"
        ? uiText("/完整路径/终端命令行程序")
        : terminal.platform === "windows"
          ? uiText("C:\\完整路径\\terminal.exe")
          : "/usr/bin/terminal"
    terminalOptionsKey = JSON.stringify([
      terminal.platform,
      terminal.supported_kinds,
      terminal.supported_styles,
    ])
  }

  function refreshTerminalOptions() {
    const terminal = host.context().terminal
    if (
      terminalOptionsKey ===
      JSON.stringify([terminal.platform, terminal.supported_kinds, terminal.supported_styles])
    )
      return
    const kind = $("#terminalKind").value,
      style = $("#terminalStyle").value
    renderTerminalOptions()
    $("#terminalKind").value = kind
    $("#terminalStyle").value = style
  }

  let terminalSaveRevision = 0

  function updateTerminalFields() {
    const kind = $("#terminalKind").value
    const custom = kind === "custom"
    $("#terminalCustomFields").hidden = !custom
    $("#terminalPath").required = custom
    $("#terminalPath").disabled = !custom
    $("#terminalStyle").disabled = !custom
    $("#terminalHint").textContent =
      kind === "macos-terminal" || (kind === "auto" && host.context().terminal.platform === "darwin")
        ? uiText("使用 macOS 系统 Terminal 打开项目工作目录，命令结束后保留终端。Codex 启动后等待你输入。")
        : kind === "otty"
          ? uiText(
              "自动检测 Otty 命令行程序，在新标签页打开项目；未运行时会先启动 Otty。未找到时可用自定义路径指定安装目录下的 bin/otty.exe。",
            )
          : kind === "windows-terminal"
            ? uiText("使用 Windows Terminal 的 wt.exe 打开新窗口。")
            : kind === "powershell"
              ? uiText("使用独立 PowerShell 窗口打开 Windows 本机项目。")
              : custom
                ? uiText("仅支持所选启动方式兼容的终端；程序不可用时会提示错误，保留你的选择。")
                : uiText("自动使用可用的 Linux 桌面终端。")
    $("#terminalStatus").hidden =
      kind !== host.context().terminal.settings?.kind || !!host.context().terminal.available
  }

  function loadTerminalFields() {
    const saved = host.context().terminal.settings
    if (!saved) return
    renderTerminalOptions()
    $("#terminalKind").value = saved.kind
    $("#terminalPath").value = saved.path || ""
    $("#terminalStyle").value =
      saved.kind === "custom" ? saved.style : host.context().terminal.supported_styles?.[0] || "otty"
    $("#terminalError").hidden = true
    if ($("#terminalSaveStatus")) $("#terminalSaveStatus").textContent = ""
    updateTerminalFields()
  }

  async function autoSavePresetTerminal() {
    const environment = host.context().environment
    const kind = $("#terminalKind").value
    if (kind === "custom" || !host.context().loaded || !host.context().terminal.settings) return
    const revision = ++terminalSaveRevision
    $("#terminalError").hidden = true
    if ($("#terminalSaveStatus")) $("#terminalSaveStatus").textContent = uiText("保存中…")
    try {
      const result = await enqueueSettingsSave(JSON.stringify([environment, "terminal"]), () =>
        host.request<TerminalAvailability>("/api/settings/terminal", {
          method: "PUT",
          environment,
          body: JSON.stringify({kind, path: "", style: kind}),
        }),
      )
      if (environment !== host.context().environment || revision !== terminalSaveRevision) return
      host.setTerminal(result)
      $("#terminalStatus").textContent =
        (host.context().terminal.message || "") +
        (host.context().terminal.launcher ? uiText("\n程序：") + host.context().terminal.launcher : "")
      if ($("#terminalSaveStatus")) $("#terminalSaveStatus").textContent = uiText("已保存")
      updateTerminalFields()
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      if (environment !== host.context().environment || revision !== terminalSaveRevision) return
      if ($("#terminalSaveStatus")) $("#terminalSaveStatus").textContent = ""
      $("#terminalError").textContent = error.message
      $("#terminalError").hidden = false
    }
  }

  $("#terminalKind").addEventListener("change", () => {
    updateTerminalFields()
    if ($("#terminalKind").value === "custom") {
      terminalSaveRevision++
      if ($("#terminalSaveStatus")) $("#terminalSaveStatus").textContent = ""
      return
    }
    void autoSavePresetTerminal()
  })
  $("#terminalForm").addEventListener("submit", (event) => {
    event.preventDefault()
    const kind = $("#terminalKind").value
    const environment = host.context().environment
    const body = {
      kind,
      path: kind === "custom" ? $("#terminalPath").value.trim() : "",
      style: kind === "custom" ? $("#terminalStyle").value : kind,
    }
    if ($("#terminalSaveStatus")) $("#terminalSaveStatus").textContent = ""
    host.mutation(
      uiText("正在保存终端设置"),
      async () => {
        const result = await enqueueSettingsSave(JSON.stringify([environment, "terminal"]), () =>
          host.request<TerminalAvailability>("/api/settings/terminal", {
            method: "PUT",
            environment,
            body: JSON.stringify(body),
          }),
        )
        if (environment !== host.context().environment) return
        host.setTerminal(result)
        $("#terminalStatus").textContent =
          (host.context().terminal.message || "") +
          (host.context().terminal.launcher ? uiText("\n程序：") + host.context().terminal.launcher : "")
        if ($("#terminalSaveStatus")) $("#terminalSaveStatus").textContent = uiText("已保存")
        updateTerminalFields()
        host.toast(
          host.context().terminal.launcher
            ? uiText("终端设置已保存，所有终端入口将使用此配置")
            : uiText("终端设置已保存。") + host.context().terminal.message,
          !host.context().terminal.launcher,
        )
      },
      $("#terminalError"),
    )
  })

  return {loadTerminalFields, refreshTerminalOptions, updateTerminalFields}
}
