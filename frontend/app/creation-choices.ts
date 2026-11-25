import {uiText} from "../i18n"

// Keep the existing form controllers as the source of truth while exposing
// every choice directly, without a dropdown-opening step.
const signatures = new WeakMap<HTMLElement, string>()
const filterInputs = new WeakMap<HTMLElement, HTMLInputElement>()

function applyFilter(container: HTMLElement, query: string) {
  const needle = query.trim().toLowerCase()
  let visible = 0
  for (const button of container.querySelectorAll<HTMLButtonElement>('button[data-creation-choice]')) {
    const haystack = `${button.textContent || ''} ${button.title || ''}`.toLowerCase()
    const match = !needle || haystack.includes(needle)
    button.hidden = !match
    if (match) visible++
  }
  let empty = container.querySelector<HTMLElement>('.creation-choices-empty')
  if (needle && visible === 0) {
    if (!empty) {
      empty = container.ownerDocument.createElement('span')
      empty.className = 'creation-choices-empty'
      empty.setAttribute('role', 'status')
      container.append(empty)
    }
    empty.textContent = uiText("无匹配目录")
  } else {
    empty?.remove()
  }
}

export function renderCreationChoices(source: HTMLSelectElement, container: HTMLElement, activate?: (value: string) => void, {actions = false}: {actions?: boolean} = {}) {
  container.classList.toggle('creation-actions', actions)
  const options = [...source.options].filter(option => !option.hidden)
  const signature = JSON.stringify([actions, options.map(option => [option.value, option.textContent, option.title, option.disabled])])
  if (signatures.get(container) !== signature) {
    const focused = container.contains(source.ownerDocument.activeElement) ? (source.ownerDocument.activeElement as HTMLElement).dataset.creationChoice : undefined
    const buttons = options.map(option => {
      const button = source.ownerDocument.createElement('button')
      button.type = 'button'
      button.dataset.creationChoice = option.value
      button.textContent = actions ? option.value === 'custom' ? uiText("配置自定义 Agent…") : uiText("启动 {0}", option.textContent) : option.textContent
      button.title = option.title || option.textContent || ''
      return button
    })
    container.replaceChildren(...buttons)
    signatures.set(container, signature)
    if (focused !== undefined) buttons.find(button => button.dataset.creationChoice === focused)?.focus({preventScroll:true})
  }
  const showFilter = !actions && options.length > 6 && !!container.parentElement
  let filter = filterInputs.get(container)
  if (showFilter) {
    if (!filter) {
      filter = source.ownerDocument.createElement('input')
      filter.type = 'search'
      filter.className = 'creation-choices-filter'
      filter.setAttribute('aria-label', uiText("筛选工作目录"))
      filter.addEventListener('input', () => applyFilter(container, filter!.value))
      filterInputs.set(container, filter)
    }
    filter.placeholder = uiText("筛选工作目录")
    filter.disabled = source.disabled
    if (filter.parentElement !== container.parentElement || filter.nextElementSibling !== container) {
      container.parentElement!.insertBefore(filter, container)
    }
    applyFilter(container, filter.value)
  } else if (filter) {
    filter.value = ''
    filter.remove()
    filterInputs.delete(container)
    applyFilter(container, '')
  }
  for (const button of container.querySelectorAll<HTMLButtonElement>('button[data-creation-choice]')) {
    const option = options.find(option => option.value === button.dataset.creationChoice)
    button.disabled = source.disabled || !option || option.disabled
    if (actions) button.removeAttribute('aria-pressed')
    else button.setAttribute('aria-pressed', String(source.value === button.dataset.creationChoice))
  }
  container.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-creation-choice]')
    if (!button || !container.contains(button) || button.disabled || source.disabled) return
    if (button.dataset.creationChoice !== source.value) {
      source.value = button.dataset.creationChoice || ''
      source.dispatchEvent(new Event('change', {bubbles:true}))
    }
    activate?.(source.value)
  }
}
