import { uiText } from "../i18n";
import { Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModalHeader } from "./shared"

export interface ChangedFile { path: string; previous?: string; index: string; working: string; untracked: boolean }

export function ChangesDialog() {
  return <><ModalHeader id="changesTitle" title={uiText("项目文件与改动")} />
    <div id="changesBrowser" />
    <section id="changesCommitPlan" className="project-commit-plan" hidden>
      <p className="dialog-description break-all" id="changesPlanContext" />
      <h3>{uiText("计划提交")}</h3>
      <p>{uiText("提交分组和执行将在后续版本提供。")}</p>
    </section>
    <div className="dialog-footer">
      <Button type="button" variant="outline" className="close-dialog">{uiText("关闭")}</Button>
      <Button type="button" variant="outline" data-action="project-commit-plan" id="showChangesPlan"><Layers aria-hidden="true" />{uiText("分批提交")}</Button>
      <Button type="button" variant="outline" data-action="changes-open" id="returnToChanges" hidden>{uiText("返回变更")}</Button>
    </div>
  </>
}
