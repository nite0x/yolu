import {uiText} from "@/shared/i18n"
import type {DiagnosticReport, DiagnosticResult, InstallState, SettingsHost} from "../model/contracts"
import {control as $} from "./controls"
export type DiagnosticViews = {
  codex(container: HTMLElement, results: DiagnosticResult[]): void
  agy(container: HTMLElement, results: DiagnosticResult[]): void
  cursor?(container: HTMLElement, results: DiagnosticResult[]): void
}
export function createDiagnosticsController(host: SettingsHost, views: DiagnosticViews) {
  const codexDiagnostics = new Map<string, DiagnosticResult>()
  const agyDiagnostics = new Map<string, DiagnosticResult>()
  const cursorDiagnostics = new Map<string, DiagnosticResult>()
  const codexInstallationMonitors = new Set<string>()
  let codexDiagnosticsBatch = false
  let codexUnregisteredDistros: string[] = []
  function renderCodexDiagnostics() {
    const results = [...codexDiagnostics.values()]
    const loading = codexDiagnosticsBatch || results.some((result) => result.loading)
    // Do not replace report DOM on the regular workspace poll: retain details,
    // selection, copy fallback and screen-reader position until a check changes.
    $("#checkCodex").disabled = loading
    $("#checkAllCodex").disabled = loading
    $("#copyCodexDiagnostics").disabled = loading || !results.length
    $("#codexDiagnosticsStatus").textContent = loading
      ? uiText("正在检测执行环境，请稍候…")
      : results.length
        ? uiText("已检测 {0} 个环境；当前配置：{1}", results.length, host.environmentName())
        : uiText("尚未检测")
    $("#codexUnregistered").hidden = !codexUnregisteredDistros.length
    $("#codexUnregistered").textContent = uiText(
      "以下 WSL 发行版尚未登记，请先使用「连接 WSL」选择用户后检测：{0}",
      codexUnregisteredDistros.join("、"),
    )
  }

  function updateCodexDiagnostics() {
    const container = $("#codexDiagnosticsResults")
    const openDetails = new Set(
      [...container.querySelectorAll<HTMLDetailsElement>("details[open]")].map(
        (details) => details.closest<HTMLElement>("[data-codex-environment]")?.dataset.codexEnvironment,
      ),
    )
    views.codex(
      container,
      [...codexDiagnostics.values()].map((result) => ({...result, readOnly: host.context().readOnly})),
    )
    for (const section of container.querySelectorAll<HTMLElement>("[data-codex-environment]")) {
      if (openDetails.has(section.dataset.codexEnvironment))
        section.querySelector("details")?.setAttribute("open", "")
    }
    $("#codexDiagnosticsCopy").hidden = true
    renderCodexDiagnostics()
  }

  function setCodexDiagnostic(id: string, changes: Partial<DiagnosticResult>) {
    codexDiagnostics.set(id, {...codexDiagnostics.get(id), id, name: host.environmentName(id), ...changes})
    updateCodexDiagnostics()
  }

  async function checkCodexEnvironment(id: string) {
    const current = codexDiagnostics.get(id)
    if (current?.loading || current?.install?.status === "running") return
    setCodexDiagnostic(id, {loading: true, error: null})
    try {
      const report = await host.request<DiagnosticReport>("/api/settings/codex", {
        environment: id,
        cache: "no-store",
      })
      if (!report || !Array.isArray(report.checks) || !Array.isArray(report.candidates))
        throw new Error(uiText("后台未返回有效检测报告，请确认 Yolu 后台版本"))
      setCodexDiagnostic(id, {report, install: report.install_state, loading: false})
      if (report.install_state?.status === "running") void monitorCodexInstallation(id)
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      setCodexDiagnostic(id, {loading: false, error: error.message})
    }
  }

  async function monitorCodexInstallation(id: string) {
    if (codexInstallationMonitors.has(id)) return
    codexInstallationMonitors.add(id)
    try {
      let failures = 0
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        try {
          const install = await host.request<InstallState>("/api/settings/codex/install", {
            environment: id,
            cache: "no-store",
          })
          if (install?.status === "running") {
            failures = 0
            if (install.stage !== codexDiagnostics.get(id)?.install?.stage) setCodexDiagnostic(id, {install})
            continue
          }
          const installError = !install?.status ? uiText("未找到安装记录，请重新检测当前版本。") : null
          setCodexDiagnostic(id, {install, installError})
          break
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause))
          if (++failures < 3) continue
          setCodexDiagnostic(id, {install: null, installError: error.message})
          break
        }
      }
    } finally {
      codexInstallationMonitors.delete(id)
    }
    await checkCodexEnvironment(id)
  }

  $("#codexDiagnosticsResults").addEventListener("click", async (event) => {
    const button =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>("button[data-codex-install]")
        : null
    if (!button || button.disabled || host.context().readOnly) return
    const id = button.closest<HTMLElement>("[data-codex-environment]")?.dataset.codexEnvironment
    if (!id) return
    const result = codexDiagnostics.get(id)
    const plan = result?.report?.install_plan
    if (!plan?.action || !result || result.loading || result.error || result.install?.status === "running")
      return
    setCodexDiagnostic(id, {install: {status: "running", action: plan.action}, installError: null})
    try {
      const install = await host.request<InstallState>("/api/settings/codex/install", {
        method: "POST",
        environment: id,
        body: JSON.stringify(plan),
      })
      if (install?.status !== "running")
        throw new Error(uiText("后台未返回有效的 Codex 安装状态，请重新检测。"))
      setCodexDiagnostic(id, {install})
      void monitorCodexInstallation(id)
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      setCodexDiagnostic(id, {install: null, installError: error.message})
      await checkCodexEnvironment(id)
    }
  })

  $("#checkCodex").addEventListener("click", () => checkCodexEnvironment(host.context().environment))
  function renderAgyDiagnostics() {
    const results = [...agyDiagnostics.values()]
    const loading = results.some((result) => result.loading)
    const button = $("#checkAgy")
    if (button) button.disabled = loading
    const status = $("#agyDiagnosticsStatus")
    if (status)
      status.textContent = loading
        ? uiText("正在检测执行环境，请稍候…")
        : results.length
          ? uiText("已检测 {0} 个环境；当前配置：{1}", results.length, host.environmentName())
          : uiText("尚未检测")
  }
  function updateAgyDiagnostics() {
    const container = $("#agyDiagnosticsResults")
    if (container && views.agy) {
      views.agy(container, [...agyDiagnostics.values()])
    }
    renderAgyDiagnostics()
  }
  function setAgyDiagnostic(id: string, changes: Partial<DiagnosticResult>) {
    agyDiagnostics.set(id, {...agyDiagnostics.get(id), id, name: host.environmentName(id), ...changes})
    updateAgyDiagnostics()
  }
  async function checkAgyEnvironment(id: string) {
    const current = agyDiagnostics.get(id)
    if (current?.loading) return
    setAgyDiagnostic(id, {loading: true, error: null})
    try {
      const report = await host.request<DiagnosticReport>("/api/settings/agy", {
        environment: id,
        cache: "no-store",
      })
      if (!report || !Array.isArray(report.checks))
        throw new Error(uiText("后台未返回有效检测报告，请确认 Yolu 后台版本"))
      setAgyDiagnostic(id, {report, loading: false})
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      setAgyDiagnostic(id, {loading: false, error: error.message})
    }
  }
  $("#checkAgy")?.addEventListener("click", () => checkAgyEnvironment(host.context().environment))
  function renderCursorDiagnostics() {
    const results = [...cursorDiagnostics.values()]
    const loading = results.some((result) => result.loading)
    const button = $("#checkCursor")
    if (button) button.disabled = loading
    const status = $("#cursorDiagnosticsStatus")
    if (status)
      status.textContent = loading
        ? uiText("正在检测执行环境，请稍候…")
        : results.length
          ? uiText("已检测 {0} 个环境；当前配置：{1}", results.length, host.environmentName())
          : uiText("尚未检测")
  }
  function updateCursorDiagnostics() {
    const container = $("#cursorDiagnosticsResults")
    if (container && views.cursor) {
      views.cursor(container, [...cursorDiagnostics.values()])
    }
    renderCursorDiagnostics()
  }
  function setCursorDiagnostic(id: string, changes: Partial<DiagnosticResult>) {
    cursorDiagnostics.set(id, {...cursorDiagnostics.get(id), id, name: host.environmentName(id), ...changes})
    updateCursorDiagnostics()
  }
  async function checkCursorEnvironment(id: string) {
    const current = cursorDiagnostics.get(id)
    if (current?.loading) return
    setCursorDiagnostic(id, {loading: true, error: null})
    try {
      const report = await host.request<DiagnosticReport>("/api/settings/cursor", {
        environment: id,
        cache: "no-store",
      })
      if (!report || !Array.isArray(report.checks))
        throw new Error(uiText("后台未返回有效检测报告，请确认 Yolu 后台版本"))
      setCursorDiagnostic(id, {report, loading: false})
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      setCursorDiagnostic(id, {loading: false, error: error.message})
    }
  }
  $("#checkCursor")?.addEventListener("click", () => checkCursorEnvironment(host.context().environment))
  $("#checkAllCodex").addEventListener("click", async () => {
    if (codexDiagnosticsBatch || [...codexDiagnostics.values()].some((result) => result.loading)) return
    codexDiagnosticsBatch = true
    renderCodexDiagnostics()
    try {
      await host.loadEnvironments()
      const pending = [
        ...new Set(["local", ...host.context().inventory.map((environment) => environment.id)]),
      ]
      // Bound concurrency so a slow WSL cannot prevent other reports appearing.
      await Promise.all(
        Array.from({length: Math.min(2, pending.length)}, async () => {
          while (pending.length) {
            const id = pending.shift()
            if (id) await checkCodexEnvironment(id)
          }
        }),
      )
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      host.toast(uiText("无法读取执行环境列表：") + error.message, true)
    } finally {
      codexDiagnosticsBatch = false
      renderCodexDiagnostics()
    }
  })

  function codexDiagnosticsText() {
    return (
      uiText("Yolu · Codex 安装检测\n") +
      [...codexDiagnostics.values()]
        .map((result) => {
          const report = result.report
          return [
            uiText("\n环境：{0} ({1})", result.name, result.id),
            result.error && uiText("本次检测失败：{0}", result.error),
            report &&
              [
                uiText("检测时间：{0}", report.checked_at),
                uiText("平台：{0}；用户：{1}", report.platform, report.user || uiText("未报告")),
                `CODEX_HOME：${report.codex_home}`,
                uiText("CLI 程序：{0}", report.cli_path),
                report.cli_entry && uiText("CLI 启动入口：{0}", report.cli_entry),
                uiText("CLI 版本：{0}", report.version || uiText("未读取")),
                uiText("共享后台程序：{0}", report.daemon_path || uiText("未读取")),
                uiText("后台状态：{0}", report.daemon_status || uiText("未读取")),
                uiText("运行中后台版本：{0}", report.daemon_version || uiText("未读取")),
                uiText("PATH 候选：\n") + report.candidates.join("\n"),
                ...report.checks.map(
                  (check) =>
                    `[${check.status}] ${uiText(check.name)}: ${uiText(check.message)}${check.advice ? uiText("\n建议：") + uiText(check.advice) : ""}`,
                ),
              ]
                .filter(Boolean)
                .join("\n"),
          ]
            .filter(Boolean)
            .join("\n")
        })
        .join("\n") +
      uiText("\n\n只读检测；未验证凭证有效性、模型访问或具体对话运行状态。")
    )
  }

  $("#copyCodexDiagnostics").addEventListener("click", async () => {
    const text = codexDiagnosticsText()
    try {
      await navigator.clipboard.writeText(text)
      host.toast(uiText("检测报告已复制"))
    } catch {
      const field = $("#codexDiagnosticsCopy")
      field.value = text
      field.hidden = false
      field.focus()
      field.select()
      host.toast(uiText("请复制已选中的检测报告"))
    }
  })

  return {
    refresh() {
      renderCodexDiagnostics()
      renderAgyDiagnostics()
      renderCursorDiagnostics()
      if (host.context().view !== "settings") return
      if (!codexDiagnosticsBatch && !codexDiagnostics.has(host.context().environment))
        void checkCodexEnvironment(host.context().environment)
      if (!agyDiagnostics.has(host.context().environment))
        void checkAgyEnvironment(host.context().environment)
      if (!cursorDiagnostics.has(host.context().environment))
        void checkCursorEnvironment(host.context().environment)
    },
    setUnregistered(values: string[]) {
      codexUnregisteredDistros = values
    },
  }
}
