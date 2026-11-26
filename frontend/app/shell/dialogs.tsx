import {uiText} from "@/shared/i18n"
import {Copy} from "lucide-react"
import {Alert, AlertDescription} from "@/shared/ui/primitives/alert"
import {Button} from "@/shared/ui/primitives/button"
import {ModalHeader, ModalFooter} from "@/shared/ui/layout/dialog"
import {Textarea} from "@/shared/ui/primitives/textarea"

export function CommandDialog() {
  return (
    <>
      <ModalHeader id="commandTitle" title={uiText("终端命令")} />
      <p id="commandDescription" className="dialog-description">{uiText("在当前执行环境的终端执行以下命令；Windows 本机使用 PowerShell。")}</p>
      <Textarea id="commandText" rows={7} readOnly aria-label={uiText("终端命令")} className="min-h-44 resize-y bg-muted p-3 font-mono text-sm leading-relaxed" />
      <ModalFooter closeLabel={uiText("关闭")}>
        <Button type="button" id="copyCommand"><Copy aria-hidden="true" />{uiText("复制命令")}</Button>
      </ModalFooter>
    </>
  )
}

export function ToastContent() {
  return <Alert role="presentation" className="border-0 bg-transparent p-0 text-inherit"><AlertDescription id="toastMessage" className="whitespace-pre-wrap text-inherit" /></Alert>
}
