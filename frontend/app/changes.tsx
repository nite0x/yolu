import { uiText } from "../i18n";
import { Button } from "@/components/ui/button"
import { ModalHeader } from "./shared"

export interface ChangedFile { path: string; previous?: string; index: string; working: string; untracked: boolean }

export function ChangesDialog() {
  return <><ModalHeader id="changesTitle" title={uiText("项目文件与改动")} />
    <div id="changesBrowser" />
    <div className="dialog-footer"><Button type="button" variant="outline" className="close-dialog">{uiText("关闭")}</Button></div>
  </>
}
