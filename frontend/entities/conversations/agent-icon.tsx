import {MousePointer2Icon} from "lucide-react"
import {uiText} from "@/shared/i18n"
import {cn} from "@/shared/lib/utils"

const logos = {
  codex: {src: "/agent-codex.png", name: "Codex"},
  "codex-cloud": {src: "/agent-codex.png", name: "Codex Cloud"},
  agy: {src: "/agent-antigravity.svg", name: "Antigravity"},
  "yolu-assistant": {src: "/yolu.svg", name: "Yolu 助手"},
}

export function AgentIcon({agent, size = 14, decorative = false, className}: {
  agent: keyof typeof logos | "cursor"
  size?: number
  decorative?: boolean
  className?: string
}) {
  if (agent === "cursor") return <MousePointer2Icon aria-hidden={decorative || undefined} aria-label={decorative ? undefined : "Cursor"} role={decorative ? undefined : "img"} width={size} height={size} className={cn("shrink-0", className)} />
  const {src, name} = logos[agent]
  const label = agent === "yolu-assistant" ? uiText("Yolu 助手") : name
  return <img alt={decorative ? "" : label} src={src} width={size} height={size} loading="lazy" draggable={false} className={cn("shrink-0 object-contain", className)} />
}
