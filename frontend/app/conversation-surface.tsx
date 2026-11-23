import { uiText } from "../i18n";
import {useEffect, useRef, type ComponentProps, type ReactNode} from "react"
import {ListTree, Maximize2, Minimize2, X} from "lucide-react"

export function ConversationKindSwitch({kind, id, uiID, terminalID}: {kind: "ui" | "terminal"; id?: string; uiID?: string; terminalID?: string}) {
  return <div id={id} className="conversation-kind-switch" role="group" aria-label={uiText("对话形式")}>
    <button id={uiID} type="button" aria-pressed={kind === "ui"}>{uiText("对话")}</button>
    <button id={terminalID} type="button" data-conversation-kind={kind === "ui" ? "terminal" : undefined} aria-pressed={kind === "terminal"}>{uiText("终端")}</button>
  </div>
}

export function ConversationHeader({title, titleID, titleHint, context, actions, children}: {title: ReactNode; titleID: string; titleHint?: string; context?: ReactNode; actions?: ReactNode; children?: ReactNode}) {
  return <header className="chat-panel-header conversation-surface-header">
    <div className="chat-panel-toolbar">
      <div className="chat-panel-heading"><h2 id={titleID} tabIndex={-1} className="chat-panel-title" title={titleHint}>{title}</h2>{context && <div className="conversation-header-context">{context}</div>}</div>
      <div className="chat-panel-actions"><span className="conversation-active-indicator" aria-label={uiText("当前对话栏")}>{uiText("当前")}</span>{actions}</div>
    </div>
    {children}
  </header>
}

// Keep native details semantics and stable DOM for terminal controllers, while
// showing secondary context above the thread without changing header height.
export function ConversationWorkingContext({id, header, children}: {id?: string; header?: ReactNode; children: ReactNode}) {
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const inDialog = (event: Event) => event.target instanceof Element && event.target.closest("dialog[open]")
    const closeOutside = (event: PointerEvent) => {
      if (details.current?.open && !event.composedPath().includes(details.current) && !inDialog(event)) details.current.open = false
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !details.current?.open || inDialog(event)) return
      event.preventDefault()
      details.current.open = false
      details.current.querySelector<HTMLElement>(":scope > summary")?.focus()
    }
    document.addEventListener("pointerdown", closeOutside)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOutside)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [])
  return <details ref={details} id={id} className="chat-workspace-context">
    <summary className="conversation-icon-button" aria-label={uiText("工作详情")} title={uiText("工作详情")}><ListTree aria-hidden="true" /></summary>
    <section className="conversation-context-popover" aria-label={uiText("工作详情")}>
      <div className="conversation-context-popover-heading">
        <div className="conversation-context-popover-header">{header ?? <strong>{uiText("工作详情")}</strong>}</div>
        <ConversationIconButton label={uiText("关闭工作详情")} onClick={() => {if (details.current) details.current.open = false; details.current?.querySelector<HTMLElement>(":scope > summary")?.focus()}}><X aria-hidden="true" /></ConversationIconButton>
      </div>
      {children}
    </section>
  </details>
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
