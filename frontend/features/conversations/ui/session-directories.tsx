import {useEffect, useId, useRef, useState, type FormEvent} from "react"
import {ChevronDown, CircleAlert, FileDiff, Folder, FolderOpen, GitBranch, Plus, Terminal, X} from "lucide-react"
import {MessageNotSentError} from "@assistant-ui/react"
import {Button} from "@/shared/ui/primitives/button"
import {Input} from "@/shared/ui/primitives/input"
import {NativeSelect, NativeSelectOption as Option} from "@/shared/ui/primitives/native-select"
import {uiText} from "@/shared/i18n"
import {conversationPathKey} from "@/shared/lib/workspace-identity"
import type {ChangedFile} from "@/features/files/model/changes"
import type {GitOverview} from "@/entities/projects/model"
import type {ChatController} from "../runtime/controller"
import {useChatState} from "../runtime/use-chat-state"
import type {BindingInput, SessionTarget} from "@/entities/conversations/bindings"
import type {Entry, Session} from "../model/messages"

type ProjectOption = NonNullable<ChatController["options"]["overview"]>["projects"][number]
type Binding = BindingInput & {
  id: string; directory: string; project_name?: string; branch?: string; worktree_id?: string;
  status: "pending" | "configuring" | "ready" | "error" | "unsupported";
  error?: string; warning?: string; conflicts?: {id: string; name: string; cwd: string}[];
  git?: {files?: ChangedFile[]; additions?: number; deletions?: number}; observed?: string[]; attributed?: string[]; activities?: Entry[];
}
type BindingSet = {
  cwd?: string; native_resume_requires_confirmation?: boolean; bindings: Binding[]; capabilities?: {
    multiple_directories?: boolean; dynamic_directory_access?: boolean;
    native_permission_requests?: boolean; enforce_read_only_directories?: boolean;
  };
}
type Prompt = {
  initial?: BindingInput;
  binding?: Binding;
  conflict?: string;
  purpose: string;
  resolve?: (confirm: boolean) => void;
}

const recentKey = "workhub:recent-session-projects:v1"
function recentProjects(environment: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentKey + ":" + environment) || "[]")
    return Array.isArray(value) ? value.filter(item => typeof item === "string") : []
  } catch { return [] }
}
function rememberProject(environment: string, project?: string) {
  if (!project) return
  try { localStorage.setItem(recentKey + ":" + environment, JSON.stringify([project, ...recentProjects(environment).filter(id => id !== project)].slice(0, 8))) }
  catch { /* Recency is optional when storage is unavailable. */ }
}

export function projectMention(draft: string) {
  return draft.match(/(?:^|\s)@([^\s@]*)$/u)?.[1]
}

function namedProject(text: string, projects: ProjectOption[]) {
  const matches = projects.filter(project => new RegExp(
    `(?:^|[^\\p{L}\\p{N}_.-])${project.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}_.-])`, "iu",
  ).test(text))
  return matches.length === 1 ? matches[0] : undefined
}

function mentionedProjects(text: string, projects: ProjectOption[]) {
  const byName = new Map<string, ProjectOption[]>()
  for (const project of projects) {
    const name = project.name.toLowerCase()
    if (name) byName.set(name, [...(byName.get(name) || []), project])
  }
  if (!byName.size || !text.includes("@")) return {explicit: false, projects: []}
  const names = [...byName.keys()].sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_.@-])@(${names.join("|")})(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}_.-])`, "gu")
  const matches = [...text.toLowerCase().matchAll(pattern)]
  const found = new Set<ProjectOption>()
  for (const [, name] of matches) {
    const candidates = byName.get(name)
    if (candidates?.length === 1) found.add(candidates[0])
  }
  return {explicit: matches.length > 0, projects: [...found]}
}

const json = (method: string, body: unknown): RequestInit => ({method, body:JSON.stringify(body)})
const failure = (error: unknown) => error instanceof Error ? error.message : String(error)
const labelFor = (binding: BindingInput, projects: ProjectOption[]) => projects.find(project => project.id === binding.project_id)?.name || binding.directory?.split(/[\\/]/).filter(Boolean).at(-1) || uiText("本地目录")
const emptyBindings: Binding[] = []
const formatCount = (value: number) => value.toLocaleString("en-US")
function observedPath(directory: string, file: string) {
  const root = conversationPathKey(directory)
  return conversationPathKey(file).startsWith(root + "/") ? file.slice(root.length + 1) : file
}
function bindingHasChanges(binding: Binding) {
  return (binding.git?.files?.length || 0) > 0 || (binding.git?.additions || 0) > 0 || (binding.git?.deletions || 0) > 0
}
function bindingStatusLabel(binding: Binding) {
  if (binding.status === "ready") return binding.access === "read" ? uiText("只读") : uiText("可修改")
  if (binding.status === "error") return uiText("异常")
  if (binding.status === "unsupported") return uiText("未授权")
  if (binding.status === "configuring") return uiText("配置中")
  return uiText("待配置")
}

export function useSessionDirectories(controller: ChatController, session: Session | null, provider: string, busy: boolean) {
  const [data, setData] = useState<BindingSet>()
  const [error, setError] = useState("")
  const [prompt, setPrompt] = useState<Prompt>()
  const [detail, setDetail] = useState("")
  const [scope, setScope] = useState<"all" | "changes">("all")
  const [planned, setPlanned] = useState<BindingInput[]>(() => controller.options.target?.bindings || [])
  const [createWorktree, setCreateWorktree] = useState(false)
  const [inspection, setInspection] = useState<"available" | "occupied" | "unavailable">()
  const [rejectedDirectory, setRejectedDirectory] = useState<{path: string; additional: boolean}>()
  const [preparing, setPreparing] = useState(false)
  const worktreeRequest = useRef<{project: string; slug: string; path?: string} | undefined>(undefined)
  const [dismissed, setDismissed] = useState("")
  const plannedRef = useRef(planned)
  const approvalRef = useRef<Prompt | undefined>(undefined)
  const revision = useRef(0)
  const base = session ? `/api/sessions/${encodeURIComponent(session.id)}/bindings` : ""
  const assistantDraft = !session && controller.isYoluAssistant()
  const { request, environment, overview, readOnly } = controller.options
  const projects = overview?.projects || []
  const bindings = data?.bindings || emptyBindings
  const target = {...controller.options.target}
  const {cwd, project_id: projectID, access} = target
  const inspectPrimary = !session && !readOnly && !assistantDraft && !controller.isCloud() && access !== "read" && !!(cwd || projectID)
  const useSelectedDirectory = inspectPrimary && !createWorktree
  const rejectedPrimary = rejectedDirectory && !rejectedDirectory.additional ? rejectedDirectory.path : undefined
  const primaryOccupied = rejectedPrimary || (useSelectedDirectory && inspection === "occupied")
  useEffect(() => {
    setInspection(undefined)
    if (!inspectPrimary) return
    const abort = new AbortController()
    void request<Binding>("/api/session-bindings/inspect?include_files=false", {
      ...json("POST", {project_id:projectID, directory:cwd, role:"primary", access:"write", provider}), signal:abort.signal,
    }).then(binding => {
      if (!abort.signal.aborted) setInspection(binding.conflicts?.length ? "occupied" : "available")
    }).catch(() => {
      if (!abort.signal.aborted) setInspection("unavailable")
    })
    return () => abort.abort()
  }, [inspectPrimary, cwd, projectID, provider, request])
  const bindingVersion = JSON.stringify(bindings.map(binding => [binding.id,binding.directory,binding.project_id,!!binding.git,binding.role]))
  useEffect(() => {
    if (!session) return
    const directories = (JSON.parse(bindingVersion) as [string,string,string | null,boolean,string][]).map(([id,path,project,git,role]) => ({id,path,project,git,primary:role === "primary"}))
    window.dispatchEvent(new CustomEvent("workhub:session-bindings-changed", {detail:{session:session.id, environment, directories}}))
  }, [bindingVersion,environment,session?.id])
  const excluded = new Set([target.project_id || "", ...bindings.map(binding => binding.project_id || ""), ...planned.map(binding => binding.project_id || "")])
  const addDirectory = () => setPrompt({purpose:uiText("为此对话添加参考或开发目录。")})

  useEffect(() => {
    if (session || assistantDraft || readOnly || busy) return
    document.addEventListener("workhub:creation-add-directory", addDirectory)
    return () => document.removeEventListener("workhub:creation-add-directory", addDirectory)
  }, [session, assistantDraft, readOnly, busy])

  useEffect(() => {
    approvalRef.current = prompt
    return () => { if (approvalRef.current === prompt) approvalRef.current = undefined }
  }, [prompt])
  useEffect(() => () => approvalRef.current?.resolve?.(false), [controller])
  useEffect(() => {
    if (!base) return
    const abort = new AbortController()
    let loading = false
    async function refresh() {
      if (loading || abort.signal.aborted || document.hidden || document.documentElement.hasAttribute("data-workspace-inactive")) return
      loading = true
      const version = revision.current
      try {
        const result = await request<BindingSet>(base, {signal:abort.signal})
        if (!abort.signal.aborted && version === revision.current) {setData(result); setError("")}
      } catch (error) {
        if (!abort.signal.aborted && version === revision.current) setError(failure(error))
      } finally { loading = false }
    }
    void refresh()
    const timer = setInterval(refresh, busy ? 1800 : 5000)
    const refreshWhenShown = () => { void refresh() }
    document.addEventListener("visibilitychange", refreshWhenShown)
    window.addEventListener("workhub:page-visibility", refreshWhenShown)
    return () => {
      abort.abort()
      clearInterval(timer)
      document.removeEventListener("visibilitychange", refreshWhenShown)
      window.removeEventListener("workhub:page-visibility", refreshWhenShown)
    }
  }, [base, busy, request])

  function closePrompt(confirm = false) {
    const pending = approvalRef.current || prompt
    setPrompt(undefined)
    approvalRef.current = undefined
    pending?.resolve?.(confirm)
    if (!confirm) setDismissed(controller.getSnapshot().draft)
  }
  function ask(input: Omit<Prompt, "resolve">) {
    return new Promise<boolean>(resolve => {
      const next = {...input,resolve}
      approvalRef.current = next
      setPrompt(next)
    })
  }
  function updatePlanned(next: BindingInput[]) {
    plannedRef.current = next
    setPlanned(next)
    controller.options.updateDraftBindings?.(next)
  }
  async function save(input: BindingInput) {
    if (!prompt) return
    if (base) {
      const bound = prompt.binding
      revision.current++
      const result = await request<BindingSet>(bound ? base + "/" + encodeURIComponent(bound.id) : base, json(bound ? "PUT" : "POST", input))
      revision.current++
      setData(result)
      if (bound) setDetail(bound.id)
    } else {
      const key = conversationPathKey(input.directory || "")
      if (target.cwd && conversationPathKey(target.cwd) === key) throw new Error(uiText("此目录已是主工作目录。"))
      updatePlanned([...plannedRef.current.filter(binding => conversationPathKey(binding.directory || "") !== key), input])
    }
    rememberProject(environment, input.project_id)
    closePrompt(true)
  }
  async function remove(binding: Binding) {
    if (!base) return
    try {
      revision.current++
      const result = await request<BindingSet>(base + "/" + encodeURIComponent(binding.id), json("DELETE", {}))
      revision.current++
      setData(result)
      setDetail("")
    } catch (error) { setError(failure(error)) }
  }
  function showFiles(binding: Binding, path?: string, defaultMode?: "all" | "working" | "index") {
    const files = binding.git?.files || []
    const file = path ? files.find(item => item.path === path) : undefined
    const hasWorking = files.some(item => item.untracked || item.working.trim())
    const hasIndex = files.some(item => !item.untracked && item.index.trim())
    const mode = file
      ? (!file.working.trim() && !file.untracked ? "index" : "working")
      : defaultMode === "working"
        ? (hasWorking ? "working" : hasIndex ? "index" : "all")
        : defaultMode
    window.dispatchEvent(new CustomEvent("workhub:binding-files", {detail:{session:session?.id, environment, id:binding.id, path:binding.directory, project:binding.project_id, git:!!binding.git, file:path,mode}}))
  }
  async function send(text: string, images: string[]) {
    let runtimeTarget = target
    if (!session && createWorktree && target.project_id) {
      if (preparing) throw new Error(uiText("正在准备工作目录…"))
      setPreparing(true)
      try {
        if (worktreeRequest.current?.project !== target.project_id) worktreeRequest.current = {project:target.project_id,slug:"session-" + crypto.randomUUID().slice(0, 12)}
        const planned = worktreeRequest.current
        const route = `/api/projects/${encodeURIComponent(planned.project)}`
        const branch = "codex/" + planned.slug
        // Reuse a worktree after an acknowledged creation or a lost response.
        if (!planned.path) {
          const overview = await request<GitOverview>(route + "/git")
          planned.path = overview.project.worktrees.find(tree => tree.branch === branch && !tree.missing && !tree.prunable && !tree.error)?.path
          if (!planned.path) {
            const result = await request<{path:string}>(route + "/worktrees", json("POST", {mode:"new",slug:planned.slug,branch,source:"HEAD"}))
            if (!result.path) throw new Error(uiText("Worktree 已创建，但未返回执行目录。请从项目页选择它。"))
            planned.path = result.path
          }
        }
        runtimeTarget = {...target,cwd:planned.path}
      } finally {setPreparing(false)}
    }
    let payload: SessionTarget = session ? {} : {...runtimeTarget, ...(useSelectedDirectory ? {allow_shared:true} : {}), bindings:plannedRef.current}
    const mentions = mentionedProjects(text, projects)
    const natural = !mentions.explicit && !busy ? namedProject(text, projects) : undefined
    const matches = natural ? [natural] : mentions.projects
    if (!readOnly && !session?.archived && matches.length) {
      const saved = base ? await request<BindingSet>(base) : undefined
      const managedSession = saved?.native_resume_requires_confirmation
      const projectIDs = new Set<string>()
      const primaryProject = session ? session.primary_project_id : target.project_id
      if (primaryProject && !managedSession) projectIDs.add(primaryProject)
      const paths = new Set<string>()
      const cwd = session ? saved?.cwd || session.cwd : runtimeTarget.cwd
      if (cwd) paths.add(conversationPathKey(cwd))
      if (!managedSession) {
        for (const path of session?.additional_directories || []) paths.add(conversationPathKey(path))
      }
      for (const binding of [...(saved?.bindings || []), ...plannedRef.current]) {
        if (binding.project_id) projectIDs.add(binding.project_id)
        if (binding.directory) paths.add(conversationPathKey(binding.directory))
      }
      const inputs: BindingInput[] = []
      for (const match of matches) {
        const path = conversationPathKey(match.path)
        if (projectIDs.has(match.id) || paths.has(path)) continue
        inputs.push({project_id:match.id, directory:match.path, access:"read", role:"additional"})
        projectIDs.add(match.id)
        paths.add(path)
      }
      if (inputs.length) {
        if (busy) throw new Error(uiText("请等待当前运行结束，再发送包含新项目引用的消息。"))
        if (base) {
          revision.current++
          const result = await request<BindingSet>(base, json("POST", {project_ids:inputs.map(input => input.project_id)}))
          revision.current++
          setData(result)
          setError("")
        } else {
          payload = {...payload, bindings:[...plannedRef.current, ...inputs]}
        }
        for (const input of inputs) rememberProject(environment, input.project_id)
      }
    }
    try { await controller.send(text, images, false, payload) }
    catch (error) {
      const {code, conflictDirectory} = error as {code?: string; conflictDirectory?: string}
      if (code !== "directory_conflict") throw error
      if (!session) {
        if (!conflictDirectory) throw error
        const key = conversationPathKey(conflictDirectory)
        const additional = plannedRef.current.some(binding => binding.role !== "primary" && binding.access === "write" && conversationPathKey(binding.directory || "") === key)
        setRejectedDirectory({path:conflictDirectory, additional})
        controller.setError("")
        throw new MessageNotSentError()
      }
      const approved = await ask({purpose:failure(error),conflict:data?.cwd || session.cwd})
      if (!approved) throw error
      await controller.send(text, images, false, {allow_shared:true})
    }
  }

  const changedCount = bindings.filter(bindingHasChanges).length
  const visibleBindings = scope === "changes" ? bindings.filter(bindingHasChanges) : bindings
  const header = <>
    {session && bindings.length > 0 ? <label className="session-dir-filter">
      <select value={scope} aria-label={uiText("筛选关联目录")} onChange={event => setScope(event.target.value === "changes" ? "changes" : "all")}>
        <option value="all">{uiText("全部目录")}</option>
        <option value="changes">{changedCount > 0 ? uiText("有改动 ({0})", changedCount) : uiText("有改动")}</option>
      </select>
      <ChevronDown aria-hidden="true" />
    </label> : <strong className="session-dir-heading">{uiText("关联目录")}</strong>}
    {!readOnly && !session?.archived && <Button type="button" size="xs" variant="ghost" className="session-dir-add" aria-label={uiText("添加项目或目录")} onClick={addDirectory}><Plus aria-hidden="true" />{uiText("添加项目")}</Button>}
  </>
  const plannedRows = planned.map(binding => <div className="session-dir-item" key={binding.directory}>
    <div className="session-dir-row-bar session-context-chip session-context-draft session-dir-draft" title={binding.directory}>
      <span className="session-dir-icon" aria-hidden="true"><Folder /></span>
      <span className="session-dir-identity"><span className="session-dir-name">{labelFor(binding, projects)}</span></span>
      <span className="session-dir-trailing"><small className="session-dir-badge" data-access={binding.access}>{binding.access === "read" ? uiText("只读") : uiText("可修改")}</small></span>
      <Button type="button" size="icon-xs" variant="ghost" disabled={busy || preparing} aria-label={uiText("移除 {0}", labelFor(binding, projects))}
        onClick={() => updatePlanned(plannedRef.current.filter(item => item !== binding))}><X aria-hidden="true" /></Button>
    </div>
    {!session && rejectedDirectory?.additional && conversationPathKey(rejectedDirectory.path) === conversationPathKey(binding.directory || "") && <CreationDirectoryConflict
      additionalShare={{checked:!!binding.allow_shared, disabled:busy || preparing,
        onChange: checked => updatePlanned(plannedRef.current.map(item => item === binding ? {...item, allow_shared:checked} : item))}} />}
  </div>)
  const directoryList = <div className="session-context-strip session-dir-list" role="group" aria-label={uiText("对话项目与目录")}>
    {session ? visibleBindings.map(binding => {
      const name = binding.project_name || labelFor(binding, projects)
      const open = detail === binding.id
      const additions = binding.git?.additions || 0
      const deletions = binding.git?.deletions || 0
      const fileCount = binding.git?.files?.length || 0
      const hasChanges = additions > 0 || deletions > 0 || fileCount > 0
      const alertText = !open ? [binding.error, binding.warning, binding.conflicts?.length && uiText("共享写入目录 · {0}", binding.conflicts.map(conflict => conflict.name || conflict.id).join("、"))].filter(Boolean).join(" · ") : ""
      return <div className="session-dir-item" key={binding.id} data-expanded={open || undefined}>
        <div className="session-dir-row-bar">
          <button type="button" className="session-context-chip session-dir-row" data-role={binding.role} data-status={binding.status}
            aria-expanded={open} aria-label={uiText("查看 {0} 的目录详情", name)} title={binding.branch ? `${name} · ${binding.branch}\n${binding.directory}` : `${name}\n${binding.directory}`}
            onClick={() => setDetail(open ? "" : binding.id)}>
            <span className="session-dir-icon" aria-hidden="true">
              {binding.status === "error" || binding.status === "unsupported" ? <CircleAlert /> : binding.git || binding.branch ? <GitBranch /> : <Folder />}
            </span>
            <span className="session-dir-identity">
              <span className="session-dir-name">{name}</span>
              {binding.branch && <><span className="session-dir-sep" aria-hidden="true">·</span><span className="session-context-branch session-dir-branch">{binding.branch}</span></>}
            </span>
            <span className="session-dir-trailing">
              {(additions > 0 || deletions > 0) ? <span className="session-dir-diff" aria-label={uiText("新增 {0} 行，删除 {1} 行", additions, deletions)}>
                {additions > 0 && <span className="session-dir-added">+{formatCount(additions)}</span>}
                {deletions > 0 && <span className="session-dir-deleted">-{formatCount(deletions)}</span>}
              </span> : fileCount > 0 ? <span className="session-dir-file-count">{uiText("{0} 个改动", fileCount)}</span> : null}
              <small className="session-dir-badge" data-status={binding.status} data-access={binding.access}>{bindingStatusLabel(binding)}</small>
            </span>
          </button>
          <button type="button" className="session-dir-quick-action" title={hasChanges ? uiText("查看改动") : uiText("查看文件")}
            aria-label={hasChanges ? uiText("查看 {0} 的改动", name) : uiText("查看 {0} 的文件", name)}
            onClick={() => showFiles(binding, undefined, hasChanges ? "working" : "all")}>
            {hasChanges ? <FileDiff aria-hidden="true" /> : <FolderOpen aria-hidden="true" />}
          </button>
        </div>
        {alertText && <p className="session-dir-inline-alert" role="status">{alertText}</p>}
        {open && <BindingDetails binding={binding} close={() => setDetail("")}
          edit={readOnly || session?.archived ? undefined : () => setPrompt({binding,initial:binding,purpose:uiText("更新此目录的访问范围或工作目录。")})}
          remove={readOnly || session?.archived ? undefined : () => void remove(binding)}
          showFiles={path => showFiles(binding, path, path ? undefined : hasChanges ? "working" : "all")}
          openProject={binding.project_id && controller.options.openProject ? () => controller.options.openProject?.(binding.project_id!,binding.directory) : undefined}
          openTerminal={environment === "local" && controller.options.openTerminal ? () => controller.options.openTerminal?.(binding) : undefined} />}
      </div>
    }) : plannedRows}
    {session && bindings.length > 0 && !visibleBindings.length && <div className="session-dir-empty-filter">
      <span className="session-context-empty">{uiText("当前关联目录没有未提交改动")}</span>
      <Button type="button" size="xs" variant="ghost" onClick={() => setScope("all")}>{uiText("查看全部目录")}</Button>
    </div>}
    {session && !bindings.length && !error && <span className="session-context-empty">{uiText(data ? "未绑定项目目录" : "正在读取目录…")}</span>}
    {!session && !planned.length && <span className="session-context-empty">{uiText("未绑定项目目录")}</span>}
  </div>
  return {
    send, target, header,
    context: <>
      {directoryList}
      {error && <p className="session-context-error" role="alert">{error}</p>}
    </>,
    dialog: prompt && <BindingDialog prompt={prompt} request={request} environment={environment} provider={provider} session={session?.id}
      projects={projects} hasPrimary={!!controller.options.updateDraftBindings || !!target.project_id || !!target.cwd || [...bindings,...planned].some(binding => binding.role === "primary")} save={save} cancel={() => closePrompt()} confirm={() => closePrompt(true)} />,
    cwd: data?.cwd,
    managed: !session || !!data?.native_resume_requires_confirmation || !data && session.source === "workbench",
    composer: !readOnly && !session?.archived && <DraftProjectSuggestions controller={controller} projects={projects}
      excluded={excluded} dismissed={dismissed} dismiss={setDismissed} configure={assistantDraft ? undefined : setPrompt} />,
    preparing,
    creation: !session && !readOnly && <>
      {target.project_id && <label className="session-worktree-choice">
        <input type="checkbox" checked={createWorktree} disabled={busy || preparing} onChange={event => {
          setCreateWorktree(event.target.checked)
          setRejectedDirectory(conflict => conflict?.additional ? conflict : undefined)
        }} />
        <span>{uiText("创建新 Worktree")}</span>
      </label>}
      {primaryOccupied ? <CreationDirectoryConflict suggestWorktree={!!target.project_id && !createWorktree}
        path={createWorktree ? rejectedPrimary : undefined} />
        : useSelectedDirectory && inspection !== "available" && <p role="status" className="session-creation-directory-status">
          {inspection === "unavailable" ? uiText("暂时无法检查目录占用。") : uiText("正在检查工作目录…")}
        </p>}
      {controller.options.updateDraftBindings && <div className="session-creation-bindings">
        <Button type="button" size="sm" variant="ghost" disabled={busy || preparing} onClick={addDirectory}><Plus aria-hidden="true" />{uiText("添加附加目录")}</Button>
        {plannedRows}
      </div>}
    </>,
  }
}

function CreationDirectoryConflict({suggestWorktree, path, additionalShare}: {
  suggestWorktree?: boolean; path?: string;
  additionalShare?: {checked: boolean; disabled: boolean; onChange: (checked: boolean) => void};
}) {
  const description = useId()
  return <div className="session-creation-directory-conflict">
    <p id={additionalShare ? description : undefined} role="status"><CircleAlert aria-hidden="true" /><span>
      {path ? uiText("新 Worktree 正被其他对话使用，请选择其他目录。") : suggestWorktree ? uiText("其他对话正在使用此目录，建议新建 Worktree。") : uiText("其他对话正在使用此目录。")}
      {path && <code>{path}</code>}
    </span></p>
    {additionalShare && <label className="session-share-choice"><input type="checkbox" aria-describedby={description} checked={additionalShare.checked} disabled={additionalShare.disabled}
      onChange={event => additionalShare.onChange(event.target.checked)} />{uiText("允许共享附加目录")}</label>}
  </div>
}

function DraftProjectSuggestions({controller, projects, excluded, dismissed, dismiss, configure}: {
  controller: ChatController; projects:ProjectOption[]; excluded:Set<string>; dismissed:string;
  dismiss:(draft:string) => void; configure?:(prompt:Prompt) => void;
}) {
  const draft = useChatState(controller, snapshot => snapshot.draft)
  if (draft === dismissed) return null
  const mention = projectMention(draft)
  if (mention !== undefined) return <div className="session-context-suggestion" aria-label={uiText("选择要引用的项目")}>
    {projects.filter(project => !excluded.has(project.id) && project.name.toLowerCase().includes(mention.toLowerCase())).slice(0, 6).map(project =>
      <Button key={project.id} type="button" size="sm" variant="outline" onClick={() =>
        controller.setDraft(draft.replace(/@[^\s@]*$/u, () => "@" + project.name + " "))
      }>@{project.name}</Button>)}
    {configure && <Button type="button" size="sm" variant="ghost" onClick={() => configure({initial:{access:"read"},purpose:uiText("选择消息所引用的本地目录。")})}><FolderOpen aria-hidden="true" />{uiText("选择本地目录…")}</Button>}
    <Button type="button" size="icon-sm" variant="ghost" aria-label={uiText("关闭项目选择器")} onClick={() => dismiss(draft)}><X aria-hidden="true" /></Button>
  </div>
  return null
}

function BindingDetails({binding, close, edit, remove, showFiles, openProject, openTerminal}: {
  binding: Binding; close: () => void; edit?: () => void; remove?: () => void;
  showFiles: (path?:string) => void; openProject?: () => void; openTerminal?: () => void;
}) {
  const files = binding.git?.files || []
  const observed = binding.observed || []
  const attributed = binding.attributed || []
  const additions = files.filter(file => !file.untracked && (file.index === "A" || file.working === "A")).length
  const deletions = files.filter(file => file.index === "D" || file.working === "D").length
  const untracked = files.filter(file => file.untracked).length
  const staged = files.filter(file => !file.untracked && file.index.trim()).length
  const unstaged = files.filter(file => file.untracked || file.working.trim()).length
  return <section className="session-binding-details" aria-label={uiText("目录详情")}>
    <div className="session-binding-title"><strong>{binding.project_name || binding.directory}</strong><Button type="button" size="icon-sm" variant="ghost" onClick={close} aria-label={uiText("关闭目录详情")}><X aria-hidden="true" /></Button></div>
    <dl>
      <dt>{uiText("实际目录")}</dt><dd><code>{binding.directory}</code></dd>
      {binding.branch && <><dt>{uiText("当前分支")}</dt><dd>{binding.branch}</dd></>}
      {binding.worktree_id && <><dt>Worktree</dt><dd><code>{binding.worktree_id}</code></dd></>}
      <dt>{uiText("访问范围")}</dt><dd>{binding.status === "ready" ? "" : uiText("请求权限 · ")}{binding.access === "read" ? uiText("只读") : uiText("可修改")}{binding.role === "primary" ? " · " + uiText("主项目") : ""}</dd>
    </dl>
    {(binding.warning || binding.error || !!binding.conflicts?.length) && <p role="status" className="session-context-error">{[binding.warning,binding.error,binding.conflicts?.length && uiText("共享写入目录 · {0}",binding.conflicts.map(conflict => conflict.name || conflict.id).join("、"))].filter(Boolean).join(" · ")}</p>}
    {binding.git ? <div className="session-binding-changes">
      <strong>{uiText("目录 Git 改动 · {0}", files.length)}</strong>
      <span>{uiText("已暂存 {0} · 未暂存 {1}", staged, unstaged)}</span>
      <span>{uiText("新增 {0} · 删除 {1} · 未跟踪 {2}",additions,deletions,untracked)}</span>
      <ul>{files.slice(0, 12).map(file => <li key={file.path}><code>{file.untracked ? "??" : file.index + file.working}</code><Button type="button" variant="link" size="xs" onClick={() => showFiles(file.path)}>{file.path}</Button></li>)}</ul>
    </div> : <p className="session-context-empty">{uiText("此目录没有 Git 状态，文件浏览和运行记录仍可用。")}</p>}
    {!!observed.length && <details><summary>{uiText("运行期间观察到 {0} 个文件变化", observed.length)}</summary><ul className="session-binding-observations">
      {observed.slice(0, 24).map(file => <li key={file}><code>{observedPath(binding.directory,file)}</code></li>)}</ul></details>}
    {!!attributed.length && <details><summary>{uiText("工具记录明确关联 {0} 个文件", attributed.length)}</summary><ul className="session-binding-observations">
      {attributed.slice(0, 24).map(file => <li key={file}><code>{observedPath(binding.directory,file)}</code></li>)}</ul></details>}
    {!!binding.activities?.length && <ul className="session-binding-activity">{binding.activities.slice(-4).map(entry => <li key={entry.id}><code>{entry.command || entry.tool || entry.kind}</code><small>{entry.status}</small></li>)}</ul>}
    <div className="session-binding-actions">
      <Button type="button" size="sm" variant="outline" onClick={() => showFiles()}>{uiText("文件与改动")}</Button>
      {openTerminal && <Button type="button" size="sm" variant="outline" onClick={openTerminal}><Terminal aria-hidden="true" />{uiText("终端")}</Button>}
      {openProject && <Button type="button" size="sm" variant="ghost" onClick={openProject}>{uiText("打开项目")}</Button>}
      {edit && <Button type="button" size="sm" variant="ghost" onClick={edit}>{uiText("更改目录与权限")}</Button>}
      {remove && <Button type="button" size="sm" variant="ghost" onClick={remove}>{uiText("取消关联")}</Button>}
    </div>
  </section>
}

function BindingDialog({prompt, request, environment, provider, session, projects, hasPrimary, save, cancel, confirm}: {
  prompt: Prompt; request: ChatController["options"]["request"]; environment: string; provider: string; session?: string;
  projects: ProjectOption[]; hasPrimary: boolean; save: (input:BindingInput) => Promise<void>; cancel: () => void; confirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const formID = useId()
  useEffect(() => { dialog.current?.showModal() }, [])
  const [project, setProject] = useState(prompt.initial?.project_id || "")
  const [directory, setDirectory] = useState(prompt.initial?.directory || "")
  const [access, setAccess] = useState<BindingInput["access"]>(prompt.initial?.access || "read")
  const [role, setRole] = useState<BindingInput["role"]>(prompt.binding?.role || "additional")
  const [query, setQuery] = useState("")
  const [preview, setPreview] = useState<Binding>()
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const recent = recentProjects(environment)
  const selected = projects.find(item => item.id === project)
  const directories = selected ? [...new Set([selected.path,...selected.worktrees.filter(tree => !tree.missing).map(tree => tree.path),...(directory ? [directory] : [])])] : []
  const matching = projects.filter(item => item.id === project || [item.name,item.path].some(value => value.toLowerCase().includes(query.toLowerCase())))
  matching.sort((a,b) => (recent.indexOf(a.id) + 1 || 100) - (recent.indexOf(b.id) + 1 || 100) || a.name.localeCompare(b.name))
  function invalidate() { setPreview(undefined); setShared(false); setError("") }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (prompt.conflict) { confirm(); return }
    if (busy) return
    setBusy(true); setError("")
    try {
      const input: BindingInput = {project_id:project || undefined, directory:directory.trim() || selected?.path, access, role, allow_shared:shared}
      if (preview) await save({...input,directory:preview.directory})
      else setPreview(await request<Binding>("/api/session-bindings/inspect", json("POST", {...input,session_id:session,provider})))
    } catch (error) { setError(failure(error)) }
    finally { setBusy(false) }
  }
  async function browse() {
    setBusy(true); setError("")
    try {
      const result = await request<{path?:string}>("/api/dialogs/directory",json("POST",{}))
      if (result.path) { setDirectory(result.path); invalidate() }
    } catch (error) { setError(failure(error)) }
    finally { setBusy(false) }
  }
  return <dialog ref={dialog} className="session-binding-dialog shadcn-scope" aria-labelledby={formID + "-title"}
      onCancel={event => {event.preventDefault(); if (!busy) cancel()}}>
    <form id={formID} onSubmit={event => void submit(event)}>
      <header className="session-binding-title"><h2 id={formID + "-title"}>{prompt.conflict ? uiText("共享工作目录") : prompt.binding ? uiText("更改目录与权限") : uiText("添加项目或目录")}</h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={cancel} disabled={busy} aria-label={uiText("关闭")}><X aria-hidden="true" /></Button></header>
      <p>{prompt.purpose}</p>
      {prompt.conflict ? <code>{prompt.conflict}</code> : <>
        <fieldset disabled={busy}>
          <label>{uiText("搜索项目名称或路径")}<Input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label>{uiText("项目")}<NativeSelect value={project} onChange={event => {setProject(event.target.value); setDirectory(""); invalidate()}}>
            <Option value="">{uiText("本地目录")}</Option>{matching.map(item => <Option key={item.id} value={item.id}>{item.name}{recent.includes(item.id) ? " · " + uiText("最近使用") : ""}</Option>)}
          </NativeSelect></label>
          {selected ? <label>{uiText("实际目录")}<NativeSelect value={directory || selected.path} onChange={event => {setDirectory(event.target.value); invalidate()}}>
            {directories.map(path => <Option key={path} value={path}>{path}{path === selected.path ? " · " + uiText("项目目录") : ""}</Option>)}
          </NativeSelect></label> : <label>{uiText("实际目录")}<div className="session-binding-field-row"><Input value={directory} onChange={event => {setDirectory(event.target.value); invalidate()}} placeholder={uiText("填写绝对目录路径")} required />
            {environment === "local" && <Button type="button" variant="outline" onClick={() => void browse()}>{uiText("选择文件夹…")}</Button>}</div></label>}
          {(!hasPrimary || prompt.binding?.role === "primary") && <label>{uiText("对话中的角色")}<NativeSelect value={role} onChange={event => {setRole(event.target.value === "primary" ? "primary" : "additional"); invalidate()}}>
            <Option value="additional">{uiText("附加目录")}</Option><Option value="primary">{uiText("主项目")}</Option>
          </NativeSelect></label>}
          <label>{uiText("Agent 访问用途")}<NativeSelect value={access} onChange={event => {setAccess(event.target.value === "write" ? "write" : "read"); invalidate()}}>
            <Option value="read">{uiText("仅作为参考（只读）")}</Option><Option value="write">{uiText("允许修改")}</Option>
          </NativeSelect></label>
        </fieldset>
        {preview && <div className="session-binding-preview" aria-live="polite">
          <strong>{preview.project_name || labelFor(preview, projects)}</strong>
          <code>{preview.directory}</code>
          <span>{preview.branch ? uiText("当前分支 · {0}", preview.branch) : uiText("未读取到 Git 分支")}{preview.worktree_id ? " · Worktree" : ""}</span>
          {(preview.warning || preview.error) && <p className="session-context-error">{preview.warning || preview.error}</p>}
          {!!preview.conflicts?.length && <label className="session-binding-shared"><input type="checkbox" checked={shared} onChange={event => setShared(event.target.checked)} />{uiText("与 {0} 共享写入目录。独立开发可先创建 Worktree。",preview.conflicts.map(conflict => conflict.name || conflict.id).join("、"))}</label>}
        </div>}
      </>}
      {error && <p role="alert" className="session-context-error">{error}</p>}
    </form>
    {selected && !!preview?.conflicts?.length && <WorktreeSetup key={selected.id} project={selected.id} request={request} disabled={busy} onCreated={path => {setDirectory(path); invalidate()}} onReset={() => {}} />}
    <footer><Button type="button" variant="outline" onClick={cancel} disabled={busy}>{uiText("取消")}</Button>
      <Button type="submit" form={formID} disabled={busy || preview?.status === "error" || !!preview?.conflicts?.length && !shared}>{busy ? uiText("处理中…") : prompt.conflict ? uiText("确认共享目录") : preview ? uiText("确认关联") : uiText("检查目录")}</Button></footer>
  </dialog>
}

function WorktreeSetup({project, request, disabled, directory, onCreated, onReset}: {
  project: string; request: ChatController["options"]["request"]; disabled: boolean; directory?: string; onCreated: (path: string) => void; onReset: () => void;
}) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<GitOverview["branches"]>([])
  const [source, setSource] = useState("")
  const [slug, setSlug] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const route = `/api/projects/${encodeURIComponent(project)}`
  async function prepare() {
    setOpen(true); setPending(true); setError("")
    try {
      const overview = await request<GitOverview>(route + "/git")
      setBranches(overview.branches)
      setSource(overview.branches.find(branch => branch.ref === overview.master_source)?.ref || overview.branches.find(branch => branch.kind === "local")?.ref || "HEAD")
      setSlug("session-" + crypto.randomUUID().slice(0, 8))
    } catch (error) { setError(failure(error)) }
    finally { setPending(false) }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("")
    try {
      const result = await request<{path:string}>(route + "/worktrees",json("POST",{mode:"new",slug,branch:"codex/" + slug,source}))
      if (!result.path) throw new Error(uiText("Worktree 已创建，但未返回执行目录。请从项目页选择它。"))
      onCreated(result.path); setOpen(false)
    } catch (error) { setError(failure(error)) }
    finally { setPending(false) }
  }
  if (directory) return <div className="session-worktree-setup"><span>{uiText("独立 Worktree")}</span><code>{directory}</code><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onReset}>{uiText("改用所选目录")}</Button></div>
  return <div className="session-worktree-setup">
    {!open ? <Button type="button" variant="outline" size="sm" onClick={() => void prepare()} disabled={disabled}><GitBranch aria-hidden="true" />{uiText("创建独立 Worktree")}</Button> :
      <form onSubmit={event => void create(event)}>
        <label>{uiText("新分支标识")}<Input value={slug} required maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_\\-]{0,63}" onChange={event => setSlug(event.target.value)} disabled={pending} /></label>
        <label>{uiText("来源分支")}<NativeSelect value={source} onChange={event => setSource(event.target.value)} disabled={pending}>
          <Option value="HEAD">HEAD</Option>{branches.map(branch => <Option key={branch.ref} value={branch.ref}>{branch.name}</Option>)}
        </NativeSelect></label>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{uiText("取消")}</Button>
        <Button type="submit" size="sm" disabled={pending || disabled || !source}>{pending ? uiText("处理中…") : uiText("创建 Worktree")}</Button>
      </form>}
    {error && <p role="alert" className="session-context-error">{error}</p>}
  </div>
}
