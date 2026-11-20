import { uiText } from "../i18n";
import { Button } from "@/components/ui/button"
import { Feedback, ModalHeader } from "./shared"

export interface CleanupCandidate {
  project_id: string; project_name: string; path: string; branch: string; head: string;
  current: boolean; dirty: number; unpushed: number; ignored: boolean; shared: string[];
  reasons: string[]; cleanable: boolean; fingerprint: string;
}
export interface ChangedFile { path: string; previous?: string; index: string; working: string; untracked: boolean }

export function WorkspaceReviewDialog() {
  return <><ModalHeader id="workspaceReviewTitle" title={uiText("工作区收尾检查")} />
    <p className="dialog-description" id="workspaceReviewDescription">{uiText("检查当前项目及工作区中保留的旧 Worktree。清理前会重新检查修改、提交、引用和活动对话。")}</p>
    <div className="flex flex-wrap gap-2 mb-3"><Button type="button" variant="outline" id="workspaceReviewRefresh">{uiText("重新检查")}</Button><Button type="button" variant="outline" id="workspaceReviewArchive">{uiText("归档工作区并重新检查")}</Button></div>
    <div id="workspaceReviewItems" aria-live="polite" />
    <Feedback id="workspaceReviewError" variant="destructive" hidden />
    <p className="text-sm text-muted-foreground mt-4">{uiText("只移除选中的 Worktree 目录，分支与对话记录保留。原项目目录、共享目录及存在未确认内容的目录不可清理。")}</p>
    <div className="dialog-footer"><Button type="button" variant="outline" className="close-dialog">{uiText("关闭")}</Button><Button type="button" id="workspaceReviewClean" disabled>{uiText("清理所选目录")}</Button></div>
  </>
}
export function WorkspaceReviewItems({items}: {items: CleanupCandidate[]}) {
  if (!items.length) return <p className="workspace-project-empty">{uiText("没有需要检查的工作目录。")}</p>
  return <div className="workspace-review-items">{items.map((item,i) => <article className="workspace-review-item" key={`${item.project_id}:${item.path}`}>
    <label className="flex items-start gap-3"><input type="checkbox" data-cleanup-index={i} disabled={!item.cleanable} aria-label={uiText("选择清理 {0}", item.path)} /><span className="min-w-0"><strong>{item.project_name}</strong><span className="quiet"> · {item.current ? uiText("当前关联目录") : uiText("工作区中的旧目录")}</span><code className="block break-all mt-1">{item.path}</code></span></label>
    <div className="text-sm mt-2">{uiText("分支")}{" "}{item.branch || uiText("未检出")} · {item.dirty || 0}{" "}{uiText("项改动 ·")}{" "}{item.unpushed || 0}{" "}{uiText("个待推送提交")}</div>
    {item.cleanable ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{uiText("检查通过，可选择清理；执行前会再次核实。")}</p> : <ul className="text-sm text-amber-800 dark:text-amber-300 list-disc pl-5">{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
  </article>)}</div>
}
export function ChangesDialog() {
  return <><ModalHeader id="changesTitle" title={uiText("项目文件与改动")} />
    <div id="changesBrowser" />
    <div className="dialog-footer"><Button type="button" variant="outline" className="close-dialog">{uiText("关闭")}</Button></div>
  </>
}
