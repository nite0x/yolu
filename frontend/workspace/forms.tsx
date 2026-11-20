import { uiText } from "../i18n";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Action, Feedback, Field, ModalFooter, ModalHeader, NativeSelect, Option, Preview } from "./shared"
import "./workspace-forms.css"

function PickerSearch({ id, label = uiText("搜索项目名称或路径") }: { id: string; label?: string }) {
  return <div className="workspace-picker-search"><label className="sr-only" htmlFor={`${id}Search`}>{label}</label><Input id={`${id}Search`} type="search" placeholder={label} data-picker-search={id} aria-controls={id} autoComplete="off" /><p id={`${id}Count`} data-picker-count={id} className="workspace-picker-count" role="status" aria-live="polite" /></div>
}

export function ProjectForm() {
  return <form id="projectForm" className="workspace-dialog-form"><ModalHeader id="projectDialogTitle" title={uiText("添加项目")} /><div className="workspace-dialog-scroll"><p className="dialog-description">{uiText("登记已有 Git 仓库、批量扫描目录，或从 Git 克隆。")}</p>
    <Field id="projectSource" label={uiText("添加方式")}><NativeSelect id="projectSource" defaultValue="local"><Option value="local">{uiText("登记本地仓库")}</Option><Option value="clone">{uiText("从 Git 克隆")}</Option><Option value="scan">{uiText("扫描目录并批量添加")}</Option></NativeSelect></Field>
    <Field id="projectEnvironmentSelect" label={uiText("项目所在环境")} help={uiText("仓库路径和 Git 操作均在此环境中执行。")}><NativeSelect id="projectEnvironmentSelect" required /></Field>
    <div id="projectCloneFields" hidden>
      <Field id="projectCloneURL" label={uiText("Git 仓库地址")} required help={uiText("支持 HTTPS 和 SSH，使用所选环境已有的 Git 凭证或 SSH 密钥。")}><Input id="projectCloneURL" disabled autoComplete="off" placeholder="https://github.com/owner/repo.git" /></Field>
      <Field id="projectCloneDirectory" label={uiText("新文件夹名")} required help={uiText("在存放目录下新建此文件夹；已有目录不会被覆盖。")}><Input id="projectCloneDirectory" disabled autoComplete="off" placeholder="repo" /></Field>
      <p className="dialog-description">{uiText("克隆失败时会保留剩余文件。若克隆完成但登记失败，可切换到登记本地仓库后重试。")}</p>
    </div>
    <Field id="projectPath" label={uiText("仓库目录")} required help={uiText("选择本机 Git 仓库主目录，或填写项目所在环境中的绝对路径。")}><div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1 basis-60" id="projectPath" name="path" required autoComplete="off" placeholder={uiText("填写仓库主目录的绝对路径")} /><Button type="button" variant="outline" id="chooseProjectDirectory">{uiText("选择文件夹…")}</Button></div><small id="projectDirectoryHint" className="text-xs text-muted-foreground" hidden>{uiText("WSL 项目请手动填写 Linux 绝对路径，例如 /home/用户名/projects/app。")}</small></Field>
    <div id="projectNameField"><Field id="projectName" label={uiText("项目名称")} help={uiText("名称会用于工作区中的项目目录，建议使用简短、可辨识的名称。")}><Input id="projectName" name="name" maxLength={80} placeholder={uiText("留空则使用仓库目录名")} /></Field></div>
    <section id="projectScanResults" aria-live="polite" aria-label={uiText("发现的仓库")} hidden />
    <Feedback id="projectError" variant="destructive" hidden /></div>
    <ModalFooter><Button type="button" variant="outline" id="projectRescan" hidden>{uiText("重新扫描")}</Button><Button type="submit" id="projectSubmit">{uiText("添加并扫描")}</Button></ModalFooter>
  </form>
}

export function WorkspaceForm() {
  return <form id="workspaceForm" className="workspace-dialog-form"><ModalHeader id="workspaceDialogTitle" title={uiText("创建工作区")} /><div className="workspace-dialog-scroll"><div id="workspaceInputs" className="workspace-creation-inputs"><p className="dialog-description">{uiText("填写开发目标并选择项目；每个项目的目录与分支可单独配置。")}</p>
    <Field id="workspaceEnvironment" label={uiText("工作区执行环境")} required help={uiText("只能关联此环境中的项目，创建后工作区环境固定。")}><NativeSelect id="workspaceEnvironment" required /></Field>
    <div><Field id="workspaceName" label={uiText("工作区名称")} required><Input id="workspaceName" name="name" required maxLength={100} placeholder={uiText("例如：订单审批流程")} /></Field></div>
    <Field id="workspaceDraftDescription" label={uiText("工作区说明")}><Textarea id="workspaceDraftDescription" name="description" rows={3} maxLength={6000} placeholder={uiText("描述开发目标、涉及的修改和完成标准，新建工作区对话时会提供这份说明。")} /></Field>

    <div className="mb-5"><div className="mb-2 flex items-center justify-between gap-3 text-sm font-medium"><span>{uiText("参与项目")}{" "}<small className="text-muted-foreground">{uiText("最多 30 个")}</small></span><Button type="button" variant="outline" size="sm" id="registerNewWorkspaceProject">{uiText("＋ 登记新项目")}</Button></div><PickerSearch id="projectPicker" /><div id="projectPicker" className="project-picker" /></div>
    <details className="workspace-preview-details"><summary>{uiText("查看工作目录预览")}</summary><Preview title={uiText("项目工作目录预览")} id="workspacePreview" /></details></div>
    <div id="workspaceProgress" className="workspace-creation-progress" hidden>
      <h3 id="workspaceProgressTitle" tabIndex={-1}>{uiText("正在创建工作区并准备工作目录")}</h3>
      <p id="workspaceProgressSummary" className="text-muted-foreground" />
      <ul id="workspaceProgressProjects" aria-live="polite" />
    </div>
    <Feedback id="workspaceError" variant="destructive" tabIndex={-1} hidden /></div>
    <ModalFooter note={uiText("创建前检查全部仓库，已有目录和分支不会被覆盖。")}><Button type="submit" id="workspaceSubmit">{uiText("创建工作区")}</Button></ModalFooter>
  </form>
}

export function WorkspaceProjectsForm() {
  return <form id="workspaceProjectsForm" className="workspace-dialog-form"><ModalHeader id="workspaceProjectsTitle" title={uiText("添加项目")} /><div className="workspace-dialog-scroll"><p className="dialog-description" id="workspaceProjectsDescription" />
    <div className="mb-5"><div className="mb-2 flex items-center justify-between gap-3 text-sm font-medium"><span>{uiText("选择尚未关联的项目")}</span><Button type="button" variant="outline" size="sm" id="registerWorkspaceProject">{uiText("＋ 登记新项目")}</Button></div><PickerSearch id="workspaceProjectPicker" /><div id="workspaceProjectPicker" className="project-picker" /></div>
    <details className="workspace-preview-details"><summary>{uiText("查看新增目录预览")}</summary><Preview title={uiText("新增项目的工作目录")} id="workspaceProjectsPreview" /></details><Feedback id="workspaceProjectsError" variant="destructive" hidden /></div>
    <ModalFooter note={uiText("每个项目可分别选择工作目录与来源分支。")}><Button type="submit" id="workspaceProjectsSubmit" disabled>{uiText("添加项目")}</Button></ModalFooter>
  </form>
}

export function WorktreeForm() {
  return <><ModalHeader id="worktreeTitle" title={uiText("创建 Worktree")} /><p className="dialog-description" id="worktreeProject" /><div id="worktreeLoading" className="loading" role="status">{uiText("正在读取分支…")}</div><Feedback id="worktreeError" variant="destructive" hidden />
    <form id="worktreeForm" hidden>
      <Field id="worktreeSlug" label={uiText("工作标识")} required help={uiText("用于总目录名；多个项目使用相同标识可集中到同一目录。已关联工作区的目录，请在对应工作区页面管理。")}><Input id="worktreeSlug" name="slug" required maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}" placeholder={uiText("例如：order-approval")} /></Field>
      <Field id="worktreeMode" label={uiText("分支方式")}><NativeSelect id="worktreeMode" name="mode"><Option value="new">{uiText("新建分支")}</Option><Option value="existing">{uiText("使用已有本地分支")}</Option></NativeSelect></Field>
      <div id="worktreeNewFields" className="form-grid"><Field id="worktreeBranch" label={uiText("新分支名称")} required help={uiText("默认 codex/工作标识，可填写自己的分支名。")}><Input id="worktreeBranch" name="branch" required maxLength={160} placeholder="codex/order-approval" /></Field><Field id="worktreeSource" label={uiText("来源分支")} required><NativeSelect id="worktreeSource" name="source" data-searchable-select required /></Field></div>
      <div id="worktreeExistingField" hidden><Field id="worktreeExisting" label={uiText("已有本地分支")} required help={uiText("已被其他 Worktree 占用的分支不可重复检出。")}><NativeSelect id="worktreeExisting" data-searchable-select disabled required /></Field></div>
      <Feedback id="worktreeSourceNote" role="status" className="mb-4 bg-muted text-muted-foreground" /><Preview title={uiText("即将创建的 Worktree 目录")} id="worktreePath" />
      <p className="dialog-description">{uiText("独立创建后显示为“未关联工作区”。创建新目录会保留原目录的分支和未提交修改。")}</p>
      <ModalFooter><Button id="worktreeSubmit" type="submit">{uiText("创建 Worktree")}</Button></ModalFooter>
    </form>
  </>
}

export function GitDialog() {
  return <><ModalHeader id="gitTitle" title={uiText("Git 操作")} />
    <p id="gitWorkspaceContext" className="git-workspace-context" hidden />
    <Feedback id="gitProgress" className="git-progress bg-muted text-muted-foreground" role="status" hidden />
    <Feedback id="gitError" variant="destructive" hidden />
    <Feedback id="gitAuthHelp" className="bg-muted" hidden><span>{uiText("在终端完成一次登录，接入的凭证助手会保存并供页面复用。")}</span><Action action="git-fetch-terminal" variant="default">{uiText("在终端登录并获取分支 ↗")}</Action></Feedback>
    <Feedback id="gitResult" role="status" className="git-result bg-muted" hidden><strong id="gitResultTitle" /><pre id="gitOutput" /></Feedback>
    <div id="gitContent" />
    <div className="dialog-footer"><Button type="button" variant="outline" className="close-dialog">{uiText("关闭")}</Button></div>
  </>
}

export function WorkspaceEditForm() {
  return <form id="workspaceEditForm"><ModalHeader id="workspaceEditTitle" title={uiText("编辑工作区信息")} />
    <Field id="workspaceEditName" label={uiText("工作区名称")} required><Input id="workspaceEditName" name="name" required maxLength={100} /></Field>
    <Field id="workspaceEditDescription" label={uiText("目标与说明")}><Textarea id="workspaceEditDescription" name="description" rows={6} maxLength={6000} /></Field>
    <Feedback id="workspaceEditError" variant="destructive" hidden /><ModalFooter><Button type="submit">{uiText("保存")}</Button></ModalFooter>
  </form>
}
export function WorkspaceDirectoryForm() {
  return <form id="workspaceDirectoryForm" className="workspace-dialog-form"><ModalHeader id="workspaceDirectoryTitle" title={uiText("更换工作目录")} /><div className="workspace-dialog-scroll">
    <p className="dialog-description" id="workspaceDirectoryCurrent" /><div id="workspaceDirectoryPicker" />
    <Preview title={uiText("将改为使用")} id="workspaceDirectoryPreview" />
    <Feedback id="workspaceDirectoryError" variant="destructive" hidden /></div>
    <ModalFooter note={uiText("旧目录、分支、代码和已有对话均保留。")}><Button type="submit" id="workspaceDirectorySubmit">{uiText("确认更换")}</Button></ModalFooter>
  </form>
}
