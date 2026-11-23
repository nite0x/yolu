import { uiText } from "./i18n";
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import { Copy, X, RotateCw } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Feedback, NativeSelect, Option } from "./app/shared"
import { ProjectForm, WorktreeForm, GitDialog } from "./app/forms"
import { workspaceUI } from "./app/renderers"
import { SettingsPage, EnvironmentForm, setupSettingsNavigation } from "./app/settings"
import { CommandOutputDialog } from "./app/sessions"
import { SessionBrowser } from "./app/session-browser"
import "./styles.css"
// Load notification CSS only through the browser entry, not Node-rendered components.
import "sonner/dist/styles.css"
import { ChangesDialog } from "./app/changes"
import "./app/interactions.css"
import { setupWorkspaceInteractions, mountWorkspaceToaster } from "./app/interactions"
import { mountWorkspaceSidebar } from "./app/sidebar"
import { setupWorkspacePanels } from "./app/resizable"
import { ListCreateButton, ListFilter, ListSearch, ResourceSwitcherTrigger, ResourceSwitcherDialog } from "./app/list-controls"

function CommandDialog() {
  return (
    <>
      <div className="dialog-header">
        <div>
          <h2 id="commandTitle" className="text-xl font-semibold">{uiText("终端命令")}</h2>
        </div>
        <Button type="button" variant="ghost" size="icon" className="close-dialog shrink-0" aria-label={uiText("关闭")}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <p id="commandDescription" className="dialog-description">{uiText("在当前执行环境的终端执行以下命令；Windows 本机使用 PowerShell。")}</p>
      <Textarea id="commandText" rows={7} readOnly aria-label={uiText("终端命令")} className="min-h-44 resize-y bg-muted p-3 font-mono text-sm leading-relaxed" />
      <div className="dialog-footer">
        <Button type="button" variant="outline" className="close-dialog">{uiText("关闭")}</Button>
        <Button type="button" id="copyCommand"><Copy aria-hidden="true" />{uiText("复制命令")}</Button>
      </div>
    </>
  )
}

function ToastContent() {
  return <Alert role="presentation" className="border-0 bg-transparent p-0 text-inherit"><AlertDescription id="toastMessage" className="whitespace-pre-wrap text-inherit" /></Alert>
}

// Mount the static form boundaries before deferred controllers attach listeners.
// Interactive islands below keep their own roots and bridge native controls.
function mount(id: string, content: ReactNode) {
  const container = document.getElementById(id)
  if (!container) throw new Error(`Missing UI mount: ${id}`)
  container.innerHTML = renderToStaticMarkup(content)
}

window.WorkHubUI = workspaceUI
mount("searchField", <ListSearch input="search" label={uiText("搜索")} placeholder={uiText("搜索项目名称、目录…")} clear={{ id:"clearListSearch" }} filter={
  <ListFilter id="projectFilters" label={uiText("筛选")}>
    <div><div id="projectEnvironmentSlot" /><div id="projectListFilterSlot" /></div>
  </ListFilter>
} />)
mount("commandDialog", <CommandDialog />)
mount("toast", <ToastContent />)
mount("resourceSwitcher", <ResourceSwitcherDialog />)
mount("projectAddButton", <ListCreateButton data-action="new-project" showLabel label={uiText("添加项目")} />)
mount("refreshControl", <Button type="button" id="refreshButton" variant="ghost" size="icon-sm" title={uiText("刷新 Git 状态")} aria-label={uiText("刷新 Git 状态")}><RotateCw aria-hidden="true" /></Button>)
mount("projectEnvironmentWrap", <label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><span className="shrink-0 whitespace-nowrap">{uiText("项目环境")}</span><NativeSelect id="projectEnvironment" aria-label={uiText("项目环境")}><Option value="local">{uiText("本机")}</Option></NativeSelect></label>)
mount("offlineFeedback", <Feedback id="offlineBanner" variant="destructive" className="mb-4" hidden />)
mount("projectDialog", <ProjectForm />)
mount("worktreeDialog", <WorktreeForm />)
mount("gitDialog", <GitDialog />)
mount("settingsPage", <SettingsPage />)
setupSettingsNavigation()
mount("environmentDialog", <EnvironmentForm />)
mount("sessionCommandOutputDialog", <CommandOutputDialog />)
mount("sessionPageMount", <SessionBrowser />)
mount("changesDialog", <ChangesDialog />)
setupWorkspaceInteractions()
mountWorkspaceToaster()
mountWorkspaceSidebar()
setupWorkspacePanels()
