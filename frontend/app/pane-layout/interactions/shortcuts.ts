export type PaneCommand =
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.splitLeft"
  | "pane.splitUp"
  | "pane.focusLeft"
  | "pane.focusRight"
  | "pane.focusUp"
  | "pane.focusDown"
  | "pane.toggleMaximize"
  | "pane.close"

export interface ShortcutKeyEvent {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  defaultPrevented?: boolean
  isComposing?: boolean
  repeat?: boolean
}

export interface ShortcutBinding {
  command: PaneCommand
  labelMac: string
  labelOther: string
}

/**
 * Conflict-checked platform shortcut map:
 * - Avoids browser reserved chords (Cmd/Ctrl+W, T, N, R, L, Tab).
 * - Avoids Yolu existing chords (Cmd/Ctrl+K search, Cmd+[/] & Alt+Left/Right history,
 *   Cmd/Ctrl+Shift+D directory popover, Alt+Up/Down sidebar project reorder).
 * - Avoids text editing chords (Option+Arrow on macOS, Ctrl+Arrow on Win/Linux,
 *   Shift+Enter / Cmd+Enter / Ctrl+Enter composer send/newline).
 */
export const PANE_SHORTCUT_BINDINGS: readonly ShortcutBinding[] = [
  { command: "pane.splitRight", labelMac: "⌘\\", labelOther: "Ctrl+\\" },
  { command: "pane.splitDown", labelMac: "⌘⇧\\", labelOther: "Ctrl+Shift+\\" },
  { command: "pane.splitLeft", labelMac: "⌘⌥⇧←", labelOther: "Ctrl+Alt+Shift+←" },
  { command: "pane.splitUp", labelMac: "⌘⌥⇧↑", labelOther: "Ctrl+Alt+Shift+↑" },
  { command: "pane.focusLeft", labelMac: "⌘⌥←", labelOther: "Alt+Shift+←" },
  { command: "pane.focusRight", labelMac: "⌘⌥→", labelOther: "Alt+Shift+→" },
  { command: "pane.focusUp", labelMac: "⌘⌥↑", labelOther: "Alt+Shift+↑" },
  { command: "pane.focusDown", labelMac: "⌘⌥↓", labelOther: "Alt+Shift+↓" },
  { command: "pane.toggleMaximize", labelMac: "⌘⇧↩", labelOther: "Ctrl+Shift+Enter" },
  { command: "pane.close", labelMac: "⌥⇧W", labelOther: "Alt+Shift+W" },
]

export function shortcutLabel(command: PaneCommand, mac: boolean): string {
  const binding = PANE_SHORTCUT_BINDINGS.find(item => item.command === command)
  return binding ? (mac ? binding.labelMac : binding.labelOther) : ""
}

function isBackslashKey(event: ShortcutKeyEvent): boolean {
  return event.code === "Backslash" || event.key === "\\" || event.key === "|"
}

/**
 * Resolves a keyboard event into a semantic pane command, or null if not matched.
 * Centralized in one place so individual panes never register global listeners.
 */
export function matchPaneShortcut(
  event: ShortcutKeyEvent,
  mac: boolean,
): PaneCommand | null {
  if (event.defaultPrevented || event.isComposing || event.repeat) return null

  const primaryMod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  const keyLower = event.key.toLowerCase()

  // Split Right: Cmd+\ (macOS) / Ctrl+\ (Win/Linux)
  if (primaryMod && !event.altKey && !event.shiftKey && isBackslashKey(event)) {
    return "pane.splitRight"
  }
  // Split Down: Cmd+Shift+\ (macOS) / Ctrl+Shift+\ (Win/Linux)
  if (primaryMod && !event.altKey && event.shiftKey && isBackslashKey(event)) {
    return "pane.splitDown"
  }

  // Split Left / Up: Cmd+Opt+Shift+Arrow (macOS) / Ctrl+Alt+Shift+Arrow (Win/Linux)
  if (primaryMod && event.altKey && event.shiftKey) {
    if (event.key === "ArrowLeft") return "pane.splitLeft"
    if (event.key === "ArrowUp") return "pane.splitUp"
  }

  // Directional Focus:
  // macOS: Cmd+Opt+Arrow (does not conflict with Option+Arrow word edit or Cmd+Arrow line jump)
  // Win/Linux: Alt+Shift+Arrow (does not conflict with Alt+Arrow Back/Forward or Ctrl+Arrow word edit)
  const focusChord = mac
    ? event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey
    : event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
  if (focusChord) {
    if (event.key === "ArrowLeft") return "pane.focusLeft"
    if (event.key === "ArrowRight") return "pane.focusRight"
    if (event.key === "ArrowUp") return "pane.focusUp"
    if (event.key === "ArrowDown") return "pane.focusDown"
  }

  // Maximize / Restore: Cmd+Shift+Enter (macOS) / Ctrl+Shift+Enter (Win/Linux)
  if (primaryMod && !event.altKey && event.shiftKey && event.key === "Enter") {
    return "pane.toggleMaximize"
  }

  // Close Pane: Opt+Shift+W (macOS) / Alt+Shift+W (Win/Linux) — avoids browser Cmd+W / Cmd+Shift+W / Ctrl+W / Ctrl+Shift+W
  const closeChord = event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
  if (closeChord && (event.code === "KeyW" || keyLower === "w")) {
    return "pane.close"
  }

  return null
}
