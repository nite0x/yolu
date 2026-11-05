import { uiText, uiLocale } from "../i18n";
import { useEffect, useId, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Popover } from "radix-ui"
import { Gauge, ChevronRight, RefreshCw, X } from "lucide-react"
import "./codex-usage.css"

interface LimitWindow { usedPercent?: number | null; windowDurationMins?: number | null; resetsAt?: number | null }
interface LimitSnapshot { limitId?: string; limitName?: string; planType?: string; primary?: LimitWindow | null; secondary?: LimitWindow | null }
interface ResetCard { id: string; resetType: string; status: string; expiresAt?: number | null; title?: string | null }
export interface CodexRateLimits { rateLimits?: LimitSnapshot | null; rateLimitsByLimitId?: Record<string, LimitSnapshot>; rateLimitResetCredits?: {availableCount: number; credits?: ResetCard[] | null} | null; checkedAt?: number }
interface Environment { id: string; name: string }
interface ResetAttempt { idempotencyKey: string; creditId: string }
const attemptKey = (environment: string) => `workhub:codex-reset-attempt:v1:${environment}`
function restoreAttempt(environment: string): ResetAttempt | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(attemptKey(environment)) || "null")
    return value && typeof value.idempotencyKey === "string" && typeof value.creditId === "string" && value.creditId ? value : null
  } catch { return null }
}
export function availableResetCards(data?: CodexRateLimits) {
  return [...(data?.rateLimitResetCredits?.credits || [])].filter(card => card.id && card.status === "available" && card.resetType === "codexRateLimits" && (!card.expiresAt || card.expiresAt > Date.now() / 1000))
    .sort((a,b) => (a.expiresAt || Infinity) - (b.expiresAt || Infinity))
}
const cardName = (card: ResetCard) => card.title === "Full reset" ? uiText("完整重置卡") : card.title || uiText("额度重置卡")

export function quotaWindows(data?: CodexRateLimits) {
  const buckets = Object.entries(data?.rateLimitsByLimitId || {})
  if (!buckets.length && data?.rateLimits) buckets.push([data.rateLimits.limitId || "codex", data.rateLimits])
  return buckets.flatMap(([id, bucket]) => (["primary", "secondary"] as const).flatMap(key => {
    const window = bucket[key]
    if (!window) return []
    const used = window.usedPercent
    const remaining = typeof used === "number" && Number.isFinite(used) ? Math.max(0, Math.min(100, 100 - used)) : null
    return [{ key: `${id}:${key}`, bucket: bucket.limitName || (id === "codex" ? "Codex" : id), id, plan: bucket.planType, ...window, remaining }]
  }))
}

export function quotaDuration(minutes?: number | null) {
  if (!minutes || minutes <= 0) return uiText("额度窗口")
  if (minutes === 10080) return uiText("每周额度")
  if (minutes % 1440 === 0) return uiText("{0} 天额度", minutes / 1440)
  if (minutes % 60 === 0) return uiText("{0} 小时额度", minutes / 60)
  return uiText("{0} 分钟额度", minutes)
}

const percent = (value: number) => `${Number(value.toFixed(1))}%`
const resetTime = (seconds?: number | null) => seconds && seconds > 0 ? new Date(seconds * 1000).toLocaleString(uiLocale(), { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }) : null
const visible = () => !document.hidden && !document.documentElement.hasAttribute("data-workspace-inactive") && !(document.documentElement.hasAttribute("data-workspace-conversation") && !document.documentElement.hasAttribute("data-workspace-navigation"))

async function quotaRequest<T>(path: string, environment: string, init: RequestInit = {}): Promise<T> {
  const token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ""
  const response = await fetch(path, { ...init, headers:{"X-CSRF-Token":token, "X-Environment-ID":environment, "Content-Type":"application/json"} })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || uiText("暂时无法读取 Codex 额度"))
  return data
}

export function CodexUsage({ portal }: { portal: HTMLElement }) {
  const title = useId()
  const [open, setOpen] = useState(false)
  const [environment, setEnvironment] = useState("local")
  const [environments, setEnvironments] = useState<Environment[]>([{id:"local", name:uiText("本机")}])
  const [snapshot, setSnapshot] = useState<{environment: string; data: CodexRateLimits} | null>(null)
  const [failure, setFailure] = useState<{environment: string; message: string} | null>(null)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [resetAttempt, setResetAttempt] = useState<ResetAttempt | null>(() => restoreAttempt("local"))
  const [selectedCard, setSelectedCard] = useState("")
  const [confirmCard, setConfirmCard] = useState<ResetCard | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const resetPending = useRef(false)
  const resetStart = useRef<HTMLButtonElement>(null)
  const [resetNotice, setResetNotice] = useState<{message: string; error?: boolean} | null>(null)
  const data = snapshot?.environment === environment ? snapshot.data : undefined
  const error = failure?.environment === environment ? failure.message : ""
  const windows = quotaWindows(data)
  const main = windows.some(w => w.id === "codex") ? windows.filter(w => w.id === "codex") : windows
  const remaining = main.flatMap(w => w.remaining === null ? [] : [w.remaining])
  const minimum = remaining.length ? Math.min(...remaining) : null
  const summary = error ? data ? uiText("待更新") : uiText("暂不可用") : minimum !== null ? uiText("剩余 {0}", percent(minimum)) : loading || !data ? uiText("读取中…") : uiText("未提供额度")
  const environmentName = environments.find(e => e.id === environment)?.name || environment
  const tone = error ? "unknown" : minimum !== null && minimum <= 20 ? "low" : "normal"
  const cards = availableResetCards(data)
  const chosenCard = cards.find(card => card.id === selectedCard) || cards[0]
  const credits = data?.rateLimitResetCredits

  const consumeReset = async (creditId?: string) => {
    if (resetPending.current) return
    resetPending.current = true; setResetBusy(true); setResetNotice(null)
    try {
      // Persist before sending. A lost response must never lead to consuming a
      // second card when the user retries or reloads this workspace page.
      const attempt = resetAttempt || restoreAttempt(environment) || {idempotencyKey:crypto.randomUUID(), creditId:creditId!}
      if (!attempt.creditId) throw new Error(uiText("请刷新后选择一张可用的重置卡。"))
      sessionStorage.setItem(attemptKey(environment), JSON.stringify(attempt))
      setResetAttempt(attempt)
      const result = await quotaRequest<{outcome: string}>("/api/codex/rate-limit-reset", environment, {method:"POST", body:JSON.stringify({...attempt, confirmed:true})})
      const notices: Record<string,string> = {reset:uiText("已使用一张重置卡。"), alreadyRedeemed:uiText("上次重置已完成，未重复使用重置卡。"), nothingToReset:uiText("当前没有符合条件的额度可以重置，未使用重置卡。"), noCredit:uiText("Codex 返回没有可用的重置卡，请查看最新卡片信息。")}
      if (!notices[result.outcome]) throw new Error(uiText("暂未确认重置结果，请重试上次操作以核对结果。"))
      sessionStorage.removeItem(attemptKey(environment)); setResetAttempt(null); setConfirmCard(null)
      setResetNotice({message:notices[result.outcome]})
      setSnapshot(null); setFailure(null); setRevision(n => n + 1)
    } catch (error) {
      setResetNotice({message:error instanceof Error ? error.message : uiText("暂未确认重置结果，请重试上次操作以核对结果。"), error:true})
    } finally { resetPending.current = false; setResetBusy(false) }
  }

  useEffect(() => {
    const abort = new AbortController()
    let pending = false
    let lastRead = 0
    const load = async (force = false) => {
      if (!visible() || resetPending.current || pending || !force && Date.now() - lastRead < 5000) return
      pending = true; lastRead = Date.now(); setLoading(true)
      try {
        const value = await quotaRequest<CodexRateLimits>(`/api/codex/rate-limits${force ? "?refresh=1" : ""}`, environment, {signal:abort.signal})
        if (!abort.signal.aborted) { setSnapshot({environment, data:value}); setFailure(null) }
      } catch (error) {
        if (!abort.signal.aborted) setFailure({environment, message:error instanceof Error ? error.message : uiText("暂时无法读取 Codex 额度")})
      } finally { pending = false; if (!abort.signal.aborted) setLoading(false) }
    }
    void load(revision > 0)
    const refresh = () => { void load() }
    const timer = window.setInterval(refresh, 60000)
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("workhub:tab-visibility", refresh)
    return () => { abort.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("workhub:tab-visibility", refresh) }
  }, [environment, revision, resetBusy])

  useEffect(() => {
    if (!open) return
    const abort = new AbortController()
    void quotaRequest<{environments: Environment[]}>("/api/environments", "local", {signal:abort.signal}).then(value => {
      if (!abort.signal.aborted) setEnvironments([...new Map([{id:"local", name:uiText("本机")}, ...(value.environments || [])].map(e => [e.id,e])).values()])
    }).catch(() => { /* Quota reads remain available without the inventory. */ })
    return () => abort.abort()
  }, [open])

  return <Popover.Root open={open} onOpenChange={value => { if (resetPending.current) return; setOpen(value); setConfirmCard(null); if (value) setRevision(n => n + 1) }}>
    <Popover.Trigger asChild><button type="button" className="codex-quota-trigger" data-tone={tone} aria-label={uiText("{0} Codex 额度，{1}", environmentName, summary)} title={uiText("{0} Codex 额度 · {1}", environmentName, summary)}>
      <Gauge aria-hidden="true" /><span className="codex-quota-copy"><span>{uiText("Codex 额度")}</span><span className="codex-quota-summary">{summary}</span></span><ChevronRight className="codex-quota-chevron" aria-hidden="true" />
    </button></Popover.Trigger>
    <Popover.Portal container={portal}><Popover.Content className="codex-quota-popover shadcn-scope" side="right" align="end" sideOffset={12} collisionPadding={16} aria-labelledby={title}>
      <div className="codex-quota-heading"><h2 id={title}>{uiText("Codex 额度")}</h2><button type="button" className="codex-quota-icon" aria-label={uiText("刷新 Codex 额度")} disabled={loading || resetBusy} onClick={() => setRevision(n => n + 1)}><RefreshCw className={loading ? "codex-quota-spinning" : ""} aria-hidden="true" /></button><Popover.Close className="codex-quota-icon" aria-label={uiText("关闭额度详情")} disabled={resetBusy}><X aria-hidden="true" /></Popover.Close></div>
      {environments.length > 1 ? <label className="codex-quota-environment">{uiText("执行环境")}<select value={environment} disabled={resetBusy} onChange={event => {setEnvironment(event.target.value); setResetAttempt(restoreAttempt(event.target.value)); setSelectedCard(""); setConfirmCard(null); setResetNotice(null)}}>{environments.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label> : <p className="codex-quota-environment">{environmentName}</p>}
      <p className="codex-quota-note">{uiText("显示此环境中登录的 Codex 账号额度，不同周期分别计算。")}</p>
      {error && <p className="codex-quota-error" role="alert">{error}{data ? uiText(" 以下为上次成功读取的结果。") : ""}</p>}
      {!data && !error && <p role="status">{uiText("正在读取额度…")}</p>}
      {data && !windows.length && <p>{uiText("当前登录方式未提供额度窗口。")}</p>}
      <div className="codex-quota-windows">{windows.map(window => <section key={window.key} className="codex-quota-window" data-tone={window.remaining !== null && window.remaining <= 20 ? "low" : "normal"}>
        <div className="codex-quota-window-heading"><span>{quotaDuration(window.windowDurationMins)}</span><strong>{window.remaining === null ? uiText("未提供比例") : uiText("剩余 {0}", percent(window.remaining))}</strong></div>
        {windows.some(w => w.id !== window.id) && <p className="codex-quota-note">{window.bucket}</p>}
        {window.remaining !== null && <div className="codex-quota-meter" role="meter" aria-label={uiText("{0} {1}剩余", window.bucket, quotaDuration(window.windowDurationMins))} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.remaining}><span style={{width:`${window.remaining}%`}} /></div>}
        <p className="codex-quota-note">{resetTime(window.resetsAt) ? uiText("{0} 重置", resetTime(window.resetsAt)) : uiText("暂未提供重置时间")}</p>
      </section>)}</div>
      <section className="codex-reset-cards" aria-label={uiText("Codex 重置卡")}>
        <div className="codex-quota-window-heading"><strong>{uiText("额度重置卡")}</strong><span>{credits ? uiText("可用 {0} 张", credits.availableCount) : uiText("暂未提供")}</span></div>
        {resetNotice && <p className={resetNotice.error ? "codex-quota-error" : "codex-reset-notice"} role={resetNotice.error ? "alert" : "status"}>{resetNotice.message}</p>}
        {resetAttempt ? <><p className="codex-quota-note">{resetBusy ? uiText("正在处理重置请求…") : uiText("上次重置结果尚未确认，重试会核对同一次操作。")}</p><button type="button" className="codex-reset-button" disabled={resetBusy} onClick={() => void consumeReset()}>{resetBusy ? uiText("正在核对…") : uiText("重试上次操作")}</button></> : confirmCard ? <div className="codex-reset-confirm" role="group" aria-label={uiText("确认使用重置卡")}>
          <p>{uiText("确定为「{0}」中的 Codex 账号使用 1 张{1}？使用后无法撤回。", environmentName, cardName(confirmCard))}</p>
          <p className="codex-quota-note">{resetTime(confirmCard.expiresAt) ? uiText("{0} 到期。", resetTime(confirmCard.expiresAt)) : uiText("未提供到期时间。")}{uiText("具体可重置的额度由 Codex 判定。")}</p>
          <div className="codex-reset-actions"><button type="button" className="codex-reset-button secondary" onClick={() => {setConfirmCard(null); resetStart.current?.focus()}}>{uiText("取消")}</button><button type="button" className="codex-reset-button" disabled={resetBusy || loading || !!error} onClick={() => void consumeReset(confirmCard.id)}>{uiText("确认使用 1 张")}</button></div>
        </div> : <>
          {cards.length > 1 && <label className="codex-reset-choice">{uiText("选择重置卡")}<select value={chosenCard?.id || ""} onChange={event => setSelectedCard(event.target.value)}>{cards.map((card, index) => <option key={card.id} value={card.id}>{cardName(card)} {index + 1}{resetTime(card.expiresAt) ? uiText(" · {0} 到期", resetTime(card.expiresAt)) : ""}</option>)}</select></label>}
          {chosenCard && <p className="codex-quota-note">{cards.length > 1 ? uiText("默认优先使用较早到期的卡。") : `${cardName(chosenCard)}${resetTime(chosenCard.expiresAt) ? uiText(" · {0} 到期", resetTime(chosenCard.expiresAt)) : ""}`}</p>}
          {credits && credits.availableCount > 0 && !cards.length && <p className="codex-quota-note">{uiText("卡片详情暂不可用，请刷新后重试。")}</p>}
          <button ref={resetStart} type="button" className="codex-reset-button" disabled={!chosenCard || !credits || credits.availableCount <= 0 || loading || !!error || resetBusy} onClick={() => {setConfirmCard(chosenCard); setResetNotice(null)}}>{uiText("使用重置卡")}</button>
        </>}
      </section>
      {data?.checkedAt && <p className="codex-quota-updated">{uiText("更新于")}{" "}{new Date(data.checkedAt * 1000).toLocaleTimeString(uiLocale(), {hour:"2-digit",minute:"2-digit",hour12:false})}{error ? uiText(" · 更新失败") : loading ? uiText(" · 更新中…") : uiText(" · 每分钟更新")}</p>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}

export function mountCodexUsage(sidebar: HTMLElement) {
  const host = document.createElement("div")
  host.className = "codex-quota-mount shadcn-scope"
  sidebar.querySelector(".sidebar-footer")?.before(host)
  let portal = document.body
  try { if (window.parent !== window && window.parent.location.origin === window.location.origin) portal = window.parent.document.body } catch { /* Use the local document when embedded elsewhere. */ }
  const root = createRoot(host)
  root.render(<CodexUsage portal={portal} />)
  return () => { root.unmount(); host.remove() }
}
