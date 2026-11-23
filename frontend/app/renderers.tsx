import { uiText } from "../i18n";
import { syncListFilter } from "./list-controls"
import type { ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { mountGitView, resetGitView, scrollToGitSection } from "./git-interactive"
import { notifyWorkspace } from "./interactions"
import { ProjectScanResults } from "./project-scan"
import { Projects, type DirectoryFilter, type ProjectFilter } from "./projects"
import { GitView } from "./git"
import { HistoryMessage, FileChange, ChatApprovals, HistoryAttention, type HistoryEntry, type Approval } from "./session-timeline"
import { Branch, EmptyState, SourceOptions, StatusBadge, TreeStatus } from "./shared"
import type { GitOverview, Project, Worktree } from "./types"
import type { ProjectOpenTool } from "./shared"
import {readElicitation} from "../chat/approval"
import { ConversationList, ConversationScopes } from "./session-browser"
import { conversationContext, isGeneralConversationDirectory } from "./conversation-context"
import { createOperations } from "./operations"
import { setupConversationResize, conversationPathKey, conversationEnvironmentKey } from "./conversation-runtime"
import { mountFileBrowser } from "./file-browser"
import { createConversationFiles } from "./conversation-files"
import { createSessionRequests } from "./session-requests"
import { conversationDefaults } from "./conversation-defaults"
import { createResourceIcons } from "./resource-icons"
import { ResourceIcon, ShortcutBadge } from "./shortcut-icons"
import { createConversationList, conversationStatusMatches, patchConversationList } from "./conversation-list"
import { createConversationState } from "./conversation-state"
import { conversationTree } from "./conversation-tree"
import { renderCreationChoices } from "./creation-choices"
import { AgyDiagnosticsResults, CodexDiagnosticsResults } from "./settings"

// Static views retain their native controllers. Interactive islands have
// separate React roots; their native fields bridge existing API/form logic.
export const workspaceUI = {
  syncListFilter,
  createConversationState,
  conversationTree,
  createConversationList, conversationStatusMatches, patchConversationList,
  createResourceIcons,
  resourceIcon: (props: Parameters<typeof ResourceIcon>[0]) => renderToStaticMarkup(<ResourceIcon {...props} />),
  resourceIconBadge: (props: Parameters<typeof ShortcutBadge>[0]) => renderToStaticMarkup(<ShortcutBadge {...props} />),
  conversationDefaults,
  renderCreationChoices,
  mountGitView, resetGitView, scrollToGitSection, notifyWorkspace,
  setupConversationResize, conversationPathKey, conversationEnvironmentKey, createSessionRequests,
  createOperations, createConversationFiles, mountFileBrowser,
  projectScanResults: (scan: Parameters<typeof ProjectScanResults>[0]) => renderToStaticMarkup(<ProjectScanResults {...scan} />),
  codexDiagnostics: (results: Parameters<typeof CodexDiagnosticsResults>[0]["results"]) => renderToStaticMarkup(<CodexDiagnosticsResults results={results} />),
  agyDiagnostics: (results: Parameters<typeof AgyDiagnosticsResults>[0]["results"]) => renderToStaticMarkup(<AgyDiagnosticsResults results={results} />),
  conversationContext, isGeneralConversationDirectory,
  conversationList: (props: Parameters<typeof ConversationList>[0]) => renderToStaticMarkup(<ConversationList {...props} />),
  conversationScopes: (scopes: Parameters<typeof ConversationScopes>[0]["scopes"], selected?: Parameters<typeof ConversationScopes>[0]["selected"]) => renderToStaticMarkup(<ConversationScopes scopes={scopes} selected={selected} />),
  readElicitation,
  projects: (projects: Project[], selectedID: string | null, openTool?: ProjectOpenTool, filter?: ProjectFilter, detailOpen?: boolean, directoryFilter?: DirectoryFilter, searching?: boolean, status?: ComponentProps<typeof Projects>["status"]) => renderToStaticMarkup(<Projects projects={projects} selectedID={selectedID} openTool={openTool} filter={filter} detailOpen={detailOpen} directoryFilter={directoryFilter} searching={searching} status={status} />),
  git: (overview: GitOverview) => renderToStaticMarkup(<GitView overview={overview} />),
  badge: (kind: string, text?: string) => renderToStaticMarkup(<span className="shadcn-scope"><StatusBadge kind={kind}>{text}</StatusBadge></span>),
  branch: (value: string) => renderToStaticMarkup(<span className="shadcn-scope"><Branch>⑂ {value || "detached HEAD"}</Branch></span>),
  treeState: (tree?: Worktree, pending?: boolean) => renderToStaticMarkup(<div className="shadcn-scope"><TreeStatus tree={tree} pending={pending} /></div>),
  empty: (title: string, description: string, action?: string, button?: string) => renderToStaticMarkup(<EmptyState title={title} description={description} action={action} button={button} />),
  offline: () => renderToStaticMarkup(<EmptyState title={uiText("暂时无法连接执行环境")} description={uiText("请检查本机服务；WSL 环境可在设置页重新连接恢复。")} href="#/settings" button={uiText("打开设置")} />),
  sourceOptions: (overview: GitOverview, includeHead = true) => renderToStaticMarkup(<SourceOptions overview={overview} includeHead={includeHead} />),
  historyEntry: (entry: HistoryEntry, metadata: string) => renderToStaticMarkup(<HistoryMessage entry={entry} metadata={metadata} />),
  fileChange: (text?: string, status?: string) => renderToStaticMarkup(<FileChange text={text} status={status} />),
  chatApprovals: (approvals: Approval[]) => renderToStaticMarkup(<ChatApprovals approvals={approvals} />),
  historyAttention: (connected: boolean, confirmations: Approval[]) => renderToStaticMarkup(<HistoryAttention connected={connected} confirmations={confirmations} />),
}

declare global { interface Window { WorkHubUI: typeof workspaceUI } }
