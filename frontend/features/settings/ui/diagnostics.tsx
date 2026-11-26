import {uiText} from "@/shared/i18n"
import {PendingButton} from "@/shared/ui/actions/button"
import {StatusBadge, type StatusTone} from "@/shared/ui/data-display/status-badge"
import type {DiagnosticCheck, DiagnosticResult} from "../model/contracts"

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

export function CodexDiagnosticsResults({results}: {results: DiagnosticResult[]}) {
  const statusLabel = (status: string) =>
    ({ok: uiText("通过"), warning: uiText("需留意"), error: uiText("异常"), skipped: uiText("未检测")})[
      status
    ] || uiText("未知")
  const statusKind = (status: string): StatusTone =>
    status === "ok" ? "success" : status === "warning" ? "warning" : status === "error" ? "error" : "neutral"
  return (
    <>
      {results.map((result) => (
        <section
          className="codex-diagnostic-result"
          key={result.id}
          data-codex-environment={result.id}
          aria-label={uiText("{0} Codex 检测", result.name)}
          aria-busy={!!result.loading}
        >
          <div className="codex-diagnostic-heading">
            <h3>{result.name}</h3>
            <StatusBadge
              tone={
                result.loading ? "neutral" : result.error ? "error" : statusKind(result.report?.status || "")
              }
            >
              {result.loading
                ? uiText("正在检测")
                : result.error
                  ? uiText("检测失败")
                  : statusLabel(result.report?.status || "")}
            </StatusBadge>
          </div>
          {result.error && (
            <p role="alert" className="codex-diagnostic-error">
              {result.error}
              {result.report
                ? uiText("；以下保留上次检测结果。")
                : uiText("。请确认环境连接正常后重试；WSL 可使用上方的重新连接。")}
            </p>
          )}
          {result.report && (
            <>
              <p className="settings-help">
                {{darwin: "macOS", windows: "Windows", linux: "Linux"}[result.report.platform] ||
                  result.report.platform}{" "}
                {uiText("· 用户")} {result.report.user || uiText("未报告")} {uiText("· 检测于")}{" "}
                <time dateTime={result.report.checked_at}>{result.report.checked_at}</time>
              </p>
              <ul className="codex-diagnostic-checks">
                {result.report.checks.map((check) => (
                  <li key={check.id}>
                    <div className="codex-diagnostic-heading">
                      <strong>{uiText(check.name)}</strong>
                      <StatusBadge tone={statusKind(check.status)}>{statusLabel(check.status)}</StatusBadge>
                    </div>
                    <p>{uiText(check.message)}</p>
                    {check.advice && <p className="settings-help">{uiText(check.advice)}</p>}
                    {check.id === "cli" && <CodexInstallAction result={result} />}
                  </li>
                ))}
              </ul>
              <details className="settings-help-details">
                <summary>{uiText("安装路径与版本详情")}</summary>
                <dl className="settings-facts codex-diagnostic-facts">
                  {[
                    [uiText("CLI 程序"), result.report.cli_path],
                    [uiText("CLI 启动入口"), result.report.cli_entry],
                    [uiText("CLI 版本"), result.report.version],
                    ["CODEX_HOME", result.report.codex_home],
                    [uiText("共享后台程序"), result.report.daemon_path],
                    [uiText("运行中后台版本"), result.report.daemon_version],
                    [uiText("后台状态"), result.report.daemon_status],
                  ]
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
                  {uiText("PATH 中找到的 Codex：")}
                  {result.report.candidates.length
                    ? result.report.candidates.map((path) => (
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
      ))}
    </>
  )
}
type AgyDiagnosticReport = {
  platform: string
  user: string
  cli_path: string
  candidates: string[]
  version?: string
  agent_name?: string
  checked_at: string
  status: string
  checks: DiagnosticCheck[]
}
type AgyDiagnosticResult = {
  id: string
  name: string
  loading?: boolean
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
  const statusLabel = (status: string) =>
    ({ok: uiText("通过"), warning: uiText("需留意"), error: uiText("异常"), skipped: uiText("未检测")})[
      status
    ] || uiText("未知")
  const statusKind = (status: string): StatusTone =>
    status === "ok" ? "success" : status === "warning" ? "warning" : status === "error" ? "error" : "neutral"
  return (
    <>
      {results.map((result) => (
        <section
          className="codex-diagnostic-result"
          key={result.id}
          data-agy-environment={provider === "agy" ? result.id : undefined}
          data-cursor-environment={provider === "cursor" ? result.id : undefined}
          aria-label={
            provider === "cursor"
              ? uiText("{0} Cursor 检测", result.name)
              : uiText("{0} Antigravity 检测", result.name)
          }
          aria-busy={!!result.loading}
        >
          <div className="codex-diagnostic-heading">
            <h3>{result.name}</h3>
            <StatusBadge
              tone={
                result.loading ? "neutral" : result.error ? "error" : statusKind(result.report?.status || "")
              }
            >
              {result.loading
                ? uiText("正在检测")
                : result.error
                  ? uiText("检测失败")
                  : statusLabel(result.report?.status || "")}
            </StatusBadge>
          </div>
          {result.error && (
            <p role="alert" className="codex-diagnostic-error">
              {result.error}
            </p>
          )}
          {result.report && (
            <>
              <p className="settings-help">
                {{darwin: "macOS", windows: "Windows", linux: "Linux"}[result.report.platform] ||
                  result.report.platform}{" "}
                {uiText("· 用户")} {result.report.user || uiText("未报告")} {uiText("· 检测于")}{" "}
                <time dateTime={result.report.checked_at}>{result.report.checked_at}</time>
              </p>
              <ul className="codex-diagnostic-checks">
                {result.report.checks.map((check) => (
                  <li key={check.id}>
                    <div className="codex-diagnostic-heading">
                      <strong>{uiText(check.name)}</strong>
                      <StatusBadge tone={statusKind(check.status)}>{statusLabel(check.status)}</StatusBadge>
                    </div>
                    <p>{uiText(check.message)}</p>
                    {check.advice && <p className="settings-help">{uiText(check.advice)}</p>}
                  </li>
                ))}
              </ul>
              <details className="settings-help-details">
                <summary>{uiText("安装路径与版本详情")}</summary>
                <dl className="settings-facts codex-diagnostic-facts">
                  {[
                    [uiText("CLI 程序"), result.report.cli_path],
                    [uiText("ACP 服务"), result.report.agent_name],
                    [uiText("ACP 版本"), result.report.version],
                  ]
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
                  {provider === "cursor"
                    ? uiText("PATH 中找到的 Cursor Agent：")
                    : uiText("PATH 中找到的 agy：")}
                  {result.report.candidates.length
                    ? result.report.candidates.map((path) => (
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
      ))}
    </>
  )
}
