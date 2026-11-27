import { memo, type ReactNode } from "react"
import type { PaneNode, SplitPlacement } from "../model/types"
import type { PaneCapabilities } from "../state/selectors"
import { EmptyPane, type RecentConversationItem } from "./empty-pane"

export interface PaneContainerProps {
  pane: PaneNode
  capabilities: PaneCapabilities
  isDraggingSource: boolean
  recentConversations: readonly RecentConversationItem[]
  canCreateConversation: boolean
  renderPaneContent?: (pane: PaneNode, capabilities: PaneCapabilities) => ReactNode
  onCreateConversation: (paneId: string, context?: Extract<PaneNode["content"], { type: "empty" }>["context"]) => void
  onPickConversation: (paneId: string, trigger?: HTMLButtonElement) => void
  onOpenRecentConversation: (paneId: string, item: RecentConversationItem) => void
  onSplit: (paneId: string, placement: SplitPlacement) => void
  onToggleMaximize: (paneId: string) => void
  onClose: (paneId: string) => void
  onFocus: (paneId: string) => void
  onStartHeaderDrag?: (paneId: string, event: React.PointerEvent<HTMLElement>) => void
}

export const PaneContainer = memo(function PaneContainer({
  pane,
  capabilities,
  isDraggingSource,
  recentConversations,
  canCreateConversation,
  renderPaneContent,
  onCreateConversation,
  onPickConversation,
  onOpenRecentConversation,
  onSplit,
  onToggleMaximize,
  onClose,
  onFocus,
  onStartHeaderDrag,
}: PaneContainerProps) {
  const isEmpty = pane.content.type === "empty"
  const customContent = !isEmpty && renderPaneContent ? renderPaneContent(pane, capabilities) : null

  return (
    <div
      className="pane-layout-pane"
      data-pane-id={pane.id}
      data-pane-type={pane.content.type}
      data-focused={capabilities.focused || undefined}
      data-dragging={isDraggingSource || undefined}
      data-passthrough={!isEmpty && !customContent ? "" : undefined}
    >
      {isEmpty ? (
        <EmptyPane
          paneId={pane.id}
          context={pane.content.type === "empty" ? pane.content.context : undefined}
          capabilities={capabilities}
          recentConversations={recentConversations}
          canCreateConversation={canCreateConversation}
          onCreateConversation={onCreateConversation}
          onPickConversation={onPickConversation}
          onOpenRecentConversation={onOpenRecentConversation}
          onSplit={onSplit}
          onToggleMaximize={onToggleMaximize}
          onClose={onClose}
          onFocus={onFocus}
          onStartHeaderDrag={onStartHeaderDrag}
        />
      ) : (
        customContent
      )}
    </div>
  )
})
