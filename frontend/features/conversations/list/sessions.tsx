import {uiText} from "@/shared/i18n"
import {Files} from "lucide-react"
import {ModalHeader} from "@/shared/ui/layout/dialog"
import {Card} from "@/shared/ui/primitives/card"
import {Button} from "@/shared/ui/primitives/button"
import {Badge} from "@/shared/ui/primitives/badge"
import {Textarea} from "@/shared/ui/primitives/textarea"
import {Label} from "@/shared/ui/primitives/label"
import {Feedback} from "@/shared/ui/feedback/message"

export function CommandOutputDialog() {
  return <><ModalHeader id="sessionCommandOutputTitle" title={uiText("命令输出")} closeLabel={uiText("关闭命令输出")} closeButton={{id: "closeSessionCommandOutput", autoFocus: true}} />
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
  {/* biome-ignore lint/a11y/noNoninteractiveTabindex: This independently scrollable history region needs keyboard scrolling. */}
  <section id="sessionHistoryScroll" className="session-history-scroll" tabIndex={0} aria-label={uiText("对话历史记录")}><Feedback id="sessionHistoryError" tone="error" hidden /><Button type="button" variant="outline" size="sm" id="loadOlderHistory" className="history-more mx-auto mb-5 flex w-fit" hidden>{uiText("加载更早记录")}</Button><div id="sessionHistoryEntries" /><div id="sessionChatLiveEntries" /></section>
  <div id="sessionChatApprovals" className="session-chat-approvals" aria-live="polite" />
  <form id="sessionChatForm" className="session-chat-form"><div id="sessionChatStatus" role="status" aria-live="polite" /><p id="sessionHandoffNotice" className="session-description" role="status" hidden /><Button type="button" variant="outline" size="sm" id="handoffSessionChat" hidden>{uiText("切换到侧栏（等本轮结束）")}</Button><Feedback id="sessionChatError" tone="error" hidden />
    <Label htmlFor="sessionChatInput" id="sessionChatLabel" className="text-xs text-muted-foreground">{uiText("继续这个对话")}</Label><Textarea id="sessionChatInput" rows={2} maxLength={32000} placeholder={uiText("补充说明、询问进展，或交代下一步…")} aria-label={uiText("对话消息")} />
    <div className="session-chat-actions"><div><Button type="button" variant="outline" size="sm" id="stopSessionChat" disabled>{uiText("停止")}</Button><Button type="submit" size="sm" id="sendSessionChat" disabled>{uiText("发送")}</Button></div></div>
  </form></>
}
