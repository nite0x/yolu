import {uiText} from "@/shared/i18n"
import {Button} from "@/shared/ui/primitives/button"
import {Action, Feedback, ModalHeader} from "@/shared/ui/patterns"

export function GitDialog() {
  return <><ModalHeader id="gitTitle" title={uiText("Git 操作")} />
    <Feedback id="gitProgress" className="git-progress bg-muted text-muted-foreground" role="status" hidden />
    <Feedback id="gitError" variant="destructive" hidden />
    <Feedback id="gitAuthHelp" className="bg-muted" hidden><span>{uiText("在终端完成一次登录，接入的凭证助手会保存并供页面复用。")}</span><Action action="git-fetch-terminal" variant="default">{uiText("在终端登录并获取分支 ↗")}</Action></Feedback>
    <Feedback id="gitResult" role="status" className="git-result bg-muted" hidden><strong id="gitResultTitle" /><pre id="gitOutput" /></Feedback>
    <div id="gitContent" />
    <div className="dialog-footer"><Button type="button" variant="outline" className="close-dialog">{uiText("关闭")}</Button></div>
  </>
}
