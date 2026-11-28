import { memo } from "react"
import { ConversationPaneButtons } from "@/shared/ui/conversation-surface"
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
  const draggable = capabilities.split && !capabilities.zoomed && !!onStartHeaderDrag

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
        <ConversationPaneButtons
          surface="pane"
          split={capabilities.split}
          canZoom={capabilities.canZoom}
          zoomed={capabilities.zoomed}
          canSplitRight={capabilities.canSplitRight}
          canSplitDown={capabilities.canSplitDown}
          canSplitLeft={capabilities.canSplitLeft}
          canSplitUp={capabilities.canSplitUp}
          canClose={capabilities.canClose}
          showSplitControls
          command={command => {
            if (command === "zoom") onToggleMaximize(paneId)
            else if (command === "close") onClose(paneId)
            else if (command === "split-right") onSplit(paneId, "right")
            else if (command === "split-down") onSplit(paneId, "down")
            else if (command === "split-left") onSplit(paneId, "left")
            else if (command === "split-up") onSplit(paneId, "up")
          }}
        />
      </div>
    </header>
  )
})
