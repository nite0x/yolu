import {
  createInitialLayout,
  createPaneNode,
  defaultIdGenerator,
  normalizeLayout,
  type IdGenerator,
} from "../model/operations"
import { clampRatio } from "../model/tree"
import {
  PANE_LAYOUT_VERSION,
  type LayoutNode,
  type PaneContent,
  type PaneLayout,
} from "../model/types"
import { validateLayout } from "../model/validation"

export interface LegacyPaneEntry {
  id?: string
  conversationId?: string | null
  selected?: string | null
  width?: number
}

export interface LegacyThreeColumnState {
  pages?: LegacyPaneEntry[]
  sessions?: (string | null | undefined)[]
  widths?: number[]
  focused?: string | null
  focusedIndex?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

/**
 * Converts a legacy 1-to-3 column horizontal layout (pages/sessions + widths + focused)
 * into a recursive binary tree PaneLayout while preserving exact order, proportional
 * widths, conversation bindings and focused selection.
 */
export function migrateLegacyThreeColumnLayout(
  legacy: LegacyThreeColumnState,
  generateId: IdGenerator = defaultIdGenerator,
): PaneLayout {
  const entries: { id: string; content: PaneContent; weight: number }[] = []

  if (Array.isArray(legacy.pages) && legacy.pages.length > 0) {
    legacy.pages.forEach((page, index) => {
      const id =
        typeof page?.id === "string" && page.id.trim() ? page.id : generateId()
      const convId =
        typeof page?.conversationId === "string" && page.conversationId.trim()
          ? page.conversationId
          : typeof page?.selected === "string" && page.selected.trim()
            ? page.selected
            : null
      const rawWeight =
        typeof page?.width === "number" && Number.isFinite(page.width) && page.width > 0
          ? page.width
          : Array.isArray(legacy.widths) &&
              typeof legacy.widths[index] === "number" &&
              Number.isFinite(legacy.widths[index]) &&
              legacy.widths[index] > 0
            ? legacy.widths[index]
            : 1
      entries.push({
        id,
        content: convId ? { type: "conversation", conversationId: convId } : { type: "empty" },
        weight: rawWeight,
      })
    })
  } else if (Array.isArray(legacy.sessions) && legacy.sessions.length > 0) {
    legacy.sessions.forEach((sessionId, index) => {
      const id = generateId()
      const rawWeight =
        Array.isArray(legacy.widths) &&
        typeof legacy.widths[index] === "number" &&
        Number.isFinite(legacy.widths[index]) &&
        legacy.widths[index] > 0
          ? legacy.widths[index]
          : 1
      entries.push({
        id,
        content:
          typeof sessionId === "string" && sessionId.trim()
            ? { type: "conversation", conversationId: sessionId }
            : { type: "empty" },
        weight: rawWeight,
      })
    })
  }

  if (entries.length === 0) {
    return createInitialLayout({ type: "empty" }, generateId())
  }

  const buildHorizontalChain = (
    items: { id: string; content: PaneContent; weight: number }[],
  ): LayoutNode => {
    if (items.length === 1) {
      return createPaneNode(items[0].content, items[0].id)
    }
    const [head, ...rest] = items
    const restWeight = rest.reduce((sum, item) => sum + item.weight, 0)
    const totalWeight = head.weight + restWeight
    const ratio = clampRatio(totalWeight > 0 ? head.weight / totalWeight : 0.5)
    return {
      type: "split",
      id: generateId(),
      direction: "horizontal",
      ratio,
      children: [createPaneNode(head.content, head.id), buildHorizontalChain(rest)],
    }
  }

  const root = buildHorizontalChain(entries)
  let activePaneId: string | null = entries[0].id
  if (typeof legacy.focused === "string" && legacy.focused.trim()) {
    const byId = entries.find(item => item.id === legacy.focused)
    const byConversation = entries.find(
      item =>
        item.content.type === "conversation" &&
        item.content.conversationId === legacy.focused,
    )
    activePaneId = byId?.id ?? byConversation?.id ?? entries[0].id
  } else if (
    typeof legacy.focusedIndex === "number" &&
    Number.isInteger(legacy.focusedIndex) &&
    entries[legacy.focusedIndex]
  ) {
    activePaneId = entries[legacy.focusedIndex].id
  }

  return normalizeLayout(
    {
      version: PANE_LAYOUT_VERSION,
      root,
      activePaneId,
    },
    generateId,
  )
}

/**
 * Migrates any saved layout payload (current versioned tree or legacy 3-column state)
 * into a validated current PaneLayout, returning null when the payload is unrecognizable.
 */
export function migrateSavedLayout(
  raw: unknown,
  generateId: IdGenerator = defaultIdGenerator,
): PaneLayout | null {
  if (!isRecord(raw)) return null

  // Current versioned recursive binary tree format
  if (typeof raw.version === "number" && raw.root !== undefined) {
    const validated = validateLayout(raw)
    if (validated.valid) return normalizeLayout(validated.layout, generateId)
    return null
  }

  // Legacy 3-column state format
  if (Array.isArray(raw.pages) || Array.isArray(raw.sessions)) {
    return migrateLegacyThreeColumnLayout(raw as LegacyThreeColumnState, generateId)
  }

  return null
}
