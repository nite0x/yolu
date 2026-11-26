import {Activity, MessageSquare, RefreshCw, SlidersHorizontal, Terminal} from "lucide-react"
import {Fragment, type ReactNode} from "react"
import {AgentIcon} from "@/entities/conversations/agent-icon"
import {uiText} from "@/shared/i18n"
import {Feedback} from "@/shared/ui/feedback/message"
import {Check} from "@/shared/ui/forms/check"
import {Field} from "@/shared/ui/forms/field"
import {HelpTip} from "@/shared/ui/help-tip"
import {SectionHeading} from "@/shared/ui/layout/section-heading"
import {Button} from "@/shared/ui/primitives/button"
import {Card} from "@/shared/ui/primitives/card"
import {Input} from "@/shared/ui/primitives/input"
import {NativeSelect, NativeSelectOption as Option} from "@/shared/ui/primitives/native-select"
import {AppearanceFields, LanguageFields, ShortcutFields} from "./preferences"

export function SettingsPage() {
  const groups: {
    id: string
    label: string
    Icon: typeof SlidersHorizontal
    cards: string[]
    headerMeta?: ReactNode
    headerAction?: ReactNode
  }[] = [
    {
      id: "settings-general",
      label: uiText("通用"),
      Icon: SlidersHorizontal,
      cards: ["appearanceTitle", "languageTitle"],
    },
    {
      id: "settings-conversation",
      label: uiText("对话"),
      Icon: MessageSquare,
      headerAction: (
        <Button
          type="button"
          id="conversationDefaultsReload"
          variant="ghost"
          size="sm"
          className="settings-reload-button"
          disabled
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          <span>{uiText("刷新可用模型")}</span>
        </Button>
      ),
      cards: [
        "defaultAgentHeading",
        "conversationDefaultsHeading",
        "chatInputHeading",
        "sessionTitleHeading",
      ],
    },
    {
      id: "settings-environment",
      label: uiText("执行环境"),
      Icon: Terminal,
      cards: ["environmentSettingsTitle", "terminalTitle", "mcpSettingsTitle", "browserAccessTitle"],
    },
    {
      id: "settings-diagnostics",
      label: uiText("诊断"),
      Icon: Activity,
      cards: ["codexDiagnosticsTitle", "agyDiagnosticsTitle"],
    },
  ]
  const cards: Record<string, ReactNode> = {
    appearanceTitle: (
      <Card
        className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="appearanceTitle"
      >
        <form id="appearanceForm">
          <AppearanceFields />
        </form>
      </Card>
    ),
    languageTitle: (
      <Card
        className="settings-card settings-row-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="languageTitle"
      >
        <form id="languageForm">
          <LanguageFields />
        </form>
      </Card>
    ),
    defaultAgentHeading: (
      <Card
        className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="defaultAgentHeading"
      >
        <form id="defaultAgentForm">
          <SectionHeading
            className="settings-card-heading"
            id="defaultAgentHeading"
            title={uiText("新对话")}
            actions={<span id="defaultAgentStatus" role="status" className="settings-inline-status" />}
          />
          <div className="settings-context-grid">
            <Field id="environmentSelect" label={uiText("执行环境")} className="settings-environment-field">
              <NativeSelect id="environmentSelect" size="sm">
                <Option value="local">{uiText("本机")}</Option>
              </NativeSelect>
              <small id="environmentStatus" role="status" className="sr-only" />
            </Field>
            <Field id="defaultAgentSelect" label={uiText("默认 Agent")}>
              <NativeSelect id="defaultAgentSelect" size="sm" disabled>
                <Option value="codex">Codex</Option>
                <Option value="agy">Antigravity (AGY)</Option>
              </NativeSelect>
            </Field>
          </div>
          <Feedback id="defaultAgentError" tone="error" className="mt-3" hidden />
          <Button type="button" id="defaultAgentRetry" variant="outline" size="sm" className="mt-2" hidden>
            {uiText("重试保存")}
          </Button>
        </form>
      </Card>
    ),
    conversationDefaultsHeading: (
      <Card
        className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="conversationDefaultsHeading"
      >
        <form id="conversationDefaultsForm">
          <SectionHeading
            className="settings-card-heading"
            id="conversationDefaultsHeading"
            title={uiText("Agent 默认配置")}
            actions={
              <span id="conversationDefaultsStatus" role="status" className="settings-inline-status" />
            }
          >
            {uiText("按执行环境和引擎分别保存，仅用于新建对话。已有对话可单独调整。")}
          </SectionHeading>
          <div className="settings-agent-field">
            <span id="conversationDefaultProvider-label" className="settings-field-label">
              {uiText("配置 Agent")}
            </span>
            <fieldset
              id="conversationDefaultProviderGroup"
              className="settings-segments settings-provider-tabs"
              aria-label={uiText("配置 Agent")}
              disabled
            >
              <label>
                <input
                  type="radio"
                  className="sr-only"
                  name="conversation_default_provider"
                  value="codex"
                  defaultChecked
                />
                <AgentIcon agent="codex" decorative />
                <span>Codex</span>
              </label>
              <label>
                <input type="radio" className="sr-only" name="conversation_default_provider" value="agy" />
                <AgentIcon agent="agy" decorative />
                <span>Antigravity (AGY)</span>
              </label>
            </fieldset>
          </div>
          <fieldset id="conversationDefaultsFields" disabled>
            <div className="settings-field-grid settings-model-fields">
              <Field id="conversationDefaultModel" label={uiText("默认模型")}>
                <NativeSelect id="conversationDefaultModel" size="sm">
                  <Option value="">{uiText("沿用 Codex 默认模型")}</Option>
                </NativeSelect>
              </Field>
              <Field id="conversationDefaultSpeed" label={uiText("默认响应速度")}>
                <NativeSelect id="conversationDefaultSpeed" size="sm">
                  <Option value="">{uiText("沿用 Codex 默认速度")}</Option>
                </NativeSelect>
              </Field>
            </div>
            <div className="field grid gap-2 settings-segment-field">
              <div className="settings-label">
                <span id="conversationDefaultEffort-label" className="settings-field-label">
                  {uiText("默认思考强度")}
                </span>
                <HelpTip id="conversationDefaultEffortHelp" label={uiText("默认思考强度")}>
                  {uiText("更高的思考强度通常需要更多时间。默认值由所选模型决定。")}
                </HelpTip>
              </div>
              <div
                id="conversationDefaultEffort"
                className="settings-segments"
                role="radiogroup"
                aria-labelledby="conversationDefaultEffort-label"
              />
              <div id="conversationDefaultEffortDropdown" hidden>
                <NativeSelect
                  id="conversationDefaultEffortSelect"
                  size="sm"
                  aria-labelledby="conversationDefaultEffort-label"
                  aria-describedby="conversationDefaultEffortHelp"
                />
              </div>
            </div>
            <div className="field grid gap-2 settings-segment-field">
              <div className="settings-label">
                <span id="conversationDefaultPermission-label" className="settings-field-label">
                  {uiText("默认权限")}
                </span>
                <HelpTip id="conversationDefaultPermissionHelp" label={uiText("默认权限")}>
                  <span />
                </HelpTip>
              </div>
              <div
                id="conversationDefaultPermission"
                className="settings-segments"
                role="radiogroup"
                aria-labelledby="conversationDefaultPermission-label"
                aria-describedby="conversationDefaultPermissionHelp"
              />
            </div>
          </fieldset>
          <Feedback id="conversationDefaultsError" tone="error" className="mt-3" hidden />
          <Button
            type="button"
            id="conversationDefaultsRetry"
            variant="outline"
            size="sm"
            className="mt-2"
            hidden
          >
            {uiText("重试保存")}
          </Button>
        </form>
      </Card>
    ),
    chatInputHeading: (
      <Card
        className="settings-card settings-row-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="chatInputHeading"
      >
        <form id="chatInputForm">
          <ShortcutFields />
        </form>
      </Card>
    ),
    sessionTitleHeading: (
      <Card
        className="settings-card settings-row-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="sessionTitleHeading"
      >
        <form id="sessionTitleForm">
          <div className="settings-row">
            <div className="settings-row-info">
              <div className="settings-label">
                <h3 id="sessionTitleHeading">{uiText("自动生成标题")}</h3>
                <HelpTip id="sessionTitleHelp" label={uiText("自动生成标题")}>
                  <span id="settingsTitleEnv" /> {uiText("首条消息发送后生成标题，保留手动名称。")}{" "}
                  {uiText(
                    "仅影响当前环境的新对话标题。沿用 Codex 登录，额外消耗一次模型请求；生成失败保留初始标题。",
                  )}
                </HelpTip>
              </div>
            </div>
            <div className="settings-row-control">
              <fieldset id="sessionTitleFields" className="settings-inline-fieldset" disabled>
                <Field id="sessionTitleModel" label={uiText("标题模型")} className="settings-inline-field">
                  <NativeSelect id="sessionTitleModel" size="sm">
                    <Option value="">{uiText("跟随正文模型")}</Option>
                  </NativeSelect>
                </Field>
              </fieldset>
            </div>
          </div>
          <p id="sessionTitleStatus" role="status" className="settings-help" />
          <Feedback id="sessionTitleError" tone="error" className="mt-3" hidden />
        </form>
      </Card>
    ),
    environmentSettingsTitle: (
      <Card
        className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="environmentSettingsTitle"
      >
        <SectionHeading
          className="settings-card-heading"
          id="environmentSettingsTitle"
          title={uiText("执行环境与目录")}
          actions={
            <div className="detail-actions">
              <Button type="button" variant="outline" size="sm" id="reconnectEnvironment" hidden>
                {uiText("重新连接")}
              </Button>
              <Button type="button" variant="outline" size="sm" id="addEnvironment">
                {uiText("连接 WSL")}
              </Button>
            </div>
          }
        >
          {uiText("目录与终端使用上方选择的执行环境；MCP 接入和浏览器访问由本机管理。")}
        </SectionHeading>
        <dl className="settings-facts">
          <div>
            <dt>{uiText("当前执行环境")}</dt>
            <dd>
              <span id="settingsEnvironment" />
            </dd>
          </div>
          <div>
            <dt>{uiText("新 Worktree 根目录")}</dt>
            <dd>
              <code id="settingsRoot">{uiText("正在读取…")}</code>
            </dd>
          </div>
        </dl>
      </Card>
    ),
    terminalTitle: (
      <Card
        className="settings-card settings-row-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="terminalTitle"
      >
        <form id="terminalForm">
          <fieldset id="terminalSettingsFields" disabled>
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-label">
                  <h3 id="terminalTitle">{uiText("终端工具")}</h3>
                  <HelpTip id="terminalHelp" label={uiText("终端工具")}>
                    <span id="terminalHint" />
                  </HelpTip>
                </div>
              </div>
              <div className="settings-row-control">
                <Field id="terminalKind" label={uiText("终端工具")} className="settings-inline-field">
                  <NativeSelect id="terminalKind" name="kind" size="sm">
                    <Option value="auto">{uiText("系统终端")}</Option>
                  </NativeSelect>
                </Field>
              </div>
            </div>
            <div id="terminalCustomFields" className="settings-subpanel" hidden>
              <div className="settings-field-grid">
                <Field
                  id="terminalPath"
                  label={uiText("终端程序路径")}
                  required
                  help={uiText("填写终端可执行文件的完整路径，无需引号或参数。")}
                  helpDisplay="tooltip"
                >
                  <Input id="terminalPath" name="path" autoComplete="off" spellCheck={false} />
                </Field>
                <Field id="terminalStyle" label={uiText("启动方式")}>
                  <NativeSelect id="terminalStyle" name="style" size="sm">
                    <Option value="otty">Otty</Option>
                    <Option value="windows-terminal">Windows Terminal</Option>
                    <Option value="command">{uiText("其他终端（支持 -e 程序 参数）")}</Option>
                  </NativeSelect>
                </Field>
              </div>
              <div className="settings-actions">
                <Button type="submit" variant="default" size="sm" id="saveTerminal">
                  {uiText("保存终端设置")}
                </Button>
              </div>
            </div>
            <p id="terminalSaveStatus" role="status" className="settings-help" />
            <Feedback id="terminalStatus" role="status" className="mt-3 bg-muted text-muted-foreground" />
            <Feedback id="terminalError" tone="error" className="mt-3" hidden />
          </fieldset>
        </form>
      </Card>
    ),
    mcpSettingsTitle: (
      <Card
        className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="mcpSettingsTitle"
      >
        <SectionHeading
          className="settings-card-heading"
          id="mcpSettingsTitle"
          title={uiText("MCP 接入")}
          actions={
            <Button type="button" variant="ghost" size="sm" id="mcpSettingsReload" disabled>
              {uiText("刷新状态")}
            </Button>
          }
        >
          {uiText("安装到本机 Agent，让它只读查询 Yolu 的项目、对话和 Git 状态。")}
        </SectionHeading>
        <ul id="mcpAgentRows" className="m-0 list-none divide-y divide-border p-0">
          {[
            {id: "codex", name: "Codex"},
            {id: "claude", name: "Claude Code"},
          ].map((agent) => (
            <li
              key={agent.id}
              data-mcp-agent={agent.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0"
            >
              <div>
                <p className="m-0 text-sm font-medium">{agent.name}</p>
                <p
                  className="m-0 mt-0.5 text-xs text-muted-foreground"
                  id={`mcp-agent-${agent.id}-status`}
                  data-mcp-status
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-mcp-install
                aria-describedby={`mcp-agent-${agent.id}-status`}
                disabled
              >
                {uiText("安装到 {0}", agent.name)}
              </Button>
            </li>
          ))}
        </ul>
        <Feedback id="mcpSettingsError" tone="error" className="mt-3" hidden />
        <p id="mcpSettingsStatus" className="settings-help" role="status" />
      </Card>
    ),
    browserAccessTitle: (
      <Card
        className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="browserAccessTitle"
      >
        <form id="browserAccessForm">
          <SectionHeading
            className="settings-card-heading"
            id="browserAccessTitle"
            title={uiText("浏览器访问")}
          >
            {uiText("浏览器连接使用 HTTP，请在可信的局域网内使用。Git、终端和对话在主机的执行环境中运行。")}
          </SectionHeading>
          <fieldset id="browserAccessFields" disabled>
            <Check id="browserAccessEnabled" label={uiText("启用局域网访问")} />
            <Field id="browserAccessPort" label={uiText("访问端口")}>
              <Input
                id="browserAccessPort"
                type="number"
                min={1024}
                max={65535}
                defaultValue={4318}
                required
              />
            </Field>
            <div id="browserAccessConnection" hidden>
              <Field
                id="browserAccessCode"
                label={uiText("配对码")}
                help={uiText("在浏览器登录页输入此码。更换配对码会断开已有浏览器连接。")}
                helpDisplay="tooltip"
              >
                <Input id="browserAccessCode" readOnly autoComplete="off" spellCheck={false} />
              </Field>
              <div className="detail-actions">
                <Button type="button" id="copyBrowserAccessCode" variant="outline" size="sm">
                  {uiText("复制配对码")}
                </Button>
                <Button type="button" id="resetBrowserAccessCode" variant="outline" size="sm">
                  {uiText("更换配对码")}
                </Button>
              </div>
              <ul id="browserAccessAddresses" className="browser-access-addresses" />
            </div>
            <div className="settings-actions">
              <Button type="submit" variant="outline" size="sm" id="saveBrowserAccess">
                {uiText("保存浏览器访问设置")}
              </Button>
            </div>
          </fieldset>
          <p id="browserAccessStatus" role="status" className="settings-help" />
        </form>
        <form id="browserAccessLogout" action="/browser-logout" method="post" target="_top" hidden>
          <HelpTip id="browserAccessLogoutHelp" label={uiText("浏览器访问")}>
            {uiText("请在主机上的 Yolu 中配置浏览器访问")}
          </HelpTip>
          <Button type="submit" variant="outline" size="sm" className="mt-3">
            {uiText("退出浏览器登录")}
          </Button>
        </form>
      </Card>
    ),
    codexDiagnosticsTitle: (
      <Card
        className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="codexDiagnosticsTitle"
      >
        <SectionHeading
          className="settings-card-heading"
          id="codexDiagnosticsTitle"
          title={uiText("Codex 安装检测")}
        >
          {uiText(
            "检测不会发送模型请求。升级后，如有对话仍在使用旧版本，请在相关操作结束后退出并停止 Yolu 后台，再重新打开。",
          )}
        </SectionHeading>
        <div className="detail-actions codex-diagnostic-actions">
          <Button type="button" variant="outline" size="sm" id="checkCodex">
            {uiText("检测当前环境")}
          </Button>
          <Button type="button" size="sm" variant="ghost" id="checkAllCodex">
            {uiText("检测全部已登记环境")}
          </Button>
          <Button type="button" size="sm" variant="ghost" id="copyCodexDiagnostics" disabled>
            {uiText("复制检测报告")}
          </Button>
        </div>
        <p id="codexDiagnosticsStatus" className="settings-help" role="status">
          {uiText("尚未检测")}
        </p>
        <p id="codexUnregistered" className="settings-help" hidden />
        <div id="codexDiagnosticsResults" />
        <textarea
          id="codexDiagnosticsCopy"
          className="codex-report-copy"
          aria-label={uiText("检测报告（可全选复制）")}
          readOnly
          hidden
        />
      </Card>
    ),
    agyDiagnosticsTitle: (
      <Card
        className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none"
        aria-labelledby="agyDiagnosticsTitle"
      >
        <SectionHeading
          className="settings-card-heading"
          id="agyDiagnosticsTitle"
          title={uiText("Antigravity (AGY) 检测")}
        >
          {uiText(
            "检测仅执行 ACP 初始化与只读列表探活，不会发送模型请求。如提示未登录，请在终端执行 agy 或 agy acp --login。",
          )}
        </SectionHeading>
        <div className="detail-actions codex-diagnostic-actions">
          <Button type="button" variant="outline" size="sm" id="checkAgy">
            {uiText("检测 Antigravity")}
          </Button>
        </div>
        <p id="agyDiagnosticsStatus" className="settings-help" role="status">
          {uiText("尚未检测")}
        </p>
        <div id="agyDiagnosticsResults" />
      </Card>
    ),
  }
  return (
    <div className="settings-shell">
      <header className="desktop-pane-header">
        <h1>{uiText("设置")}</h1>
      </header>
      <div className="settings-layout">
        <nav className="settings-index" aria-label={uiText("设置分类")}>
          {groups.map((group, index) => (
            <button
              key={group.id}
              type="button"
              aria-controls={group.id}
              aria-current={index === 0 ? "location" : undefined}
              data-settings-section={group.id}
            >
              <group.Icon aria-hidden="true" />
              <span>{group.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-sections">
          <div className="settings-sections-inner">
            {groups.map((group) => (
              <section
                id={group.id}
                className="settings-section"
                key={group.id}
                aria-labelledby={`${group.id}-title`}
              >
                <div className="settings-section-header">
                  <div className="settings-section-title-group">
                    <h2 id={`${group.id}-title`} tabIndex={-1}>
                      {group.label}
                    </h2>
                    {group.headerMeta}
                  </div>
                  {group.headerAction}
                </div>
                <div className="settings-group">
                  {group.cards.map((id) => (
                    <Fragment key={id}>{cards[id]}</Fragment>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
