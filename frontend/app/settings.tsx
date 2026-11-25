import { uiText } from "../i18n";
import { Fragment, type ReactNode } from "react"
import { Activity, MessageSquare, Orbit, RefreshCw, SlidersHorizontal, SquareTerminal, Terminal } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Check, Feedback, Field, ModalFooter, ModalHeader, NativeSelect, Option, StatusBadge } from "./shared"

function Heading({ id, title, children, actions }: { id: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return <div className="settings-card-heading"><div><h3 id={id} className="m-0 text-sm font-semibold">{title}</h3><p className="text-xs leading-relaxed text-muted-foreground">{children}</p></div>{actions}</div>
}
function Help({ children }: { children: ReactNode }) {
  return <p className="settings-help text-xs leading-relaxed text-muted-foreground">{children}</p>
}
export function SettingsPage() {
  const themeChoices = [
    { value: "mint", label: uiText("Yolu 薄荷"), desc: uiText("暖白 · 深青 · 薄荷绿"), swatches: ["appearance-swatch-paper", "appearance-swatch-teal", "appearance-swatch-mint"] },
    { value: "classic", label: uiText("经典蓝紫"), desc: uiText("冷白 · 蓝紫 · 淡紫"), swatches: ["appearance-swatch-cool", "appearance-swatch-indigo", "appearance-swatch-lavender"] },
    { value: "light", label: uiText("浅色"), desc: uiText("纯白 · 中性灰 · 蓝色"), swatches: ["appearance-swatch-white", "appearance-swatch-gray", "appearance-swatch-blue"] },
    { value: "dark", label: uiText("深色"), desc: uiText("深灰 · 石板 · 天蓝"), swatches: ["appearance-swatch-night", "appearance-swatch-slate", "appearance-swatch-sky"] },
    { value: "system", label: uiText("跟随系统"), desc: uiText("自动切换浅色/深色"), swatches: ["appearance-swatch-white", "appearance-swatch-night", "appearance-swatch-blue"] },
  ];
  const groups: { id: string; label: string; Icon: typeof SlidersHorizontal; cards: string[]; headerMeta?: ReactNode; headerAction?: ReactNode }[] = [
    {id:"settings-general",label:uiText("通用"),Icon:SlidersHorizontal,cards:["appearanceTitle", "languageTitle"]},
    {
      id:"settings-conversation",
      label:uiText("对话"),
      Icon:MessageSquare,
      headerAction:<Button type="button" id="conversationDefaultsReload" variant="ghost" size="sm" className="settings-reload-button" disabled><RefreshCw className="size-3.5" aria-hidden="true" /><span>{uiText("刷新可用模型")}</span></Button>,
      cards:["conversationDefaultsHeading", "chatInputHeading", "sessionTitleHeading"]
    },
    {id:"settings-environment",label:uiText("执行环境"),Icon:Terminal,cards:["environmentSettingsTitle", "terminalTitle", "mcpSettingsTitle", "browserAccessTitle"]},
    {id:"settings-diagnostics",label:uiText("诊断"),Icon:Activity,cards:["codexDiagnosticsTitle", "agyDiagnosticsTitle"]}
  ];
  const cards: Record<string, ReactNode> = {
    "appearanceTitle": (<Card className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="appearanceTitle"><form id="appearanceForm">
      <Heading id="appearanceTitle" title={uiText("界面配色")} actions={<span id="appearanceStatus" role="status" className="settings-inline-status" />}>
        {uiText("立即应用到整个工作台，无需重新加载。")}
      </Heading>
      <fieldset id="colorThemeGroup" className="settings-theme-grid" aria-label={uiText("配色方案")}>
        {themeChoices.map(theme => (
          <label key={theme.value} className="settings-theme-option" title={theme.desc}>
            <input type="radio" className="sr-only" name="color_theme" value={theme.value} />
            <span className="settings-theme-swatches" aria-hidden="true">
              {theme.swatches.map(cls => <span key={cls} className={cls} />)}
            </span>
            <span className="settings-theme-name">{theme.label}</span>
          </label>
        ))}
      </fieldset>
      <Feedback id="appearanceError" variant="destructive" className="mt-3" hidden />
    </form></Card>),
    "languageTitle": (<Card className="settings-card settings-row-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="languageTitle"><form id="languageForm">
      <div className="settings-row">
        <div className="settings-row-info">
          <h3 id="languageTitle">{uiText("界面语言")}</h3>
          <p>{uiText("语言设置应用于所有项目和执行环境。应用时会重新加载界面，后台工作继续。")}</p>
        </div>
        <div className="settings-row-control">
          <Field id="languageSelect" label={uiText("界面语言")} className="settings-inline-field"><NativeSelect id="languageSelect" name="language" size="sm"><Option value="system">{uiText("跟随系统")}</Option><Option value="en">English</Option><Option value="zh-CN">简体中文</Option></NativeSelect></Field>
          <Button type="button" variant="ghost" size="sm" id="cancelLanguage" hidden>{uiText("取消")}</Button>
          <Button type="submit" variant="default" size="sm" id="saveLanguage" hidden>{uiText("应用并重新加载")}</Button>
        </div>
      </div>
      <p id="languageStatus" role="status" className="settings-help" />
    </form></Card>),
    "conversationDefaultsHeading": (<Card className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="conversationDefaultsHeading"><form id="conversationDefaultsForm">
      <Heading id="conversationDefaultsHeading" title={uiText("新对话默认设置")} actions={<span id="conversationDefaultsStatus" role="status" className="settings-inline-status" />}>
        {uiText("按执行环境和引擎分别保存，仅用于新建对话。已有对话可单独调整。")}
      </Heading>
      <div className="settings-context-grid">
      <Field id="environmentSelect" label={uiText("执行环境")} className="settings-environment-field"><NativeSelect id="environmentSelect" size="sm"><Option value="local">{uiText("本机")}</Option></NativeSelect><small id="environmentStatus" role="status" className="sr-only" /></Field>
      <div className="settings-agent-field"><span id="conversationDefaultProvider-label" className="settings-field-label">{uiText("对话引擎")}</span>
      <fieldset id="conversationDefaultProviderGroup" className="settings-segments settings-provider-tabs" aria-label={uiText("对话引擎")} disabled>
        <label>
          <input type="radio" className="sr-only" name="conversation_default_provider" value="codex" defaultChecked />
          <SquareTerminal aria-hidden="true" />
          <span>Codex</span>
        </label>
        <label>
          <input type="radio" className="sr-only" name="conversation_default_provider" value="agy" />
          <Orbit aria-hidden="true" />
          <span>Antigravity (AGY)</span>
        </label>
      </fieldset>
      </div>
      </div>
      <fieldset id="conversationDefaultsFields" disabled>
        <div className="settings-field-grid settings-model-fields">
          <Field id="conversationDefaultModel" label={uiText("默认模型")}><NativeSelect id="conversationDefaultModel" size="sm"><Option value="">{uiText("沿用 Codex 默认模型")}</Option></NativeSelect></Field>
          <Field id="conversationDefaultSpeed" label={uiText("默认响应速度")}><NativeSelect id="conversationDefaultSpeed" size="sm"><Option value="">{uiText("沿用 Codex 默认速度")}</Option></NativeSelect></Field>
        </div>
        <div className="field grid gap-2 settings-segment-field">
          <span id="conversationDefaultEffort-label" className="settings-field-label">{uiText("默认思考强度")}</span>
          <div id="conversationDefaultEffort" className="settings-segments" role="radiogroup" aria-labelledby="conversationDefaultEffort-label" />
          <div id="conversationDefaultEffortDropdown" hidden><NativeSelect id="conversationDefaultEffortSelect" size="sm" aria-labelledby="conversationDefaultEffort-label" aria-describedby="conversationDefaultEffortHelp" /></div>
          <p id="conversationDefaultEffortHelp" className="settings-help">{uiText("更高的思考强度通常需要更多时间。默认值由所选模型决定。")}</p>
        </div>
        <div className="field grid gap-2 settings-segment-field">
          <span id="conversationDefaultPermission-label" className="settings-field-label">{uiText("默认权限")}</span>
          <div id="conversationDefaultPermission" className="settings-segments" role="radiogroup" aria-labelledby="conversationDefaultPermission-label" aria-describedby="conversationDefaultPermissionHelp" />
          <p id="conversationDefaultPermissionHelp" className="settings-help settings-permission-help" />
        </div>
      </fieldset>
      <Feedback id="conversationDefaultsError" variant="destructive" className="mt-3" hidden />
      <Button type="button" id="conversationDefaultsRetry" variant="outline" size="sm" className="mt-2" hidden>{uiText("重试保存")}</Button>
    </form></Card>),
    "chatInputHeading": (<Card className="settings-card settings-row-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="chatInputHeading"><form id="chatInputForm">
      <div className="settings-row">
        <div className="settings-row-info">
          <h3 id="chatInputHeading">{uiText("发送快捷键")}</h3>
          <p id="sendShortcutHelp" />
          <p className="settings-scope">{uiText("应用于所有项目和执行环境，包括已打开的对话。")}</p>
        </div>
        <div className="settings-row-control">
          <fieldset id="sendShortcutGroup" className="settings-segments settings-compact-segments" aria-label={uiText("发送快捷键")}>
            <label>
              <input type="radio" className="sr-only" name="send_shortcut" value="enter" defaultChecked />
              <span>{uiText("Enter 发送")}</span>
            </label>
            <label>
              <input type="radio" className="sr-only" name="send_shortcut" value="ctrlEnter" />
              <span>Ctrl / ⌘ + Enter</span>
            </label>
          </fieldset>
        </div>
      </div>
      <p id="chatInputStatus" role="status" className="settings-help" />
      <Feedback id="chatInputError" variant="destructive" className="mt-3" hidden />
    </form></Card>),
    "sessionTitleHeading": (<Card className="settings-card settings-row-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="sessionTitleHeading"><form id="sessionTitleForm">
      <div className="settings-row">
        <div className="settings-row-info">
          <h3 id="sessionTitleHeading">{uiText("自动生成标题")}</h3>
          <p>{uiText("首条消息发送后生成标题，保留手动名称。")}</p>
          <p id="settingsTitleEnv" className="settings-scope" />
          <details className="settings-help-details"><summary>{uiText("标题生成说明")}</summary><Help>{uiText("仅影响当前环境的新对话标题。沿用 Codex 登录，额外消耗一次模型请求；生成失败保留初始标题。")}</Help></details>
        </div>
        <div className="settings-row-control">
          <fieldset id="sessionTitleFields" className="settings-inline-fieldset" disabled>
            <Field id="sessionTitleModel" label={uiText("标题模型")} className="settings-inline-field"><NativeSelect id="sessionTitleModel" size="sm"><Option value="">{uiText("跟随正文模型")}</Option></NativeSelect></Field>
          </fieldset>
        </div>
      </div>
      <p id="sessionTitleStatus" role="status" className="settings-help" />
      <Feedback id="sessionTitleError" variant="destructive" className="mt-3" hidden />
    </form></Card>),
    "environmentSettingsTitle": (<Card className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="environmentSettingsTitle">
      <Heading id="environmentSettingsTitle" title={uiText("执行环境与目录")} actions={<div className="detail-actions"><Button type="button" variant="outline" size="sm" id="reconnectEnvironment" hidden>{uiText("重新连接")}</Button><Button type="button" variant="outline" size="sm" id="addEnvironment">{uiText("连接 WSL")}</Button></div>}>{uiText("目录与终端使用上方选择的执行环境；MCP 接入和浏览器访问由本机管理。")}</Heading>
      <dl className="settings-facts"><div><dt>{uiText("当前执行环境")}</dt><dd><span id="settingsEnvironment" /></dd></div><div><dt>{uiText("新 Worktree 根目录")}</dt><dd><code id="settingsRoot">{uiText("正在读取…")}</code></dd></div></dl>
    </Card>),
    "terminalTitle": (<Card className="settings-card settings-row-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="terminalTitle"><form id="terminalForm">
      <fieldset id="terminalSettingsFields" disabled>
        <div className="settings-row">
          <div className="settings-row-info">
            <h3 id="terminalTitle">{uiText("终端工具")}</h3>
            <p>{uiText("Codex、Git 终端和在终端获取分支共用此设置，切换后立即生效。")}</p>
          </div>
          <div className="settings-row-control">
            <Field id="terminalKind" label={uiText("终端工具")} className="settings-inline-field"><NativeSelect id="terminalKind" name="kind" size="sm"><Option value="auto">{uiText("系统终端")}</Option></NativeSelect></Field>
          </div>
        </div>
        <div id="terminalCustomFields" className="settings-subpanel" hidden>
          <div className="settings-field-grid">
            <Field id="terminalPath" label={uiText("终端程序路径")} required help={uiText("填写终端可执行文件的完整路径，无需引号或参数。")}><Input id="terminalPath" name="path" autoComplete="off" spellCheck={false} /></Field>
            <Field id="terminalStyle" label={uiText("启动方式")}><NativeSelect id="terminalStyle" name="style" size="sm"><Option value="otty">Otty</Option><Option value="windows-terminal">Windows Terminal</Option><Option value="command">{uiText("其他终端（支持 -e 程序 参数）")}</Option></NativeSelect></Field>
          </div>
          <div className="settings-actions"><Button type="submit" variant="default" size="sm" id="saveTerminal">{uiText("保存终端设置")}</Button></div>
        </div>
        <p id="terminalHint" className="settings-help text-muted-foreground" />
        <p id="terminalSaveStatus" role="status" className="settings-help" />
        <Feedback id="terminalStatus" role="status" className="mt-3 bg-muted text-muted-foreground" />
        <Feedback id="terminalError" variant="destructive" className="mt-3" hidden />
      </fieldset>
    </form></Card>),
    "mcpSettingsTitle": (<Card className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="mcpSettingsTitle">
      <Heading id="mcpSettingsTitle" title={uiText("MCP 接入")} actions={<Button type="button" variant="ghost" size="sm" id="mcpSettingsReload" disabled>{uiText("刷新状态")}</Button>}>
        {uiText("安装到本机 Agent，让它只读查询 Yolu 的项目、对话和 Git 状态。")}
      </Heading>
      <ul id="mcpAgentRows" className="m-0 list-none divide-y divide-border p-0">
        {[{id:"codex",name:"Codex"},{id:"claude",name:"Claude Code"}].map(agent => <li key={agent.id} data-mcp-agent={agent.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0">
          <div><p className="m-0 text-sm font-medium">{agent.name}</p><p className="m-0 mt-0.5 text-xs text-muted-foreground" id={`mcp-agent-${agent.id}-status`} data-mcp-status /></div>
          <Button type="button" variant="outline" size="sm" data-mcp-install aria-describedby={`mcp-agent-${agent.id}-status`} disabled>{uiText("安装到 {0}", agent.name)}</Button>
        </li>)}
      </ul>
      <Feedback id="mcpSettingsError" variant="destructive" className="mt-3" hidden />
      <p id="mcpSettingsStatus" className="settings-help" role="status" />
    </Card>),
    "browserAccessTitle": (<Card className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="browserAccessTitle">
      <form id="browserAccessForm">
        <Heading id="browserAccessTitle" title={uiText("浏览器访问")}>
          {uiText("桌面端与浏览器共用后台、项目和对话。开启后，可从局域网内的其他设备登录。")}
        </Heading>
        <fieldset id="browserAccessFields" disabled>
          <Check id="browserAccessEnabled" label={uiText("启用局域网访问")} />
          <Field id="browserAccessPort" label={uiText("访问端口")}>
            <Input id="browserAccessPort" type="number" min={1024} max={65535} defaultValue={4318} required />
          </Field>
          <div id="browserAccessConnection" hidden>
            <Field id="browserAccessCode" label={uiText("配对码")} help={uiText("在浏览器登录页输入此码。更换配对码会断开已有浏览器连接。")}>
              <Input id="browserAccessCode" readOnly autoComplete="off" spellCheck={false} />
            </Field>
            <div className="detail-actions">
              <Button type="button" id="copyBrowserAccessCode" variant="outline" size="sm">{uiText("复制配对码")}</Button>
              <Button type="button" id="resetBrowserAccessCode" variant="outline" size="sm">{uiText("更换配对码")}</Button>
            </div>
            <p className="settings-help">{uiText("在其他设备上打开主机的局域网 IP 地址。")}</p>
            <ul id="browserAccessAddresses" className="browser-access-addresses" />
          </div>
          <Help>{uiText("浏览器连接使用 HTTP，请在可信的局域网内使用。Git、终端和对话在主机的执行环境中运行。")}</Help>
          <div className="settings-actions">
            <Button type="submit" variant="outline" size="sm" id="saveBrowserAccess">{uiText("保存浏览器访问设置")}</Button>
          </div>
        </fieldset>
        <p id="browserAccessStatus" role="status" className="settings-help" />
      </form>
      <form id="browserAccessLogout" action="/browser-logout" method="post" target="_top" hidden>
        <Help>{uiText("请在主机上的 Yolu 中配置浏览器访问")}</Help>
        <Button type="submit" variant="outline" size="sm" className="mt-3">{uiText("退出浏览器登录")}</Button>
      </form>
    </Card>),
    "codexDiagnosticsTitle": (<Card className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="codexDiagnosticsTitle">
      <Heading id="codexDiagnosticsTitle" title={uiText("Codex 安装检测")}>{uiText("安装或升级 Codex CLI 后，Yolu 会自动启动共享后台并重新检测当前环境。")}</Heading>
      <div className="detail-actions codex-diagnostic-actions"><Button type="button" variant="outline" size="sm" id="checkCodex">{uiText("检测当前环境")}</Button><Button type="button" size="sm" variant="ghost" id="checkAllCodex">{uiText("检测全部已登记环境")}</Button><Button type="button" size="sm" variant="ghost" id="copyCodexDiagnostics" disabled>{uiText("复制检测报告")}</Button></div>
      <p id="codexDiagnosticsStatus" className="settings-help" role="status">{uiText("尚未检测")}</p>
      <p id="codexUnregistered" className="settings-help" hidden />
      <div id="codexDiagnosticsResults" />
      <textarea id="codexDiagnosticsCopy" className="codex-report-copy" aria-label={uiText("检测报告（可全选复制）")} readOnly hidden />
      <Help>{uiText("检测不会发送模型请求。升级后，如有对话仍在使用旧版本，请在相关操作结束后退出并停止 Yolu 后台，再重新打开。")}</Help>
    </Card>),
    "agyDiagnosticsTitle": (<Card className="settings-card gap-0 rounded-none border-0 border-b border-border bg-transparent py-4 shadow-none" aria-labelledby="agyDiagnosticsTitle">
      <Heading id="agyDiagnosticsTitle" title={uiText("Antigravity (AGY) 检测")}>{uiText("检测当前环境的 agy CLI 与 ACP 协议握手状态。新建对话时可选择 Antigravity 引擎。")}</Heading>
      <div className="detail-actions codex-diagnostic-actions"><Button type="button" variant="outline" size="sm" id="checkAgy">{uiText("检测 Antigravity")}</Button></div>
      <p id="agyDiagnosticsStatus" className="settings-help" role="status">{uiText("尚未检测")}</p>
      <div id="agyDiagnosticsResults" />
      <Help>{uiText("检测仅执行 ACP 初始化与只读列表探活，不会发送模型请求。如提示未登录，请在终端执行 agy 或 agy acp --login。")}</Help>
    </Card>)
  };
  return <div className="settings-shell">
    <header className="desktop-pane-header">
      <h1>{uiText("设置")}</h1>
    </header>
    <div className="settings-layout">
      <nav className="settings-index" aria-label={uiText("设置分类")}>
        {groups.map((group,index) => <button key={group.id} type="button" aria-controls={group.id} aria-current={index === 0 ? "location" : undefined} data-settings-section={group.id}><group.Icon aria-hidden="true" /><span>{group.label}</span></button>)}
      </nav>
      <div className="settings-sections">
        <div className="settings-sections-inner">{groups.map(group => <section id={group.id} className="settings-section" key={group.id} aria-labelledby={group.id + "-title"}>
          <div className="settings-section-header">
            <div className="settings-section-title-group">
              <h2 id={group.id + "-title"} tabIndex={-1}>{group.label}</h2>
              {group.headerMeta}
            </div>
            {group.headerAction}
          </div>
          <div className="settings-group">
            {group.cards.map(id => <Fragment key={id}>{cards[id]}</Fragment>)}
          </div>
        </section>)}</div>
      </div>
    </div>
  </div>
}

// Settings forms are static boundaries owned by the legacy controllers.
export function setupSettingsNavigation() {
  const page = document.getElementById("settingsPage");
  const scroller = page?.querySelector<HTMLElement>(".settings-sections") || page?.closest("main");
  let frame = 0;
  const mark = (id: string) => page?.querySelectorAll<HTMLElement>("[data-settings-section]").forEach(button => {
    if (button.dataset.settingsSection === id) button.setAttribute("aria-current","location");
    else button.removeAttribute("aria-current");
  });
  const track = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const sections = [...(page?.querySelectorAll<HTMLElement>(".settings-section") || [])];
      if (!sections.length) return;
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 24 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 24) {
        mark(sections.at(-1)!.id);
        return;
      }
      const edge = (scroller?.getBoundingClientRect().top || 0) + 96;
      const current = sections.filter(section => section.getBoundingClientRect().top <= edge).at(-1) || sections[0];
      if (current) mark(current.id);
    });
  };
  const jump = (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-settings-section]");
    if (!button || !page?.contains(button)) return;
    const heading = document.getElementById(button.dataset.settingsSection + "-title");
    heading?.scrollIntoView({block:"start"});
    heading?.focus({preventScroll:true});
    mark(button.dataset.settingsSection!);
  };
  page?.addEventListener("click", jump);
  scroller?.addEventListener("scroll", track, {passive:true});
  window.addEventListener("pagehide", () => {page?.removeEventListener("click", jump); scroller?.removeEventListener("scroll", track); cancelAnimationFrame(frame);}, {once:true});
}

type DiagnosticCheck = { id: string; name: string; status: string; message: string; advice?: string }
type InstallPlan = { action?: "install" | "upgrade"; manager?: "standalone" | "brew" | "npm"; path?: string; reason?: string }
type InstallState = { status: string; action?: "install" | "upgrade"; stage?: "daemon"; version?: string; error?: string }
type DiagnosticReport = {
  platform: string; user: string; codex_home: string; cli_path: string; cli_entry?: string; candidates: string[];
  version?: string; daemon_path?: string; daemon_version?: string; daemon_status?: string; checked_at: string;
  status: string; checks: DiagnosticCheck[];
  install_plan?: InstallPlan;
}
type DiagnosticResult = { id: string; name: string; loading?: boolean; error?: string; report?: DiagnosticReport; install?: InstallState; installError?: string; readOnly?: boolean }

function CodexInstallAction({ result }: { result: DiagnosticResult }) {
  const plan = result.report?.install_plan
  const install = result.install
  const running = install?.status === "running"
  const upgrade = (running ? install.action : plan?.action) === "upgrade"
  const label = upgrade ? uiText("升级 Codex CLI") : uiText("安装 Codex CLI")
  const manager = { standalone: uiText("OpenAI 官方安装程序"), brew: "Homebrew", npm: "npm" }[plan?.manager || "standalone"]
  const progress = install?.stage === "daemon" ? uiText("正在启动并检测 Codex 共享后台…")
    : upgrade ? uiText("正在升级 Codex CLI…") : uiText("正在安装 Codex CLI…")
  const error = result.installError || install?.error
  return <>
    {(plan?.action || running) && !result.readOnly && <div className="codex-install-actions">
      <Button type="button" size="sm" variant="outline" data-codex-install disabled={running || result.loading || !!result.error} aria-label={uiText("{0} · {1}", label, result.name)}>{label}</Button>
      {plan?.action && <span className="settings-help">{manager}</span>}
    </div>}
    {plan?.reason && !result.readOnly && <p className="settings-help">{uiText(plan.reason)}</p>}
    {running && <p role="status" className="settings-help">{progress}</p>}
    {install?.status === "succeeded" && <p role="status" className="settings-help">{install.action === "upgrade" ? uiText("Codex CLI 已升级到最新版本 · {0}", install.version) : uiText("Codex CLI 安装完成 · {0}", install.version)}</p>}
    {error && <p role="alert" className="codex-diagnostic-error">{install?.stage === "daemon"
      ? uiText("{0} 已就绪。共享后台启动或检测失败。{1}", install.version, uiText(error))
      : uiText("Codex 安装或升级失败：{0}", uiText(error))}</p>}
  </>
}

export function CodexDiagnosticsResults({ results }: { results: DiagnosticResult[] }) {
  const statusLabel = (status: string) => ({ok: uiText("通过"), warning: uiText("需留意"), error: uiText("异常"), skipped: uiText("未检测")})[status] || uiText("未知")
  const statusKind = (status: string) => ({ok: "ready", warning: "warning", error: "failed"})[status] || "neutral"
  return <>{results.map(result => <section className="codex-diagnostic-result" key={result.id} data-codex-environment={result.id} aria-label={uiText("{0} Codex 检测", result.name)} aria-busy={!!result.loading}>
    <div className="codex-diagnostic-heading"><h3>{result.name}</h3><StatusBadge kind={result.loading ? "neutral" : result.error ? "failed" : statusKind(result.report?.status || "")}>{result.loading ? uiText("正在检测") : result.error ? uiText("检测失败") : statusLabel(result.report?.status || "")}</StatusBadge></div>
    {result.error && <p role="alert" className="codex-diagnostic-error">{result.error}{result.report ? uiText("；以下保留上次检测结果。") : uiText("。请确认环境连接正常后重试；WSL 可使用上方的重新连接。")}</p>}
    {result.report && <>
      <p className="settings-help">{({darwin: "macOS", windows: "Windows", linux: "Linux"})[result.report.platform] || result.report.platform}{" "}{uiText("· 用户")}{" "}{result.report.user || uiText("未报告")}{" "}{uiText("· 检测于")}{" "}<time dateTime={result.report.checked_at}>{result.report.checked_at}</time></p>
      <ul className="codex-diagnostic-checks">{result.report.checks.map(check => <li key={check.id}><div className="codex-diagnostic-heading"><strong>{uiText(check.name)}</strong><StatusBadge kind={statusKind(check.status)}>{statusLabel(check.status)}</StatusBadge></div><p>{uiText(check.message)}</p>{check.advice && <p className="settings-help">{uiText(check.advice)}</p>}{check.id === "cli" && <CodexInstallAction result={result} />}</li>)}</ul>
      <details className="settings-help-details"><summary>{uiText("安装路径与版本详情")}</summary><dl className="settings-facts codex-diagnostic-facts">{[
        [uiText("CLI 程序"), result.report.cli_path], [uiText("CLI 启动入口"), result.report.cli_entry], [uiText("CLI 版本"), result.report.version],
        ["CODEX_HOME", result.report.codex_home], [uiText("共享后台程序"), result.report.daemon_path], [uiText("运行中后台版本"), result.report.daemon_version], [uiText("后台状态"), result.report.daemon_status],
      ].filter(([, value]) => value).map(([name, value]) => <div key={name}><dt>{name}</dt><dd><code>{value}</code></dd></div>)}</dl>
      <p>{uiText("PATH 中找到的 Codex：")}{result.report.candidates.length ? result.report.candidates.map(path => <code className="block" key={path}>{path}</code>) : uiText("未找到")}</p></details>
    </>}
  </section>)}</>
}
type AgyDiagnosticReport = {
  platform: string; user: string; cli_path: string; candidates: string[];
  version?: string; agent_name?: string; checked_at: string;
  status: string; checks: DiagnosticCheck[];
}
type AgyDiagnosticResult = { id: string; name: string; loading?: boolean; error?: string; report?: AgyDiagnosticReport }

export function AgyDiagnosticsResults({ results }: { results: AgyDiagnosticResult[] }) {
  const statusLabel = (status: string) => ({ok: uiText("通过"), warning: uiText("需留意"), error: uiText("异常"), skipped: uiText("未检测")})[status] || uiText("未知")
  const statusKind = (status: string) => ({ok: "ready", warning: "warning", error: "failed"})[status] || "neutral"
  return <>{results.map(result => <section className="codex-diagnostic-result" key={result.id} data-agy-environment={result.id} aria-label={uiText("{0} Antigravity 检测", result.name)} aria-busy={!!result.loading}>
    <div className="codex-diagnostic-heading"><h3>{result.name}</h3><StatusBadge kind={result.loading ? "neutral" : result.error ? "failed" : statusKind(result.report?.status || "")}>{result.loading ? uiText("正在检测") : result.error ? uiText("检测失败") : statusLabel(result.report?.status || "")}</StatusBadge></div>
    {result.error && <p role="alert" className="codex-diagnostic-error">{result.error}</p>}
    {result.report && <>
      <p className="settings-help">{({darwin: "macOS", windows: "Windows", linux: "Linux"})[result.report.platform] || result.report.platform}{" "}{uiText("· 用户")}{" "}{result.report.user || uiText("未报告")}{" "}{uiText("· 检测于")}{" "}<time dateTime={result.report.checked_at}>{result.report.checked_at}</time></p>
      <ul className="codex-diagnostic-checks">{result.report.checks.map(check => <li key={check.id}><div className="codex-diagnostic-heading"><strong>{uiText(check.name)}</strong><StatusBadge kind={statusKind(check.status)}>{statusLabel(check.status)}</StatusBadge></div><p>{uiText(check.message)}</p>{check.advice && <p className="settings-help">{uiText(check.advice)}</p>}</li>)}</ul>
      <details className="settings-help-details"><summary>{uiText("安装路径与版本详情")}</summary><dl className="settings-facts codex-diagnostic-facts">{[
        [uiText("CLI 程序"), result.report.cli_path], [uiText("ACP 服务"), result.report.agent_name], [uiText("ACP 版本"), result.report.version],
      ].filter(([, value]) => value).map(([name, value]) => <div key={name}><dt>{name}</dt><dd><code>{value}</code></dd></div>)}</dl>
      <p>{uiText("PATH 中找到的 agy：")}{result.report.candidates.length ? result.report.candidates.map(path => <code className="block" key={path}>{path}</code>) : uiText("未找到")}</p></details>
    </>}
  </section>)}</>
}
export function EnvironmentForm() {
  return <form id="environmentForm"><ModalHeader id="environmentTitle" title={uiText("连接 WSL 环境")} /><p className="dialog-description">{uiText("应用自动部署并启动辅助程序。Git 和文件操作在所选 WSL 用户内执行，项目和对话索引保存在本机。")}</p>
    <Field id="environmentDistro" label={uiText("发行版")}><NativeSelect id="environmentDistro" required /></Field>
    <Field id="environmentUser" label={uiText("Linux 用户")}><Input id="environmentUser" autoComplete="off" placeholder={uiText("留空使用发行版默认用户")} /></Field>
    <Field id="environmentRoot" label={uiText("新 Worktree 根目录")}><Input id="environmentRoot" autoComplete="off" placeholder={uiText("留空使用该用户的 ~/workspaces")} /></Field>
    <Check id="environmentImport" label={uiText("导入该用户原有的 Yolu 项目与对话记录")} />
    <p className="dialog-description">{uiText("导入会复制一份当前记录到 Windows；项目和 Worktree 保留原路径。之后可在桌面端查看项目与对话。")}</p><Feedback id="environmentError" variant="destructive" hidden />
    <ModalFooter><Button type="submit" id="connectEnvironment">{uiText("连接并准备环境")}</Button></ModalFooter>
  </form>
}
