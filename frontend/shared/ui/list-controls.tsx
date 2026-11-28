import type {ButtonHTMLAttributes, ComponentProps, ReactNode} from "react"
import {ChevronDown, Plus, Search, SlidersHorizontal, X} from "lucide-react"
import {Button} from "./primitives/button"
import {Input} from "./primitives/input"
import {uiText} from "../i18n"

export function ListCreateButton({ label, showLabel, icon, ...props }: ComponentProps<typeof Button> & { label: string; showLabel?: boolean; icon?: ReactNode }) {
  if (showLabel) return <Button type="button" size="sm" className="resource-list-create" aria-label={label} title={label} {...props}>{icon ?? <Plus aria-hidden="true" />}{label}</Button>
  return <Button type="button" variant="ghost" size="icon-sm" className="list-create-button size-[28px] rounded-[5px]" aria-label={label} title={label} {...props}>
    {icon ?? <Plus className="size-[15px]" aria-hidden="true" />}
  </Button>
}

export function ListSearch({ id, className = "", input, label, placeholder, clear, filter, variant = "default", leading, actions }: {
  id?: string; className?: string; variant?: "default" | "plain"; leading?: ReactNode; actions?: ReactNode; input: string; label: string; placeholder: string;
  clear: ButtonHTMLAttributes<HTMLButtonElement> & { [attribute: `data-${string}`]: string | undefined }; filter: ReactNode;
}) {
  return <div id={id} className={`list-search ${variant === "plain" ? "list-search-plain" : ""} ${className}`}>
    {leading}
    <div className="list-search-field">
      <Search aria-hidden="true" />
      <Input id={input} aria-label={label} type="search" placeholder={placeholder} autoComplete="off" className="h-[32px] rounded-none border-0 px-[28px] text-xs shadow-none focus-visible:ring-0 md:text-xs" />
      <button {...clear} type="button" className="list-search-clear" aria-label={uiText("清除搜索")} title={uiText("清除搜索")} hidden><X aria-hidden="true" /></button>
    </div>
    {filter}
    {actions && <div className="list-search-actions">{actions}</div>}
  </div>
}

export function ListFilter({ id, label, descriptionID, description, menuClass = "", icon, children }: {
  id: string; label: string; descriptionID?: string; description?: string; menuClass?: string; icon?: ReactNode; children: ReactNode;
}) {
  return <details id={id} className="list-filter">
    <summary aria-label={label} title={label} aria-describedby={descriptionID}>{icon ?? <SlidersHorizontal aria-hidden="true" />}
      {descriptionID && <span id={descriptionID} className="sr-only">{description}</span>}
    </summary>
    <div className={`list-filter-menu ${menuClass}`} popover="manual">{children}</div>
  </details>
}

export function syncListFilter(picker: HTMLDetailsElement, visible = true) {
  const panel = picker.querySelector<HTMLElement>(".list-filter-menu")
  if (typeof panel?.showPopover !== "function") return
  if (!picker.open || !visible) {
    if (panel.matches(":popover-open")) panel.hidePopover()
    return
  }
  const window = picker.ownerDocument.defaultView
  const summary = picker.querySelector("summary")
  if (!window || !summary) return
  const anchor = summary.getBoundingClientRect()
  const search = (picker.closest(".list-search") || summary).getBoundingClientRect()
  const desktop = picker.ownerDocument.documentElement.hasAttribute("data-workhub-desktop")
  const width = Math.min(desktop && search.width ? search.width : 420, window.innerWidth - 24)
  const below = window.innerHeight - anchor.bottom - 18
  const above = anchor.top - 18
  const useBelow = below >= 300 || below >= above
  panel.style.width = `${width}px`
  panel.style.left = `${Math.max(12, Math.min(search.width ? search.left : anchor.left, window.innerWidth - width - 12))}px`
  panel.style.top = useBelow ? `${anchor.bottom + 6}px` : "auto"
  panel.style.bottom = useBelow ? "auto" : `${window.innerHeight - anchor.top + 6}px`
  panel.style.maxHeight = `${Math.max(0, Math.min(560, useBelow ? below : above))}px`
  if (!panel.matches(":popover-open")) panel.showPopover()
}

export function ResourceSwitcherTrigger({ kind }: { kind: "project" }) {
  const label = uiText("切换项目")
  return <Button type="button" variant="ghost" size="icon-sm" className="resource-switcher-trigger"
    data-resource-switcher={kind} aria-label={label} title={label} aria-haspopup="dialog" aria-controls="resourceSwitcher">
    <ChevronDown aria-hidden="true" />
  </Button>
}

export function ResourceSwitcherDialog() {
  return <div className="resource-switcher-content">
    <header className="dialog-header">
      <h2 id="resourceSwitcherTitle">{uiText("切换项目")}</h2>
      <Button type="button" size="icon-sm" variant="ghost" className="close-dialog" aria-label={uiText("关闭")}><X aria-hidden="true" /></Button>
    </header>
    <ListSearch input="resourceSwitcherSearch" label={uiText("搜索")} placeholder={uiText("搜索")} clear={{ id: "resourceSwitcherClear" }} filter={null} />
    <div id="resourceSwitcherResults" className="resource-switcher-results"></div>
    <p id="resourceSwitcherEmpty" role="status" hidden>{uiText("没有匹配的结果")}</p>
  </div>
}
