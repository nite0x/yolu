import { uiText } from "../i18n";
import {createRoot} from "react-dom/client"
import {flushSync} from "react-dom"
import {ALargeSmall, Folder, GitBranch, Minus, MoreHorizontal, Plus, RefreshCw, Search, X} from "lucide-react"
import {ConversationHeader, ConversationIconButton, ConversationKindSwitch, ConversationPaneButtons, ConversationStatusBadge} from "./conversation-surface"

// Mount the same chrome as UI conversations once. The terminal controller owns
// the existing selects and their values, including unfinished launch settings.
export function mountTerminalSurface(command: (command: string) => void) {
  const root = createRoot(document.getElementById("terminalSurface")!)
  flushSync(() => root.render(<>
    <div id="terminalKind"><ConversationKindSwitch kind="terminal" uiID="terminalKindUI" /></div>
    <div id="terminalDirectoryChoicesField" className="terminal-directory-choices"><span id="terminalDirectoryChoicesLabel">{uiText("工作目录")}</span><div id="terminalDirectoryChoices" className="creation-choices" role="group" aria-labelledby="terminalDirectoryChoicesLabel" /><select id="terminalDirectory" form="terminalForm" hidden aria-label={uiText("工作目录")} /></div>
    <ConversationHeader title={uiText("新建对话")} titleID="terminalTitle"
      tasks={<nav className="chat-workspace-tasks" aria-label={uiText("关联任务详情")}><span>{uiText("任务")}</span><button id="terminalContext" className="chat-workspace-link" type="button">{uiText("请选择任务")}</button></nav>}
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
      </>}>
      <details id="terminalWorkspace" className="chat-workspace-context">
        <summary><span className="chat-workspace-project"><Folder aria-hidden="true" /><span id="terminalDirectoryName">{uiText("工作目录")}</span></span><span id="terminalBranch" className="chat-workspace-branch" hidden><GitBranch aria-hidden="true" /><span id="terminalBranchName" /></span></summary>
        <div className="terminal-workspace-fields">
          <label>{uiText("任务")}<select id="terminalTask" form="terminalForm" required /></label>
          <small id="terminalDirectoryPath" />
        </div>
      </details>
      <div id="terminalSearchBar" className="terminal-search-bar" role="search" hidden><input id="terminalSearch" type="search" placeholder={uiText("搜索终端输出")} aria-label={uiText("搜索终端输出")} /><button id="terminalSearchNext" type="button">{uiText("查找")}</button><ConversationIconButton id="closeTerminalSearch" label={uiText("关闭终端搜索")}><X aria-hidden="true" /></ConversationIconButton></div>
    </ConversationHeader>
  </>))
  return () => root.unmount()
}
