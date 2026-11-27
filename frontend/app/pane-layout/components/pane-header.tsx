import { uiText } from "@/shared/i18n"
import {
  Columns2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Rows2,
  X,
} from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"
import type { SplitPlacement } from "../model/types"
import type { PaneCapabilities } from "../state/selectors"

export interface PaneHeaderProps {
  paneId: string
  title: string
  capabilities: PaneCapabilities
  onSplit: (paneId: string, placement: SplitPlacement) => void
  onToggleMaximize: (paneId: string) => void
  onClose: (paneId: string) => void
  onStartHeaderDrag?: (paneId: string, event: React.PointerEvent<HTMLElement>) => void
}

export const PaneHeader = memo(function PaneHeader({
  paneId,
  title,
  capabilities,
  onSplit,
  onToggleMaximize,
  onClose,
  onStartHeaderDrag,
}: PaneHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const items = () =>
      [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    items()[0]?.focus({ preventScroll: true })
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setMenuOpen(false)
        triggerRef.current?.focus({ preventScroll: true })
        return
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
      const enabled = items()
      if (!enabled.length) return
      event.preventDefault()
      const idx = enabled.indexOf(document.activeElement as HTMLButtonElement)
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? enabled.length - 1
            : (idx + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length
      enabled[next]?.focus({ preventScroll: true })
    }
    const onBlur = () => setMenuOpen(false)
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    window.addEventListener("blur", onBlur)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("blur", onBlur)
    }
  }, [menuOpen])

  const draggable = capabilities.split && !capabilities.zoomed && !!onStartHeaderDrag
  const zoomLabel = capabilities.zoomed ? uiText("恢复分栏") : uiText("放大当前对话")

  return (
    <header
      className="pane-layout-header"
      data-focused={capabilities.focused || undefined}
      data-draggable={draggable || undefined}
      data-no-window-drag=""
      onPointerDown={event => {
        if (!draggable || event.button !== 0) return
        const target = event.target as HTMLElement
        if (target.closest("button,a,input,select,textarea,[role='menu']")) return
        onStartHeaderDrag?.(paneId, event)
      }}
    >
      <h2 className="pane-layout-header-title" title={title}>
        {title}
      </h2>
      <div className="pane-layout-header-actions">
        <button
          type="button"
          className="pane-layout-icon-button pane-layout-split-quick"
          aria-label={uiText("向右分屏")}
          title={uiText("向右分屏")}
          disabled={!capabilities.canSplitRight}
          onClick={() => onSplit(paneId, "right")}
        >
          <Columns2 aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pane-layout-icon-button pane-layout-split-quick-secondary"
          aria-label={uiText("向下分屏")}
          title={uiText("向下分屏")}
          disabled={!capabilities.canSplitDown}
          onClick={() => onSplit(paneId, "down")}
        >
          <Rows2 aria-hidden="true" />
        </button>
        <div className="pane-layout-menu-anchor" ref={menuRef}>
          <button
            ref={triggerRef}
            type="button"
            className="pane-layout-icon-button"
            aria-label={uiText("更多分屏操作")}
            title={uiText("更多分屏操作")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(open => !open)}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="pane-layout-menu" role="menu" aria-label={uiText("分屏操作")}>
              <button
                type="button"
                role="menuitem"
                disabled={!capabilities.canSplitRight}
                onClick={() => {
                  setMenuOpen(false)
                  onSplit(paneId, "right")
                }}
              >
                {uiText("向右分屏")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!capabilities.canSplitDown}
                onClick={() => {
                  setMenuOpen(false)
                  onSplit(paneId, "down")
                }}
              >
                {uiText("向下分屏")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!capabilities.canSplitLeft}
                onClick={() => {
                  setMenuOpen(false)
                  onSplit(paneId, "left")
                }}
              >
                {uiText("向左分屏")}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!capabilities.canSplitUp}
                onClick={() => {
                  setMenuOpen(false)
                  onSplit(paneId, "up")
                }}
              >
                {uiText("向上分屏")}
              </button>
              {capabilities.canZoom && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onToggleMaximize(paneId)
                  }}
                >
                  {zoomLabel}
                </button>
              )}
              {capabilities.canClose && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onClose(paneId)
                  }}
                >
                  {uiText("关闭面板")}
                </button>
              )}
            </div>
          )}
        </div>
        {capabilities.split && capabilities.canZoom && (
          <button
            type="button"
            className="pane-layout-icon-button"
            aria-label={zoomLabel}
            title={zoomLabel}
            data-zoomed={capabilities.zoomed || undefined}
            onClick={() => onToggleMaximize(paneId)}
          >
            {capabilities.zoomed ? (
              <Minimize2 aria-hidden="true" />
            ) : (
              <Maximize2 aria-hidden="true" />
            )}
          </button>
        )}
        {capabilities.split && (
          <button
            type="button"
            className="pane-layout-icon-button"
            aria-label={uiText("关闭面板")}
            title={uiText("关闭面板")}
            onClick={() => onClose(paneId)}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  )
})
