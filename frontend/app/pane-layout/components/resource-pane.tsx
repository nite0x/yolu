import { useCallback, useMemo } from "react"
import { createAPIClient } from "@/core/api-client"
import { createRequestCache } from "@/core/request-cache"
import { FileBrowser } from "@/features/files/ui/browser"
import { uiText } from "@/shared/i18n"
import type { ResourcePaneContent } from "../model/content"

const reads = createRequestCache((path, options) => fetch(path, options))

export function ResourcePane({ paneId, content, onSelectFile }: {
  paneId: string
  content: ResourcePaneContent
  onSelectFile?: (paneId: string, path: string, mode: string) => void
}) {
  const request = useMemo(() => createAPIClient({
    token: document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || "",
    context: () => ({environment: "local", revision: 0}),
    read: reads.read,
    text: uiText,
  }), [])
  const path = content.type === "file" ? content.path : undefined
  const line = content.type === "file" ? content.line : undefined
  const mode = content.type === "file" ? content.mode : undefined
  const reference = useMemo(() => path ? {path, line, version: 0, mode: mode === "working" || mode === "index" ? mode : undefined} : undefined, [path, line, mode])
  const selectFile = useCallback((file: string, selectedMode: string) => onSelectFile?.(paneId, file, selectedMode), [paneId, onSelectFile])
  if (content.type !== "file") return null
  return <div className="pane-layout-resource-body">
    <FileBrowser
      key={JSON.stringify([content.environment, content.projectId, content.sessionId, content.bindingId, content.cwd])}
      project={content.projectId} session={content.sessionId} binding={content.bindingId}
      git={content.git} path={content.cwd} environment={content.environment}
      request={request} idPrefix={`pane-${paneId}`} initialMode={content.mode || "all"}
      reference={reference} onSelectFile={selectFile}
    />
  </div>
}
