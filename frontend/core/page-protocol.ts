// The host owns navigation and pane placement. Readers own drafts, selection
// restoration and subscriptions. Runtime/provider state remains on the backend.
export interface PageSnapshot {
  route: string
  environment?: string
  title?: string
  kind?: string
  conversation?: {selected?: string | null; creating?: boolean; scope?: object; directory?: string; creationDirectory?: string; environmentFilter?: string; pane?: string; session?: unknown; creationBindings?: unknown; creationLocalDirectories?: unknown} | null
  terminal?: {id?: string; cwd?: string; projectID?: string; sessionID?: string; bindingID?: string}
  context?: string
  draftTitle?: string
  status?: string
  sessionEnvironment?: string
}
export interface PageMessages {
  'workhub:page-ready': object
  'workhub:page-restored': object
  'workhub:page-focus': object
  'workhub:page-closing': object
  'workhub:page-navigation': object
  'workhub:global-search': object
  'workhub:terminals-changed': object
  'workhub:page-state': {snapshot: PageSnapshot}
  'workhub:page-open': {snapshot: PageSnapshot; placement?: 'current' | 'split'; create?: boolean}
  'workhub:conversation-select': {snapshot: PageSnapshot; initial?: boolean}
  'workhub:conversation-add': {snapshot: PageSnapshot}
  'workhub:conversation-kind': {snapshot: PageSnapshot; kind: 'ui' | 'terminal'}
  'workhub:page-restore': {snapshot: PageSnapshot; active: boolean}
  'workhub:page-active': {active: boolean}
  'workhub:page-pane': {split: boolean; shared?: boolean}
  'workhub:page-pane-command': {command: 'close' | 'zoom'}
  'workhub:navigation-modal': {open: boolean}
  'workhub:navigation-route': {route: string}
  'workhub:page-navigate': {route: string}
  'workhub:page-chrome': {chrome: {left: number; top: number}}
  'workhub:parallel-layout': {split?: boolean; focused?: boolean; zoomed?: boolean; canZoom?: boolean; canSplit?: boolean}
  'workhub:conversation-group': {sessions: (string | null | undefined)[]; selected?: string | null; target?: PageSnapshot; targetTitle?: string; full?: boolean; split?: boolean; canSplit?: boolean; listWidth?: number; autoSelect?: boolean; createdConversation?: boolean}
}
export type PageMessage = {[K in keyof PageMessages]: {type: K} & PageMessages[K]}[keyof PageMessages]
type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value)
const optional = (value: unknown, test: (value: unknown) => boolean) => value === undefined || test(value)
const string = (value: unknown): value is string => typeof value === 'string'
const bool = (value: unknown) => typeof value === 'boolean'
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const route = (value: unknown) => string(value) && /^\/(projects(?:\/[\w-]+(?:\/(?:git|worktrees))?)?|sessions|terminals|settings|issues)(?:\?[^#]*)?$/.test(value)

export function isPageSnapshot(value: unknown): value is PageSnapshot {
  if (!record(value) || !route(value.route) || !optional(value.environment, string) || !optional(value.title, string)) return false
  if (value.conversation != null) {
    const view = value.conversation
    if (!record(view) || !optional(view.selected, v => v === null || string(v)) || !optional(view.creating, bool)) return false
    if (view.scope !== undefined && (!record(view.scope) || !['all', 'project', 'directory'].includes(String(view.scope.kind)))) return false
  }
  const terminal = value.terminal
  return terminal === undefined || record(terminal) && ['id', 'cwd', 'projectID', 'sessionID', 'bindingID'].every(key => optional(terminal[key], string))
}

// Validate at both receiving boundaries, after origin/source checks. Unknown
// message types are ignored, so independent terminal/readers can evolve safely.
export function readPageMessage(value: unknown): PageMessage | null {
  if (!record(value) || !string(value.type)) return null
  const snapshot = () => isPageSnapshot(value.snapshot)
  let valid = false
  switch (value.type) {
    case 'workhub:page-ready': case 'workhub:page-restored': case 'workhub:page-focus':
    case 'workhub:page-closing': case 'workhub:page-navigation': case 'workhub:global-search': case 'workhub:terminals-changed': valid = true; break
    case 'workhub:page-state': case 'workhub:conversation-add': valid = snapshot(); break
    case 'workhub:conversation-select': valid = snapshot() && optional(value.initial, bool); break
    case 'workhub:page-open': valid = snapshot() && optional(value.placement, v => v === 'current' || v === 'split') && optional(value.create, bool); break
    case 'workhub:conversation-kind': valid = snapshot() && (value.kind === 'ui' || value.kind === 'terminal'); break
    case 'workhub:page-restore': valid = snapshot() && bool(value.active); break
    case 'workhub:page-active': valid = bool(value.active); break
    case 'workhub:page-pane': valid = bool(value.split) && optional(value.shared, bool); break
    case 'workhub:page-pane-command': valid = value.command === 'close' || value.command === 'zoom'; break
    case 'workhub:navigation-modal': valid = bool(value.open); break
    case 'workhub:navigation-route': case 'workhub:page-navigate': valid = route(value.route); break
    case 'workhub:page-chrome': valid = record(value.chrome) && finite(value.chrome.left) && finite(value.chrome.top); break
    case 'workhub:parallel-layout': valid = ['focused', 'zoomed', 'canZoom', 'canSplit', 'split'].every(key => optional(value[key], bool)); break
    case 'workhub:conversation-group': valid = Array.isArray(value.sessions) && value.sessions.every(v => v == null || string(v))
      && optional(value.selected, v => v === null || string(v)) && optional(value.targetTitle, string) && optional(value.target, isPageSnapshot)
      && optional(value.listWidth, finite) && ['full', 'split', 'canSplit', 'autoSelect', 'createdConversation'].every(key => optional(value[key], bool)); break
  }
  return valid ? value as unknown as PageMessage : null
}

export function postPageMessage<K extends keyof PageMessages>(target: Pick<Window, 'postMessage'>, origin: string, type: K, detail: PageMessages[K]) {
  const message = {type, ...detail}
  if (!readPageMessage(message)) throw new TypeError(`Invalid page message: ${type}`)
  target.postMessage(message, origin)
}
