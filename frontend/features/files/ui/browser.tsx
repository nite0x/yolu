import {uiText} from "@/shared/i18n"
import {useEffect, useRef, useState} from "react"
import {flushSync} from "react-dom"
import {createRecoverableRoot as createRoot} from "@/shared/ui/feedback/root"
import {ChevronDown, ChevronRight, CodeXml, Folder, FolderOpen, PanelRightOpen, RefreshCw} from "lucide-react"
import {FileTypeIcon} from "@/shared/ui/file-type-icon"
import {FileSplit} from "./split"
import {Button} from "@/shared/ui/primitives/button"
import {NativeSelect, NativeSelectOption as Option} from "@/shared/ui/primitives/native-select"
import {IconButton} from "@/shared/ui/actions/button"
import type {ChangedFile} from "@/features/files/model/changes"
import type {FileDisplay, FilePreview} from "../runtime/viewer"

export type BrowserRequest = <T>(path: string, options?: RequestInit & {environment?: string}) => Promise<T>
export interface BrowserProps { project?: string; session?: string; binding?: string; git?: boolean; path: string; environment: string; request: BrowserRequest; idPrefix?: string; initialMode?: string; reference?: {path: string; line?: number; version: number; mode?: "working" | "index"}; onSelectFile?: (path: string, mode: string) => void; onOpenInPane?: (file: {path?: string; line?: number; mode: string}) => void }
interface Entry { name: string; path: string; directory: boolean; symlink?: boolean }
interface Directory { entries: Entry[]; truncated: boolean }
let displayPromise: Promise<FileDisplay> | undefined
function loadDisplay() {
  const host = window as Window & { WorkHubFileDisplay?: FileDisplay }
  if (host.WorkHubFileDisplay) return Promise.resolve(host.WorkHubFileDisplay)
  if (!displayPromise) displayPromise = new Promise<FileDisplay>((resolve, reject) => {
    const script = document.createElement("script")
    script.type = "module"
    script.src = "/ui/files/file-display.js"
    script.onload = () => host.WorkHubFileDisplay ? resolve(host.WorkHubFileDisplay) : reject(new Error(uiText("文件查看器未就绪")))
    script.onerror = () => { script.remove(); reject(new Error(uiText("文件查看器加载失败，请重试"))) }
    document.head.append(script)
  }).catch(error => { displayPromise = undefined; throw error })
  return displayPromise
}

function Preview({ preview, split, id }: { preview: FilePreview; split: boolean; id: string }) {
  const target = useRef<HTMLElement>(null)
  const [error, setError] = useState("")
  useEffect(() => {
    const container = target.current
    if (!container) return
    let active = true
    let dispose: (() => void) | undefined
    setError("")
    // Partial patches may be invalid; show their bounded output as plain text.
    if (preview.truncated || !preview.format || preview.format === "text") {
      container.textContent = preview.text
      return () => { container.replaceChildren() }
    }
    container.textContent = uiText("正在加载文件查看器…")
    void loadDisplay().then(display => {
      if (!active) return
      container.replaceChildren()
      dispose = display.render(container, preview, split)
    }).catch(error => {
      if (!active) return
      container.textContent = preview.text
      setError(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false; dispose?.(); container.replaceChildren() }
  }, [preview, split])
  return <>
    {error && <p role="status" className="quiet">{error}{uiText("，已显示纯文本内容。")}</p>}
    {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to focus and scroll this read-only file viewport. */}
    <section ref={target} id={id} className="changes-text" tabIndex={0} aria-label={uiText("只读文件内容与差异")} />
  </>
}

function ImagePreview({ preview, id }: { preview: FilePreview; id: string }) {
  const [failed, setFailed] = useState(false)
  const source = /^data:image\/(png|jpeg|gif|webp);base64,/.test(preview.data_url || "") ? preview.data_url : undefined
  // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to focus and scroll this read-only image viewport.
  return <section id={id} className="changes-text file-image-preview" tabIndex={0} aria-label={uiText("只读图片预览")}>
    {failed || !source ? <p role="alert">{uiText("图片无法显示，文件可能已损坏。")}</p> : <img src={source} alt={preview.name} onError={() => setFailed(true)} />}
  </section>
}

function DirectoryTree({ directory = "", selected, choose, request, endpoint, environment, depth = 0 }: {
  directory?: string; selected: string; choose: (file: string) => void; request: BrowserRequest; endpoint: string; environment: string; depth?: number
}) {
  const [data, setData] = useState<Directory>()
  const [error, setError] = useState("")
  const [expanded, setExpanded] = useState<string[]>([])
  useEffect(() => {
    const segments = selected.split("/").slice(0, -1)
    const parents = segments.map((_, index) => segments.slice(0, index + 1).join("/"))
    setExpanded(values => parents.every(parent => values.includes(parent)) ? values : [...new Set([...values, ...parents])])
  }, [selected])
  useEffect(() => {
    const abort = new AbortController()
    let active = true
    setData(undefined)
    setError("")
    void request<Directory>(`${endpoint}&${new URLSearchParams({dir: directory})}`, { environment, signal: abort.signal })
      .then(value => { if (active) setData(value) })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false; abort.abort() }
  }, [directory, endpoint, environment, request])
  if (error) return <p role="alert">{error}</p>
  if (!data) return <p role="status" className="quiet">{uiText("正在读取目录…")}</p>
  return <ul className="browser-tree">{data.entries.map(entry => <li key={entry.path}>
    <Button type="button" variant={selected === entry.path ? "secondary" : "ghost"} className="browser-tree-entry aria-pressed:bg-[var(--yolu-selected)] aria-pressed:text-primary justify-start text-left font-normal [&&]:pl-[var(--tree-indent)]" style={{ "--tree-indent": `${8 + depth * 16}px` } as React.CSSProperties}
      disabled={entry.symlink} title={entry.symlink ? uiText("{0} · 符号链接请在 IDE 中打开", entry.path) : entry.path}
      aria-expanded={entry.directory ? expanded.includes(entry.path) : undefined} aria-pressed={entry.directory ? undefined : selected === entry.path}
      data-change-file={entry.directory ? undefined : entry.path}
      onClick={() => entry.directory ? setExpanded(values => values.includes(entry.path) ? values.filter(value => value !== entry.path) : [...values, entry.path]) : choose(entry.path)}>
      {entry.directory ? <>{expanded.includes(entry.path) ? <ChevronDown /> : <ChevronRight />}{expanded.includes(entry.path) ? <FolderOpen className="browser-folder is-open" /> : <Folder className="browser-folder" />}</> : <FileTypeIcon path={entry.path} />}<span>{entry.name}</span>{entry.symlink && <span>↗</span>}
    </Button>
    {entry.directory && expanded.includes(entry.path) && <DirectoryTree directory={entry.path} selected={selected} choose={choose} request={request} endpoint={endpoint} environment={environment} depth={depth + 1} />}
  </li>)}{!data.entries.length && <li className="quiet">{uiText("空目录")}</li>}{data.truncated && <li role="status">{uiText("目录超过 5000 项，请在 IDE 中查看完整列表。")}</li>}</ul>
}

export function FileBrowser({ project, session, binding, git = !!project, path, environment, request, idPrefix = "changes", initialMode = "working", reference, onSelectFile, onOpenInPane }: BrowserProps) {
  const [mode, setMode] = useState(reference?.mode || (reference ? "all" : git ? initialMode : "all"))
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [selected, setSelected] = useState(reference?.path || "")
  const [preview, setPreview] = useState<FilePreview>()
  const [listingError, setListingError] = useState("")
  const [previewError, setPreviewError] = useState("")
  const [loading, setLoading] = useState(false)
  const [listing, setListing] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [split, setSplit] = useState(true)
  const [branch, setBranch] = useState("")
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const choose = (file: string) => { setSelected(file); onSelectFile?.(file, mode) }
  const endpoint = `/api/projects/${encodeURIComponent(project || "")}`
  const filesEndpoint = session ? `/api/sessions/${encodeURIComponent(session)}/files` : `${endpoint}/files`
  useEffect(() => {
    if (reference) { setMode(reference.mode || "all"); setSelected(reference.path) }
  }, [reference])
  const bindingEndpoint = session && binding ? `/api/sessions/${encodeURIComponent(session)}/bindings` : ""
  const previewEndpoint = mode === "all" ? filesEndpoint : bindingEndpoint ? `${bindingEndpoint}/${encodeURIComponent(binding || "")}/diff` : `${endpoint}/changes`
  const query = new URLSearchParams({ path }).toString()
  const visible = files.filter(file => mode === "index" ? !file.untracked && file.index !== " " && file.index !== "?" : file.untracked || file.working !== " ")
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter explicitly reloads this resource without changing its API URL.
  useEffect(() => {
    if (mode === "all") { setListingError(""); return }
    let active = true
    const abort = new AbortController()
    setListing(true); setListingError("")
    const load = bindingEndpoint
      ? request<{bindings:{id:string; branch?:string; git?:{files?:ChangedFile[]}}[]}>(bindingEndpoint, {environment,signal:abort.signal})
        .then(({bindings}) => {
          const selected = bindings.find(item => item.id === binding)
          return {files:selected?.git?.files || [],branch:selected?.branch || ""}
        })
      : request<{files:ChangedFile[];branch:string}>(`${endpoint}/changes?${query}`, {environment,signal:abort.signal})
    void load.then(data => {
      if (!active) return
      setFiles(data.files); setBranch(data.branch)
      const choices = data.files.filter(file => mode === "index" ? !file.untracked && file.index !== " " && file.index !== "?" : file.untracked || file.working !== " ")
      const next = choices.some(file => file.path === selectedRef.current) ? selectedRef.current : choices[0]?.path || ""
      setSelected(next)
      onSelectFile?.(next, mode)
    }).catch(error => { if (active) setListingError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (active) setListing(false) })
    return () => { active = false; abort.abort() }
  }, [endpoint, bindingEndpoint, binding, query, environment, mode, refresh, request, onSelectFile])
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter explicitly reloads this resource without changing its API URL.
  useEffect(() => {
    setPreview(undefined)
    setPreviewError("")
    if (!selected) { setLoading(false); return }
    let active = true
    const abort = new AbortController()
    setLoading(true)
    const params = new URLSearchParams({ path, file: selected, mode })
    void request<FilePreview>(`${previewEndpoint}?${params}`, { environment, signal: abort.signal }).then(data => {
      if (active) setPreview({ ...data, name: selected, format: mode === "all" && data.format !== "image" ? "file" : data.format, line: reference?.path === selected ? reference.line : undefined })
    }).catch(error => { if (active) setPreviewError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; abort.abort() }
  }, [previewEndpoint, path, environment, mode, selected, refresh, request, reference])
  const error = [listingError, previewError].filter(Boolean).join("\n")
  return <div className="file-browser" data-mode={mode}>
    <p id={`${idPrefix}Context`} className="dialog-description break-all" title={path}>{path}{branch ? ` · ${branch}` : ""}{" "}{uiText("· 只读")}</p>
    <div className="changes-controls"><div className="changes-control-field"><label htmlFor={`${idPrefix}Mode`}>{uiText("查看")}</label><NativeSelect size="sm" className="border-0 shadow-none text-xs hover:bg-accent" id={`${idPrefix}Mode`} value={mode} onChange={event => { setMode(event.target.value); setSelected(""); setFiles([]); setPreview(undefined); setListingError(""); setPreviewError(""); onSelectFile?.("", event.target.value) }}>
      <Option value="all">{uiText("全部文件")}</Option>{git && <><Option value="working">{uiText("未暂存改动（含未跟踪）")}</Option><Option value="index">{uiText("修改文件 · 暂存区")}</Option></>}
    </NativeSelect></div>
      <div className="changes-control-field" hidden={mode === "all"}><label htmlFor={`${idPrefix}Layout`}>{uiText("差异布局")}</label><NativeSelect size="sm" className="border-0 shadow-none text-xs hover:bg-accent" id={`${idPrefix}Layout`} value={split ? "split" : "unified"} onChange={event => setSplit(event.target.value === "split")} disabled={mode === "all"}><Option value="split">{uiText("并排")}</Option><Option value="unified">{uiText("统一")}</Option></NativeSelect></div>
      <div className="changes-control-actions">
        <IconButton size="icon-sm" label={uiText("刷新")} id={`${idPrefix}Refresh`} onClick={() => setRefresh(value => value + 1)}><RefreshCw aria-hidden="true" /></IconButton>
        {project && <IconButton size="icon-sm" label={uiText("在 VS Code 中打开 ↗")} data-action="project-open-vscode" data-id={project} data-path={path}><CodeXml aria-hidden="true" /></IconButton>}
        {onOpenInPane && <IconButton size="icon-sm" label={uiText("在面板中打开")} onClick={() => onOpenInPane({path: selected || undefined, line: reference?.path === selected ? reference.line : undefined, mode})}><PanelRightOpen aria-hidden="true" /></IconButton>}
      </div>
    </div>
    <FileSplit tree={<nav className="browser-files" id={`${idPrefix}Files`} aria-label={mode === "all" ? uiText("全部文件") : uiText("改动文件")}>
      {mode === "all" ? <>{reference && /^(?:\/|[a-z]:[\\/])/i.test(reference.path) && <Button type="button" variant={selected === reference.path ? "secondary" : "ghost"} className="h-auto w-full justify-start whitespace-normal text-left break-all aria-pressed:bg-[var(--yolu-selected)] aria-pressed:text-primary" data-change-file={reference.path} aria-pressed={selected === reference.path} onClick={() => choose(reference.path)}><FileTypeIcon path={reference.path} /><span>{reference.path}</span></Button>}<DirectoryTree key={refresh} selected={selected} choose={choose} request={request} endpoint={`${filesEndpoint}?${query}`} environment={environment} /></> : listing ? <p role="status">{uiText("正在读取改动文件…")}</p> : <div className="changes-file-list">{visible.length ? visible.map(file => <Button type="button" key={file.path} variant={file.path === selected ? "secondary" : "ghost"} className="h-auto w-full justify-start whitespace-normal text-left break-all aria-pressed:bg-[var(--yolu-selected)] aria-pressed:text-primary" data-change-file={file.path} aria-pressed={file.path === selected} onClick={() => choose(file.path)}><FileTypeIcon path={file.path} /><code className="shrink-0 browser-change-status" data-status={file.untracked || file.index === "A" ? "added" : file.index === "D" || file.working === "D" ? "deleted" : "modified"}>{file.untracked ? "??" : `${file.index}${file.working}`}</code><span>{file.previous ? `${file.previous} → ` : ""}{file.path}</span></Button>) : <p className="quiet">{uiText("此区域没有改动。")}</p>}</div>}
    </nav>}><div className="min-w-0 browser-content"><p id={`${idPrefix}Truncated`} role="status" hidden={!preview?.truncated}>{uiText("差异超过 256 KiB，已显示部分纯文本；请在 IDE 中查看完整内容。")}</p>
      {selected && <p className="file-preview-path" title={preview?.path || selected}>{preview?.path || selected}</p>}
      {preview ? preview.format === "image" ? <ImagePreview key={selected + refresh} preview={preview} id={`${idPrefix}Text`} /> : <Preview preview={preview} split={split} id={`${idPrefix}Text`} /> : <div id={`${idPrefix}Text`} className="changes-text" role="status">{loading ? uiText("正在读取文件…") : previewError ? uiText("无法预览此文件，请在 IDE 中打开。") : mode === "all" ? uiText("选择文件查看内容。") : uiText("选择修改文件查看差异。")}</div>}
    </div></FileSplit><p id={`${idPrefix}Error`} role="alert" hidden={!error}>{error}</p>
  </div>
}

const mounts = new WeakMap<HTMLElement, ReturnType<typeof createRoot>>()
export function mountFileBrowser(container: HTMLElement, props?: BrowserProps) {
  let root = mounts.get(container)
  if (!root) { root = createRoot(container); mounts.set(container, root) }
  // Each retained mount owns one directory resource. References within that
  // resource preserve the reading UI; a different resource starts cleanly.
  const resource = props && JSON.stringify([props.environment, props.session ? ["session", props.session, props.binding] : ["project", props.project], props.path])
  flushSync(() => root.render(props ? <FileBrowser key={resource} {...props} /> : null))
}
