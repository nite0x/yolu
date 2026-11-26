import assert from "node:assert/strict"
import {createRequire} from "node:module"
import {test} from "node:test"
import type {ReactNode} from "react"
import {renderToStaticMarkup} from "react-dom/server"
import type {DiagnosticReport, DiagnosticResult} from "../frontend/features/settings/model/contracts"
import {AgyDiagnosticsResults, CodexDiagnosticsResults} from "../frontend/features/settings/ui/diagnostics"
import {uiText} from "../frontend/shared/i18n"

const {JSDOM} = createRequire(import.meta.url)("jsdom")
function markup(node: ReactNode): Document {
  return new JSDOM(renderToStaticMarkup(node)).window.document
}
const report: DiagnosticReport = {
  platform: "linux",
  user: "fixture-user",
  codex_home: "/home/fixture-user/.codex",
  cli_path: "/usr/bin/codex",
  cli_entry: "/usr/bin/codex-entry",
  candidates: ["/usr/bin/codex", "/usr/local/bin/codex"],
  version: "1.0.0",
  daemon_path: "/usr/bin/codex-daemon",
  daemon_version: "1.0.0",
  daemon_status: "running",
  checked_at: "2026-11-26T10:00:00Z",
  status: "warning",
  checks: [
    {id: "cli", name: "CLI", status: "ok", message: "Installed"},
    {id: "daemon", name: "Daemon", status: "warning", message: "Reconnect", advice: "Try again"},
    {id: "auth", name: "Authentication", status: "error", message: "Sign in"},
    {id: "skipped", name: "Optional check", status: "skipped", message: "Not checked"},
  ],
  install_plan: {action: "upgrade", manager: "npm"},
}

test("diagnostics share status presentation while retaining provider facts and controller targets", () => {
  const document = markup(
    <>
      <CodexDiagnosticsResults results={[{id: "local", name: "Local", report}]} />
      <AgyDiagnosticsResults
        results={[
          {id: "wsl", name: "WSL", report: {...report, cli_path: "/usr/bin/agy", agent_name: "agy-agent"}},
        ]}
      />
    </>,
  )
  const codex = document.querySelector('[data-codex-environment="local"]')
  const agy = document.querySelector('[data-agy-environment="wsl"]')
  assert(codex)
  assert(agy)
  assert.equal(codex.getAttribute("aria-label"), uiText("{0} Codex 检测", "Local"))
  assert.equal(agy.getAttribute("aria-label"), uiText("{0} Antigravity 检测", "WSL"))
  assert.equal(codex.querySelectorAll(".codex-diagnostic-checks li").length, 4)
  assert.deepEqual(
    [...codex.querySelectorAll('.codex-diagnostic-checks [data-slot="badge"]')].map(
      (badge) => badge.textContent,
    ),
    [uiText("通过"), uiText("需留意"), uiText("异常"), uiText("未检测")],
  )
  assert.equal(codex.querySelector("time")?.dateTime, report.checked_at)
  assert.equal(
    codex.querySelector("[data-codex-install]")?.getAttribute("aria-label"),
    uiText("{0} · {1}", uiText("升级 Codex CLI"), "Local"),
  )
  assert(codex.textContent?.includes("CODEX_HOME"))
  assert(codex.textContent?.includes(report.codex_home))
  assert(agy.textContent?.includes("agy-agent"))
  assert(agy.textContent?.includes(uiText("ACP 版本")))
  assert.equal(agy.querySelector("[data-codex-install]"), null)
  assert.equal(agy.textContent?.includes("CODEX_HOME"), false)
})

test("failed diagnostics retain previous reports with provider-specific recovery guidance", () => {
  const document = markup(
    <>
      <CodexDiagnosticsResults results={[{id: "local", name: "Local", error: "offline", report}]} />
      <AgyDiagnosticsResults results={[{id: "wsl", name: "WSL", error: "offline", report}]} />
    </>,
  )
  const sections = document.querySelectorAll("section")
  assert.equal(
    sections[0].querySelector('[role="alert"]')?.textContent,
    `offline${uiText("；以下保留上次检测结果。")}`,
  )
  assert.equal(sections[1].querySelector('[role="alert"]')?.textContent, "offline")
  for (const section of sections) {
    assert.equal(section.querySelector(".codex-diagnostic-checks")?.children.length, 4)
    assert(section.querySelector(".codex-diagnostic-heading")?.textContent?.includes(uiText("检测失败")))
  }
  assert.equal(sections[0].querySelector<HTMLButtonElement>("[data-codex-install]")?.disabled, true)
})

test("diagnostic installation preserves read-only, progress and daemon failure behavior", () => {
  const results: DiagnosticResult[] = [
    {id: "readonly", name: "Read only", readOnly: true, report},
    {
      id: "running",
      name: "Running",
      report,
      install: {status: "running", action: "upgrade", stage: "daemon"},
    },
    {
      id: "failed",
      name: "Failed",
      report,
      install: {status: "failed", stage: "daemon", version: "1.0.0", error: "unavailable"},
    },
  ]
  const document = markup(<CodexDiagnosticsResults results={results} />)
  assert.equal(document.querySelector('[data-codex-environment="readonly"] [data-codex-install]'), null)
  const running = document.querySelector<HTMLButtonElement>(
    '[data-codex-environment="running"] [data-codex-install]',
  )
  assert.equal(running?.disabled, true)
  assert.equal(running?.getAttribute("aria-busy"), "true")
  assert(
    document
      .querySelector('[data-codex-environment="running"] [role="status"]')
      ?.textContent?.includes(uiText("正在启动并检测 Codex 共享后台…")),
  )
  assert.equal(
    document.querySelector('[data-codex-environment="failed"] [role="alert"]')?.textContent,
    uiText("{0} 已就绪。共享后台启动或检测失败。{1}", "1.0.0", "unavailable"),
  )
})

test("loading and unavailable diagnostic reports keep accessible feedback without invented details", () => {
  const document = markup(
    <>
      <CodexDiagnosticsResults
        results={[
          {id: "loading", name: "Loading", loading: true},
          {id: "failed", name: "Failed", error: "offline"},
        ]}
      />
      <AgyDiagnosticsResults
        results={[
          {id: "unknown", name: "Unknown", report: {...report, candidates: [], status: "future", checks: []}},
        ]}
      />
    </>,
  )
  const loading = document.querySelector('[data-codex-environment="loading"]')
  assert.equal(loading?.getAttribute("aria-busy"), "true")
  assert(loading?.textContent?.includes(uiText("正在检测")))
  assert.equal(loading?.querySelector("details"), null)
  assert.equal(
    document.querySelector('[data-codex-environment="failed"] [role="alert"]')?.textContent,
    `offline${uiText("。请确认环境连接正常后重试；WSL 可使用上方的重新连接。")}`,
  )
  const unknown = document.querySelector('[data-agy-environment="unknown"]')
  assert(unknown?.textContent?.includes(uiText("未知")))
  assert(unknown?.textContent?.includes(uiText("未找到")))
})
