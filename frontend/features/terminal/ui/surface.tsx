import {uiText} from "@/shared/i18n"
import {createRecoverableRoot as createRoot} from "@/shared/ui/feedback/root"
import {createPortal, flushSync} from "react-dom"
import {ALargeSmall, ArrowRight, Bot, Minus, MoreHorizontal, Plus, RefreshCw, Search, Terminal, X} from "lucide-react"
import {ConversationCreationIntro, ConversationHeader, ConversationIconButton, ConversationPaneButtons, ConversationStatusBadge, ConversationWorkingContext} from "@/shared/ui/conversation-surface"

export interface TerminalProfile { id: string; name: string; executable: string; args: string[] | null; available: boolean }

export function mountTerminalTools(launch: (id: string) => void) {
  const root = createRoot(document.getElementById("terminalProfileChoices")!)
  return {
    render(profiles: TerminalProfile[], disabled: boolean, starting?: string) {
      const available = profiles.filter(profile => profile.available)
      const unavailable = profiles.filter(profile => !profile.available)
      root.render(<>
        <div className="terminal-tool-list">
          {available.map(profile => {
            const Icon = profile.id === "shell" ? Terminal : Bot
            const label = starting === profile.id ? uiText("正在启动 {0}…", profile.name) : uiText("启动 {0}", profile.name)
            return <button key={profile.id} type="button" className="terminal-tool" data-terminal-profile={profile.id} disabled={disabled} aria-label={label} onClick={() => launch(profile.id)}>
              <span className="terminal-tool-icon"><Icon aria-hidden="true" /></span>
              <span>{starting === profile.id ? label : profile.name}</span>
              <ArrowRight className="terminal-tool-arrow" aria-hidden="true" />
            </button>
          })}
        </div>
        {!!unavailable.length && <details className="terminal-disclosure terminal-unavailable">
          <summary>{uiText("未找到命令 · {0}", unavailable.length)}</summary>
          <ul>{unavailable.map(profile => <li key={profile.id}><span>{profile.name}</span><code>{profile.executable}</code></li>)}</ul>
        </details>}
      </>)
    },
    unmount: () => root.unmount(),
  }
}

// Mount the same chrome as UI conversations once. The terminal controller owns
// the launch form values, including unfinished custom settings.
export function mountTerminalSurface(command: (command: string) => void) {
  const root = createRoot(document.getElementById("terminalSurface")!)
  flushSync(() => root.render(<>
    {createPortal(<ConversationCreationIntro kind="terminal" uiID="terminalKindUI" />, document.getElementById("terminalCreationSetup")!)}
    <ConversationHeader title={uiText("新建对话")} titleID="terminalTitle"
      actions={<>
        <ConversationStatusBadge id="terminalStatusBadge" hidden><span className="chat-status-dot" aria-hidden="true" /><span id="terminalStatus">{uiText("正在连接…")}</span></ConversationStatusBadge>
        <span id="terminalRuntimeActions" className="terminal-runtime-actions" hidden>
          <details id="terminalAppearanceMenu" className="terminal-appearance-menu">
            <summary className="conversation-icon-button" aria-label={uiText("终端文字大小")} title={uiText("终端文字大小")}><ALargeSmall aria-hidden="true" /></summary>
            <div className="terminal-appearance-panel">
              <span>{uiText("文字大小")}</span>
              <div className="terminal-font-controls" role="group" aria-label={uiText("调整终端文字大小")}>
                <ConversationIconButton id="decreaseTerminalFont" label={uiText("缩小终端文字")}><Minus aria-hidden="true" /></ConversationIconButton>
                <output id="terminalFontSize" aria-live="polite">14 px</output>
                <ConversationIconButton id="increaseTerminalFont" label={uiText("放大终端文字")}><Plus aria-hidden="true" /></ConversationIconButton>
              </div>
              <button id="resetTerminalFont" type="button">{uiText("恢复默认")}</button>
            </div>
          </details>
          <ConversationIconButton id="openTerminalSearch" label={uiText("查找终端输出")} aria-expanded="false" aria-controls="terminalSearchBar"><Search aria-hidden="true" /></ConversationIconButton>
          <ConversationIconButton id="reconnectTerminal" label={uiText("重连终端")}><RefreshCw aria-hidden="true" /></ConversationIconButton>
          <details id="terminalActionMenu" className="terminal-action-menu"><summary className="conversation-icon-button" aria-label={uiText("更多终端操作")} title={uiText("更多终端操作")}><MoreHorizontal aria-hidden="true" /></summary><div><button id="stopTerminal" className="danger" type="button">{uiText("结束进程")}</button></div></details>
        </span>
        <ConversationPaneButtons split canZoom zoomed={false} command={command} zoomID="zoomTerminal" closeID="closeTerminalView" />
      </>}
      context={<ConversationWorkingContext id="terminalDirectoryContext" trigger={<>
        <span className="chat-workspace-project"><span id="terminalDirectoryName">{uiText("工作目录")}</span></span>
        <span id="terminalBranch" className="chat-workspace-branch" hidden><span id="terminalBranchName" /></span>
      </>}>
        <button id="terminalContext" className="chat-workspace-link" type="button">{uiText("打开项目")}</button>
        <code id="terminalContextPath" className="chat-workspace-path" />
      </ConversationWorkingContext>}>

      <div id="terminalSearchBar" className="terminal-search-bar" role="search" hidden><input id="terminalSearch" type="search" placeholder={uiText("搜索终端输出")} aria-label={uiText("搜索终端输出")} /><button id="terminalSearchNext" type="button">{uiText("查找")}</button><ConversationIconButton id="closeTerminalSearch" label={uiText("关闭终端搜索")}><X aria-hidden="true" /></ConversationIconButton></div>
    </ConversationHeader>
  </>))
  return () => root.unmount()
}
