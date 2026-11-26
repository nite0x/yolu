import {uiText} from "@/shared/i18n"
import {Button} from "@/shared/ui/primitives/button"
import {LoadingState} from "@/shared/ui/feedback/loading-state"
import {Input} from "@/shared/ui/primitives/input"
import {Feedback} from "@/shared/ui/feedback/message"
import {Field} from "@/shared/ui/forms/field"
import {ModalFooter, ModalHeader} from "@/shared/ui/layout/dialog"
import {NativeSelect, NativeSelectOption as Option} from "@/shared/ui/primitives/native-select"
import {Preview} from "@/shared/ui/data-display/code-preview"
import "./project-form.css"

export function ProjectForm() {
  return <form id="projectForm" className="project-dialog-form"><ModalHeader id="projectDialogTitle" title={uiText("添加项目")} /><div className="project-dialog-scroll"><p className="dialog-description">{uiText("登记已有 Git 仓库、批量扫描目录，或从 Git 克隆。")}</p>
    <Field id="projectSource" label={uiText("添加方式")}><NativeSelect id="projectSource" defaultValue="local"><Option value="local">{uiText("登记本地仓库")}</Option><Option value="clone">{uiText("从 Git 克隆")}</Option><Option value="scan">{uiText("扫描目录并批量添加")}</Option></NativeSelect></Field>
    <Field id="projectEnvironmentSelect" label={uiText("项目所在环境")} help={uiText("仓库路径和 Git 操作均在此环境中执行。")}><NativeSelect id="projectEnvironmentSelect" required /></Field>
    <div id="projectCloneFields" hidden>
      <Field id="projectCloneURL" label={uiText("Git 仓库地址")} required help={uiText("支持 HTTPS 和 SSH，使用所选环境已有的 Git 凭证或 SSH 密钥。")}><Input id="projectCloneURL" disabled autoComplete="off" placeholder="https://github.com/owner/repo.git" /></Field>
      <Field id="projectCloneDirectory" label={uiText("新文件夹名")} required help={uiText("在存放目录下新建此文件夹；已有目录不会被覆盖。")}><Input id="projectCloneDirectory" disabled autoComplete="off" placeholder="repo" /></Field>
      <p className="dialog-description">{uiText("克隆失败时会保留剩余文件。若克隆完成但登记失败，可切换到登记本地仓库后重试。")}</p>
    </div>
    <Field id="projectPath" label={uiText("仓库目录")} required help={uiText("选择本机 Git 仓库主目录，或填写项目所在环境中的绝对路径。")}>{control => <><div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1 basis-60" {...control} name="path" autoComplete="off" placeholder={uiText("填写仓库主目录的绝对路径")} /><Button type="button" variant="outline" id="chooseProjectDirectory">{uiText("选择文件夹…")}</Button></div><small id="projectDirectoryHint" className="text-xs text-muted-foreground" hidden>{uiText("WSL 项目请手动填写 Linux 绝对路径，例如 /home/用户名/projects/app。")}</small></>}</Field>
    <div id="projectNameField"><Field id="projectName" label={uiText("项目名称")} help={uiText("建议使用简短、可辨识的项目名称。")}><Input id="projectName" name="name" maxLength={80} placeholder={uiText("留空则使用仓库目录名")} /></Field></div>
    <section id="projectScanResults" aria-live="polite" aria-label={uiText("发现的仓库")} hidden />
    <Feedback id="projectError" tone="error" hidden /></div>
    <ModalFooter><Button type="button" variant="outline" id="projectRescan" hidden>{uiText("重新扫描")}</Button><Button type="submit" id="projectSubmit">{uiText("添加并扫描")}</Button></ModalFooter>
  </form>
}

export function WorktreeForm() {
  return <><ModalHeader id="worktreeTitle" title={uiText("创建 Worktree")} /><p className="dialog-description" id="worktreeProject" /><LoadingState id="worktreeLoading" className="loading">{uiText("正在读取分支…")}</LoadingState><Feedback id="worktreeError" tone="error" hidden />
    <form id="worktreeForm" hidden>
      <Field id="worktreeSlug" label={uiText("工作标识")} required help={uiText("用于 Worktree 目录名。")}><Input id="worktreeSlug" name="slug" required maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}" placeholder={uiText("例如：order-approval")} /></Field>
      <Field id="worktreeMode" label={uiText("分支方式")}><NativeSelect id="worktreeMode" name="mode"><Option value="new">{uiText("新建分支")}</Option><Option value="existing">{uiText("使用已有本地分支")}</Option></NativeSelect></Field>
      <div id="worktreeNewFields" className="form-grid"><Field id="worktreeBranch" label={uiText("新分支名称")} required help={uiText("默认 codex/工作标识，可填写自己的分支名。")}><Input id="worktreeBranch" name="branch" required maxLength={160} placeholder="codex/order-approval" /></Field><Field id="worktreeSource" label={uiText("来源分支")} required><NativeSelect id="worktreeSource" name="source" data-searchable-select required /></Field></div>
      <div id="worktreeExistingField" hidden><Field id="worktreeExisting" label={uiText("已有本地分支")} required help={uiText("已被其他 Worktree 占用的分支不可重复检出。")}><NativeSelect id="worktreeExisting" data-searchable-select disabled required /></Field></div>
      <Feedback id="worktreeSourceNote" role="status" className="mb-4 bg-muted text-muted-foreground" /><Preview title={uiText("即将创建的 Worktree 目录")} id="worktreePath" />
      <p className="dialog-description">{uiText("创建新目录会保留原目录的分支和未提交修改。")}</p>
      <ModalFooter><Button id="worktreeSubmit" type="submit">{uiText("创建 Worktree")}</Button></ModalFooter>
    </form>
  </>
}
