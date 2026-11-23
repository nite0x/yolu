import { Fragment, type ReactNode } from "react"
import { Check, ChevronDown, Copy, GitBranch, GitCommitHorizontal, MoreHorizontal, Pencil, Terminal } from "lucide-react"
import { TableCell, TableRow } from "@/components/ui/table"
import { uiLocale, uiText } from "../i18n"
import { Action, Branch, DataTable, StatusBadge, ProjectOpenActions, TreeStatus, type ProjectOpenTool } from "./shared"
import type { Worktree } from "./types"
import { compactWorkspacePath } from "./workspace-path"

const directoryCell = "p-[var(--directory-cell-padding)] align-middle whitespace-normal"

export function WorkingDirectoryTable({ label, children }: { label: string; children: ReactNode }) {
  const headers = [uiText("工作目录"), uiText("远程同步"), uiText("本地改动"), uiText("操作")]
  return <div className="working-directory-table">
    <DataTable label={label} headers={headers} containerClassName="overflow-visible" headerClassName="h-7 bg-transparent">{children}</DataTable>
  </div>
}

export function WorkingDirectoryGroup({ label, count }: { label: string; count: number }) {
  return <TableRow role="row" className="directory-group">
    <TableCell role="cell" colSpan={4}><h4>{label}<span>{count}</span></h4></TableCell>
  </TableRow>
}
export function directoryBranch(tree?: Worktree) {
  return tree?.branch || (tree?.detached ? "detached HEAD" : tree?.bare ? uiText("裸仓库") : uiText("尚未读取分支"))
}

type DirectoryRowProps = {
  project: string
  name: string
  path: string
  tree?: Worktree
  tool: ProjectOpenTool
  usable: boolean
  issue: boolean
  primary?: boolean
  unavailableStatus?: ReactNode
  details: ReactNode
  notice?: ReactNode
}

export function WorkingDirectoryRow({
  project, name, path, tree, tool, usable, issue, primary,
  unavailableStatus, details, notice,
}: DirectoryRowProps) {
  const context = { id: project, "data-path": path }
  const branch = directoryBranch(tree)
  const branchBadge = <Branch><GitBranch aria-hidden="true" /><span>{branch}</span></Branch>
  const terminalLabel = uiText("用 {0} 打开工作目录", uiText("终端"))

  return <Fragment>
    <TableRow role="row" tabIndex={-1} data-project-id={project} data-directory-path={path} data-primary-directory={primary || undefined} className={`working-directory-row${issue ? " working-directory-issue" : ""}${notice ? " border-b-0" : ""}`}>
      <TableCell role="cell" className={`${directoryCell} directory-identity`}>
        <div className="directory-identity-main">
          <strong className="directory-name">{name}</strong>
          {name !== branch ? <span className="directory-branch" title={branch}>{branchBadge}</span> : null}
        </div>
        <div className="directory-identity-meta">
          <button type="button" className="directory-path" data-action="copy-path" data-path={path} title={uiText("{0}\n复制目录路径", path)} aria-label={uiText("复制目录路径 {0}", path)}>
            <span>{compactWorkspacePath(path)}</span><Copy aria-hidden="true" />
          </button>
          <details className="directory-details">
            <summary>{uiText("详情")}<ChevronDown aria-hidden="true" /></summary>
            <div className="directory-detail-content">
              <div>{uiText("完整路径")} <code>{path}</code></div>
              {details}
              {tree?.status_updated_at ? <div>{uiText("上次检查")} <time data-status-path={path} dateTime={tree.status_updated_at}>{new Date(tree.status_updated_at).toLocaleTimeString(uiLocale(), { hour12: false })}</time></div> : null}
            </div>
          </details>
        </div>
      </TableCell>
      <TableCell role="cell" className={`${directoryCell} directory-sync`}>
        <span className="directory-cell-label" aria-hidden="true">{uiText("远程同步")}</span>
        {usable ? <GitSyncStatus tree={tree} /> : <span className="directory-muted">{issue ? uiText("目录不可用，暂无法确认") : tree?.bare ? uiText("不适用") : uiText("正在检查")}</span>}
      </TableCell>
      <TableCell role="cell" className={`${directoryCell} directory-status`}>
        {usable && tree ? <DirectoryLocalStatus tree={tree} project={project} name={name} path={path} /> : unavailableStatus ?? <TreeStatus tree={tree} compact />}
      </TableCell>
      <TableCell role="cell" className={`${directoryCell} directory-actions-cell`}>
        <div className="directory-actions">
          <ProjectOpenActions project={project} path={path} tool={tool} disabled={!usable} primary={primary} />
          <Action action="changes-open" {...context} disabled={!usable} aria-label={uiText("文件与改动")} title={uiText("文件与改动")}>{uiText("改动")}</Action>
          <Action action="project-terminal" {...context} disabled={!usable} size="icon-sm" className="directory-terminal" title={terminalLabel} aria-label={terminalLabel}><Terminal aria-hidden="true" /></Action>
          <details className={`workspace-more directory-more`}>
            <summary aria-label={uiText("{0} 更多操作", name)}><MoreHorizontal aria-hidden="true" /></summary>
            <div className="workspace-more-menu">
              <Action action="project-conversation-new" {...context} disabled={!usable}>{uiText("新建对话…")}</Action>
              <hr />
              <Action action="git-open" {...context} disabled={!usable}>{uiText("Git 操作")}</Action>
              <Action action="project-open-remote" {...context} disabled={!usable}>{uiText("打开远端仓库")}</Action>
              {!primary && !tree?.bare ? <Action action="remove-worktree" {...context}>{uiText("移除 Worktree")}</Action> : null}
            </div>
          </details>
        </div>
      </TableCell>
    </TableRow>
    {notice ? <TableRow role="row" className="directory-notice-row"><TableCell role="cell" className={`${directoryCell} pt-0`} colSpan={4}>{notice}</TableCell></TableRow> : null}
  </Fragment>
}

function DirectoryLocalStatus({ tree, project, name, path }: { tree: Worktree; project: string; name: string; path: string }) {
  const committed = !tree.detached && !!tree.upstream && tree.sync_available && (tree.sync_ahead || 0) > 0
  return <div className="directory-local-status">
    {tree.dirty ? <Action action="changes-open" id={project} data-path={path} variant="ghost" className="directory-changes-link h-auto p-0" aria-label={uiText("查看 {0} 的 {1} 项改动", name, tree.dirty)}>
      <StatusBadge kind="warning"><Pencil aria-hidden="true" />{uiText("有改动")} {tree.dirty}</StatusBadge>
    </Action> : !committed ? <span title={uiText("工作目录干净，无未提交改动")}><StatusBadge kind="ready"><Check aria-hidden="true" />{uiText("干净")}</StatusBadge></span> : null}
    {committed ? <span title={uiText("已有 {0} 个提交待推送", tree.sync_ahead)}><StatusBadge kind="primary-tag"><GitCommitHorizontal aria-hidden="true" />{uiText("已提交")}</StatusBadge></span> : null}
  </div>
}

function GitSyncStatus({ tree }: { tree?: Worktree }) {
  if (!tree) return null
  const { upstream, detached, sync_available, sync_ahead = 0, sync_behind = 0, operation, conflicts } = tree
  return <div className="comparison space-y-1" title={uiText("同步数量基于本地最近获取的上游记录；获取远端后更新。")}>
    {upstream && !detached ? <div className="directory-sync-summary">
      <code title={upstream}>{upstream}</code>
      {sync_available ? <span className="directory-sync-counts" aria-label={uiText("待推送 {0} 个提交，待拉取 {1} 个提交", sync_ahead, sync_behind)} title={uiText("↑ 待推送 {0} · ↓ 待拉取 {1}{2}", sync_ahead, sync_behind, sync_ahead && sync_behind ? uiText(" · 已分歧") : "")}>
        <span data-active={sync_ahead > 0}>↑{sync_ahead}</span><span data-active={sync_behind > 0}>↓{sync_behind}</span>
      </span> : <span title={uiText("上游不可用，请获取远端")}>{uiText("暂不可用")}</span>}
    </div> : <div>{detached ? uiText("游离 HEAD") : uiText("未设置上游")}</div>}
    {operation ? <div className="font-medium text-amber-800 dark:text-amber-300">{operation === "merge" ? uiText("合并进行中{0}", conflicts?.length ? uiText(" · {0} 个冲突文件", conflicts.length) : uiText(" · 等待完成提交")) : uiText("{0} 进行中", operation)}</div> : null}
  </div>
}
