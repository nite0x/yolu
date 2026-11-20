import { uiText } from "./i18n";
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"
import { Copy, X, RotateCw } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Check, Feedback, NativeSelect, Option } from "./workspace/shared"
import { ProjectForm, WorkspaceForm, WorkspaceProjectsForm, WorkspaceEditForm, WorkspaceDirectoryForm, WorktreeForm, GitDialog } from "./workspace/forms"
import { workspaceUI } from "./workspace/renderers"
import { SettingsPage, EnvironmentForm } from "./workspace/settings"
import { SessionPickerDialog, CommandOutputDialog } from "./workspace/sessions"
import { SessionBrowser } from "./workspace/session-browser"
import "./styles.css"
// Load notification CSS only through the browser entry, not Node-rendered components.
import "sonner/dist/styles.css"
import "./workspace/interactions.css"
import { WorkspaceReviewDialog, ChangesDialog } from "./workspace/workspace-review"
import { setupWorkspaceInteractions, mountWorkspaceToaster } from "./workspace/interactions"
import { mountWorkspaceSidebar } from "./workspace/sidebar"
import { setupWorkspacePanels } from "./workspace/resizable"
import { ListCreateButton, ListFilter, ListSearch, ResourceSwitcherTrigger, ResourceSwitcherDialog } from "./workspace/list-controls"

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
mount("searchField", <ListSearch input="search" label={uiText("搜索")} placeholder={uiText("搜索工作区名称、说明…")} clear={{ id:"clearListSearch" }} filter={
  <ListFilter id="workspaceListFilters" label={uiText("筛选")}>
    <div id="archiveFilterWrap" /><div id="workspaceStatusFilterWrap" />
    <div id="projectListFilters" hidden><div id="projectEnvironmentSlot" /><div id="projectListFilterSlot" /></div>
  </ListFilter>
} />)
mount("commandDialog", <CommandDialog />)
mount("toast", <ToastContent />)
mount("workspaceSwitcherTrigger", <ResourceSwitcherTrigger kind="workspace" />)
mount("resourceSwitcher", <ResourceSwitcherDialog />)
mount("newWorkspaceButton", <ListCreateButton id="newButton" showLabel label={uiText("创建工作区")} />)
mount("projectAddButton", <ListCreateButton data-action="new-project" showLabel label={uiText("添加项目")} />)
mount("refreshControl", <Button type="button" id="refreshButton" variant="ghost" size="icon-sm" title={uiText("刷新 Git 状态")} aria-label={uiText("刷新 Git 状态")}><RotateCw aria-hidden="true" /></Button>)
mount("archiveFilterWrap", <Check id="archiveFilter" label={uiText("显示归档")} />)
mount("workspaceStatusFilterWrap", <label className="flex items-center gap-2 text-sm"><span className="sr-only">{uiText("筛选工作目录状态")}</span><NativeSelect id="workspaceStatusFilter" aria-label={uiText("筛选工作目录状态")}><Option value="all">{uiText("全部状态")}</Option><Option value="issues">{uiText("目录异常")}</Option><Option value="dirty">{uiText("有改动")}</Option><Option value="push">{uiText("待推送")}</Option><Option value="conflicts">{uiText("Git 操作待处理")}</Option></NativeSelect></label>)
mount("projectEnvironmentWrap", <label className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><span className="shrink-0 whitespace-nowrap">{uiText("项目环境")}</span><NativeSelect id="projectEnvironment" aria-label={uiText("项目环境")}><Option value="local">{uiText("本机")}</Option></NativeSelect></label>)
mount("offlineFeedback", <Feedback id="offlineBanner" variant="destructive" className="mb-4" hidden />)
mount("projectDialog", <ProjectForm />)
mount("workspaceDialog", <WorkspaceForm />)
mount("workspaceProjectsDialog", <WorkspaceProjectsForm />)
mount("workspaceEditDialog", <WorkspaceEditForm />)
mount("workspaceDirectoryDialog", <WorkspaceDirectoryForm />)
mount("worktreeDialog", <WorktreeForm />)
mount("gitDialog", <GitDialog />)
mount("settingsPage", <SettingsPage />)
mount("environmentDialog", <EnvironmentForm />)
mount("sessionDialog", <SessionPickerDialog />)
mount("sessionCommandOutputDialog", <CommandOutputDialog />)
mount("sessionPageMount", <SessionBrowser />)
mount("workspaceReviewDialog", <WorkspaceReviewDialog />)
mount("changesDialog", <ChangesDialog />)
setupWorkspaceInteractions()
mountWorkspaceToaster()
mountWorkspaceSidebar()
setupWorkspacePanels()
