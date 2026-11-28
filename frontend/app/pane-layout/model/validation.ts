import {
  createInitialLayout,
  defaultIdGenerator,
  normalizeLayout,
  type IdGenerator,
} from "./operations"
import { findPane } from "./tree"
import { resourceContent } from "./content"
import { isPageSnapshot } from "@/core/page-protocol"
import {
  MAX_LAYOUT_DEPTH,
  PANE_LAYOUT_VERSION,
  type LayoutNode,
  type PaneContent,
  type PaneContextHint,
  type PaneLayout,
} from "./types"

export type LayoutValidationResult =
  | { valid: true; layout: PaneLayout }
  | { valid: false; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string"
}

function validateContextHint(value: unknown): PaneContextHint | undefined | null {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  if (
    !isOptionalString(value.environment) ||
    !isOptionalString(value.projectId) ||
    !isOptionalString(value.cwd) ||
    !isOptionalString(value.sessionId) ||
    !isOptionalString(value.bindingId) ||
    (value.git !== undefined && typeof value.git !== "boolean")
  ) {
    return null
  }
  let scope: PaneContextHint["scope"]
  if (value.scope !== undefined) {
    if (
      !isRecord(value.scope) ||
      !isNonEmptyString(value.scope.kind) ||
      !isOptionalString(value.scope.id) ||
      !isOptionalString(value.scope.cwd) ||
      !isOptionalString(value.scope.environment)
    ) {
      return null
    }
    scope = {
      kind: value.scope.kind,
      ...(value.scope.id !== undefined ? { id: value.scope.id } : {}),
      ...(value.scope.cwd !== undefined ? { cwd: value.scope.cwd } : {}),
      ...(value.scope.environment !== undefined
        ? { environment: value.scope.environment }
        : {}),
    }
  }
  return {
    ...(value.environment !== undefined ? { environment: value.environment } : {}),
    ...(value.projectId !== undefined ? { projectId: value.projectId } : {}),
    ...(value.cwd !== undefined ? { cwd: value.cwd } : {}),
    ...(value.sessionId !== undefined ? { sessionId: value.sessionId } : {}),
    ...(value.bindingId !== undefined ? { bindingId: value.bindingId } : {}),
    ...(value.git !== undefined ? { git: value.git } : {}),
    ...(scope ? { scope } : {}),
  }
}

function validatePaneContent(value: unknown): PaneContent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null
  if (value.type === "empty") {
    const context = validateContextHint(value.context)
    if (context === null) return null
    return context ? { type: "empty", context } : { type: "empty" }
  }
  if (value.type === "conversation") {
    if (!isNonEmptyString(value.conversationId)) return null
    return { type: "conversation", conversationId: value.conversationId }
  }
  if (value.type === "project" || value.type === "file") {
    if (!isNonEmptyString(value.environment) || !isOptionalString(value.title)) return null
    // Validate through the same page protocol used at iframe/host boundaries.
    if (value.type === "project") {
      if (!isNonEmptyString(value.route)) return null
      return resourceContent({route: value.route, environment: value.environment, title: value.title})
    }
    if (!isNonEmptyString(value.cwd)) return null
    const {type: _type, environment, title, ...file} = value
    const snapshot = {route: "/files", environment, title, file}
    return isPageSnapshot(snapshot) ? resourceContent(snapshot) : null
  }
  return null
}

function validateNode(
  value: unknown,
  seenIds: Set<string>,
  depth: number,
): { node?: LayoutNode; error?: string } {
  if (depth > MAX_LAYOUT_DEPTH) return { error: "layout exceeds maximum depth" }
  if (!isRecord(value)) return { error: "layout node must be an object" }
  if (!isNonEmptyString(value.id)) return { error: "layout node id must be a non-empty string" }
  if (seenIds.has(value.id)) return { error: `duplicate node id: ${value.id}` }
  seenIds.add(value.id)

  if (value.type === "pane") {
    const content = validatePaneContent(value.content)
    if (!content) return { error: `invalid pane content for ${value.id}` }
    return { node: { type: "pane", id: value.id, content } }
  }

  if (value.type === "split") {
    if (value.direction !== "horizontal" && value.direction !== "vertical") {
      return { error: `invalid split direction for ${value.id}` }
    }
    if (
      typeof value.ratio !== "number" ||
      !Number.isFinite(value.ratio) ||
      value.ratio <= 0 ||
      value.ratio >= 1
    ) {
      return { error: `invalid split ratio for ${value.id}` }
    }
    if (!Array.isArray(value.children) || value.children.length !== 2) {
      return { error: `split node ${value.id} must have exactly two children` }
    }
    const left = validateNode(value.children[0], seenIds, depth + 1)
    if (left.error || !left.node) return { error: left.error }
    const right = validateNode(value.children[1], seenIds, depth + 1)
    if (right.error || !right.node) return { error: right.error }
    return {
      node: {
        type: "split",
        id: value.id,
        direction: value.direction,
        ratio: value.ratio,
        children: [left.node, right.node],
      },
    }
  }

  return { error: `unknown node type for ${value.id}` }
}

export function validateLayout(value: unknown): LayoutValidationResult {
  if (!isRecord(value)) return { valid: false, reason: "layout must be an object" }
  if (
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    value.version > PANE_LAYOUT_VERSION
  ) {
    return { valid: false, reason: "unsupported layout version" }
  }
  const seenIds = new Set<string>()
  const parsed = validateNode(value.root, seenIds, 0)
  if (parsed.error || !parsed.node) {
    return { valid: false, reason: parsed.error || "invalid root node" }
  }
  if (value.activePaneId !== null && !isNonEmptyString(value.activePaneId)) {
    return { valid: false, reason: "activePaneId must be a non-empty string or null" }
  }
  if (value.activePaneId !== null && !findPane(parsed.node, value.activePaneId)) {
    return { valid: false, reason: "activePaneId does not reference an existing pane" }
  }
  return {
    valid: true,
    layout: {
      version: value.version,
      root: parsed.node,
      activePaneId: value.activePaneId,
    },
  }
}

/** Validates an untrusted layout value, normalizing valid trees and degrading corrupt trees to a single empty pane. */
export function sanitizeOrDegradeLayout(
  value: unknown,
  generateId: IdGenerator = defaultIdGenerator,
): PaneLayout {
  const result = validateLayout(value)
  if (result.valid) return normalizeLayout(result.layout, generateId)
  return createInitialLayout({ type: "empty" }, generateId())
}
