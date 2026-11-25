import { uiText } from "../i18n";
import { Terminal, type ITheme } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { SearchAddon } from "@xterm/addon-search"
import { WebglAddon } from "@xterm/addon-webgl"
import { mountTerminalSurface, mountTerminalTools, type TerminalProfile } from "./terminal-surface"
import { conversationDefaults } from "./conversation-defaults"
import {mainCreationProjects} from "./creation-directories"
import "./terminal.css"
import type { Project } from "./types"

interface TerminalInfo { id: string; name: string; project_id?: string; session_id?: string; binding_id?: string; cwd: string; state: string; attached: boolean; exit_code?: number }
interface Snapshot { route: string; environment: string; title: string; kind?: string; context?: string; terminal?: { projectID?: string; sessionID?: string; bindingID?: string; cwd?: string; id?: string }; conversation?: {scope?: object; directory?: string; creationDirectory?: string; selected?: string | null; creating?: boolean; pane?: string} }

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const unmountSurface = mountTerminalSurface(command => window.parent.postMessage({type:"workhub:page-pane-command", command}, location.origin))
const terminalTools = mountTerminalTools(id => void launchTerminal(id))
const projectSelect = element<HTMLSelectElement>("terminalProject"), profileSelect = element<HTMLSelectElement>("terminalProfile")
const customTerminal = element<HTMLDetailsElement>("customTerminal")
const startCustom = element<HTMLButtonElement>("startTerminal")
const executable = element<HTMLInputElement>("customExecutable"), argsInput = element<HTMLTextAreaElement>("customArgs"), envInput = element<HTMLTextAreaElement>("customEnv"), nameInput = element<HTMLInputElement>("customName")
const host = window.parent, token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!.content
const post = (type: string, extra: object = {}) => host.postMessage({type, ...extra}, location.origin)
let saved: Snapshot = {route:"/terminals", environment:"local", title:uiText("新建终端"), terminal:{}}
let active = false, disposed = false, restoring = true, savingProfile = false
let startingProfile: string | undefined
let projects: Project[] = [], profiles: TerminalProfile[] = [], customProfiles: TerminalProfile[] = [], rows: TerminalInfo[] = []
let term: Terminal | undefined, fit: FitAddon | undefined, search: SearchAddon | undefined, socket: WebSocket | undefined
let current: TerminalInfo | undefined, seq = 0, generation = 0, retry: ReturnType<typeof setTimeout> | undefined, reconnecting = false
let restoreRevision = 0, busy = false, finished = false, lastSize = ""
const terminalFonts = document.fonts?.load('14px "JetBrains Mono Variable"').catch(() => []) ?? Promise.resolve([])
const storedFontSize = Number(conversationDefaults.get("terminal-font-size"))
let fontSize = Number.isInteger(storedFontSize) && storedFontSize >= 12 && storedFontSize <= 20 ? storedFontSize : 14

function updateFontSize(value = fontSize) {
  fontSize = Math.max(12, Math.min(20, value))
  element("terminalFontSize").textContent = `${fontSize} px`
  element<HTMLButtonElement>("decreaseTerminalFont").disabled = fontSize === 12
  element<HTMLButtonElement>("increaseTerminalFont").disabled = fontSize === 20
  conversationDefaults.set("terminal-font-size", String(fontSize))
  if (term) {term.options.fontSize = fontSize; requestAnimationFrame(measure)}
}
element("decreaseTerminalFont").onclick = () => updateFontSize(fontSize - 1)
element("increaseTerminalFont").onclick = () => updateFontSize(fontSize + 1)
element("resetTerminalFont").onclick = () => updateFontSize(14)
updateFontSize()

// xterm generates scoped renderer styles. Give those styles this page's CSP
// nonce instead of relaxing style-src for the entire application.
const nonce = document.querySelector<HTMLMetaElement>('meta[name="style-nonce"]')!.content
document.createElement = new Proxy(document.createElement, {apply(target, owner, args) {
  const node = Reflect.apply(target, owner, args) as HTMLElement
  if (node.tagName === "STYLE") node.setAttribute("nonce", nonce)
  return node
}})

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {method, headers:{"Content-Type":"application/json", "X-CSRF-Token":token, "X-Environment-ID":saved.environment}, ...(body === undefined ? {} : {body:JSON.stringify(body)})})
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || uiText("终端请求失败"))
  return value as T
}
function feedback(message = "", nearAction = false) {
  const node = element(!current && !restoring ? "terminalLaunchFeedback" : "terminalFeedback")
  node.textContent = message; node.hidden = !message
  if (message && nearAction) node.scrollIntoView?.({block:"nearest"})
}
function status(message: string) {
  element("terminalStatus").textContent = message
  element("terminalStatusBadge").dataset.state = message.includes(uiText("失败")) || message === uiText("未连接") ? "failed" : message.startsWith(uiText("已退出")) ? "completed" : message === uiText("已连接") ? "running" : "starting"
}
function terminalExited(code?: number) {
  finished = true
  status(uiText("已退出 · {0}", code ?? "?"))
  element<HTMLButtonElement>("stopTerminal").disabled = true
  post("workhub:terminals-changed")
}
function snapshot(): Snapshot { return {...saved, kind:"terminals", terminal:{...saved.terminal}} }
function publish() { if (!restoring && !disposed) post("workhub:page-state", {snapshot:snapshot()}) }
function context() {
  const project = projects.find(p => p.id === saved.terminal?.projectID)
  const path = current?.cwd || saved.terminal?.cwd || ""
  const tree = project?.worktrees.find(tree => tree.path === path)
  element("terminalContext").textContent = project?.name || uiText("本地目录")
  element<HTMLButtonElement>("terminalContext").disabled = !project
  element("terminalTitle").textContent = current ? current.name : uiText("新建对话")
  element("terminalDirectoryName").textContent = project?.name || uiText("工作目录")
  element("terminalDirectoryName").title = path
  const branch = tree?.detached ? "detached HEAD" : tree?.branch || ""
  element("terminalBranch").title = branch
  element("terminalBranch").hidden = !branch
  element("terminalBranchName").textContent = branch
  element("terminalContextPath").textContent = path
  element("terminalContextPath").title = path
  element("terminalDirectoryContext").hidden = !current
}

function workingDirectoryChanged() {
  const projectID = projectSelect.value || undefined
  const cwd = saved.terminal?.bindingID ? saved.terminal.cwd : projects.find(project => project.id === projectID)?.path
  const path = element("terminalDirectoryPath")
  path.textContent = cwd || ""
  path.hidden = !cwd
  saved.terminal = {...saved.terminal, projectID, cwd}
  saved.conversation = {...saved.conversation, creationDirectory:cwd || ""}
  context()
  syncLauncher()
}
function renderCustomProfiles(selected = profileSelect.value) {
  profileSelect.replaceChildren(new Option(uiText("新建配置"), "custom"), ...customProfiles.map(profile => new Option(profile.name, profile.id)))
  profileSelect.value = customProfiles.some(profile => profile.id === selected) ? selected : "custom"
  element("terminalCustomProfileField").hidden = !customProfiles.length
}
function syncLauncher() {
  const waiting = !!startingProfile || savingProfile
  const local = saved.environment === "local"
  const unavailable = restoring || waiting || !!current || !local || !saved.terminal?.cwd
  startCustom.disabled = unavailable
  startCustom.textContent = startingProfile === "custom" ? uiText("正在启动…") : uiText("启动自定义 Agent")
  element<HTMLFieldSetElement>("customTerminalFields").disabled = waiting
  customTerminal.hidden = restoring || !local || !saved.terminal?.cwd
  projectSelect.disabled = restoring || waiting || !!saved.terminal?.bindingID || projectSelect.options.length <= 1 || !local
  element("terminalDirectoryHint").hidden = restoring || !local || !!saved.terminal?.cwd || projectSelect.options.length > 1
  element<HTMLButtonElement>("terminalKindUI").disabled = restoring || waiting
  terminalTools.render([...profiles, ...customProfiles], unavailable, startingProfile)
  element("terminalForm").setAttribute("aria-busy", String(restoring || waiting))
}
function parsedArgs(): string[] {
  const value: unknown = JSON.parse(argsInput.value || "[]")
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error(uiText("参数需要填写 JSON 字符串数组，例如 [\"--model\", \"my-model\"]"))
  return value as string[]
}
function parsedEnv(): Record<string, string> {
  const value: unknown = JSON.parse(envInput.value || "{}")
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(v => typeof v !== "string")) throw new Error(uiText("环境变量需要填写 JSON 对象，例如 {\"NAME\":\"value\"}"))
  return value as Record<string, string>
}
function showRows() {
  const list = element("terminalList"); list.replaceChildren()
  const filtered = rows.filter(row => !projectSelect.value || row.project_id === projectSelect.value)
  element("terminalExisting").hidden = !filtered.length
  element("terminalExistingSummary").textContent = uiText("已有终端 · {0}", filtered.length)
  if (!filtered.length) {const p = document.createElement("p"); p.className = "terminal-help"; p.textContent = uiText("暂无终端。"); list.append(p)}
  for (const row of filtered) {
    const item = document.createElement("div"); item.className = "terminal-row"
    const description = document.createElement("div"), title = document.createElement("strong"), path = document.createElement("small")
    title.textContent = `${row.name} · ${row.state === "running" ? row.attached ? uiText("已打开") : uiText("运行中") : uiText("已退出 ({0})", row.exit_code ?? "?")}`
    path.textContent = row.cwd; path.title = row.cwd; description.append(title, path)
    const actions = document.createElement("div"); actions.className = "terminal-row-actions"
    const attach = document.createElement("button"); attach.type = "button"; attach.textContent = row.attached ? uiText("查看") : uiText("连接")
    attach.onclick = () => post("workhub:page-open", {placement:"current", snapshot:{route:"/terminals", environment:saved.environment, title:row.name, terminal:{id:row.id, projectID:row.project_id,sessionID:row.session_id,bindingID:row.binding_id,cwd:row.cwd}}})
    actions.append(attach)
    if (row.state !== "running") {const remove = document.createElement("button"); remove.type = "button"; remove.textContent = uiText("移除"); remove.onclick = () => void api(`/api/terminals/${encodeURIComponent(row.id)}`, "DELETE").then(refreshRows).catch(error => feedback(error.message)); actions.append(remove)}
    item.append(description, actions); list.append(item)
  }
}
async function refreshRows() { rows = await api<TerminalInfo[]>("/api/terminals"); if (!disposed) showRows() }

function measure() {
  if (!active || !term || !fit || element("terminalConsole").hidden || !element("terminalScreen").clientWidth) return
  const dimensions = fit.proposeDimensions()
  if (!dimensions || !element("terminalScreen").clientHeight) return
  term.resize(Math.max(2,Math.min(500,dimensions.cols)), Math.max(1,Math.min(300,dimensions.rows)))
  const size = `${term.cols}:${term.rows}`
  if (size !== lastSize && socket?.readyState === WebSocket.OPEN) {send({type:"resize", cols:term.cols, rows:term.rows}); lastSize = size}
}
const resize = new ResizeObserver(() => requestAnimationFrame(measure))
resize.observe(element("terminalScreen"))
function send(value: unknown) {if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))}
function disconnect() {
  ++generation; clearTimeout(retry); retry = undefined
  if (socket) {socket.onclose = null; socket.close(); socket = undefined}
}
function terminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string, fallback: string) => style.getPropertyValue(`--yolu-terminal-${name}`).trim() || fallback
  return {
    background:color("background", "#1c2130"), foreground:color("foreground", "#d8deed"),
    cursor:color("cursor", "#b6a4fa"), cursorAccent:color("background", "#1c2130"),
    selectionBackground:color("selection", "#a99aef40"), selectionInactiveBackground:color("selection", "#a99aef25"),
    scrollbarSliderBackground:"#8992ae30", scrollbarSliderHoverBackground:"#8992ae55", scrollbarSliderActiveBackground:"#8992ae70",
    black:color("black", "#343c50"), red:"#ec9b9e", green:"#a3d6ac", yellow:"#e6c791",
    blue:color("blue", "#a4b8f5"), magenta:"#c5a8ed", cyan:"#91cdd9", white:color("foreground", "#d8deed"),
    brightBlack:color("bright-black", "#8c96b0"), brightRed:"#f4b2b4", brightGreen:"#b7e4bd", brightYellow:"#f2d7ab",
    brightBlue:color("bright-blue", "#bacbff"), brightMagenta:"#d7bff7", brightCyan:"#b0e1e9", brightWhite:"#f0f3fc",
  }
}
window.addEventListener("yolu:appearance", () => { if (term) term.options.theme = terminalTheme() })

function createTerminal() {
  if (term) return
  term = new Terminal({
    cursorBlink:true, cursorStyle:"bar", cursorInactiveStyle:"bar", cursorWidth:2,
    fontSize, fontFamily:getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace", fontWeight:400, fontWeightBold:600,
    lineHeight:1.35, letterSpacing:0, customGlyphs:true, drawBoldTextInBrightColors:false, minimumContrastRatio:4.5,
    scrollback:5000,
    theme:terminalTheme(), allowProposedApi:false,
  })
  fit = new FitAddon(); search = new SearchAddon(); term.loadAddon(fit); term.loadAddon(search); term.open(element("terminalScreen"))
  // Draw block/box characters to the cell edges. Font glyphs in the DOM
  // renderer leave gaps in CLI logos and borders when line height is increased.
  const display = term
  let renderer: WebglAddon | undefined
  const fallback = () => {
    renderer?.dispose()
    if (disposed || term !== display) return
    display.options.lineHeight = 1
    requestAnimationFrame(measure)
  }
  try {
    renderer = new WebglAddon()
    renderer.onContextLoss(fallback)
    display.loadAddon(renderer)
  } catch {fallback()}
  term.onData(data => {
    if (finished || busy) return
    if (socket?.readyState !== WebSocket.OPEN) {feedback(uiText("连接已断开，请等待重连后输入。")); return}
    if (socket.bufferedAmount > (1 << 20)) {feedback(uiText("输入发送中，请稍后再试。")); return}
    // Bound each frame by UTF-8 byte size, including multi-byte pasted text.
    for (const chunk of data.match(/[\s\S]{1,4096}/gu) || []) send({type:"input", data:chunk})
  })
  requestAnimationFrame(measure)
}
async function connect() {
  if (!current || disposed || reconnecting || finished) return
  reconnecting = true; disconnect(); busy = false
  lastSize = ""
  const revision = generation, id = current.id
  try {
    // Reconnect only after queued output has been parsed, so its sequence is
    // acknowledged exactly once even if the socket closed during term.write.
    if (term) await new Promise<void>(resolve => term!.write("", resolve))
    const auth = await api<{ticket: string}>(`/api/terminals/${encodeURIComponent(id)}/ticket`, "POST", {})
    if (disposed || revision !== generation) return
    const url = new URL(`/terminal-stream/${encodeURIComponent(id)}`, location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:"
    const ws = new WebSocket(url); socket = ws; status(uiText("正在连接…"))
    ws.onopen = () => {ws.send(JSON.stringify({ticket:auth.ticket, since:seq})); measure()}
    ws.onmessage = event => {
      if (revision !== generation || disposed) return
      const message = JSON.parse(event.data)
      if (message.type === "output") {
        status(uiText("已连接")); const bytes = Uint8Array.from(atob(message.data), c => c.charCodeAt(0))
        term!.write(bytes, () => {seq = message.seq; if (socket === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({type:"ack", seq}))})
      } else if (message.type === "gap") {term!.reset(); seq = message.seq; feedback(message.message)}
      else if (message.type === "exit") terminalExited(message.exit_code)
      else if (message.type === "busy" || message.type === "error") {busy = true; status(uiText("未连接")); feedback(message.message)}
    }
    ws.onclose = () => {if (disposed || revision !== generation || finished || busy) return; status(uiText("连接中断，正在重连…")); retry = setTimeout(() => void connect(), 1500)}
    ws.onerror = () => status(uiText("连接失败"))
    status(uiText("已连接")); if (active) term?.focus()
  } catch (error) {if (!disposed && revision === generation) {status(uiText("未连接")); feedback((error as Error).message)}}
  finally {reconnecting = false}
}
async function showTerminal(info: TerminalInfo) {
  if (current?.id === info.id && term) return
  disconnect(); term?.dispose(); term = undefined; fit = undefined; search = undefined; element("terminalScreen").replaceChildren()
  current = info; seq = 0; finished = false
  const project = projects.find(p => p.id === info.project_id)
  saved = {...saved, title:[project?.name, info.name].filter(Boolean).join(" · "), context:project?.name || info.cwd, terminal:{id:info.id,projectID:info.project_id,sessionID:info.session_id,bindingID:info.binding_id,cwd:info.cwd}}
  element("terminalLauncher").hidden = true; element("terminalConsole").hidden = false
  element<HTMLButtonElement>("stopTerminal").disabled = info.state !== "running"
  element("terminalStatusBadge").hidden = false; element("terminalRuntimeActions").hidden = false
  element<HTMLDetailsElement>("terminalDirectoryContext").open = false
  context(); await terminalFonts
  if (disposed || current !== info) return
  createTerminal(); publish(); await connect()
}
async function restore(value: Snapshot) {
  const revision = ++restoreRevision; restoring = true; saved = {...value, terminal:{...value.terminal}}
  feedback()
  syncLauncher()
  try {
    if (saved.environment !== "local") throw new Error(uiText("内置终端目前仅支持本机执行环境。"))
    const [overview, available, terminals] = await Promise.all([api<{projects: Project[]}>("/api/state"), api<TerminalProfile[]>("/api/terminal-profiles"), api<TerminalInfo[]>("/api/terminals")])
    if (disposed || revision !== restoreRevision) return
    projects = overview.projects; profiles = available.filter(p => !p.id.startsWith("custom-")); customProfiles = available.filter(p => p.id.startsWith("custom-")); rows = terminals
    if (saved.terminal?.id) {
      const info = rows.find(row => row.id === saved.terminal?.id)
      if (!info) throw new Error(uiText("这个终端已结束或后台已重启，请新建终端。"))
      await showTerminal(info)
    } else {
      const roots = mainCreationProjects(projects)
      const cwd = saved.terminal?.cwd || saved.conversation?.creationDirectory
      if (saved.terminal?.bindingID) {
        const project = projects.find(project => project.id === saved.terminal?.projectID)
        projectSelect.replaceChildren(new Option(project?.name || uiText("对话工作目录"), project?.id || ""))
      } else {
        const preferred = cwd || conversationDefaults.get("terminal-directory")
        const requested = saved.terminal?.projectID
        const project = roots.find(project => requested ? project.id === requested : project.path === preferred || project.worktrees.some(tree => tree.path === preferred))
        const placeholder = new Option(uiText("选择本机项目"), "")
        placeholder.disabled = true
        projectSelect.replaceChildren(placeholder, ...roots.map(project => {
          const branch = project.worktrees.find(tree => tree.path === project.path)?.branch
          return new Option([project.name, branch].filter(Boolean).join(" · "), project.id)
        }))
        projectSelect.value = project?.id || (!requested && !cwd ? roots[0]?.id : "") || ""
      }
      workingDirectoryChanged()
      renderCustomProfiles()
      showRows()
    }
  } catch (error) {if (!disposed && revision === restoreRevision) feedback((error as Error).message)}
  finally {if (!disposed && revision === restoreRevision) {restoring = false; syncLauncher(); publish(); post("workhub:page-restored")}}
}

projectSelect.onchange = () => {workingDirectoryChanged(); feedback(); showRows(); publish()}
profileSelect.onchange = () => {
  const profile = customProfiles.find(profile => profile.id === profileSelect.value)
  nameInput.value = profile?.name || ""
  executable.value = profile?.executable || ""
  argsInput.value = JSON.stringify(profile?.args || [])
  envInput.value = "{}"
  feedback()
}
element("saveTerminalProfile").onclick = async () => {
  if (startingProfile || savingProfile) return
  savingProfile = true
  const button = element("saveTerminalProfile")
  button.textContent = uiText("保存中…")
  syncLauncher()
  feedback()
  try {
    if (!executable.value.trim()) throw new Error(uiText("请填写可执行文件"))
    const id = profileSelect.value.startsWith("custom-") ? profileSelect.value : "custom-" + crypto.randomUUID()
    const profile: TerminalProfile = {id, name:nameInput.value.trim() || executable.value.trim(), executable:executable.value.trim(), args:parsedArgs(), available:true}
    const result = await api<TerminalProfile>("/api/terminal-profiles", "POST", profile)
    if (disposed) return
    customProfiles = [...customProfiles.filter(p => p.id !== id), result]
    renderCustomProfiles(id); feedback(uiText("启动配置已保存；环境变量不会保存。"), true)
  } catch (error) {if (!disposed) feedback((error as Error).message, true)}
  finally {savingProfile = false; if (!disposed) {button.textContent = uiText("保存启动配置"); syncLauncher()}}
}
async function launchTerminal(id: string) {
  const target = saved.terminal
  if (startingProfile || savingProfile || current || restoring || saved.environment !== "local" || !target?.cwd) return
  startingProfile = id
  syncLauncher()
  feedback()
  try {
    const preset = customProfiles.find(profile => profile.id === id)
    const command = id === "custom"
      ? {name:nameInput.value.trim(), executable:executable.value.trim(), args:parsedArgs(), env:parsedEnv()}
      : preset ? {name:preset.name, executable:preset.executable, args:preset.args || []} : undefined
    if (command && !command.executable) throw new Error(uiText("请填写可执行文件"))
    const directory = target.bindingID ? {session_id:target.sessionID,binding_id:target.bindingID} : {project_id:target.projectID,cwd:target.cwd}
    const info = await api<TerminalInfo>("/api/terminals", "POST", {...directory, profile_id:command ? "custom" : id, ...command, cols:100, rows:30})
    conversationDefaults.set("terminal-directory",info.cwd)
    if (!disposed) await showTerminal(info)
  } catch (error) {if (!disposed) feedback((error as Error).message, true)}
  finally {startingProfile = undefined; if (!disposed) syncLauncher()}
}
element<HTMLFormElement>("terminalForm").onsubmit = event => {
  event.preventDefault()
  if (customTerminal.open) void launchTerminal("custom")
}
element("terminalContext").onclick = () => {
  const project = saved.terminal?.projectID
  if (project) post("workhub:page-open", {snapshot:{route:`/projects/${encodeURIComponent(project)}?${new URLSearchParams({directory:saved.terminal?.cwd || ""})}`,environment:saved.environment}})
}
element("terminalKindUI").onclick = () => {
  if (current || startingProfile || savingProfile) return
  const project = saved.terminal?.projectID
  const cwd = saved.terminal?.cwd
  post("workhub:conversation-kind", {kind:"ui", snapshot:{...saved,terminal:{projectID:project,cwd},conversation:{...saved.conversation,
    scope:project ? {kind:"project",id:project,environment:saved.environment} : {kind:"all"},
    creationDirectory:cwd || "",selected:null,creating:true,pane:"detail"}}})
}
element("refreshTerminals").onclick = () => void refreshRows().catch(error => feedback(error.message))
element("reconnectTerminal").onclick = () => {if (finished) {feedback(uiText("终端已退出，请新建终端。")); return}; feedback(); void connect()}
function showSearch(open: boolean) {
  element("terminalSearchBar").hidden = !open
  element("openTerminalSearch").setAttribute("aria-expanded", String(open))
  if (open) element<HTMLInputElement>("terminalSearch").focus()
  else element("openTerminalSearch").focus()
}
element("openTerminalSearch").onclick = () => showSearch(!!element("terminalSearchBar").hidden)
element("closeTerminalSearch").onclick = () => showSearch(false)
element("terminalSearchNext").onclick = () => search?.findNext(element<HTMLInputElement>("terminalSearch").value)
element("terminalSearch").onkeydown = event => {if (event.key === "Enter") search?.findNext(element<HTMLInputElement>("terminalSearch").value); else if (event.key === "Escape") {event.stopPropagation(); showSearch(false)}}
element("stopTerminal").onclick = () => {element<HTMLDetailsElement>("terminalActionMenu").open = false; element<HTMLDialogElement>("stopTerminalDialog").showModal()}
element<HTMLDialogElement>("stopTerminalDialog").onclose = () => {
  if (element<HTMLDialogElement>("stopTerminalDialog").returnValue !== "stop" || !current) return
  const id = current.id
  status(uiText("正在结束…"))
  void api<TerminalInfo>(`/api/terminals/${encodeURIComponent(id)}/stop`, "POST", {}).then(info => {
    if (disposed || current?.id !== id || finished) return
    if (info.state === "exited") terminalExited(info.exit_code)
  }).catch(error => {
    if (disposed || current?.id !== id || finished) return
    status(uiText("结束失败")); feedback(error.message)
  })
}

document.addEventListener("pointerdown", () => post("workhub:page-focus"), true)
document.addEventListener("focusin", () => post("workhub:page-focus"))
function dispose() {if (disposed) return; disposed = true; ++restoreRevision; disconnect(); resize.disconnect(); term?.dispose(); clearInterval(poll); terminalTools.unmount(); unmountSurface()}
window.addEventListener("pagehide", dispose)
window.addEventListener("message", event => {
  if (event.source !== host || event.origin !== location.origin || !event.data) return
  const message = event.data
  if (message.type === "workhub:page-restore") {active = !!message.active; void restore(message.snapshot)}
  else if (message.type === "workhub:page-active") {active = !!message.active; if (active) requestAnimationFrame(measure)}
  else if (message.type === "workhub:parallel-layout") {
    document.documentElement.toggleAttribute("data-workspace-pane", !!message.split)
    document.documentElement.toggleAttribute("data-workspace-focused", !!message.focused)
    element("closeTerminalView").hidden = !message.split
    element("zoomTerminal").hidden = !message.split || !message.canZoom
    const zoomLabel = message.zoomed ? uiText("恢复分栏") : uiText("放大当前对话")
    element("zoomTerminal").setAttribute("aria-label", zoomLabel); element("zoomTerminal").title = zoomLabel
    element("zoomTerminal").dataset.zoomed = String(!!message.zoomed)
  } else if (message.type === "workhub:page-closing") dispose()
  else if (message.type === "workhub:page-navigate" && typeof message.route === "string") post("workhub:page-open", {snapshot:{route:message.route, environment:saved.environment}})
})
const poll = setInterval(() => {if (active && !current && !restoring && !disposed && saved.environment === "local") void refreshRows().catch(() => {})}, 5000)
;(window as Window & {WorkHubPage?: object}).WorkHubPage = {snapshot, canClose:() => !startingProfile && !savingProfile, dispose, get restoring() {return restoring}}
context()
syncLauncher()
post("workhub:page-ready")
