import { uiText, uiLocale } from "../i18n";
import { Files } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Feedback } from "./shared"

export interface Session {
  terminal?: {projectID?: string; cwd?: string; sessionID?: string; bindingID?: string; attached: boolean};
  primary_project_id?: string; project_ids?: string[];
  browser_key?: string; environment_id?: string; environment_name?: string;
  context?: ReturnType<typeof import("./conversation-context").conversationContext>;
  id: string; provider?: "codex" | "agy"; name: string; cwd: string; updated_at?: number; updatedAt?: number;
  source?: string; error?: string; available?: boolean;
  pinned?: boolean; archived?: boolean; chat_status?: string; completed_run?: string; unread?: boolean;
}
export interface SessionsData { sessions: Session[]; loading?: boolean; error?: string }
export const sessionTime = (value?: number) => value ? new Date(value * 1000).toLocaleString(uiLocale(), { hour12: false }) : uiText("暂无活动记录")
export function CommandOutputDialog() {
  return <><div className="dialog-header"><div><h2 id="sessionCommandOutputTitle" className="m-0 text-xl font-semibold">{uiText("命令输出")}</h2></div><Button type="button" variant="ghost" size="icon" id="closeSessionCommandOutput" aria-label={uiText("关闭命令输出")} autoFocus>×</Button></div>
    <pre id="sessionCommandOutputCommand" className="history-command-line" /><div id="sessionCommandOutputMeta" className="session-command-output-meta" />
    <Card className="session-command-output-text gap-0 bg-muted p-4 shadow-none" id="sessionCommandOutputText" tabIndex={0} role="region" aria-label={uiText("命令输出内容")} />
    <p className="session-command-output-hint">{uiText("Esc 关闭 · 输出独立滚动，保留对话位置")}</p>
  </>
}
export function SessionHistoryPanel() {
  return <><div id="assistantChatRoot" /><header className="session-history-header">
    <div className="dialog-header"><div><Badge variant="secondary" id="sessionHistoryEyebrow" className="mb-3 rounded-md text-xs tracking-wider">SESSION HISTORY</Badge><h2 id="sessionHistoryTitle" className="m-0 text-lg font-semibold" tabIndex={-1}>{uiText("对话详情")}</h2></div><div className="session-history-heading-actions"><span id="sessionHistoryFilesSlot"><Button type="button" size="sm" variant="ghost" id="toggleConversationFiles" title={uiText("查看对话工作目录的文件")} aria-label={uiText("查看对话工作目录的文件")} aria-expanded={false} aria-controls="conversationFilesPane" disabled><Files aria-hidden="true" />{uiText("文件")}</Button></span><Button type="button" variant="ghost" size="icon" id="closeSessionHistory" aria-label={uiText("关闭对话详情")}>×</Button></div></div>
    <details className="session-context"><summary>{uiText("工作目录")}</summary><div id="sessionHistoryMeta" className="session-history-meta" /></details>
    <div className="session-history-toolbar"><span id="sessionHistoryStatus" role="status" aria-live="polite" /><div><Button type="button" variant="outline" size="sm" id="refreshSessionHistory">{uiText("刷新详情")}</Button><Button type="button" size="sm" data-session-action="resume" id="resumeHistorySession">{uiText("在终端继续 ↗")}</Button></div></div>
    <Feedback id="sessionHistoryAttention" className="session-history-attention" role="alert" aria-live="polite" tabIndex={0} aria-label={uiText("终端待确认事项")} hidden />
  </header>
  <div id="sessionHistoryScroll" className="session-history-scroll" tabIndex={0} aria-label={uiText("对话历史记录")}><Feedback id="sessionHistoryError" variant="destructive" hidden /><Button type="button" variant="outline" size="sm" id="loadOlderHistory" className="history-more mx-auto mb-5 flex w-fit" hidden>{uiText("加载更早记录")}</Button><div id="sessionHistoryEntries" /><div id="sessionChatLiveEntries" /></div>
  <div id="sessionChatApprovals" className="session-chat-approvals" aria-live="polite" />
  <form id="sessionChatForm" className="session-chat-form"><div id="sessionChatStatus" role="status" aria-live="polite" /><p id="sessionHandoffNotice" className="session-description" role="status" hidden /><Button type="button" variant="outline" size="sm" id="handoffSessionChat" hidden>{uiText("切换到侧栏（等本轮结束）")}</Button><Feedback id="sessionChatError" variant="destructive" hidden />
    <Label htmlFor="sessionChatInput" id="sessionChatLabel" className="text-xs text-muted-foreground">{uiText("继续这个对话")}</Label><Textarea id="sessionChatInput" rows={2} maxLength={32000} placeholder={uiText("补充说明、询问进展，或交代下一步…")} aria-label={uiText("对话消息")} />
    <div className="session-chat-actions"><div><Button type="button" variant="outline" size="sm" id="stopSessionChat" disabled>{uiText("停止")}</Button><Button type="submit" size="sm" id="sendSessionChat" disabled>{uiText("发送")}</Button></div></div>
  </form></>
}
