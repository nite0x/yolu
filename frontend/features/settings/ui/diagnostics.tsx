import type {ReactNode} from "react"
import {uiText} from "@/shared/i18n"
import {PendingButton} from "@/shared/ui/actions/button"
import {StatusBadge, type StatusTone} from "@/shared/ui/data-display/status-badge"
import type {DiagnosticCheck, DiagnosticReport, DiagnosticResult} from "../model/contracts"

function CodexInstallAction({result}: {result: DiagnosticResult}) {
  const plan = result.report?.install_plan
  const install = result.install
  const running = install?.status === "running"
  const upgrade = (running ? install.action : plan?.action) === "upgrade"
  const label = upgrade ? uiText("升级 Codex CLI") : uiText("安装 Codex CLI")
  const manager = {standalone: uiText("OpenAI 官方安装程序"), brew: "Homebrew", npm: "npm"}[
    plan?.manager || "standalone"
  ]
  const progress =
    install?.stage === "daemon"
      ? uiText("正在启动并检测 Codex 共享后台…")
      : upgrade
        ? uiText("正在升级 Codex CLI…")
        : uiText("正在安装 Codex CLI…")
  const error = result.installError || install?.error
  return (
    <>
      {(plan?.action || running) && !result.readOnly && (
        <div className="codex-install-actions">
          <PendingButton
            type="button"
            size="sm"
            variant="outline"
            data-codex-install
            pending={running}
            pendingLabel={label}
            disabled={result.loading || !!result.error}
            aria-label={uiText("{0} · {1}", label, result.name)}
          >
            {label}
          </PendingButton>
          {plan?.action && <span className="settings-help">{manager}</span>}
        </div>
      )}
      {plan?.reason && !result.readOnly && <p className="settings-help">{uiText(plan.reason)}</p>}
      {running && (
        <p role="status" className="settings-help">
          {progress}
        </p>
      )}
      {install?.status === "succeeded" && (
        <p role="status" className="settings-help">
          {install.action === "upgrade"
            ? uiText("Codex CLI 已升级到最新版本 · {0}", install.version)
            : uiText("Codex CLI 安装完成 · {0}", install.version)}
        </p>
      )}
      {error && (
        <p role="alert" className="codex-diagnostic-error">
          {install?.stage === "daemon"
            ? uiText("{0} 已就绪。共享后台启动或检测失败。{1}", install.version, uiText(error))
            : uiText("Codex 安装或升级失败：{0}", uiText(error))}
        </p>
      )}
    </>
  )
}

type ReportSummary = Pick<
  DiagnosticReport,
  "platform" | "user" | "checked_at" | "status" | "checks" | "candidates"
>
type ResultSummary = Pick<DiagnosticResult, "id" | "name" | "loading" | "error"> & {report?: ReportSummary}
type Facts = [string, string | undefined][]

const statusLabel = (status: string) =>
  ({ok: uiText("通过"), warning: uiText("需留意"), error: uiText("异常"), skipped: uiText("未检测")})[
    status
  ] || uiText("未知")
const statusKind = (status: string): StatusTone =>
  status === "ok" ? "success" : status === "warning" ? "warning" : status === "error" ? "error" : "neutral"

// Both providers share report presentation. Their actions, facts and recovery
// guidance stay with the provider-specific caller below.
function DiagnosticResultView({
  result,
  provider,
  label,
  errorHelp,
  facts,
  candidatesLabel,
  checkAction,
}: {
  result: ResultSummary
  provider: "codex" | "agy" | "cursor"
  label: string
  errorHelp?: ReactNode
  facts: Facts
  candidatesLabel: string
  checkAction?: (check: DiagnosticCheck) => ReactNode
}) {
  const report = result.report
  return (
    <section
      className="codex-diagnostic-result"
      data-codex-environment={provider === "codex" ? result.id : undefined}
      data-agy-environment={provider === "agy" ? result.id : undefined}
      data-cursor-environment={provider === "cursor" ? result.id : undefined}
      aria-label={label}
      aria-busy={!!result.loading}
    >
      <div className="codex-diagnostic-heading">
        <h3>{result.name}</h3>
        <StatusBadge
          tone={result.loading ? "neutral" : result.error ? "error" : statusKind(report?.status || "")}
        >
          {result.loading
            ? uiText("正在检测")
            : result.error
              ? uiText("检测失败")
              : statusLabel(report?.status || "")}
        </StatusBadge>
      </div>
      {result.error && (
        <p role="alert" className="codex-diagnostic-error">
          {result.error}
          {errorHelp}
        </p>
      )}
      {report && (
        <>
          <p className="settings-help">
            {{darwin: "macOS", windows: "Windows", linux: "Linux"}[report.platform] || report.platform}{" "}
            {uiText("· 用户")} {report.user || uiText("未报告")} {uiText("· 检测于")}{" "}
            <time dateTime={report.checked_at}>{report.checked_at}</time>
          </p>
          <ul className="codex-diagnostic-checks">
            {report.checks.map((check) => (
              <li key={check.id}>
                <div className="codex-diagnostic-heading">
                  <strong>{uiText(check.name)}</strong>
                  <StatusBadge tone={statusKind(check.status)}>{statusLabel(check.status)}</StatusBadge>
                </div>
                <p>{uiText(check.message)}</p>
                {check.advice && <p className="settings-help">{uiText(check.advice)}</p>}
                {checkAction?.(check)}
              </li>
            ))}
          </ul>
          <details className="settings-help-details">
            <summary>{uiText("安装路径与版本详情")}</summary>
            <dl className="settings-facts codex-diagnostic-facts">
              {facts
                .filter(([, value]) => value)
                .map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>
                      <code>{value}</code>
                    </dd>
                  </div>
                ))}
            </dl>
            <p>
              {candidatesLabel}
              {report.candidates.length
                ? report.candidates.map((path) => (
                    <code className="block" key={path}>
                      {path}
                    </code>
                  ))
                : uiText("未找到")}
            </p>
          </details>
        </>
      )}
    </section>
  )
}

export function CodexDiagnosticsResults({results}: {results: DiagnosticResult[]}) {
  return (
    <>
      {results.map((result) => (
        <DiagnosticResultView
          key={result.id}
          result={result}
          provider="codex"
          label={uiText("{0} Codex 检测", result.name)}
          errorHelp={
            result.report
              ? uiText("；以下保留上次检测结果。")
              : uiText("。请确认环境连接正常后重试；WSL 可使用上方的重新连接。")
          }
          facts={[
            [uiText("CLI 程序"), result.report?.cli_path],
            [uiText("CLI 启动入口"), result.report?.cli_entry],
            [uiText("CLI 版本"), result.report?.version],
            ["CODEX_HOME", result.report?.codex_home],
            [uiText("共享后台程序"), result.report?.daemon_path],
            [uiText("运行中后台版本"), result.report?.daemon_version],
            [uiText("后台状态"), result.report?.daemon_status],
          ]}
          candidatesLabel={uiText("PATH 中找到的 Codex：")}
          checkAction={(check) => check.id === "cli" && <CodexInstallAction result={result} />}
        />
      ))}
    </>
  )
}

type AgyDiagnosticReport = ReportSummary & {
  cli_path: string
  version?: string
  agent_name?: string
}
type AgyDiagnosticResult = Omit<ResultSummary, "report" | "error"> & {
  error?: string
  report?: AgyDiagnosticReport
}

export function AgyDiagnosticsResults({
  results,
  provider = "agy",
}: {
  results: AgyDiagnosticResult[]
  provider?: "agy" | "cursor"
}) {
  return (
    <>
      {results.map((result) => (
        <DiagnosticResultView
          key={result.id}
          result={result}
          provider={provider}
          label={
            provider === "cursor"
              ? uiText("{0} Cursor 检测", result.name)
              : uiText("{0} Antigravity 检测", result.name)
          }
          facts={[
            [uiText("CLI 程序"), result.report?.cli_path],
            [uiText("ACP 服务"), result.report?.agent_name],
            [uiText("ACP 版本"), result.report?.version],
          ]}
          candidatesLabel={
            provider === "cursor" ? uiText("PATH 中找到的 Cursor Agent：") : uiText("PATH 中找到的 agy：")
          }
        />
      ))}
    </>
  )
}
