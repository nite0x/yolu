import assert from "node:assert/strict"
import { test } from "node:test"
import {
  classifyDropZone,
  resolveDropTarget,
} from "../frontend/app/pane-layout/interactions/drag-and-drop"
import {
  computeSplitPixelMetrics,
  ratioFromKeyboardDelta,
  ratioFromPointerCoordinate,
} from "../frontend/app/pane-layout/interactions/resize"
import { matchPaneShortcut } from "../frontend/app/pane-layout/interactions/shortcuts"
import {
  bindPaneContent,
  closePane,
  createInitialLayout,
  movePane,
  normalizeLayout,
  resetSplitRatio,
  resizeSplit,
  splitPane,
  swapPanes,
} from "../frontend/app/pane-layout/model/operations"
import {
  canSplitPaneInDirection,
  computeLayoutGeometry,
  computeLayoutRects,
  computeMinSubtreeSize,
  computeSplitRatioBounds,
  countPanes,
  findPane,
  getAdjacentPane,
  listPanes,
} from "../frontend/app/pane-layout/model/tree"
import {
  DEFAULT_LAYOUT_CONSTRAINTS,
  PANE_LAYOUT_VERSION,
  type PaneLayout,
  type SplitNode,
} from "../frontend/app/pane-layout/model/types"
import {
  sanitizeOrDegradeLayout,
  validateLayout,
} from "../frontend/app/pane-layout/model/validation"
import {
  migrateLegacyThreeColumnLayout,
  migrateSavedLayout,
} from "../frontend/app/pane-layout/persistence/migration"
import {
  deserializePaneLayout,
  serializePaneLayout,
} from "../frontend/app/pane-layout/persistence/serializer"

function seqIds(prefix = "id") {
  let n = 0
  return () => `${prefix}-${++n}`
}

test("splitPane supports all four directions and preserves existing pane identity", () => {
  const base = createInitialLayout({ type: "conversation", conversationId: "c1" }, "p1")

  const right = splitPane(base, "p1", "right", { newPaneId: "p2", splitId: "s1" })
  assert.equal(right.root.type, "split")
  assert.equal(right.root.direction, "horizontal")
  assert.equal(right.root.children[0].id, "p1")
  assert.equal(right.root.children[1].id, "p2")
  assert.equal(right.activePaneId, "p2")

  const left = splitPane(base, "p1", "left", { newPaneId: "p2", splitId: "s1" })
  assert.equal(left.root.type, "split")
  assert.equal(left.root.direction, "horizontal")
  assert.equal(left.root.children[0].id, "p2")
  assert.equal(left.root.children[1].id, "p1")

  const down = splitPane(base, "p1", "down", { newPaneId: "p2", splitId: "s1" })
  assert.equal(down.root.type, "split")
  assert.equal(down.root.direction, "vertical")
  assert.equal(down.root.children[0].id, "p1")
  assert.equal(down.root.children[1].id, "p2")

  const up = splitPane(base, "p1", "up", { newPaneId: "p2", splitId: "s1" })
  assert.equal(up.root.type, "split")
  assert.equal(up.root.direction, "vertical")
  assert.equal(up.root.children[0].id, "p2")
  assert.equal(up.root.children[1].id, "p1")
})

test("recursive mixed splits compute exact normalized geometry and directional neighbors", () => {
  // Layout:
  // +-------+-------+
  // |       |  p2   |
  // |  p1   +-------+
  // |       | p3|p4 |
  // +-------+-------+
  let layout = createInitialLayout({ type: "conversation", conversationId: "c1" }, "p1")
  layout = splitPane(layout, "p1", "right", { newPaneId: "p2", splitId: "s-root", ratio: 0.4 })
  layout = splitPane(layout, "p2", "down", { newPaneId: "p3", splitId: "s-right", ratio: 0.5 })
  layout = splitPane(layout, "p3", "right", { newPaneId: "p4", splitId: "s-bottom", ratio: 0.5 })

  assert.equal(countPanes(layout.root), 4)
  const geometry = computeLayoutGeometry(layout.root)
  assert.equal(geometry.dividers.length, 3)

  const p1 = geometry.panes.get("p1")!
  const p2 = geometry.panes.get("p2")!
  const p3 = geometry.panes.get("p3")!
  const p4 = geometry.panes.get("p4")!

  assert.ok(Math.abs(p1.width - 0.4) < 1e-6)
  assert.ok(Math.abs(p1.height - 1) < 1e-6)
  assert.ok(Math.abs(p2.x - 0.4) < 1e-6)
  assert.ok(Math.abs(p2.height - 0.5) < 1e-6)
  assert.ok(Math.abs(p3.x - 0.4) < 1e-6)
  assert.ok(Math.abs(p3.y - 0.5) < 1e-6)
  assert.ok(Math.abs(p3.width - 0.3) < 1e-6)
  assert.ok(Math.abs(p4.x - 0.7) < 1e-6)
  assert.ok(Math.abs(p4.width - 0.3) < 1e-6)

  // Directional navigation
  assert.equal(getAdjacentPane(layout.root, "p1", "left"), null)
  assert.equal(getAdjacentPane(layout.root, "p2", "left")?.id, "p1")
  assert.equal(getAdjacentPane(layout.root, "p3", "left")?.id, "p1")
  assert.equal(getAdjacentPane(layout.root, "p3", "right")?.id, "p4")
  assert.equal(getAdjacentPane(layout.root, "p4", "left")?.id, "p3")
  assert.equal(getAdjacentPane(layout.root, "p3", "up")?.id, "p2")
  assert.equal(getAdjacentPane(layout.root, "p4", "up")?.id, "p2")
  assert.equal(getAdjacentPane(layout.root, "p2", "down")?.id, "p3")
})

test("closePane collapses redundant split containers, transfers focus, and resets last pane to empty", () => {
  let layout = createInitialLayout({ type: "conversation", conversationId: "c1" }, "p1")
  layout = splitPane(layout, "p1", "right", {
    newPaneId: "p2",
    splitId: "s1",
    content: { type: "conversation", conversationId: "c2" },
  })
  layout = splitPane(layout, "p2", "down", {
    newPaneId: "p3",
    splitId: "s2",
    content: { type: "conversation", conversationId: "c3" },
  })

  // Close p3 -> s2 collapses directly to p2, focus moves to p2
  layout = closePane(layout, "p3")
  assert.equal(countPanes(layout.root), 2)
  assert.equal(layout.root.type, "split")
  assert.equal(layout.root.children[1].type, "pane")
  assert.equal(layout.root.children[1].id, "p2")
  assert.equal(layout.activePaneId, "p2")

  // Close p2 -> s1 collapses directly to p1, focus moves to p1
  layout = closePane(layout, "p2")
  assert.equal(layout.root.type, "pane")
  assert.equal(layout.root.id, "p1")
  assert.equal(layout.activePaneId, "p1")

  // Close last pane p1 -> resets content to empty without removing root node
  layout = closePane(layout, "p1")
  assert.equal(layout.root.type, "pane")
  assert.equal(layout.root.id, "p1")
  assert.deepEqual(layout.root.content, { type: "empty" })
  assert.equal(layout.activePaneId, "p1")
})

test("swapPanes and movePane preserve pane identities and collapse vacated splits", () => {
  let layout = createInitialLayout({ type: "conversation", conversationId: "c1" }, "p1")
  layout = splitPane(layout, "p1", "right", {
    newPaneId: "p2",
    splitId: "s1",
    content: { type: "conversation", conversationId: "c2" },
  })
  layout = splitPane(layout, "p2", "down", {
    newPaneId: "p3",
    splitId: "s2",
    content: { type: "conversation", conversationId: "c3" },
  })

  const swapped = swapPanes(layout, "p1", "p3")
  assert.equal((swapped.root as SplitNode).children[0].id, "p3")
  assert.equal(((swapped.root as SplitNode).children[1] as SplitNode).children[1].id, "p1")
  assert.deepEqual(findPane(swapped.root, "p1")?.content, {
    type: "conversation",
    conversationId: "c1",
  })

  // Move p3 to top of p1 -> s2 collapses to p2, p1 splits vertically with p3 on top
  const moved = movePane(layout, "p3", "p1", "top", { splitId: "s-moved" })
  assert.equal(countPanes(moved.root), 3)
  assert.equal(moved.activePaneId, "p3")
  const leftBranch = (moved.root as SplitNode).children[0] as SplitNode
  assert.equal(leftBranch.type, "split")
  assert.equal(leftBranch.direction, "vertical")
  assert.equal(leftBranch.children[0].id, "p3")
  assert.equal(leftBranch.children[1].id, "p1")
  assert.equal((moved.root as SplitNode).children[1].id, "p2")

  // Move with center zone swaps positions and focuses source
  const centerMoved = movePane(layout, "p1", "p2", "center")
  assert.equal(centerMoved.activePaneId, "p1")
  assert.equal((centerMoved.root as SplitNode).children[0].id, "p2")
})

test("resizeSplit, resetSplitRatio, and minimum dimension constraints protect nested panes", () => {
  let layout = createInitialLayout({ type: "empty" }, "p1")
  layout = splitPane(layout, "p1", "right", { newPaneId: "p2", splitId: "s-root" })
  layout = splitPane(layout, "p2", "right", { newPaneId: "p3", splitId: "s-right" })

  // Nested horizontal panes require 360 * 3 = 1080px minimum width
  const minSize = computeMinSubtreeSize(layout.root, DEFAULT_LAYOUT_CONSTRAINTS)
  assert.equal(minSize.width, 1080)
  assert.equal(minSize.height, 280)

  // At 1200px viewport: s-root left needs >= 360px (0.3), right subtree needs >= 720px (max 0.4)
  const bounds = computeSplitRatioBounds(
    layout.root,
    "s-root",
    { width: 1200, height: 800 },
    DEFAULT_LAYOUT_CONSTRAINTS,
  )
  assert.ok(Math.abs(bounds.min - 0.3) < 1e-6)
  assert.ok(Math.abs(bounds.max - 0.4) < 1e-6)

  const resized = resizeSplit(layout, "s-root", 0.8, bounds)
  assert.ok(Math.abs((resized.root as SplitNode).ratio - 0.4) < 1e-6)

  const reset = resetSplitRatio(resized, "s-root")
  assert.equal((reset.root as SplitNode).ratio, 0.5)

  // Pixel metrics & keyboard/pointer ratio helpers
  const metrics = computeSplitPixelMetrics(
    layout.root,
    "s-root",
    "horizontal",
    { left: 100, top: 0, width: 1200, height: 800 },
    DEFAULT_LAYOUT_CONSTRAINTS,
  )!
  assert.equal(metrics.splitAxisStart, 100)
  assert.equal(metrics.splitAxisSize, 1200)
  assert.ok(Math.abs(ratioFromPointerCoordinate(520, metrics) - 0.35) < 1e-6)
  assert.ok(Math.abs(ratioFromKeyboardDelta(0.35, 1200, metrics) - 0.4) < 1e-6)
})

test("canSplitPaneInDirection enforces max panes and minimum width/height", () => {
  const single = createInitialLayout({ type: "empty" }, "p1")
  assert.equal(
    canSplitPaneInDirection(single.root, "p1", "right", { width: 720, height: 500 }),
    true,
  )
  assert.equal(
    canSplitPaneInDirection(single.root, "p1", "right", { width: 700, height: 500 }),
    false,
  )
  assert.equal(
    canSplitPaneInDirection(single.root, "p1", "down", { width: 500, height: 560 }),
    true,
  )
  assert.equal(
    canSplitPaneInDirection(single.root, "p1", "down", { width: 500, height: 520 }),
    false,
  )

  // Max panes product constraint (default 6)
  let full = single
  const nextId = seqIds("p")
  for (let i = 0; i < 10; i++) {
    full = splitPane(full, full.activePaneId!, "right", {
      maxPanes: 6,
      generateId: nextId,
    })
  }
  assert.equal(countPanes(full.root), 6)
  assert.equal(
    canSplitPaneInDirection(full.root, full.activePaneId!, "right", { width: 5000, height: 3000 }),
    false,
  )
})

test("validateLayout rejects corrupt inputs and sanitizeOrDegradeLayout recovers safely", () => {
  assert.equal(validateLayout(null).valid, false)
  assert.equal(validateLayout({ version: 99, root: { type: "pane", id: "p1", content: { type: "empty" } }, activePaneId: "p1" }).valid, false)
  assert.equal(validateLayout({ version: 1, root: { type: "split", id: "s1", direction: "horizontal", ratio: 1.5, children: [{ type: "pane", id: "p1", content: { type: "empty" } }, { type: "pane", id: "p2", content: { type: "empty" } }] }, activePaneId: "p1" }).valid, false)
  // Duplicate IDs
  assert.equal(validateLayout({ version: 1, root: { type: "split", id: "dup", direction: "horizontal", ratio: 0.5, children: [{ type: "pane", id: "dup", content: { type: "empty" } }, { type: "pane", id: "p2", content: { type: "empty" } }] }, activePaneId: "p2" }).valid, false)
  // Missing activePaneId target
  assert.equal(validateLayout({ version: 1, root: { type: "pane", id: "p1", content: { type: "empty" } }, activePaneId: "missing" }).valid, false)

  const degraded = sanitizeOrDegradeLayout("{corrupt")
  assert.equal(degraded.version, PANE_LAYOUT_VERSION)
  assert.equal(degraded.root.type, "pane")
  assert.deepEqual(degraded.root.content, { type: "empty" })
  assert.equal(degraded.activePaneId, degraded.root.id)
})

test("drag-and-drop hit testing identifies left, right, top, bottom, and center swap zones", () => {
  assert.equal(classifyDropZone(0.1, 0.5), "left")
  assert.equal(classifyDropZone(0.9, 0.5), "right")
  assert.equal(classifyDropZone(0.5, 0.1), "top")
  assert.equal(classifyDropZone(0.5, 0.9), "bottom")
  assert.equal(classifyDropZone(0.5, 0.5), "center")

  const layout = splitPane(createInitialLayout({ type: "empty" }, "p1"), "p1", "right", {
    newPaneId: "p2",
    splitId: "s1",
  })
  const box = { left: 0, top: 0, width: 1000, height: 600 }
  // Dropping onto self returns null
  assert.equal(resolveDropTarget(layout.root, box, { clientX: 250, clientY: 300 }, "p1"), null)
  // Dropping onto right half center -> center swap on p2
  const center = resolveDropTarget(layout.root, box, { clientX: 750, clientY: 300 }, "p1")
  assert.equal(center?.targetPaneId, "p2")
  assert.equal(center?.zone, "center")
  // Dropping near bottom edge of p2 -> bottom split preview
  const bottom = resolveDropTarget(layout.root, box, { clientX: 750, clientY: 560 }, "p1")
  assert.equal(bottom?.targetPaneId, "p2")
  assert.equal(bottom?.zone, "bottom")
  assert.ok(Math.abs(bottom!.previewRect.y - 0.5) < 1e-6)
  assert.ok(Math.abs(bottom!.previewRect.height - 0.5) < 1e-6)
})

test("shortcuts match all 10 semantic commands without conflicting with text editing or navigation", () => {
  const key = (
    k: string,
    mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; code: string }> = {},
  ) => ({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  })

  // macOS bindings
  assert.equal(matchPaneShortcut(key("\\", { metaKey: true, code: "Backslash" }), true), "pane.splitRight")
  assert.equal(matchPaneShortcut(key("|", { metaKey: true, shiftKey: true, code: "Backslash" }), true), "pane.splitDown")
  assert.equal(matchPaneShortcut(key("ArrowLeft", { metaKey: true, altKey: true, shiftKey: true }), true), "pane.splitLeft")
  assert.equal(matchPaneShortcut(key("ArrowUp", { metaKey: true, altKey: true, shiftKey: true }), true), "pane.splitUp")
  assert.equal(matchPaneShortcut(key("ArrowLeft", { metaKey: true, altKey: true }), true), "pane.focusLeft")
  assert.equal(matchPaneShortcut(key("ArrowRight", { metaKey: true, altKey: true }), true), "pane.focusRight")
  assert.equal(matchPaneShortcut(key("ArrowUp", { metaKey: true, altKey: true }), true), "pane.focusUp")
  assert.equal(matchPaneShortcut(key("ArrowDown", { metaKey: true, altKey: true }), true), "pane.focusDown")
  assert.equal(matchPaneShortcut(key("Enter", { metaKey: true, shiftKey: true }), true), "pane.toggleMaximize")
  assert.equal(matchPaneShortcut(key("W", { altKey: true, shiftKey: true, code: "KeyW" }), true), "pane.close")

  // Must NOT hijack macOS Option+Arrow word edit, Cmd+W / Cmd+Shift+W browser close, Cmd+K search, or Cmd+Shift+D directory picker
  assert.equal(matchPaneShortcut(key("ArrowLeft", { altKey: true }), true), null)
  assert.equal(matchPaneShortcut(key("w", { metaKey: true }), true), null)
  assert.equal(matchPaneShortcut(key("W", { metaKey: true, shiftKey: true, code: "KeyW" }), true), null)
  assert.equal(matchPaneShortcut(key("k", { metaKey: true }), true), null)
  assert.equal(matchPaneShortcut(key("d", { metaKey: true, shiftKey: true }), true), null)

  // Windows / Linux bindings
  assert.equal(matchPaneShortcut(key("\\", { ctrlKey: true, code: "Backslash" }), false), "pane.splitRight")
  assert.equal(matchPaneShortcut(key("|", { ctrlKey: true, shiftKey: true, code: "Backslash" }), false), "pane.splitDown")
  assert.equal(matchPaneShortcut(key("ArrowRight", { altKey: true, shiftKey: true }), false), "pane.focusRight")
  assert.equal(matchPaneShortcut(key("W", { altKey: true, shiftKey: true, code: "KeyW" }), false), "pane.close")
  // Must NOT hijack Win/Linux Alt+Arrow Back/Forward or Ctrl+Arrow word jump
  assert.equal(matchPaneShortcut(key("ArrowLeft", { altKey: true }), false), null)
  assert.equal(matchPaneShortcut(key("ArrowLeft", { ctrlKey: true }), false), null)
})

test("legacy 3-column layout migrates preserving order, ratios, bindings, and focus", () => {
  const migrated = migrateLegacyThreeColumnLayout(
    {
      pages: [
        { id: "col-1", conversationId: "s1", width: 2 },
        { id: "col-2", conversationId: "s2", width: 1 },
        { id: "col-3", conversationId: "s3", width: 1 },
      ],
      focused: "col-2",
    },
    seqIds("mig"),
  )

  assert.equal(migrated.activePaneId, "col-2")
  const panes = listPanes(migrated.root)
  assert.deepEqual(
    panes.map(p => [p.id, p.content.type === "conversation" ? p.content.conversationId : null]),
    [
      ["col-1", "s1"],
      ["col-2", "s2"],
      ["col-3", "s3"],
    ],
  )
  const rects = computeLayoutRects(migrated.root)
  assert.ok(Math.abs(rects.get("col-1")!.width - 0.5) < 1e-6)
  assert.ok(Math.abs(rects.get("col-2")!.width - 0.25) < 1e-6)
  assert.ok(Math.abs(rects.get("col-3")!.width - 0.25) < 1e-6)

  // Serializer round-trip & corrupt fallback
  const json = serializePaneLayout(migrated, "default", {
    s1: { environment: "local", route: "/sessions", title: "One", selected: "s1" },
  })
  const restored = deserializePaneLayout(json, "default")
  assert.equal(restored.degraded, false)
  assert.equal(restored.layout.activePaneId, "col-2")
  assert.equal(restored.conversations.s1?.title, "One")

  const migratedRaw = migrateSavedLayout({ sessions: ["a", "b"], widths: [3, 1], focused: "b" }, seqIds("m"))
  assert.ok(migratedRaw)
  assert.equal(countPanes(migratedRaw.root), 2)
  assert.ok(Math.abs((migratedRaw.root as SplitNode).ratio - 0.75) < 1e-6)

  const corrupt = deserializePaneLayout("{not-json", "default")
  assert.equal(corrupt.degraded, true)
  assert.equal(corrupt.layout.root.type, "pane")
})

test("bindPaneContent and normalizeLayout handle empty/duplicate states cleanly", () => {
  const initial = createInitialLayout({ type: "empty" }, "p1")
  const bound = bindPaneContent(initial, "p1", {
    type: "conversation",
    conversationId: "conv-1",
  })
  assert.deepEqual(findPane(bound.root, "p1")?.content, {
    type: "conversation",
    conversationId: "conv-1",
  })

  const badLayout: PaneLayout = {
    version: 1,
    root: {
      type: "split",
      id: "dup",
      direction: "horizontal",
      ratio: Number.NaN,
      children: [
        { type: "pane", id: "dup", content: { type: "empty" } },
        { type: "pane", id: "dup", content: { type: "conversation", conversationId: "" } },
      ],
    },
    activePaneId: "nonexistent",
  }
  const normalized = normalizeLayout(badLayout, seqIds("norm"))
  assert.equal(validateLayout(normalized).valid, true)
  assert.equal((normalized.root as SplitNode).ratio, 0.5)
  assert.equal(listPanes(normalized.root)[1].content.type, "empty")

  // bindPaneContent returns same reference when content is equal
  const same = bindPaneContent(bound, "p1", { type: "conversation", conversationId: "conv-1" })
  assert.equal(same, bound)

  // Nested vertical split bounds & below-minimum proportional clamping
  let nested = createInitialLayout({ type: "empty" }, "p1")
  nested = splitPane(nested, "p1", "right", { newPaneId: "p2", splitId: "s-h", ratio: 0.5 })
  nested = splitPane(nested, "p2", "down", { newPaneId: "p3", splitId: "s-v", ratio: 0.5 })
  const vBounds = computeSplitRatioBounds(nested.root, "s-v", { width: 1200, height: 700 })
  assert.ok(Math.abs(vBounds.min - 0.4) < 1e-6)
  assert.ok(Math.abs(vBounds.max - 0.6) < 1e-6)
  const crampedBounds = computeSplitRatioBounds(nested.root, "s-v", { width: 1200, height: 400 })
  assert.equal(crampedBounds.min, crampedBounds.max)
})

test("mixed resource panes preserve environment, directory, binding and file location across persistence", async () => {
  const {resourceContent, resourceSnapshot, resourceIdentity} = await import("../frontend/app/pane-layout/model/content")
  const {serializePaneLayout, deserializePaneLayout} = await import("../frontend/app/pane-layout/persistence/serializer")
  const file = resourceContent({route: "/files", environment: "remote", title: "main.ts", file: {
    cwd: "/workspace/secondary", projectId: "p2", sessionId: "c1", bindingId: "b2", path: "src/main.ts", line: 42, mode: "index", git: true,
  }})!
  const project = resourceContent({route: "/projects/p1/worktrees?path=%2Fworkspace%2Ffeature", environment: "local", title: "Project"})!
  let layout = createInitialLayout({type: "conversation", conversationId: "c1"}, "chat")
  layout = splitPane(layout, "chat", "right", {newPaneId: "file", splitId: "s1", content: file})
  layout = splitPane(layout, "file", "down", {newPaneId: "project", splitId: "s2", content: project})
  const restored = deserializePaneLayout(serializePaneLayout(layout))
  assert.equal(restored.degraded, false)
  const contents = listPanes(restored.layout.root).map(pane => pane.content)
  assert.deepEqual(contents, JSON.parse(JSON.stringify([{type: "conversation", conversationId: "c1"}, file, project])))
  assert.deepEqual(resourceSnapshot(contents[1])?.file, JSON.parse(JSON.stringify(resourceSnapshot(file)?.file)))
  assert.notEqual(resourceIdentity(resourceSnapshot(file)!), resourceIdentity({...resourceSnapshot(file)!, environment: "local"}))
  assert.notEqual(resourceIdentity(resourceSnapshot(file)!), resourceIdentity({...resourceSnapshot(file)!, file: {...resourceSnapshot(file)!.file!, bindingId: "other"}}))
  assert.equal(resourceContent({route: "/files", file: {cwd: "/workspace"}}), null)
  assert.equal(resourceContent({route: "/files", file: {cwd: "/workspace", projectId: "p1", line: -1}}), null)
  assert.equal(resourceContent({route: "/settings"}), null)
})
