export type RightPanelFileMode = "all" | "working" | "index"

export interface RightPanelTab {
  id: string
  kind: "file"
  environment: string
  title: string
  cwd: string
  path?: string
  projectId?: string
  sessionId?: string
  bindingId?: string
  line?: number
  git?: boolean
  mode?: RightPanelFileMode
  /** Monotonic counter bumped when jumping to a line in an already-open tab. */
  version?: number
}

export interface RightPanelTabInput {
  kind?: "file"
  environment?: string
  title?: string
  cwd: string
  path?: string
  projectId?: string
  sessionId?: string
  bindingId?: string
  line?: number
  git?: boolean
  mode?: RightPanelFileMode
}

export interface RightPanelState {
  open: boolean
  width: number
  activeTabId: string | null
  tabs: RightPanelTab[]
}

export interface PersistedRightPanelState {
  open: boolean
  width: number
  activeTabId: string | null
  tabs: Omit<RightPanelTab, "version">[]
}

export const DEFAULT_RIGHT_PANEL_WIDTH = 500
export const MIN_RIGHT_PANEL_WIDTH = 320
export const MAX_RIGHT_PANEL_WIDTH = 960
export const MAX_RIGHT_PANEL_TABS = 24
