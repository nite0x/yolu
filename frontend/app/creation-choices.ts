import {uiText} from "../i18n"
import {creationDirectoryPinned, pinCreationDirectory, rankCreationDirectories} from "./creation-directories"

type Settings = {actions?: boolean; focus?: () => void; chooseFolder?: () => Promise<void>; addDirectory?: () => void}
type Choice = {value: string; name: string; branch: string; path: string; label: string; disabled: boolean}
type Picker = {update: (settings: Settings) => void; open: (trigger?: HTMLElement) => void; reset: () => void}
const pickers = new WeakMap<HTMLElement, Picker>()
const signatures = new WeakMap<HTMLElement, string>()

function choice(option: HTMLOptionElement): Choice {
  const [name, ...branch] = (option.textContent || "").split(" · ")
  return {value:option.value, name:option.dataset.name || name, branch:option.dataset.branch ?? branch.join(" · "), path:option.title, label:option.textContent || "", disabled:option.disabled}
}
function span(doc: Document, className: string, text: string) {
  const node = doc.createElement("span"); node.className = className; node.textContent = text; return node
}
function label(button: HTMLElement, item: Choice) {
  const doc = button.ownerDocument
  button.replaceChildren(span(doc, "creation-directory-icon", ""), span(doc, "creation-choice-name", item.name))
  if (item.branch) button.append(span(doc, "creation-choice-branch", `· ${item.branch}`))
  button.title = [item.label, item.path].filter(Boolean).join("\n")
}
function createPicker(source: HTMLSelectElement, container: HTMLElement): Picker {
  const doc = source.ownerDocument
  let quickSignature = ""
  let settings: Settings = {}, items: Choice[] = [], top: string[] | undefined, active = 0, matches: Choice[] = [], trigger: HTMLElement | undefined
  const more = doc.createElement("button")
  more.type = "button"; more.className = "creation-more"; more.setAttribute("aria-haspopup", "dialog"); more.setAttribute("aria-expanded", "false")
  const panel = doc.createElement("div")
  panel.className = "creation-directory-popover"; panel.setAttribute("popover", "auto"); panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", uiText("选择工作目录"))
  panel.id = `${container.id}-popover`; more.setAttribute("aria-controls", panel.id)
  const search = doc.createElement("input")
  search.type = "search"; search.className = "creation-directory-search"; search.placeholder = uiText("搜索项目、分支或路径…")
  search.setAttribute("aria-label", uiText("搜索项目、分支或路径…")); search.setAttribute("role", "combobox"); search.setAttribute("aria-autocomplete", "list"); search.setAttribute("aria-expanded", "false")
  const list = doc.createElement("div")
  list.className = "creation-directory-list"; list.id = `${panel.id}-list`; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", uiText("工作目录")); search.setAttribute("aria-controls", list.id)
  const footer = doc.createElement("button")
  footer.type = "button"; footer.className = "creation-directory-footer"; footer.textContent = uiText("＋ 选择本地文件夹…")
  const add = doc.createElement("button")
  add.type = "button"; add.className = "creation-directory-footer"; add.textContent = uiText("添加附加目录")
  const error = doc.createElement("p"); error.className = "creation-directory-error"; error.setAttribute("role", "alert"); error.hidden = true
  panel.append(search, list, error, footer, add); container.append(panel)
  const isOpen = () => panel.matches(":popover-open")
  const focus = () => settings.focus?.()
  const close = (restore = false) => { if (isOpen()) panel.hidePopover(); if (restore) trigger?.focus({preventScroll:true}) }
  const select = (item: Choice) => {
    if (source.disabled || item.disabled) return
    close()
    if (source.value !== item.value) {source.value = item.value; source.dispatchEvent(new Event("change", {bubbles:true}))}
    update(settings)
    requestAnimationFrame(focus)
  }
  const highlight = () => {
    for (const [index, row] of [...list.querySelectorAll<HTMLElement>('[role="option"]')].entries()) row.dataset.active = String(index === active)
    const row = list.querySelector<HTMLElement>('[data-active="true"]')
    if (row) {search.setAttribute("aria-activedescendant", row.id); row.scrollIntoView?.({block:"nearest"})}
    else search.removeAttribute("aria-activedescendant")
  }
  const renderList = () => {
    const query = search.value.trim().toLocaleLowerCase()
    const tokens = query.split(/\s+/).filter(Boolean)
    const ordered = query ? items : [...items.filter(item => item.value && !top?.includes(item.value)), ...items.filter(item => !item.value || top?.includes(item.value))]
    matches = ordered.filter(item => !item.disabled && tokens.every(token => `${item.label} ${item.path}`.toLocaleLowerCase().includes(token)))
    active = 0; list.replaceChildren()
    for (const [index, item] of matches.entries()) {
      const row = doc.createElement("button"); row.type = "button"; row.tabIndex = -1; row.className = "creation-directory-row"; row.id = `${panel.id}-option-${index}`
      row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(item.value === source.value))
      const heading = doc.createElement("span"); heading.className = "creation-directory-row-heading"
      heading.append(span(doc, "creation-directory-icon", ""), span(doc, "creation-choice-name", item.name))
      if (item.branch) heading.append(span(doc, "creation-directory-branch", item.branch))
      if (creationDirectoryPinned(item.value)) heading.append(span(doc, "creation-choice-pin", ""))
      if (item.value === source.value) heading.append(span(doc, "creation-directory-check", "✓"))
      row.append(heading)
      if (item.path) row.append(span(doc, "creation-directory-path", item.path))
      row.title = [item.label, item.path].filter(Boolean).join("\n")
      row.onclick = () => select(item)
      row.onpointermove = () => {active = index; highlight()}
      row.oncontextmenu = event => pinMenu(event, item)
      list.append(row)
    }
    if (!matches.length) {const empty = span(doc, "creation-choices-empty", uiText("无匹配目录")); empty.setAttribute("role", "status"); list.append(empty)}
    highlight()
  }
  const menu = doc.createElement("div"); menu.className = "creation-pin-menu"; menu.setAttribute("popover", "auto"); menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", uiText("管理常用目录"))
  const pin = doc.createElement("button"); pin.type = "button"; pin.setAttribute("role", "menuitem"); menu.append(pin); container.append(menu)
  function pinMenu(event: MouseEvent, item: Choice) {
    if (!item.value || source.disabled) return
    event.preventDefault()
    pin.textContent = creationDirectoryPinned(item.value) ? uiText("取消固定") : uiText("固定到常用")
    pin.onclick = () => {pinCreationDirectory(item.value, !creationDirectoryPinned(item.value)); menu.hidePopover(); update(settings); focus()}
    menu.style.left = `${Math.max(8, Math.min(event.clientX, doc.documentElement.clientWidth - 180))}px`; menu.style.top = `${Math.max(8, Math.min(event.clientY, doc.documentElement.clientHeight - 50))}px`
    menu.showPopover(); pin.focus()
  }
  const position = () => {
    const rect = (trigger?.isConnected ? trigger : more).getBoundingClientRect()
    const width = Math.min(380, doc.documentElement.clientWidth - 24)
    panel.style.width = `${width}px`
    panel.style.left = `${Math.max(12, Math.min(rect.left, doc.documentElement.clientWidth - width - 12))}px`
    const below = doc.documentElement.clientHeight - rect.bottom - 12
    const above = rect.top - 12
    const placeBelow = below >= Math.min(320, above)
    panel.style.top = `${placeBelow ? rect.bottom + 6 : Math.max(12, rect.top - Math.min(320, above) - 6)}px`
    panel.style.maxHeight = `${Math.max(100, Math.min(320, placeBelow ? below - 6 : above - 6))}px`
  }
  const open = (opener: HTMLElement = more) => {
    if (source.disabled || !container.isConnected) return
    trigger = opener; search.value = ""; error.hidden = true; renderList(); position()
    panel.showPopover(); more.setAttribute("aria-expanded", "true"); trigger.setAttribute("aria-expanded", "true"); search.setAttribute("aria-expanded", "true"); search.focus({preventScroll:true})
  }
  more.onclick = () => isOpen() ? close(true) : open()
  search.oninput = renderList
  panel.addEventListener("keydown", event => {
    if (event.isComposing) return
    if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); close(true)}
    if (event.target === search && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation()
      if (event.key === "Enter") {if (matches[active]) select(matches[active])}
      else if (matches.length) {active = (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length; highlight()}
    }
    if (event.key === "Tab") {
      const controls = [search, ...[footer, add].filter(button => !button.hidden && !button.disabled)]
      const index = controls.indexOf(doc.activeElement as HTMLInputElement)
      if (event.shiftKey && index <= 0 || !event.shiftKey && index === controls.length - 1) {event.preventDefault(); controls[event.shiftKey ? controls.length - 1 : 0].focus()}
    }
  })
  menu.addEventListener("keydown", event => {if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); menu.hidePopover(); focus()}})
  panel.addEventListener("toggle", () => {
    const expanded = String(isOpen()); more.setAttribute("aria-expanded", expanded); trigger?.setAttribute("aria-expanded", expanded); search.setAttribute("aria-expanded", expanded)
  })
  footer.onclick = async () => {
    if (!settings.chooseFolder) return
    footer.disabled = true; error.hidden = true
    try {await settings.chooseFolder(); close(); requestAnimationFrame(focus)}
    catch (cause) {error.textContent = (cause as Error).message; error.hidden = false}
    finally {footer.disabled = false}
  }
  add.onclick = () => {close(true); settings.addDirectory?.()}
  doc.addEventListener("keydown", event => {
    if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== "KeyD" || !container.isConnected || !container.getClientRects().length || !settings.focus) return
    event.preventDefault(); open()
  })
  doc.addEventListener("workhub:creation-directory", event => {
    if (container.id !== "sessionBrowserDirectoryChoices" || !container.getClientRects().length) return
    open((event as CustomEvent<HTMLElement>).detail)
  })
  doc.defaultView?.addEventListener("resize", () => {if (isOpen()) position()})
  const update = (next: Settings) => {
    settings = next; items = [...source.options].filter(option => !option.hidden).map(choice)
    if (!top) top = rankCreationDirectories(items.filter(item => item.value && !item.disabled)).slice(0, 5).map(item => item.value)
    // Fill late inventory arrivals without moving choices already on screen.
    const available = new Set(items.map(item => item.value))
    top = top.filter(value => available.has(value))
    if (top.length < 5) top.push(...rankCreationDirectories(items.filter(item => item.value && !item.disabled && !top!.includes(item.value))).slice(0, 5 - top.length).map(item => item.value))
    const signature = JSON.stringify([source.disabled, source.value, top, items, items.map(item => creationDirectoryPinned(item.value))])
    if (signature !== quickSignature) {
      quickSignature = signature
      for (const node of container.querySelectorAll(':scope > button[data-creation-choice]')) node.remove()
      const quick = [...items.filter(item => !item.value), ...top.flatMap(value => items.find(item => item.value === value) || [])]
      for (const item of quick) {
        const button = doc.createElement("button"); button.type = "button"; button.dataset.creationChoice = item.value; label(button, item)
        if (creationDirectoryPinned(item.value)) button.prepend(span(doc, "creation-choice-pin", ""))
        button.disabled = source.disabled || item.disabled; button.setAttribute("aria-pressed", String(source.value === item.value))
        button.onclick = () => select(item); button.oncontextmenu = event => pinMenu(event, item)
        button.onkeydown = event => {if (event.key === "F10" && event.shiftKey) {const rect = button.getBoundingClientRect(); pinMenu(new MouseEvent("contextmenu", {clientX:rect.left, clientY:rect.bottom}), item); event.preventDefault()}}
        container.insertBefore(button, panel)
      }
      const selected = items.find(item => item.value === source.value)
      const overflow = selected?.value && !top.includes(selected.value)
      if (overflow) label(more, selected)
      else {more.replaceChildren(span(doc, "creation-choice-name", uiText("更多目录"))); more.title = uiText("更多目录")}
      more.append(span(doc, "creation-choice-chevron", "⌄")); more.disabled = source.disabled; more.setAttribute("aria-pressed", String(!!overflow))
      container.insertBefore(more, panel)
    }
    footer.hidden = !settings.chooseFolder
    add.hidden = !settings.addDirectory
    if (isOpen()) renderList()
  }
  return {update, open, reset: () => {top = undefined; quickSignature = ""; close()}}
}

export function resetCreationChoices(container: HTMLElement) {pickers.get(container)?.reset()}
export function renderCreationChoices(source: HTMLSelectElement, container: HTMLElement, activate?: (value: string) => void, settings: Settings = {}) {
  container.classList.toggle("creation-actions", !!settings.actions)
  if (!settings.actions) {
    let picker = pickers.get(container)
    if (!picker) {picker = createPicker(source, container); pickers.set(container, picker)}
    picker.update(settings)
    return
  }
  const options = [...source.options].filter(option => !option.hidden)
  const signature = JSON.stringify(options.map(option => [option.value, option.textContent, option.disabled]))
  if (signatures.get(container) !== signature) {
    container.replaceChildren(...options.map(option => {
      const button = source.ownerDocument.createElement("button"); button.type = "button"; button.dataset.creationChoice = option.value
      button.textContent = option.value === "custom" ? uiText("配置自定义 Agent…") : uiText("启动 {0}", option.textContent)
      return button
    }))
    signatures.set(container, signature)
  }
  for (const button of container.querySelectorAll<HTMLButtonElement>("button[data-creation-choice]")) {
    button.disabled = source.disabled || !!options.find(option => option.value === button.dataset.creationChoice)?.disabled
    button.onclick = () => {
      source.value = button.dataset.creationChoice || ""; source.dispatchEvent(new Event("change", {bubbles:true})); activate?.(source.value)
    }
  }
}
