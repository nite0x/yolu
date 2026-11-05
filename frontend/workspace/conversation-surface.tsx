import { uiText } from "../i18n";
import type { ComponentProps, ReactNode } from "react"
import {Maximize2, Minimize2, X} from "lucide-react"

export function ConversationKindSwitch({kind, id, uiID, terminalID}: {kind: "ui" | "terminal"; id?: string; uiID?: string; terminalID?: string}) {
  return <div id={id} className="conversation-kind-switch" role="group" aria-label={uiText("对话形式")}>
    <button id={uiID} type="button" aria-pressed={kind === "ui"}>{uiText("UI 对话")}</button>
    <button id={terminalID} type="button" data-conversation-kind={kind === "ui" ? "terminal" : undefined} aria-pressed={kind === "terminal"}>{uiText("终端")}</button>
  </div>
}

export function ConversationHeader({title, titleID, titleHint, tasks, actions, children}: {title: string; titleID: string; titleHint?: string; tasks?: ReactNode; actions?: ReactNode; children?: ReactNode}) {
  return <header className="chat-panel-header conversation-surface-header">
    <div className="chat-panel-toolbar">
      <div className="chat-panel-heading">{tasks}<h2 id={titleID} tabIndex={-1} className="chat-panel-title" title={titleHint}>{title}</h2></div>
      <div className="chat-panel-actions">{actions}</div>
    </div>
    {children}
  </header>
}

export function ConversationIconButton({label, children, ...props}: ComponentProps<"button"> & {label: string}) {
  return <button type="button" className="conversation-icon-button" title={label} aria-label={label} {...props}>{children}</button>
}

export function ConversationStatusBadge({children, ...props}: ComponentProps<"span">) {
  return <span className="chat-status" role="status" aria-live="polite" {...props}>{children}</span>
}

export function ConversationPaneButtons({split, canZoom, zoomed, command, zoomID, closeID}: {split: boolean; canZoom: boolean; zoomed: boolean; command?: (command: string) => void; zoomID?: string; closeID?: string}) {
  const label = zoomed ? uiText("恢复分栏") : uiText("放大当前对话")
  return <>
    <ConversationIconButton id={zoomID} hidden={!split || !canZoom} label={label} data-zoomed={zoomed} onClick={command ? () => command("zoom") : undefined}><Maximize2 className="conversation-zoom-in" aria-hidden="true" /><Minimize2 className="conversation-zoom-out" aria-hidden="true" /></ConversationIconButton>
    <ConversationIconButton id={closeID} hidden={!split} label={uiText("关闭当前对话栏")} onClick={command ? () => command("close") : undefined}><X aria-hidden="true" /></ConversationIconButton>
  </>
}
