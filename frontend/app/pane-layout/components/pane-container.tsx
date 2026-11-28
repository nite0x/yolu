import { memo, type ReactNode } from "react"
import type { PaneNode, SplitPlacement } from "../model/types"
import type { PaneCapabilities } from "../state/selectors"
import { EmptyPane, type RecentConversationItem } from "./empty-pane"
import { PaneHeader } from "./pane-header"
import { ResourcePane } from "./resource-pane"
import { uiText } from "@/shared/i18n"
import { RenderBoundary } from "@/shared/ui/feedback/render-boundary"

export interface PaneContainerProps {
  pane: PaneNode
  capabilities: PaneCapabilities
  isDraggingSource: boolean
  recentConversations: readonly RecentConversationItem[]
  canCreateConversation: boolean
  renderPaneContent?: (pane: PaneNode, capabilities: PaneCapabilities) => ReactNode
  onCreateConversation: (paneId: string, context?: Extract<PaneNode["content"], { type: "empty" }>["context"]) => void
  onPickConversation: (paneId: string, trigger?: HTMLButtonElement) => void
  onPickResource?: (paneId: string, kind: "file" | "project", trigger?: HTMLButtonElement) => void
  onSelectFile?: (paneId: string, path: string, mode: string) => void
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
  onPickResource,
  onSelectFile,
  onOpenRecentConversation,
  onSplit,
  onToggleMaximize,
  onClose,
  onFocus,
  onStartHeaderDrag,
}: PaneContainerProps) {
  const isEmpty = pane.content.type === "empty"
  const resource = pane.content.type === "file" || pane.content.type === "project" ? pane.content : null
  const customContent = !isEmpty && renderPaneContent ? renderPaneContent(pane, capabilities) : null

  return (
    <div
      className="pane-layout-pane"
      data-pane-id={pane.id}
      data-pane-type={pane.content.type}
      data-focused={capabilities.focused || undefined}
      data-dragging={isDraggingSource || undefined}
      data-passthrough={pane.content.type === "project" || !isEmpty && !resource && !customContent ? "" : undefined}
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
          onPickResource={onPickResource}
          onOpenRecentConversation={onOpenRecentConversation}
          onSplit={onSplit}
          onToggleMaximize={onToggleMaximize}
          onClose={onClose}
          onFocus={onFocus}
          onStartHeaderDrag={onStartHeaderDrag}
        />
      ) : (
        customContent || (resource && <section className="pane-layout-resource" aria-label={resource.title || uiText(resource.type === "file" ? "文件预览" : "项目详情")} data-resource-type={resource.type}
          onPointerDown={() => onFocus(pane.id)} onFocus={() => onFocus(pane.id)}>
          <PaneHeader paneId={pane.id} title={resource.title || uiText(resource.type === "file" ? "文件预览" : "项目详情")}
            capabilities={capabilities} onSplit={onSplit} onToggleMaximize={onToggleMaximize} onClose={onClose} onStartHeaderDrag={onStartHeaderDrag} />
          <RenderBoundary key={JSON.stringify([resource.type, resource.environment, resource.type === "project" ? resource.route : [resource.cwd, resource.sessionId, resource.bindingId]])}>
            <ResourcePane paneId={pane.id} content={resource} onSelectFile={onSelectFile} />
          </RenderBoundary>
        </section>)
      )}
    </div>
  )
})
