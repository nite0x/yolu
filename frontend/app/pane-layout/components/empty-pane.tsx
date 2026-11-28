import { uiText } from "@/shared/i18n"
import { FileSearch, FolderGit2, MessageSquare, Search, SquarePen, X } from "lucide-react"
import { memo } from "react"
import type { PaneContextHint, SplitPlacement } from "../model/types"
import type { PaneCapabilities } from "../state/selectors"
import { PaneHeader } from "./pane-header"

export interface RecentConversationItem {
  id: string
  title: string
  environment: string
  detail?: string
}

export interface EmptyPaneProps {
  paneId: string
  context?: PaneContextHint
  capabilities: PaneCapabilities
  recentConversations: readonly RecentConversationItem[]
  canCreateConversation: boolean
  onCreateConversation: (paneId: string, context?: PaneContextHint) => void
  onPickConversation: (paneId: string, trigger?: HTMLButtonElement) => void
  onPickResource?: (paneId: string, kind: "file" | "project", trigger?: HTMLButtonElement) => void
  onOpenRecentConversation: (paneId: string, item: RecentConversationItem) => void
  onSplit: (paneId: string, placement: SplitPlacement) => void
  onToggleMaximize: (paneId: string) => void
  onClose: (paneId: string) => void
  onFocus: (paneId: string) => void
  onStartHeaderDrag?: (paneId: string, event: React.PointerEvent<HTMLElement>) => void
}

export const EmptyPane = memo(function EmptyPane({
  paneId,
  context,
  capabilities,
  recentConversations,
  canCreateConversation,
  onCreateConversation,
  onPickConversation,
  onPickResource,
  onOpenRecentConversation,
  onSplit,
  onToggleMaximize,
  onClose,
  onFocus,
  onStartHeaderDrag,
}: EmptyPaneProps) {
  const recent = recentConversations.slice(0, 5)

  return (
    <section
      className="pane-layout-empty"
      aria-label={uiText("打开内容")}
      onPointerDown={() => onFocus(paneId)}
      onFocus={() => onFocus(paneId)}
    >
      <PaneHeader
        paneId={paneId}
        title={uiText("打开内容")}
        capabilities={capabilities}
        onSplit={onSplit}
        onToggleMaximize={onToggleMaximize}
        onClose={onClose}
        onStartHeaderDrag={onStartHeaderDrag}
      />
      <div className="pane-layout-empty-body">
        <div className="pane-layout-empty-inner">
          <p className="pane-layout-empty-hint">
            {uiText("开始对话，浏览文件，或查看项目详情。")}
          </p>
          <div className="pane-layout-empty-actions">
            <button
              type="button"
              className="pane-layout-empty-primary"
              disabled={!canCreateConversation}
              onClick={() => onCreateConversation(paneId, context)}
            >
              <SquarePen aria-hidden="true" />
              <span>{uiText("新建对话")}</span>
            </button>
            <button
              type="button"
              className="pane-layout-empty-secondary"
              onClick={event => onPickConversation(paneId, event.currentTarget)}
            >
              <Search aria-hidden="true" />
              <span>{uiText("打开已有对话")}</span>
            </button>
            {onPickResource && <>
              <button type="button" className="pane-layout-empty-secondary" onClick={event => onPickResource(paneId, "file", event.currentTarget)}>
                <FileSearch aria-hidden="true" /><span>{uiText("浏览文件")}</span>
              </button>
              <button type="button" className="pane-layout-empty-secondary" onClick={event => onPickResource(paneId, "project", event.currentTarget)}>
                <FolderGit2 aria-hidden="true" /><span>{uiText("项目详情")}</span>
              </button>
            </>}
            {capabilities.split && (
              <button
                type="button"
                className="pane-layout-empty-cancel"
                onClick={() => onClose(paneId)}
              >
                <X aria-hidden="true" />
                <span>{uiText("取消分屏")}</span>
              </button>
            )}
          </div>
          {recent.length > 0 && (
            <div className="pane-layout-empty-recent">
              <h3 className="pane-layout-empty-recent-title">{uiText("最近对话")}</h3>
              <ul className="pane-layout-empty-recent-list">
                {recent.map(item => (
                  <li key={`${item.environment}:${item.id}`}>
                    <button
                      type="button"
                      className="pane-layout-empty-recent-item"
                      onClick={() => onOpenRecentConversation(paneId, item)}
                      title={[item.title, item.detail].filter(Boolean).join("\n")}
                    >
                      <MessageSquare aria-hidden="true" />
                      <span className="pane-layout-empty-recent-text">
                        <strong>{item.title}</strong>
                        {item.detail && <small>{item.detail}</small>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  )
})
