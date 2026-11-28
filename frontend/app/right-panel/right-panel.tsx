import { useCallback, useMemo } from "react"
import { Files, Folder, GitCompareArrows, PanelRightClose, X } from "lucide-react"
import { createAPIClient } from "@/core/api-client"
import { createRequestCache } from "@/core/request-cache"
import { FileBrowser } from "@/features/files/ui/browser"
import { uiText } from "@/shared/i18n"
import { RenderBoundary } from "@/shared/ui/feedback/render-boundary"
import { FileTypeIcon } from "@/shared/ui/file-type-icon"
import type { RightPanelState, RightPanelTab } from "./types"

const reads = createRequestCache((path, options) => fetch(path, options))

function leafDir(cwd: string): string {
  const clean = cwd.replace(/\\/g, "/").replace(/\/+$/, "")
  return clean.split("/").pop() || clean
}

function disambiguationHint(tab: RightPanelTab): string {
  const dir = leafDir(tab.cwd)
  if (tab.environment && tab.environment !== "local") {
    return `${tab.environment}/${dir}`
  }
  return dir
}

export interface RightPanelProps {
  state: RightPanelState
  overlay?: boolean
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onCloseAllTabs: () => void
  onSelectFile: (tabId: string, path: string, mode: string) => void
  onCollapse: () => void
}

function RightTabContent({
  tab,
  onSelectFile,
}: {
  tab: RightPanelTab
  onSelectFile: (tabId: string, path: string, mode: string) => void
}) {
  const request = useMemo(
    () =>
      createAPIClient({
        token: document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || "",
        context: () => ({ environment: "local", revision: 0 }),
        read: reads.read,
        text: uiText,
      }),
    [],
  )

  const reference = useMemo(
    () =>
      tab.path
        ? {
            path: tab.path,
            line: tab.line,
            version: tab.version ?? 1,
            mode: tab.mode === "working" || tab.mode === "index" ? tab.mode : undefined,
          }
        : undefined,
    [tab.path, tab.line, tab.version, tab.mode],
  )

  const handleSelect = useCallback(
    (path: string, mode: string) => onSelectFile(tab.id, path, mode),
    [tab.id, onSelectFile],
  )

  return (
    <div className="right-panel-body">
      <RenderBoundary
        key={JSON.stringify([
          tab.id,
          tab.environment,
          tab.projectId,
          tab.sessionId,
          tab.bindingId,
          tab.cwd,
        ])}
      >
        <FileBrowser
          key={JSON.stringify([
            tab.id,
            tab.environment,
            tab.projectId,
            tab.sessionId,
            tab.bindingId,
            tab.cwd,
          ])}
          project={tab.projectId}
          session={tab.sessionId}
          binding={tab.bindingId}
          git={tab.git}
          path={tab.cwd}
          environment={tab.environment}
          request={request}
          idPrefix={`right-tab-${tab.id}`}
          initialMode={tab.mode || "all"}
          reference={reference}
          onSelectFile={handleSelect}
        />
      </RenderBoundary>
    </div>
  )
}

export function RightPanel({
  state,
  overlay = false,
  onActivateTab,
  onCloseTab,
  onCloseAllTabs,
  onSelectFile,
  onCollapse,
}: RightPanelProps) {
  if (!state.open) return null

  const titleCounts = new Map<string, number>()
  for (const tab of state.tabs) {
    titleCounts.set(tab.title, (titleCounts.get(tab.title) ?? 0) + 1)
  }

  const activeTab =
    state.tabs.find(tab => tab.id === state.activeTabId) ?? state.tabs[0] ?? null

  return (
    <aside
      className="workspace-right-panel-inner shadcn-scope"
      aria-label={uiText("文件与预览标签页")}
      data-overlay={overlay || undefined}
    >
      <header className="right-panel-header">
        <div
          className="right-panel-tabs"
          role="tablist"
          aria-label={uiText("已打开的文件标签")}
        >
          {state.tabs.map(tab => {
            const active = activeTab?.id === tab.id
            const duplicate = (titleCounts.get(tab.title) ?? 0) > 1
            const suffix = duplicate ? disambiguationHint(tab) : ""
            const tooltip = [
              tab.title,
              tab.path || tab.cwd,
              tab.path ? tab.cwd : "",
              tab.environment !== "local" ? tab.environment : "",
              tab.mode === "working"
                ? uiText("未暂存改动")
                : tab.mode === "index"
                  ? uiText("暂存区改动")
                  : "",
            ]
              .filter(Boolean)
              .join("\n")

            return (
              <div
                key={tab.id}
                className="right-panel-tab"
                data-active={active || undefined}
                data-tab-id={tab.id}
              >
                <button
                  type="button"
                  role="tab"
                  className="right-panel-tab-trigger"
                  aria-selected={active}
                  title={tooltip}
                  onMouseDown={event => {
                    if (event.button === 1) {
                      event.preventDefault()
                      onCloseTab(tab.id)
                    }
                  }}
                  onClick={() => onActivateTab(tab.id)}
                >
                  <span className="right-panel-tab-icon" aria-hidden="true">
                    {tab.path ? (
                      <FileTypeIcon path={tab.path} />
                    ) : tab.mode === "working" || tab.mode === "index" ? (
                      <GitCompareArrows />
                    ) : (
                      <Folder />
                    )}
                  </span>
                  <span className="right-panel-tab-title">{tab.title}</span>
                  {suffix && <span className="right-panel-tab-context">{suffix}</span>}
                  {(tab.mode === "working" || tab.mode === "index") && tab.path && (
                    <span className="right-panel-tab-diff-dot" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className="right-panel-tab-close"
                  aria-label={uiText("关闭标签页：{0}", tab.title)}
                  title={uiText("关闭标签页")}
                  onClick={event => {
                    event.stopPropagation()
                    onCloseTab(tab.id)
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            )
          })}
          {state.tabs.length === 0 && (
            <span className="right-panel-header-empty-label">
              <Files aria-hidden="true" />
              <span>{uiText("文件预览")}</span>
            </span>
          )}
        </div>
        <div className="right-panel-controls">
          {state.tabs.length > 1 && (
            <button
              type="button"
              className="right-panel-icon-button"
              aria-label={uiText("关闭全部标签页")}
              title={uiText("关闭全部标签页")}
              onClick={onCloseAllTabs}
            >
              <X aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="right-panel-icon-button"
            aria-label={uiText("收起右侧面板")}
            title={uiText("收起右侧面板")}
            onClick={onCollapse}
          >
            <PanelRightClose aria-hidden="true" />
          </button>
        </div>
      </header>
      {activeTab ? (
        <RightTabContent tab={activeTab} onSelectFile={onSelectFile} />
      ) : (
        <div className="right-panel-empty" role="status">
          <Files aria-hidden="true" />
          <strong>{uiText("暂无打开的标签页")}</strong>
          <p>{uiText("在任意对话中点击文件链接或文件按钮，即可在此独立打开并切换多个标签页。")}</p>
        </div>
      )}
    </aside>
  )
}
