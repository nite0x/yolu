import {renderToStaticMarkup} from "react-dom/server"
import {syncListFilter} from "@/shared/ui/list-controls"
import {ResourceIcon, ShortcutBadge} from "@/shared/ui/resource-icons"
import {createResourceIcons} from "@/shared/lib/resource-icons"
import {conversationDefaults} from "@/shared/lib/preferences"
import {setupSplitResize} from "@/shared/lib/split-resize"
import {conversationPathKey, conversationEnvironmentKey} from "@/shared/lib/workspace-identity"
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
}
