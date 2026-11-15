import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react"
import { Plus, Search, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { uiText } from "../i18n"

export function ListCreateButton({ label, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return <Button type="button" variant="ghost" size="icon-sm" className="list-create-button size-[28px] rounded-[5px]" aria-label={label} title={label} {...props}>
    <Plus className="size-[15px]" aria-hidden="true" />
  </Button>
}

export function ListSearch({ id, className = "", input, label, placeholder, clear, filter }: {
  id?: string; className?: string; input: string; label: string; placeholder: string;
  clear: ButtonHTMLAttributes<HTMLButtonElement> & { [attribute: `data-${string}`]: string | undefined }; filter: ReactNode;
}) {
  return <div id={id} className={`list-search ${className}`}>
    <div className="list-search-field">
      <Search aria-hidden="true" />
      <Input id={input} aria-label={label} type="search" placeholder={placeholder} autoComplete="off" className="h-[32px] rounded-none border-0 px-[28px] text-xs shadow-none focus-visible:ring-0 md:text-xs" />
      <button {...clear} type="button" className="list-search-clear" aria-label={uiText("清除搜索")} title={uiText("清除搜索")} hidden><X aria-hidden="true" /></button>
    </div>
    {filter}
  </div>
}

export function ListFilter({ id, label, descriptionID, description, menuClass = "", children }: {
  id: string; label: string; descriptionID?: string; description?: string; menuClass?: string; children: ReactNode;
}) {
  return <details id={id} className="list-filter">
    <summary aria-label={label} title={label} aria-describedby={descriptionID}><SlidersHorizontal aria-hidden="true" />
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
  const window = picker.ownerDocument.defaultView!
  const anchor = picker.querySelector("summary")!.getBoundingClientRect()
  const search = picker.closest(".list-search")!.getBoundingClientRect()
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
