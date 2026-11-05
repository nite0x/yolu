import { uiText } from "../i18n";
import { memo, useLayoutEffect, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { flushSync } from "react-dom"
import { ChevronDown, Columns2, CopyPlus, FolderGit2, ListTodo, MessageSquare, PanelLeft, Plus, Settings2, Terminal, X } from "lucide-react"
import { DropdownMenu } from "radix-ui"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { setupSplitResize } from "./split-resize"
import { ConversationPicker, type ConversationPickerProps } from "./conversation-picker"

export { setupSplitResize }

interface TabItem { id: string; title: string; context?: string; environment: string; kind: string; status?: string }
interface TabbarProps {
  tabs: TabItem[]; selected: string; ready: boolean
  select: (id: string) => void; close: (id: string) => void
  create: () => void; duplicate: () => void
  canAdd: boolean; addConversation: () => void
  newConversation: () => void; canSplit: boolean; splitConversation: () => void
}
const icons = { requirements: ListTodo, projects: FolderGit2, sessions: MessageSquare, terminals: Terminal, settings: Settings2 }

const WorkspaceTabItem = memo(function WorkspaceTabItem({ id, title, context, environment, kind, active, select, close }: TabItem & {
  active: boolean; select: TabbarProps["select"]; close: TabbarProps["close"]
}) {
  const Icon = icons[kind as keyof typeof icons] || ListTodo
  return <div className="workspace-tab-item" data-active={active}
    onAuxClick={event => { if (event.button === 1) {event.preventDefault(); close(id)} }}>
    <TabsTrigger id={`tab-${id}`} value={id} variant="plain" aria-controls={`page-${id}`} className="workspace-tab-trigger text-[12px]"
      onClick={() => select(id)}
      title={[title, context, environment === "local" ? "" : environment].filter(Boolean).join("\n")}>
      <Icon className="workspace-tab-type size-[14px]" aria-hidden="true" /><span className="workspace-tab-label">{title}</span>
    </TabsTrigger>
    <Button type="button" variant="ghost" size="icon-xs" className="workspace-tab-close" aria-label={uiText("关闭标签页：{0}", title)}
      onClick={() => close(id)}><X aria-hidden="true" /></Button>
  </div>
})

function WorkspaceTabbar({ tabs, selected, ready, select, close, create, duplicate, canAdd, addConversation, newConversation, canSplit, splitConversation }: TabbarProps) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    root.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({block:"nearest", inline:"nearest"})
  }, [selected])
  return <div ref={root} className="workspace-tabbar-content shadcn-scope">
    <Tabs value={selected} onValueChange={select} className="workspace-tabs-root">
      <TabsList id="workspaceTabs" variant="line" aria-label={uiText("打开的页面")} className="workspace-tab-list">
        {tabs.map(tab => <WorkspaceTabItem key={tab.id} {...tab} active={tab.id === selected} select={select} close={close} />)}
      </TabsList>
    </Tabs>
    <div className="workspace-tab-actions">
      <Button type="button" id="workspaceTabNew" variant="ghost" size="icon-xs" disabled={!ready} title={uiText("新建标签页（⌘/Ctrl+T）")} aria-label={uiText("新建标签页")} onClick={create}><Plus className="size-[14px]" aria-hidden="true" /></Button>
      <Button type="button" id="workspaceTabDuplicate" variant="ghost" size="icon-xs" disabled={!tabs.length} title={uiText("在新标签页打开当前页面")} aria-label={uiText("在新标签页打开当前页面")} onClick={duplicate}><CopyPlus className="size-[14px]" aria-hidden="true" /></Button>
      {canAdd && <Button type="button" variant="ghost" size="sm" className="workspace-parallel-add text-[12px]" aria-label={uiText("添加并列对话")} title={uiText("选择同一任务或其他任务的对话并列查看")} onClick={addConversation}><Columns2 className="size-[14px]" aria-hidden="true" /><span>{uiText("并列对话")}</span></Button>}
      <Button type="button" variant="ghost" size="sm" className="workspace-parallel-add text-[12px]" disabled={!ready} aria-label={uiText("新建对话")} title={uiText("选择 UI 对话或终端")} onClick={newConversation}><MessageSquare className="size-[14px]" aria-hidden="true" /><span>{uiText("新建对话")}</span></Button>
      {canSplit && <Button type="button" variant="ghost" size="icon-xs" aria-label={uiText("在右侧新建对话")} title={uiText("在右侧新建 UI 对话或终端")} onClick={splitConversation}><Columns2 className="size-[14px]" aria-hidden="true" /><Plus className="size-[14px]" aria-hidden="true" /></Button>}
    </div>
  </div>
}

interface PaneProps {
  tabs: TabItem[]; panes: string[]; selected: string; zoomed: boolean; zoomable: boolean
  choose: (id: string) => void; zoom: (id: string) => void
  replace: (id: string) => void; close: (id: string) => void
  resize: (index: number, width: number) => void; commit: () => void
  frames: HTMLIFrameElement[]; container: HTMLElement
}
function PaneSeparator({ index, frames, container, resize, commit }: PaneProps & {index: number}) {
  const ref = useRef<HTMLDivElement>(null)
  const frame = frames[index], adjacent = frames[index + 1]
  useLayoutEffect(() => setupSplitResize({
    handle:ref.current!, container, panel:frame, axis:"x",
    bounds:() => {
      const pair = frame.getBoundingClientRect().width + adjacent.getBoundingClientRect().width
      return pair > 0 ? {min:Math.min(280, pair / 2), max:pair - Math.min(280, pair / 2)} : null
    },
    resize:width => resize(index, width), commit,
  }), [index, frame, adjacent, container, resize, commit])
  return <div ref={ref} role="separator" tabIndex={0} aria-orientation="vertical" aria-label={uiText("调整第 {0} 栏宽度", index + 1)} className="workspace-pane-resize" style={{gridColumn:index * 2 + 2, gridRow:1}} />
}
function PaneHeaders(props: PaneProps) {
  return <>{!props.zoomed && props.panes.slice(1).map((_, index) => <PaneSeparator key={`resize-${index}`} {...props} index={index} />)}</>
}

const roots = new WeakMap<HTMLElement, Root>()
interface WindowChromeProps {
  collapsed: boolean; ready: boolean; canCreate: boolean
  toggle: () => void; create: () => void; home: () => void
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
          <DropdownMenu.Item className="window-brand-menu-item" disabled={!props.canCreate} onSelect={props.create}>
            <Plus aria-hidden="true" /><span>{uiText("新建标签页")}</span><kbd>⌘T</kbd>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="window-brand-menu-separator" />
          <DropdownMenu.Item className="window-brand-menu-item" disabled={!props.canCreate} onSelect={props.home}>
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
export function render(container: HTMLElement, props: TabbarProps) {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  flushSync(() => root.render(<WorkspaceTabbar {...props} />))
}
export function renderPanes(container: HTMLElement, props: PaneProps | null) {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  flushSync(() => root.render(props ? <PaneHeaders {...props} /> : null))
}

export function renderPicker(container: HTMLElement, props: ConversationPickerProps | null) {
  let root = roots.get(container)
  if (!root) { root = createRoot(container); roots.set(container, root) }
  flushSync(() => root.render(props ? <ConversationPicker key={props.requestID} {...props} /> : null))
}
export { conversationDefaults } from "./conversation-defaults"
