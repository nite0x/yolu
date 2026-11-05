import { uiText } from "../i18n";
import type { ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Check, Feedback, Field, ModalFooter, ModalHeader, NativeSelect, Option, StatusBadge } from "./shared"

function Heading({ id, title, children, actions }: { id: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return <div className="settings-card-heading"><div><h2 id={id} className="m-0 text-lg font-semibold">{title}</h2><p className="text-sm leading-relaxed text-muted-foreground">{children}</p></div>{actions}</div>
}
function Help({ children }: { children: ReactNode }) {
  return <p className="settings-help text-sm leading-relaxed text-muted-foreground">{children}</p>
}
export function SettingsPage() {
  return <>
    <Card className="settings-card gap-0 p-6 shadow-none" aria-labelledby="languageTitle"><form id="languageForm">
      <Heading id="languageTitle" title={uiText("界面语言")}>{uiText("语言设置应用于所有项目和执行环境。应用时会重新加载界面，后台工作继续。")}</Heading>
      <Field id="languageSelect" label={uiText("界面语言")}><NativeSelect id="languageSelect" name="language"><Option value="system">{uiText("跟随系统")}</Option><Option value="en">English</Option><Option value="zh-CN">简体中文</Option></NativeSelect></Field>
      <div className="settings-actions"><Button type="submit" id="saveLanguage">{uiText("保存并应用语言")}</Button></div>
      <p id="languageStatus" role="status" className="settings-help" />
    </form></Card>
    <Card className="settings-card gap-0 p-6 shadow-none" aria-labelledby="environmentSettingsTitle">
      <Heading id="environmentSettingsTitle" title={uiText("执行环境与工作区")} actions={<div className="detail-actions"><Button type="button" variant="outline" size="sm" id="reconnectEnvironment" hidden>{uiText("重新连接")}</Button><Button type="button" size="sm" id="addEnvironment">{uiText("连接 WSL")}</Button></div>}>{uiText("为当前环境配置工作目录与工具。")}</Heading>
      <Field id="environmentSelect" label={uiText("配置环境")}><NativeSelect id="environmentSelect" aria-label={uiText("配置环境")}><Option value="local">{uiText("本机")}</Option></NativeSelect><small id="environmentStatus" role="status" className="text-muted-foreground" /></Field>
      <span id="settingsEnvironment" hidden />
      <dl className="settings-facts"><div><dt>{uiText("新任务工作区")}</dt><dd><code id="settingsRoot">{uiText("正在读取…")}</code></dd></div></dl>
      <details className="settings-help-details"><summary>{uiText("工作区与环境规则")}</summary><Help>{uiText("任务创建后环境固定，项目、终端和会话在此环境执行。工作区默认使用 ~/workspaces，可通过 --root 指定；已有任务沿用保存路径。")}</Help></details>
    </Card>
    <Card className="settings-card gap-0 p-6 shadow-none" aria-labelledby="codexDiagnosticsTitle">
      <Heading id="codexDiagnosticsTitle" title={uiText("Codex 安装检测")}>{uiText("检查应用实际使用的 CLI、会话接口、登录配置和共享后台。Windows 本机与每个 WSL 用户分别检测。")}</Heading>
      <div className="detail-actions codex-diagnostic-actions"><Button type="button" id="checkCodex">{uiText("检测当前环境")}</Button><Button type="button" variant="outline" id="checkAllCodex">{uiText("检测全部已登记环境")}</Button><Button type="button" variant="outline" id="copyCodexDiagnostics" disabled>{uiText("复制检测报告")}</Button></div>
      <p id="codexDiagnosticsStatus" className="settings-help" role="status">{uiText("尚未检测")}</p>
      <p id="codexUnregistered" className="settings-help" hidden />
      <div id="codexDiagnosticsResults" />
      <textarea id="codexDiagnosticsCopy" className="codex-report-copy" aria-label={uiText("检测报告（可全选复制）")} readOnly hidden />
      <Help>{uiText("只读检测，不发送模型请求，不启动或重启共享后台。检测结果反映当前应用后台的环境；安装或切换 CLI 后，请退出并停止 Yolu 后台再打开。")}</Help>
    </Card>
    <Card className="settings-card gap-0 p-6 shadow-none" aria-labelledby="terminalTitle"><form id="terminalForm">
      <Heading id="terminalTitle" title={uiText("终端工具")}>{uiText("Codex、Git 终端和在终端获取分支共用此设置，保存后立即生效。")}</Heading>
      <fieldset id="terminalSettingsFields" disabled>
        <Field id="terminalKind" label={uiText("终端工具")}><NativeSelect id="terminalKind" name="kind"><Option value="auto">{uiText("系统终端")}</Option></NativeSelect></Field>
        <div id="terminalCustomFields" hidden><Field id="terminalPath" label={uiText("终端程序路径")} required help={uiText("填写终端可执行文件的完整路径，无需引号或参数。")}><Input id="terminalPath" name="path" autoComplete="off" spellCheck={false} /></Field><Field id="terminalStyle" label={uiText("启动方式")}><NativeSelect id="terminalStyle" name="style"><Option value="otty">Otty</Option><Option value="windows-terminal">Windows Terminal</Option><Option value="command">{uiText("其他终端（支持 -e 程序 参数）")}</Option></NativeSelect></Field></div>
        <p id="terminalHint" className="settings-help text-muted-foreground" />
        <Feedback id="terminalStatus" role="status" className="mt-4 bg-muted text-muted-foreground" />
        <Feedback id="terminalError" variant="destructive" className="mt-4" hidden />
        <div className="settings-actions"><Button type="submit">{uiText("保存终端设置")}</Button></div>
      </fieldset>
    </form></Card>
    <Card className="settings-card gap-0 p-6 shadow-none" aria-labelledby="conversationDefaultsHeading"><form id="conversationDefaultsForm">
      <Heading id="conversationDefaultsHeading" title={uiText("新会话默认设置")}>{uiText("默认沿用当前环境的 Codex 配置。可为新会话指定模型与权限，单次对话可覆盖。")}</Heading>
      <fieldset id="conversationDefaultsFields" disabled>
        <Field id="conversationDefaultModel" label={uiText("默认模型")}><NativeSelect id="conversationDefaultModel"><Option value="">{uiText("沿用 Codex 默认模型")}</Option></NativeSelect></Field>
        <Field id="conversationDefaultPermission" label={uiText("默认权限")}><NativeSelect id="conversationDefaultPermission"><Option value="">{uiText("沿用 Codex 默认权限")}</Option><Option value="ask">{uiText("请求批准")}</Option><Option value="auto">{uiText("帮我批准")}</Option><Option value="full">{uiText("完全访问权限")}</Option></NativeSelect></Field>
        <Help>{uiText("设置按执行环境保存，仅用于之后创建的对话。思考强度默认沿用 Codex，可在对话中调整。")}</Help>
        <Help>{uiText("完全访问权限允许读取和修改电脑上的文件并执行命令；沿用 Codex 时使用该环境已有的权限配置。")}</Help>
        <div className="settings-actions"><Button type="submit">{uiText("保存新会话设置")}</Button></div>
      </fieldset>
      <Feedback id="conversationDefaultsError" variant="destructive" className="mt-4" hidden />
      <p id="conversationDefaultsStatus" role="status" className="settings-help" />
      <Button type="button" id="conversationDefaultsReload" variant="outline" size="sm" className="mt-3">{uiText("刷新可用模型")}</Button>
    </form></Card>
    <Card className="settings-card gap-0 p-6 shadow-none" aria-labelledby="sessionTitleHeading"><form id="sessionTitleForm">
      <Heading id="sessionTitleHeading" title={uiText("对话标题")}>{uiText("发送首条消息后，根据首次输入在后台生成一次主题标题。手动名称优先保留。")}</Heading>
      <fieldset id="sessionTitleFields" disabled>
        <Field id="sessionTitleModel" label={uiText("标题模型")}><NativeSelect id="sessionTitleModel"><Option value="">{uiText("跟随正文模型")}</Option></NativeSelect></Field>
        <details className="settings-help-details"><summary>{uiText("标题生成说明")}</summary><Help>{uiText("仅影响当前环境的新对话标题。沿用 Codex 登录，额外消耗一次模型请求；生成失败保留初始标题。")}</Help></details>
        <div className="settings-actions"><Button type="submit">{uiText("保存标题设置")}</Button></div>
      </fieldset>
      <Feedback id="sessionTitleError" variant="destructive" className="mt-4" hidden />
      <Button type="button" id="sessionTitleReload" variant="outline" size="sm" className="mt-3">{uiText("刷新可用模型")}</Button>
    </form></Card>
  </>
}

type DiagnosticCheck = { id: string; name: string; status: string; message: string; advice?: string }
type DiagnosticReport = {
  platform: string; user: string; codex_home: string; cli_path: string; cli_entry?: string; candidates: string[];
  version?: string; daemon_path?: string; daemon_version?: string; daemon_status?: string; checked_at: string;
  status: string; checks: DiagnosticCheck[];
}
type DiagnosticResult = { id: string; name: string; loading?: boolean; error?: string; report?: DiagnosticReport }

export function CodexDiagnosticsResults({ results }: { results: DiagnosticResult[] }) {
  const statusLabel = (status: string) => ({ok: uiText("通过"), warning: uiText("需留意"), error: uiText("异常"), skipped: uiText("未检测")})[status] || uiText("未知")
  const statusKind = (status: string) => ({ok: "ready", warning: "warning", error: "failed"})[status] || "neutral"
  return <>{results.map(result => <section className="codex-diagnostic-result" key={result.id} data-codex-environment={result.id} aria-label={uiText("{0} Codex 检测", result.name)} aria-busy={!!result.loading}>
    <div className="codex-diagnostic-heading"><h3>{result.name}</h3><StatusBadge kind={result.loading ? "neutral" : result.error ? "failed" : statusKind(result.report?.status || "")}>{result.loading ? uiText("正在检测") : result.error ? uiText("检测失败") : statusLabel(result.report?.status || "")}</StatusBadge></div>
    {result.error && <p role="alert" className="codex-diagnostic-error">{result.error}{result.report ? uiText("；以下保留上次检测结果。") : uiText("。请确认环境连接正常后重试；WSL 可使用上方的重新连接。")}</p>}
    {result.report && <>
      <p className="settings-help">{({darwin: "macOS", windows: "Windows", linux: "Linux"})[result.report.platform] || result.report.platform}{" "}{uiText("· 用户")}{" "}{result.report.user || uiText("未报告")}{" "}{uiText("· 检测于")}{" "}<time dateTime={result.report.checked_at}>{result.report.checked_at}</time></p>
      <ul className="codex-diagnostic-checks">{result.report.checks.map(check => <li key={check.id}><div className="codex-diagnostic-heading"><strong>{uiText(check.name)}</strong><StatusBadge kind={statusKind(check.status)}>{statusLabel(check.status)}</StatusBadge></div><p>{uiText(check.message)}</p>{check.advice && <p className="settings-help">{uiText(check.advice)}</p>}</li>)}</ul>
      <details className="settings-help-details"><summary>{uiText("安装路径与版本详情")}</summary><dl className="settings-facts codex-diagnostic-facts">{[
        [uiText("CLI 程序"), result.report.cli_path], [uiText("CLI 启动入口"), result.report.cli_entry], [uiText("CLI 版本"), result.report.version],
        ["CODEX_HOME", result.report.codex_home], [uiText("共享后台程序"), result.report.daemon_path], [uiText("运行中后台版本"), result.report.daemon_version], [uiText("后台状态"), result.report.daemon_status],
      ].filter(([, value]) => value).map(([name, value]) => <div key={name}><dt>{name}</dt><dd><code>{value}</code></dd></div>)}</dl>
      <p>{uiText("PATH 中找到的 Codex：")}{result.report.candidates.length ? result.report.candidates.map(path => <code className="block" key={path}>{path}</code>) : uiText("未找到")}</p></details>
    </>}
  </section>)}</>
}
export function EnvironmentForm() {
  return <form id="environmentForm"><ModalHeader id="environmentTitle" title={uiText("连接 WSL 环境")} eyebrow="EXECUTION ENVIRONMENT" /><p className="dialog-description">{uiText("应用自动部署并启动辅助程序。Git 和文件操作在所选 WSL 用户内执行，任务记录保存在本机。")}</p>
    <Field id="environmentDistro" label={uiText("发行版")}><NativeSelect id="environmentDistro" required /></Field>
    <Field id="environmentUser" label={uiText("Linux 用户")}><Input id="environmentUser" autoComplete="off" placeholder={uiText("留空使用发行版默认用户")} /></Field>
    <Field id="environmentRoot" label={uiText("新任务的工作区根目录")}><Input id="environmentRoot" autoComplete="off" placeholder={uiText("留空使用该用户的 ~/workspaces")} /></Field>
    <Check id="environmentImport" label={uiText("导入该用户原有的 Yolu 项目与任务记录")} />
    <p className="dialog-description">{uiText("导入会复制一份当前记录到 Windows；项目和 worktree 保留原路径。之后请通过桌面端维护这些任务。")}</p><Feedback id="environmentError" variant="destructive" hidden />
    <ModalFooter><Button type="submit" id="connectEnvironment">{uiText("连接并准备环境")}</Button></ModalFooter>
  </form>
}
