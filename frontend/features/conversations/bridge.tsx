import {renderToStaticMarkup} from "react-dom/server"
import {ConversationList, ConversationScopes} from "./list/browser"
import {createConversationState} from "./list/state"
import {conversationTree, projectConversationStep} from "./list/tree"
import {createConversationList, patchConversationList} from "./list/list"
import {setupConversationResize} from "./list/resize"
import {createSessionRequests} from "./list/requests"
import {createConversationFiles} from "./list/files"
import {renderCreationChoices, resetCreationChoices} from "./creation/choices"
import {recordCreationDirectory} from "./creation/directories"
import {HistoryMessage, FileChange, ChatApprovals, HistoryAttention, type HistoryEntry, type Approval} from "./list/timeline"
import {readElicitation} from "./model/approval"
import {effortLabel, findChatModel, permissionChoices, serviceTierLabel} from "./model/settings"

export const conversationUI = {
  createConversationState, conversationTree, projectConversationStep,
  createConversationList, patchConversationList,
  renderCreationChoices, resetCreationChoices, recordCreationDirectory,
  setupConversationResize, createSessionRequests, createConversationFiles,
  readElicitation, effortLabel, findChatModel, permissionChoices, serviceTierLabel,
  conversationList: (props: Parameters<typeof ConversationList>[0]) => renderToStaticMarkup(<ConversationList {...props} />),
  conversationScopes: (scopes: Parameters<typeof ConversationScopes>[0]["scopes"], selected?: Parameters<typeof ConversationScopes>[0]["selected"]) => renderToStaticMarkup(<ConversationScopes scopes={scopes} selected={selected} />),
  historyEntry: (entry: HistoryEntry, metadata: string) => renderToStaticMarkup(<HistoryMessage entry={entry} metadata={metadata} />),
  fileChange: (text?: string, status?: string) => renderToStaticMarkup(<FileChange text={text} status={status} />),
  chatApprovals: (approvals: Approval[]) => renderToStaticMarkup(<ChatApprovals approvals={approvals} />),
  historyAttention: (connected: boolean, confirmations: Approval[]) => renderToStaticMarkup(<HistoryAttention connected={connected} confirmations={confirmations} />),
}
