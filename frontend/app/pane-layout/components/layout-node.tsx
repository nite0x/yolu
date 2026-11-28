import { memo, type ReactNode } from "react"
import type {
  LayoutConstraints,
  LayoutNode,
  PaneLayout,
  PaneNode,
  SplitPlacement,
  ViewportSize,
} from "../model/types"
import type { PaneInteractionState } from "../state/layout-store"
import { getPaneCapabilities, type PaneCapabilities } from "../state/selectors"
import type { RecentConversationItem } from "./empty-pane"
import { PaneContainer } from "./pane-container"
import { SplitContainer } from "./split-container"

export interface LayoutNodeViewProps {
  node: LayoutNode
  layout: PaneLayout
  interaction: PaneInteractionState
  viewport: ViewportSize
  container: HTMLElement | null
  constraints: LayoutConstraints
  recentConversations: readonly RecentConversationItem[]
  canCreateConversation: boolean
  renderPaneContent?: (pane: PaneNode, capabilities: PaneCapabilities) => ReactNode
  onCreateConversation: (
    paneId: string,
    context?: Extract<PaneNode["content"], { type: "empty" }>["context"],
  ) => void
  onPickConversation: (paneId: string, trigger?: HTMLButtonElement) => void
  onPickResource?: (paneId: string, kind: "file" | "project", trigger?: HTMLButtonElement) => void
  onSelectFile?: (paneId: string, path: string, mode: string) => void
  onOpenRecentConversation: (paneId: string, item: RecentConversationItem) => void
  onSplit: (paneId: string, placement: SplitPlacement) => void
  onToggleMaximize: (paneId: string) => void
  onClose: (paneId: string) => void
  onFocus: (paneId: string) => void
  onResizeStart: (splitId: string) => void
  onResize: (splitId: string, ratio: number) => void
  onResizeCommit: (splitId: string) => void
  onResetRatio: (splitId: string) => void
  onStartHeaderDrag?: (paneId: string, event: React.PointerEvent<HTMLElement>) => void
}

export const LayoutNodeView = memo(function LayoutNodeView(props: LayoutNodeViewProps) {
  const { node } = props
  if (node.type === "pane") {
    const capabilities = getPaneCapabilities(
      props.layout,
      props.interaction,
      node.id,
      props.viewport,
      props.constraints,
    )
    return (
      <PaneContainer
        pane={node}
        capabilities={capabilities}
        isDraggingSource={props.interaction.draggingPaneId === node.id}
        recentConversations={props.recentConversations}
        canCreateConversation={props.canCreateConversation}
        renderPaneContent={props.renderPaneContent}
        onCreateConversation={props.onCreateConversation}
        onPickConversation={props.onPickConversation}
            onPickResource={props.onPickResource}
            onSelectFile={props.onSelectFile}
        onOpenRecentConversation={props.onOpenRecentConversation}
        onSplit={props.onSplit}
        onToggleMaximize={props.onToggleMaximize}
        onClose={props.onClose}
        onFocus={props.onFocus}
        onStartHeaderDrag={props.onStartHeaderDrag}
      />
    )
  }

  return (
    <SplitContainer
      node={node}
      root={props.layout.root}
      container={props.container}
      constraints={props.constraints}
      resizingSplitId={props.interaction.resizingSplitId}
      onResizeStart={props.onResizeStart}
      onResize={props.onResize}
      onResizeCommit={props.onResizeCommit}
      onResetRatio={props.onResetRatio}
      first={<LayoutNodeView {...props} node={node.children[0]} />}
      second={<LayoutNodeView {...props} node={node.children[1]} />}
    />
  )
})
