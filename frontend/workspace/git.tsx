import { uiText } from "../i18n";
import { useState, type ReactNode } from "react"
import { ArrowDownToLine, ArrowUpFromLine, Search } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { Action, Branch, Check, DataTable, Feedback, Field, NativeSelect, Option, SourceOptions, StatusBadge } from "./shared"
import type { GitOverview } from "./types"

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <Card className="git-section gap-4 rounded-lg p-4 shadow-none"><div className="git-section-title mb-0"><h3 className="m-0 text-sm font-semibold">{title}</h3><span className="text-xs text-muted-foreground">{description}</span></div>{children}</Card>
}

// Native fields stay mounted while the controller refreshes repository state.
export function GitView({ overview: v }: { overview: GitOverview }) {
  const [query, setQuery] = useState("")
  const local = v.branches.filter(b => b.kind === "local")
  const remote = v.branches.filter(b => b.kind === "remote")
  const matching = v.branches.filter(b => `${b.name} ${b.upstream || ""} ${b.worktrees.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))

  return <div className="git-workspace">
    <div className="git-workspace-context">
      <div className="git-workspace-directory">
        <Field id="gitWorktree" label={uiText("工作目录")}><NativeSelect id="gitWorktree" data-searchable-select>{v.project.worktrees.filter(t => !t.bare && !t.missing && !t.prunable && !t.error).map(t => <Option key={t.path} value={t.path}>{t.path} · {t.branch || "detached HEAD"}</Option>)}</NativeSelect></Field>
        <Action action="git-terminal" variant="outline">{uiText("打开终端 ↗")}</Action>
      </div>
      <Feedback id="gitContext" className="git-context-summary" role="status" />
    </div>

    <nav className="git-section-navigation" aria-label={uiText("Git 操作分类")}>
      <a href="#git-sync">{uiText("同步")}</a>
      <a href="#git-branches">{uiText("分支")}</a>
      <a href="#git-merge">{uiText("合并")}</a>
    </nav>
    <div className="git-sections">
      <section id="git-sync" className="git-operation-section" aria-label={uiText("同步")}>
        <Section title={uiText("获取与拉取")} description={uiText("获取更新远端记录；拉取只允许快进")}>
          <div className="git-inline">
            <Field id="gitRemote" label={uiText("远端")} className="grow"><NativeSelect id="gitRemote" disabled={!v.remotes.length}>{v.remotes.length ? v.remotes.map(r => <Option key={r.name} value={r.name}>{r.name} · {r.url}</Option>) : <Option value="">{uiText("未配置远端")}</Option>}</NativeSelect></Field>
            <Action action="git-fetch" variant="default" disabled={!v.remotes.length}><ArrowDownToLine aria-hidden="true" />{uiText("获取远端")}</Action>
            <Action action="git-pull">{uiText("快进拉取")}</Action>
            <Action action="git-reload">{uiText("刷新状态")}</Action>
          </div>
          <p className="git-help">{uiText("获取不会切换当前分支。存在未提交修改或未结束的 Git 操作时，先在终端或编辑器处理再拉取。")}</p>
          <details className="git-credential-details"><summary>{uiText("凭证与终端帮助")}</summary><p>{v.credentials?.message || uiText("沿用当前环境的 Git 凭证助手。需要登录时可在终端获取。")}</p><Action action="git-fetch-terminal" disabled={!v.remotes.length}>{uiText("在终端登录并获取 ↗")}</Action></details>
        </Section>
        <Section title={uiText("推送当前分支")} description={uiText("只推送已提交内容，保留未提交修改")}>
          <div className="form-grid"><Field id="gitPushRemote" label={uiText("目标远端")}><NativeSelect id="gitPushRemote">{v.remotes.map(r => <Option key={r.name} value={r.name}>{r.name} · {r.url}</Option>)}</NativeSelect></Field><Field id="gitPushName" label={uiText("远端分支名称")}><Input id="gitPushName" maxLength={160} /></Field></div>
          <div className="git-push-footer"><Check id="gitPushTrack" label={uiText("设置为当前分支的上游")} /><Action action="git-push" variant="default"><ArrowUpFromLine aria-hidden="true" />{uiText("推送")}</Action></div>
          <p id="gitPushDirection" className="git-push-direction" />
        </Section>
      </section>

      <section id="git-branches" className="git-operation-section" aria-label={uiText("分支")}>
        <Section title={uiText("切换当前目录分支")} description={uiText("只影响上方选中的工作目录")}>
          <div className="git-inline"><Field id="gitSwitch" label={uiText("切换到分支")} className="grow"><NativeSelect id="gitSwitch" data-searchable-select /></Field><Field id="gitSwitchName" label={uiText("远端分支对应的新本地分支")} className="grow"><Input id="gitSwitchName" maxLength={160} /></Field><Action action="git-switch" variant="default">{uiText("切换分支")}</Action></div>
          <p id="gitSwitchNote" className="git-help" />
          <small className="git-help">{uiText("有未提交修改、进行中的 Git 操作或分支被其他 Worktree 占用时，不能直接切换。")}</small>
        </Section>
        <Section title={uiText("创建本地分支")} description={uiText("创建后保留当前目录的分支")}>
          <form id="gitCreateForm"><div className="form-grid"><Field id="gitBranchName" label={uiText("新分支名称")}><Input id="gitBranchName" required maxLength={160} placeholder="feature/example" /></Field><Field id="gitBranchSource" label={uiText("来源分支")}><NativeSelect id="gitBranchSource" data-searchable-select required><SourceOptions overview={v} /></NativeSelect></Field></div><div className="git-inline"><div className="mr-auto"><Check id="gitTrack" label={uiText("设置远端跟踪关系")} /></div><Button type="submit">{uiText("创建本地分支")}</Button></div><Feedback id="gitSourceExplanation" className="mt-3 bg-muted text-muted-foreground">{uiText("请选择来源分支。")}</Feedback></form>
        </Section>
        {local.some(b => b.worktrees.length === 0) && remote.length ? <Section title={uiText("更新未检出的本地分支")} description={uiText("无需切换工作目录，只允许快进")}>
          <div className="form-grid"><Field id="gitFFLocal" label={uiText("本地分支")}><NativeSelect id="gitFFLocal" data-searchable-select>{local.filter(b => b.worktrees.length === 0).map(b => <Option key={b.name} value={b.name}>{b.name}</Option>)}</NativeSelect></Field><Field id="gitFFSource" label={uiText("快进到远端分支")}><NativeSelect id="gitFFSource" data-searchable-select>{remote.map(b => <Option key={b.ref} value={b.ref}>{b.name}</Option>)}</NativeSelect></Field></div><div><Action action="git-fast-forward">{uiText("快进更新本地分支")}</Action></div><small className="git-help">{uiText("分支有分歧或已被 Worktree 检出时会拒绝更新。")}</small>
        </Section> : null}
        <Section title={uiText("全部分支")} description={uiText("{0} 个本地 · {1} 个远端", local.length, remote.length)}>
          <div className="git-branch-search"><Search aria-hidden="true" /><Input id="gitBranchSearch" value={query} onChange={event => setQuery(event.target.value)} type="search" aria-label={uiText("搜索分支、上游或工作目录")} placeholder={uiText("搜索分支、上游或工作目录")} /></div>
          <DataTable label={uiText("Git 分支")} headers={[uiText("分支 / 提交 / 跟踪"), uiText("占用的 Worktree"), uiText("操作")]}>{matching.length ? matching.map(b => <TableRow key={b.ref}><TableCell className="align-top whitespace-normal"><div className="flex flex-wrap items-center gap-2"><Branch>{b.name}</Branch><StatusBadge kind={b.kind === "remote" ? "neutral" : "primary-tag"}>{b.kind === "remote" ? uiText("远端") : uiText("本地")}</StatusBadge></div><div className="comparison">{b.commit.slice(0, 8)}{b.upstream ? uiText(" · 跟踪 {0}", b.upstream) : ""}</div></TableCell><TableCell className="align-top whitespace-normal">{b.worktrees.length ? b.worktrees.map(path => <div key={path} className="path">{path}</div>) : <span className="quiet">{uiText("未检出")}</span>}</TableCell><TableCell className="align-top"><Action action="git-use-source" data-ref={b.ref}>{uiText("以此创建分支")}</Action></TableCell></TableRow>) : <TableRow><TableCell colSpan={3} className="whitespace-normal">{query ? uiText("没有匹配的分支，试试其他名称。") : uiText("尚无分支记录，请先获取远端或在终端创建初始提交。")}</TableCell></TableRow>}</DataTable>
        </Section>
      </section>

      <section id="git-merge" className="git-operation-section" aria-label={uiText("合并")}>
        <Section title={uiText("将当前分支合并到…")} description={uiText("选择目标分支，当前目录保留在原分支")}>
          <Field id="gitMergeTarget" label={uiText("目标本地分支")}><NativeSelect id="gitMergeTarget" data-searchable-select /></Field>
          <p id="gitMergeIntoDirection" className="git-help whitespace-pre-wrap break-words" role="status" />
          <div className="git-inline"><Action action="git-merge-into-preview" variant="default">{uiText("预览合并")}</Action><Action action="git-merge-into" disabled>{uiText("合并到目标分支")}</Action></div>
          <Feedback id="gitMergeIntoPreview" className="mt-3 bg-muted" hidden />
          <small className="git-help">{uiText("仅合并已提交内容。目标目录需要干净；出现冲突时停止，目标分支保留原状态。需要发布时，再切到目标分支推送。")}</small>
        </Section>
        <Section title={uiText("合并到当前分支")} description={uiText("先预览待合入提交，再执行合并")}>
          <div id="gitMergeActive" hidden><Feedback id="gitMergeStatus" className="bg-muted" role="status" /><div className="git-inline"><Action action="git-merge-ai" variant="default">{uiText("让 AI 完成合并")}</Action><Action action="git-merge-abort">{uiText("中止合并")}</Action></div></div>
          <div id="gitMergeForm"><Field id="gitMergeSource" label={uiText("待合入的分支")}><NativeSelect id="gitMergeSource" data-searchable-select><SourceOptions overview={v} includeHead={false} /></NativeSelect></Field><div className="git-inline"><Action action="git-merge-preview" variant="default">{uiText("预览合并")}</Action><Action action="git-merge" disabled>{uiText("执行合并")}</Action></div><Feedback id="gitMergePreview" className="mt-3 bg-muted" hidden /></div>
        </Section>
      </section>
    </div>
  </div>
}
