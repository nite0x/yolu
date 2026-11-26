import type {APIOptions} from "@/core/api-client"

export interface TerminalSettings {
  kind: string
  path?: string
  style: string
}
export interface TerminalAvailability {
  settings?: TerminalSettings
  platform?: string
  supported_kinds?: string[]
  supported_styles?: string[]
  available?: boolean
  message?: string
  launcher?: string
}
export interface Environment {
  id: string
  name: string
  distro?: string
}
export interface Model {
  model: string
  displayName?: string
  isDefault?: boolean
  supportedReasoningEfforts?: {reasoningEffort: string}[]
  serviceTiers?: {id: string; name?: string}[]
}
export interface DefaultValues {
  model?: string
  effort?: string
  serviceTier?: string
  permission?: string
}
export interface ModelOptions {
  settings: DefaultValues
  models?: Model[]
  models_error?: string
  available?: boolean
}
export interface MCPSettings {
  can_manage?: boolean
  agents: {agent: string; status: string}[]
}
export interface MCPResult {
  agent: string
  status: string
}
export interface BrowserAccess {
  can_manage: boolean
  enabled: boolean
  port: number
  code: string
  running?: boolean
  error?: string
  addresses: string[]
}
export interface DiagnosticCheck {
  id: string
  name: string
  status: string
  message: string
  advice?: string
}
export interface InstallPlan {
  action?: "install" | "upgrade"
  manager?: "standalone" | "brew" | "npm"
  path?: string
  reason?: string
}
export interface InstallState {
  status: string
  action?: "install" | "upgrade"
  stage?: string
  version?: string
  error?: string
}
export interface DiagnosticReport {
  platform: string
  user: string
  codex_home: string
  cli_path: string
  cli_entry?: string
  candidates: string[]
  version?: string
  daemon_path?: string
  daemon_version?: string
  daemon_status?: string
  checked_at: string
  status: string
  checks: DiagnosticCheck[]
  install_plan?: InstallPlan
  install_state?: InstallState
}
export interface DiagnosticResult {
  id: string
  name: string
  loading?: boolean
  error?: string | null
  report?: DiagnosticReport
  install?: InstallState | null
  installError?: string | null
  readOnly?: boolean
}
export interface SettingsContext {
  environment: string
  inventory: Environment[]
  view: string
  loaded: boolean
  root: string
  terminal: TerminalAvailability
  readOnly: boolean
}
export interface SettingsHost {
  context(): SettingsContext
  request<T>(path: string, options?: APIOptions): Promise<T>
  environmentName(id?: string): string
  loadEnvironments(): Promise<void>
  toast(message: string, error?: boolean): void
  copy(text: string): unknown
  setTerminal(value: TerminalAvailability): void
  mutation(message: string, operation: () => Promise<void>, errorTarget: HTMLElement): Promise<unknown>
  broadcastDefaults(environment: string, provider: string): void
  preferences: {
    theme: {current(): string; apply(value: string): void}
    shortcut: {current(): string; apply(value: string): void}
    language: string
    flushDrafts(): Promise<boolean>
    reload(): void
  }
  choices: {
    findChatModel(models: Model[], name?: string): Model | undefined
    effortLabel(value: string): string
    serviceTierLabel(tier: {id: string; name?: string}): string
    permissionChoices(
      provider: string,
    ): {value: string; label: string; description: string; danger?: boolean}[]
  }
}
