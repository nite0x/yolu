import {renderToStaticMarkup} from "react-dom/server"
import {uiText} from "@/shared/i18n"
import {syncListFilter} from "@/shared/ui/list-controls"
import {ResourceIcon, ShortcutBadge} from "@/shared/ui/resource-icons"
import {EmptyState} from "@/shared/ui/feedback/empty-state"
import {StatusBadge, type StatusTone} from "@/shared/ui/data-display/status-badge"
import {Action} from "@/shared/ui/actions/button"
import {Button} from "@/shared/ui/primitives/button"
import {createResourceIcons} from "@/shared/lib/resource-icons"
import {conversationDefaults} from "@/shared/lib/preferences"
import {setupSplitResize} from "@/shared/lib/split-resize"
import {conversationPathKey, conversationEnvironmentKey} from "@/shared/lib/workspace-identity"
import {Branch, TreeStatus} from "@/entities/projects/presentation"
import type {Worktree} from "@/entities/projects/model"
import {mainCreationProjects} from "@/entities/projects/creation"
import {conversationStatusMatches} from "@/entities/conversations/status"
import {conversationContext, isGeneralConversationDirectory} from "@/entities/conversations/context"
import {createOperations} from "../model/operations"
import {notifyWorkspace} from "../interactions"

// Translate the retained native-controller vocabulary at the application boundary.
const statusLabels: Record<string, string> = {ready: uiText("已就绪"), partial: uiText("部分就绪"), archived: uiText("已归档"), creating: uiText("创建中"), pending: uiText("待创建"), failed: uiText("创建失败"), removed: uiText("目录已清理")}
const statusTones: Record<string, StatusTone> = {ready: "success", partial: "warning", warning: "warning", failed: "error", "primary-tag": "accent"}

export const sharedUI = {
  syncListFilter, createResourceIcons, conversationDefaults, notifyWorkspace,
  conversationPathKey, conversationEnvironmentKey, createOperations, setupSplitResize,
  mainCreationProjects, conversationStatusMatches, conversationContext, isGeneralConversationDirectory,
  resourceIcon: (props: Parameters<typeof ResourceIcon>[0]) => renderToStaticMarkup(<ResourceIcon {...props} />),
  resourceIconBadge: (props: Parameters<typeof ShortcutBadge>[0]) => renderToStaticMarkup(<ShortcutBadge {...props} />),
  badge: (kind: string, text?: string) => renderToStaticMarkup(<span className="shadcn-scope"><StatusBadge tone={statusTones[kind] || "neutral"}>{text || statusLabels[kind] || kind}</StatusBadge></span>),
  branch: (value: string) => renderToStaticMarkup(<span className="shadcn-scope"><Branch>⑂ {value || "detached HEAD"}</Branch></span>),
  treeState: (tree?: Worktree, pending?: boolean) => renderToStaticMarkup(<div className="shadcn-scope"><TreeStatus tree={tree} pending={pending} /></div>),
  empty: (title: string, description: string, action?: string, button?: string) => renderToStaticMarkup(<EmptyState title={title} description={description} actions={action ? <Action action={action} variant="default">{action.startsWith("new-") ? "＋ " : ""}{button}</Action> : undefined} />),
  offline: () => renderToStaticMarkup(<EmptyState title={uiText("暂时无法连接执行环境")} description={uiText("请检查本机服务；WSL 环境可在设置页重新连接恢复。")} actions={<Button variant="outline" asChild><a href="#/settings">{uiText("打开设置")}</a></Button>} />),
}
