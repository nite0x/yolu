// Explicit native view boundary. React islands own their descendants separately.
interface Controls {
  "#browserAccessEnabled": HTMLInputElement
  "#addEnvironment": HTMLButtonElement
  "#appearanceForm": HTMLFormElement
  "#browserAccessCode": HTMLInputElement
  "#browserAccessFields": HTMLFieldSetElement
  "#browserAccessForm": HTMLFormElement
  "#browserAccessLogout": HTMLFormElement
  "#browserAccessPort": HTMLInputElement
  "#cancelLanguage": HTMLButtonElement
  "#chatInputForm": HTMLFormElement
  "#checkAgy": HTMLButtonElement
  "#checkCursor": HTMLButtonElement
  "#checkAllCodex": HTMLButtonElement
  "#checkCodex": HTMLButtonElement
  "#codexDiagnosticsCopy": HTMLTextAreaElement
  "#colorThemeGroup": HTMLFieldSetElement
  "#connectEnvironment": HTMLButtonElement
  "#conversationDefaultEffortSelect": HTMLSelectElement
  "#conversationDefaultModel": HTMLSelectElement
  "#conversationDefaultProviderGroup": HTMLFieldSetElement
  "#conversationDefaultSpeed": HTMLSelectElement
  "#conversationDefaultsFields": HTMLFieldSetElement
  "#conversationDefaultsForm": HTMLFormElement
  "#conversationDefaultsReload": HTMLButtonElement
  "#conversationDefaultsRetry": HTMLButtonElement
  "#copyBrowserAccessCode": HTMLButtonElement
  "#copyCodexDiagnostics": HTMLButtonElement
  "#defaultAgentForm": HTMLFormElement
  "#defaultAgentRetry": HTMLButtonElement
  "#defaultAgentSelect": HTMLSelectElement
  "#environmentDistro": HTMLSelectElement
  "#environmentForm": HTMLFormElement
  "#environmentRoot": HTMLInputElement
  "#environmentSelect": HTMLSelectElement
  "#environmentUser": HTMLInputElement
  "#languageForm": HTMLFormElement
  "#languageSelect": HTMLSelectElement
  "#mcpSettingsReload": HTMLButtonElement
  "#reconnectEnvironment": HTMLButtonElement
  "#resetBrowserAccessCode": HTMLButtonElement
  "#saveBrowserAccess": HTMLButtonElement
  "#saveLanguage": HTMLButtonElement
  "#saveTerminal": HTMLButtonElement
  "#sendShortcutGroup": HTMLFieldSetElement
  "#sessionTitleFields": HTMLFieldSetElement
  "#sessionTitleForm": HTMLFormElement
  "#sessionTitleModel": HTMLSelectElement
  "#terminalForm": HTMLFormElement
  "#terminalKind": HTMLSelectElement
  "#terminalPath": HTMLInputElement
  "#terminalSettingsFields": HTMLFieldSetElement
  "#terminalStyle": HTMLSelectElement
}
export function control<K extends keyof Controls>(selector: K): Controls[K]
export function control(selector: string): HTMLElement
export function control(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector)
  if (!node) throw new Error(`Missing settings control: ${selector}`)
  return node
}
