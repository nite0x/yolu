import {GitDialog} from "@/features/git/ui/dialog"
import {uiText} from "@/shared/i18n"
import {renderToStaticMarkup} from "react-dom/server"
import type {ReactNode} from "react"
import {RotateCw} from "lucide-react"
import {Button} from "@/shared/ui/primitives/button"
import {Feedback} from "@/shared/ui/feedback/message"
import {NativeSelect, NativeSelectOption as Option} from "@/shared/ui/primitives/native-select"
import {ProjectForm, WorktreeForm} from "@/features/projects/ui/forms"
import {workspaceUI} from "@/app/bridge/workspace-ui"
import {SettingsPage} from "@/features/settings/ui/settings"
import {EnvironmentForm} from "@/features/settings/ui/forms"
import {setupSettingsNavigation} from "@/features/settings/ui/navigation"
import {CommandOutputDialog} from "@/features/conversations/list/sessions"
import {SessionBrowser} from "@/features/conversations/list/browser"
import "@/app/styles/workspace.css"
// Load notification CSS only through the browser entry, not Node-rendered components.
import "sonner/dist/styles.css"
import {ChangesDialog} from "@/features/files/ui/changes"
import "@/app/styles/interactions.css"
import {setupWorkspaceInteractions, mountWorkspaceToaster} from "@/app/interactions"
import {mountWorkspaceSidebar} from "@/app/shell/sidebar"
import {setupWorkspacePanels} from "@/app/shell/resizable"
import {ListCreateButton, ListFilter, ListSearch, ResourceSwitcherDialog} from "@/shared/ui/list-controls"

import {CommandDialog, ToastContent} from "../shell/dialogs"

export function mountWorkspace(document: Document) {
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
  mount("projectEnvironmentWrap", <label htmlFor="projectEnvironment" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><span className="shrink-0 whitespace-nowrap">{uiText("项目环境")}</span><NativeSelect id="projectEnvironment" aria-label={uiText("项目环境")}><Option value="local">{uiText("本机")}</Option></NativeSelect></label>)
  mount("offlineFeedback", <Feedback id="offlineBanner" tone="error" className="mb-4" hidden />)
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

}
