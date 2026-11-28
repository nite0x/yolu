import {uiText} from "../i18n"
import {useEffect, useRef, useState, type ComponentProps, type ReactNode} from "react"
import {ChevronDown, Columns2, ListTree, Maximize2, Minimize2, X} from "lucide-react"

export function ConversationKindSwitch({kind, id, uiID, terminalID, cloudID, cloudHidden}: {kind: "ui" | "terminal"; id?: string; uiID?: string; terminalID?: string; cloudID?: string; cloudHidden?: boolean}) {
  // biome-ignore lint/a11y/useSemanticElements: Mode actions navigate between conversation entry points; they are not form fields.
  return <div id={id} className="conversation-kind-switch" role="group" aria-label={uiText("对话形式")}>
    <button id={uiID} type="button" aria-pressed={kind === "ui"}>{uiText("对话")}</button>
    <button id={terminalID} type="button" data-conversation-kind={kind === "ui" ? "terminal" : undefined} aria-pressed={kind === "terminal"}>{uiText("终端")}</button>
    {cloudID && <button id={cloudID} type="button" aria-pressed={false} hidden={cloudHidden}>Codex Cloud</button>}
  </div>
}

export function ConversationCreationIntro({kind, switchID, uiID, switchHidden, cloudID, cloudHidden}: {kind: "ui" | "terminal"; switchID?: string; uiID?: string; switchHidden?: boolean; cloudID?: string; cloudHidden?: boolean}) {
  return <div className="conversation-creation-intro">
    <div id={switchID} hidden={switchHidden}><ConversationKindSwitch kind={kind} uiID={uiID} cloudID={cloudID} cloudHidden={cloudHidden} /></div>
    <h1 className="conversation-welcome-title">{kind === "ui" ? uiText("想完成什么？") : uiText("选择终端工具")}</h1>
  </div>
}

const PANE_DRAG_THRESHOLD = 6

export function ConversationHeader({title, titleID, titleHint, context, actions, children}: {title: ReactNode; titleID: string; titleHint?: string; context?: ReactNode; actions?: ReactNode; children?: ReactNode}) {
  const dragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
    }
  }, [])

  const startHeaderDrag = (downEvent: React.PointerEvent<HTMLElement>) => {
    if (downEvent.button !== 0 || window.parent === window) return
    const root = document.documentElement
    if (
      !root.hasAttribute("data-workspace-pane") ||
      root.hasAttribute("data-workspace-zoomed") ||
      root.hasAttribute("data-workspace-compact")
    ) {
      return
    }
    const target = downEvent.target as HTMLElement
    if (target.closest("button,a,input,select,textarea,summary,details,[role='button'],[role='menuitem'],[contenteditable]")) return

    dragCleanupRef.current?.()
    const captureTarget = downEvent.currentTarget
    const startX = downEvent.clientX
    const startY = downEvent.clientY
    const pointerId = downEvent.pointerId
    let started = false

    const dispatch = (phase: "start" | "move" | "end" | "cancel", clientX?: number, clientY?: number) => {
      window.dispatchEvent(new CustomEvent("workhub:pane-drag", {detail: {phase, clientX, clientY}}))
    }

    const cleanup = () => {
      if (captureTarget.hasPointerCapture?.(pointerId)) {
        captureTarget.releasePointerCapture(pointerId)
      }
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
      document.removeEventListener("pointercancel", onCancel)
      captureTarget.removeEventListener("lostpointercapture", onCancel)
      document.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("blur", onCancel)
      if (dragCleanupRef.current === cancelOnUnmount) {
        dragCleanupRef.current = null
      }
    }

    const cancelOnUnmount = () => {
      cleanup()
      if (started) dispatch("cancel")
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      if (!started) {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) < PANE_DRAG_THRESHOLD) return
        started = true
        try {
          captureTarget.setPointerCapture?.(pointerId)
        } catch {
          /* Pointer capture is optional in synthetic environments. */
        }
        dispatch("start", event.clientX, event.clientY)
      }
      dispatch("move", event.clientX, event.clientY)
    }

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      cleanup()
      if (started) dispatch("end", event.clientX, event.clientY)
    }

    const onCancel = () => {
      cleanup()
      if (started) dispatch("cancel")
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }

    dragCleanupRef.current = cancelOnUnmount
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
    document.addEventListener("pointercancel", onCancel)
    captureTarget.addEventListener("lostpointercapture", onCancel)
    document.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("blur", onCancel)
  }

  return <header className="chat-panel-header conversation-surface-header" data-no-window-drag="" onPointerDown={startHeaderDrag}>
    <div className="chat-panel-toolbar">
      <div className="chat-panel-heading"><h2 id={titleID} tabIndex={-1} className="chat-panel-title" title={titleHint}>{title}</h2>{context && <div className="conversation-header-context">{context}</div>}</div>
      <div className="chat-panel-actions">{actions}</div>
    </div>
    {children}
  </header>
}

// Keep native details semantics and stable DOM for terminal controllers, while
// showing secondary context above the thread without changing header height.
export function ConversationWorkingContext({id, trigger, triggerTitle, header, children}: {id?: string; trigger?: ReactNode; triggerTitle?: string; header?: ReactNode; children: ReactNode}) {
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
  const label = triggerTitle ? `${triggerTitle} · ${uiText("工作详情")}` : uiText("工作详情")
  return <details ref={details} id={id} className="chat-workspace-context">
    <summary className={trigger ? "conversation-context-trigger" : "conversation-icon-button"} aria-label={uiText("工作详情")} title={label}>
      {trigger ? <>
        <span className="conversation-context-summary">{trigger}</span>
        <ChevronDown className="conversation-context-chevron" aria-hidden="true" />
        <ListTree className="conversation-context-fallback-icon" aria-hidden="true" />
      </> : <ListTree aria-hidden="true" />}
    </summary>
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

export function ConversationPaneButtons({
  split, canZoom, zoomed, canSplitRight = true, canSplitDown = true, canSplitLeft = true, canSplitUp = true, canClose = true,
  showSplitControls = false, command, zoomID, closeID, surface = "conversation",
}: {
  split: boolean; canZoom: boolean; zoomed: boolean
  canSplitRight?: boolean; canSplitDown?: boolean; canSplitLeft?: boolean; canSplitUp?: boolean; canClose?: boolean
  showSplitControls?: boolean
  surface?: "conversation" | "pane"
  command?: (command: string) => void; zoomID?: string; closeID?: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const items = () =>
      [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    items()[0]?.focus({preventScroll: true})
    const closeOutside = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setMenuOpen(false)
        triggerRef.current?.focus({preventScroll: true})
        return
      }
      if (event.key === "Tab") { triggerRef.current?.focus({preventScroll: true}); setMenuOpen(false); return }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
      const enabled = items()
      if (!enabled.length) return
      event.preventDefault()
      const idx = enabled.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        event.key === "Home" ? 0
          : event.key === "End" ? enabled.length - 1
            : (idx + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length
      enabled[next]?.focus({preventScroll: true})
    }
    const onBlur = () => setMenuOpen(false)
    document.addEventListener("pointerdown", closeOutside)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("blur", onBlur)
    return () => {
      document.removeEventListener("pointerdown", closeOutside)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("blur", onBlur)
    }
  }, [menuOpen])

  const label = zoomed ? uiText("恢复分栏") : uiText("放大当前面板")
  const buttonClass = surface === "pane" ? "pane-layout-icon-button" : "conversation-icon-button"
  const menuClass = surface === "pane" ? "pane-layout-menu" : "conversation-pane-menu"
  const run = (name: string) => {
    setMenuOpen(false)
    if (menuOpen) triggerRef.current?.focus({preventScroll: true})
    command?.(name)
  }
  const hasAnySplitControl = showSplitControls || split
  return <>
    {surface === "conversation" && <span className="conversation-pane-divider" aria-hidden="true" hidden={!hasAnySplitControl} />}
    {showSplitControls && <div ref={menuRef} className={`${menuClass}-anchor pane-split-control`}>
      <button type="button" className={`${buttonClass} pane-split-primary`} data-pane-action="split-right" disabled={!canSplitRight} aria-label={uiText("分栏")} title={uiText("向右分屏")} onClick={() => run("split-right")}><Columns2 aria-hidden="true" /></button>
      <button ref={triggerRef} type="button" className={`${buttonClass} pane-split-directions`} data-pane-menu-trigger="" aria-haspopup="menu" aria-expanded={menuOpen} aria-label={uiText("分栏方向")} title={uiText("分栏方向")} onClick={() => setMenuOpen(open => !open)} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          setMenuOpen(true)
        }
      }}><ChevronDown aria-hidden="true" /></button>
      {menuOpen && <div className={menuClass} role="menu" aria-label={uiText("分栏方向")}>
        <button type="button" role="menuitem" disabled={!canSplitRight} onClick={() => run("split-right")}>{uiText("向右分屏")}</button>
        <button type="button" role="menuitem" disabled={!canSplitDown} onClick={() => run("split-down")}>{uiText("向下分屏")}</button>
        <button type="button" role="menuitem" disabled={!canSplitLeft} onClick={() => run("split-left")}>{uiText("向左分屏")}</button>
        <button type="button" role="menuitem" disabled={!canSplitUp} onClick={() => run("split-up")}>{uiText("向上分屏")}</button>
      </div>}
    </div>}
    <button type="button" className={buttonClass} id={zoomID} hidden={!split || !canZoom} title={label} aria-label={label} data-zoomed={zoomed} onClick={command ? () => run("zoom") : undefined}>{zoomed ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>
    <button type="button" className={buttonClass} id={closeID} hidden={!split && !showSplitControls || !canClose} title={uiText("关闭面板")} aria-label={uiText("关闭面板")} onClick={command ? () => run("close") : undefined}><X aria-hidden="true" /></button>
  </>
}
