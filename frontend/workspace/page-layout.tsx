import { uiText } from "../i18n";
import { useLayoutEffect, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { flushSync } from "react-dom"
import { ChevronDown, ListTodo, PanelLeft } from "lucide-react"
import { DropdownMenu } from "radix-ui"
import { Button } from "@/components/ui/button"
import { setupSplitResize } from "./split-resize"

export { setupSplitResize }

interface PaneProps {
  count: number
  resize: (index: number, width: number) => void
  frames: HTMLIFrameElement[]; container: HTMLElement
}
function PaneSeparator({ index, frames, container, resize }: PaneProps & {index: number}) {
  const ref = useRef<HTMLDivElement>(null)
  const frame = frames[index], adjacent = frames[index + 1]
  useLayoutEffect(() => setupSplitResize({
    handle:ref.current!, container, panel:frame, axis:"x",
    bounds:() => {
      const pair = frame.getBoundingClientRect().width + adjacent.getBoundingClientRect().width
      return pair > 0 ? {min:Math.min(280, pair / 2), max:pair - Math.min(280, pair / 2)} : null
    },
    resize:width => resize(index, width),
  }), [index, frame, adjacent, container, resize])
  return <div ref={ref} role="separator" tabIndex={0} aria-orientation="vertical" aria-label={uiText("调整第 {0} 栏宽度", index + 1)} className="workspace-pane-resize" style={{gridColumn:index * 2 + 2, gridRow:1}} />
}
function PaneHeaders(props: PaneProps) {
  return <>{Array.from({length:props.count - 1}, (_, index) => <PaneSeparator key={`resize-${index}`} {...props} index={index} />)}</>
}

const roots = new WeakMap<HTMLElement, Root>()
interface WindowChromeProps {
  collapsed: boolean; ready: boolean
  toggle: () => void; home: () => void
}
function WindowChrome(props: WindowChromeProps) {
  const label = props.collapsed ? uiText("展开侧栏") : uiText("收起侧栏")
  return <>
    <Button type="button" variant="ghost" size="icon-sm" className="window-sidebar-toggle size-[32px]"
      aria-label={label} title={label} aria-expanded={!props.collapsed} disabled={!props.ready} onClick={props.toggle}>
      <PanelLeft className="size-[16px]" aria-hidden="true" />
    </Button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="window-brand-trigger" aria-label={uiText("Yolu 菜单")} title={uiText("Yolu 菜单")}>
          <img src="/yolu.svg" width="26" height="26" alt="" />
          <span>Yolu</span><ChevronDown aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="window-brand-menu shadcn-scope" side="bottom" align="start" sideOffset={6} collisionPadding={8}>
          <DropdownMenu.Item className="window-brand-menu-item" disabled={!props.ready} onSelect={props.home}>
            <ListTodo aria-hidden="true" /><span>{uiText("任务首页")}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  </>
}
export function renderChrome(container: HTMLElement, props: WindowChromeProps) {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  flushSync(() => root.render(<WindowChrome {...props} />))
}
export function renderPanes(container: HTMLElement, props: PaneProps | null) {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  flushSync(() => root.render(props ? <PaneHeaders {...props} /> : null))
}

export { conversationDefaults } from "./conversation-defaults"
