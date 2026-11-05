// Keep the existing form controllers as the source of truth while exposing
// every choice directly, without a dropdown-opening step.
const signatures = new WeakMap<HTMLElement, string>()

export function renderCreationChoices(source: HTMLSelectElement, container: HTMLElement, activate?: (value: string) => void) {
  const options = [...source.options].filter(option => !option.hidden)
  const signature = JSON.stringify(options.map(option => [option.value, option.textContent, option.title, option.disabled]))
  if (signatures.get(container) !== signature) {
    const focused = container.contains(source.ownerDocument.activeElement) ? (source.ownerDocument.activeElement as HTMLElement).dataset.creationChoice : undefined
    const buttons = options.map(option => {
      const button = source.ownerDocument.createElement('button')
      button.type = 'button'
      button.dataset.creationChoice = option.value
      button.textContent = option.textContent
      button.title = option.title || option.textContent || ''
      return button
    })
    container.replaceChildren(...buttons)
    signatures.set(container, signature)
    if (focused !== undefined) buttons.find(button => button.dataset.creationChoice === focused)?.focus({preventScroll:true})
  }
  for (const button of container.querySelectorAll<HTMLButtonElement>('button[data-creation-choice]')) {
    const option = options.find(option => option.value === button.dataset.creationChoice)
    button.disabled = source.disabled || !option || option.disabled
    button.setAttribute('aria-pressed', String(source.value === button.dataset.creationChoice))
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
