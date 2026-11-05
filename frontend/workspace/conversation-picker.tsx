import { uiText } from "../i18n";
import { useEffect, useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { conversationContext, type ConversationWorkspace } from "./conversation-context"

interface Scope { kind: string; id?: string; environment?: string; name?: string }
export interface ConversationChoice {
  route: string; environment: string; title: string; context: string
  conversation: {scope: Scope; selected: string; pane: string}
}
export interface ConversationPickerProps {
  requestID: number; title: string; scope?: Scope; environment: string
  existing: string[]; choose: (snapshot: ConversationChoice) => void; close: () => void
}
interface Environment { id: string; name: string }
type Task = ConversationWorkspace["tasks"][number] & {environment_id?: string}
interface Row { id: string; name: string; cwd: string; updated_at?: number; available?: boolean; error?: string }
const identity = (environment: string, id: string) => environment === "local" ? id : JSON.stringify([environment,id])
async function read<T>(path: string, environment = "local", signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {headers:{"X-Environment-ID":environment}, signal})
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || uiText("读取对话失败"))
  return value
}

export function ConversationPicker(props: ConversationPickerProps) {
  const [inventory, setInventory] = useState<{tasks: Task[]; environments: Environment[]} | null>(null)
  const [task, setTask] = useState(props.scope?.kind === "task" ? JSON.stringify([props.scope.environment || props.environment,props.scope.id]) : "")
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<(ConversationChoice & {key: string; cwd: string; disabled: boolean})[]>([])
  const [loading, setLoading] = useState(true)
  const [errors, setErrors] = useState<string[]>([])
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setInventory(null); setErrors([]); setLoading(true)
    void Promise.allSettled([
      read<{requirements: Task[]; environments: Environment[]}>("/api/task-inventory", "local", controller.signal),
      read<{environments: Environment[]}>("/api/environments", "local", controller.signal),
    ]).then(results => {
      if (controller.signal.aborted) return
      const tasks = results[0].status === "fulfilled" ? results[0].value.requirements || [] : []
      const entries = results.flatMap(result => result.status === "fulfilled" ? result.value.environments || [] : [])
      const environments = [...new Map([{id:"local",name:uiText("本机")}, ...entries, {id:props.environment,name:entries.find(e => e.id === props.environment)?.name || props.environment}].map(e => [e.id,e])).values()]
      setInventory({tasks,environments})
      setErrors(results.flatMap(result => result.status === "rejected" ? [String(result.reason.message)] : []))
    })
    return () => controller.abort()
  }, [props.environment,revision])
  useEffect(() => {
    if (!inventory) return
    const controller = new AbortController()
    const selected = task ? JSON.parse(task) as [string,string] : null
    const environments = selected ? inventory.environments.filter(e => e.id === selected[0]) : inventory.environments
    setLoading(true); setRows([])
    void Promise.allSettled(environments.map(async environment => {
      const params = new URLSearchParams()
      if (selected) {params.set("task_id",selected[1]); params.set("linked","true")}
      const result = await read<{sessions: Row[]; error?: string}>("/api/sessions?" + params,environment.id,controller.signal)
      const tasks = inventory.tasks.filter(t => (t.environment_id || "local") === environment.id)
      return {error:result.error ? `${environment.name}：${result.error}` : "", rows:(result.sessions || []).map(session => {
        const context = conversationContext(session.cwd,{tasks,projects:[]},selected?.[1])
        const label = context.tasks.map(t => t.name).join("、") || uiText("未关联任务")
        return {key:identity(environment.id,session.id),cwd:session.cwd,disabled:session.available === false || !!session.error,
          route:"/sessions", environment:environment.id, title:session.name || uiText("未命名对话"), context:label + " · " + environment.name,
          conversation:{scope:selected ? {kind:"task",id:selected[1],environment:environment.id,name:label} : {kind:"all"},selected:identity(environment.id,session.id),pane:"detail"}}
      })}
    })).then(results => {
      if (controller.signal.aborted) return
      setRows(results.flatMap(result => result.status === "fulfilled" ? result.value.rows : []))
      setErrors(previous => [...previous, ...results.flatMap(result => result.status === "rejected" ? [String(result.reason.message)] : result.value.error ? [result.value.error] : [])])
      setLoading(false)
    })
    return () => controller.abort()
  }, [inventory,task])
  const query = search.trim().toLowerCase()
  const matching = rows.filter(row => [row.title,row.context,row.cwd].join(" ").toLowerCase().includes(query))
  return <Dialog.Root open onOpenChange={open => {if (!open) props.close()}}>
    <Dialog.Portal>
      <Dialog.Overlay className="conversation-picker-overlay" />
      <Dialog.Content className="conversation-picker shadcn-scope" aria-describedby="parallelPickerDescription">
        <div className="conversation-picker-heading"><Dialog.Title>{props.title}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon-sm" aria-label={uiText("关闭对话选择器")}><X /></Button></Dialog.Close></div>
        <Dialog.Description id="parallelPickerDescription">{uiText("可选择当前任务或其他任务的对话。已有对话会直接定位到对应栏。")}</Dialog.Description>
        <div className="conversation-picker-task"><label htmlFor="parallelTaskScope">{uiText("任务范围")}</label><select id="parallelTaskScope" aria-label={uiText("选择任务范围")} value={task} onChange={event => {setTask(event.target.value); setErrors([])}}>
          <option value="">{uiText("全部任务与对话")}</option>
          {task && !inventory?.tasks.some(t => JSON.stringify([t.environment_id || "local",t.id]) === task) && <option value={task}>{props.scope?.name || uiText("当前任务")}</option>}
          {inventory?.tasks.map(t => <option key={JSON.stringify([t.environment_id || "local",t.id])} value={JSON.stringify([t.environment_id || "local",t.id])}>{t.name} · {inventory.environments.find(e => e.id === (t.environment_id || "local"))?.name || t.environment_id || uiText("本机")}</option>)}
        </select>{task && <Button type="button" variant="ghost" size="sm" onClick={() => {setTask(""); setErrors([])}} aria-label={uiText("查看全部任务的对话")}>{uiText("全部任务")}</Button>}</div>
        <div className="conversation-picker-search"><Search aria-hidden="true" /><Input autoFocus aria-label={uiText("搜索并列对话")} placeholder={uiText("搜索对话、任务或工作目录")} value={search} onChange={event => setSearch(event.target.value)} /></div>
        {!!errors.length && <div role="alert" className="conversation-picker-error">{[...new Set(errors)].join("；")}<Button variant="ghost" size="sm" onClick={() => setRevision(revision + 1)}>{uiText("重试")}</Button></div>}
        <div className="conversation-picker-results" aria-label={uiText("可并列的对话")} aria-busy={loading}>
          {loading ? <p role="status">{uiText("正在读取对话…")}</p> : matching.length ? matching.map(row => <button key={row.key} type="button" className="conversation-picker-row" disabled={row.disabled} onClick={() => props.choose(row)}>
            <span><strong>{row.title}</strong><small>{row.context}</small><small title={row.cwd}>{row.cwd}</small></span><span>{row.disabled ? uiText("暂不可用") : props.existing.includes(row.key) ? uiText("定位") : uiText("选择")}</span>
          </button>) : <p role="status">{uiText("没有找到对话，可切换任务范围或修改搜索条件。")}</p>}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
