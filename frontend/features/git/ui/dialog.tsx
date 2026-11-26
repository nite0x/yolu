import {uiText} from "@/shared/i18n"
import {Action} from "@/shared/ui/actions/button"
import {Feedback} from "@/shared/ui/feedback/message"
import {ModalHeader, ModalFooter} from "@/shared/ui/layout/dialog"

export function GitDialog() {
  return <><ModalHeader id="gitTitle" title={uiText("Git 操作")} />
    <Feedback id="gitProgress" className="git-progress bg-muted text-muted-foreground" role="status" hidden />
    <Feedback id="gitError" tone="error" hidden />
    <Feedback id="gitAuthHelp" className="bg-muted" hidden><span>{uiText("在终端完成一次登录，接入的凭证助手会保存并供页面复用。")}</span><Action action="git-fetch-terminal" variant="default">{uiText("在终端登录并获取分支 ↗")}</Action></Feedback>
    <Feedback id="gitResult" role="status" className="git-result bg-muted" hidden><strong id="gitResultTitle" /><pre id="gitOutput" /></Feedback>
    <div id="gitContent" />
    <ModalFooter closeLabel={uiText("关闭")} />
  </>
}
