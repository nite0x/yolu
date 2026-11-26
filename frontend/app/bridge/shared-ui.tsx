import {renderToStaticMarkup} from "react-dom/server"
import {uiText} from "@/shared/i18n"
import {syncListFilter} from "@/shared/ui/list-controls"
import {ResourceIcon, ShortcutBadge} from "@/shared/ui/resource-icons"
import {EmptyState, StatusBadge} from "@/shared/ui/patterns"
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

export const sharedUI = {
  syncListFilter, createResourceIcons, conversationDefaults, notifyWorkspace,
  conversationPathKey, conversationEnvironmentKey, createOperations, setupSplitResize,
  mainCreationProjects, conversationStatusMatches, conversationContext, isGeneralConversationDirectory,
  resourceIcon: (props: Parameters<typeof ResourceIcon>[0]) => renderToStaticMarkup(<ResourceIcon {...props} />),
  resourceIconBadge: (props: Parameters<typeof ShortcutBadge>[0]) => renderToStaticMarkup(<ShortcutBadge {...props} />),
  badge: (kind: string, text?: string) => renderToStaticMarkup(<span className="shadcn-scope"><StatusBadge kind={kind}>{text}</StatusBadge></span>),
  branch: (value: string) => renderToStaticMarkup(<span className="shadcn-scope"><Branch>⑂ {value || "detached HEAD"}</Branch></span>),
  treeState: (tree?: Worktree, pending?: boolean) => renderToStaticMarkup(<div className="shadcn-scope"><TreeStatus tree={tree} pending={pending} /></div>),
  empty: (title: string, description: string, action?: string, button?: string) => renderToStaticMarkup(<EmptyState title={title} description={description} action={action} button={button} />),
  offline: () => renderToStaticMarkup(<EmptyState title={uiText("暂时无法连接执行环境")} description={uiText("请检查本机服务；WSL 环境可在设置页重新连接恢复。")} href="#/settings" button={uiText("打开设置")} />),
}
