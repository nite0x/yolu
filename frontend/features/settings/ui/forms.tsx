import {uiText} from "@/shared/i18n"
import {Feedback} from "@/shared/ui/feedback/message"
import {Check} from "@/shared/ui/forms/check"
import {Field} from "@/shared/ui/forms/field"
import {ModalFooter, ModalHeader} from "@/shared/ui/layout/dialog"
import {Button} from "@/shared/ui/primitives/button"
import {Input} from "@/shared/ui/primitives/input"
import {NativeSelect} from "@/shared/ui/primitives/native-select"

export function EnvironmentForm() {
  return (
    <form id="environmentForm">
      <ModalHeader id="environmentTitle" title={uiText("连接 WSL 环境")} />
      <p className="dialog-description">
        {uiText(
          "应用自动部署并启动辅助程序。Git 和文件操作在所选 WSL 用户内执行，项目和对话索引保存在本机。",
        )}
      </p>
      <Field id="environmentDistro" label={uiText("发行版")}>
        <NativeSelect id="environmentDistro" required />
      </Field>
      <Field id="environmentUser" label={uiText("Linux 用户")}>
        <Input id="environmentUser" autoComplete="off" placeholder={uiText("留空使用发行版默认用户")} />
      </Field>
      <Field id="environmentRoot" label={uiText("新 Worktree 根目录")}>
        <Input
          id="environmentRoot"
          autoComplete="off"
          placeholder={uiText("留空使用该用户的 ~/workspaces")}
        />
      </Field>
      <Check id="environmentImport" label={uiText("导入该用户原有的 Yolu 项目与对话记录")} />
      <p className="dialog-description">
        {uiText(
          "导入会复制一份当前记录到 Windows；项目和 Worktree 保留原路径。之后可在桌面端查看项目与对话。",
        )}
      </p>
      <Feedback id="environmentError" tone="error" hidden />
      <ModalFooter>
        <Button type="submit" id="connectEnvironment">
          {uiText("连接并准备环境")}
        </Button>
      </ModalFooter>
    </form>
  )
}
