import assert from "node:assert/strict"
import { test } from "node:test"
import { createInitialLayout } from "../frontend/app/pane-layout/model/operations"
import { countPanes, findPane } from "../frontend/app/pane-layout/model/tree"
import type { SplitNode } from "../frontend/app/pane-layout/model/types"
import { createPaneLayoutPersistence } from "../frontend/app/pane-layout/persistence/serializer"
import { createPaneLayoutStore } from "../frontend/app/pane-layout/state/layout-store"
import {
  computeLayoutView,
  getPaneCapabilities,
} from "../frontend/app/pane-layout/state/selectors"

test("store separates durable LayoutState from transient InteractionState", () => {
  const store = createPaneLayoutStore(
    createInitialLayout({ type: "conversation", conversationId: "c1" }, "p1"),
  )
  let layoutEvents = 0
  let totalEvents = 0
  store.subscribe(() => {
    totalEvents += 1
  })
  store.subscribeLayout(() => {
    layoutEvents += 1
  })

  const p2 = store.split("p1", "right", { newPaneId: "p2", splitId: "s1", ratio: 0.35 })
  assert.equal(p2, "p2")
  assert.equal(layoutEvents, 1)

  // Toggle maximize on p2 -> layout tree & ratio remain completely unchanged
  const beforeRoot = store.getLayout().root
  store.toggleMaximize("p2")
  assert.equal(store.getInteraction().maximizedPaneId, "p2")
  assert.equal(store.getLayout().root, beforeRoot)
  assert.equal((store.getLayout().root as SplitNode).ratio, 0.35)
  assert.equal(layoutEvents, 1, "maximizing already-active pane must not trigger durable layout save")

  const maximizedView = computeLayoutView(store.getLayout(), store.getInteraction(), {
    width: 1400,
    height: 900,
  })
  assert.deepEqual(
    maximizedView.visiblePanes.map(p => p.id),
    ["p2"],
  )
  assert.deepEqual(maximizedView.paneRects.get("p2"), { x: 0, y: 0, width: 1, height: 1 })
  assert.equal(maximizedView.dividers.length, 0)

  // Restore -> original tree, ratio, and both panes reappear intact
  store.toggleMaximize("p2")
  assert.equal(store.getInteraction().maximizedPaneId, null)
  const restoredView = computeLayoutView(store.getLayout(), store.getInteraction(), {
    width: 1400,
    height: 900,
  })
  assert.equal(restoredView.visiblePanes.length, 2)
  assert.ok(Math.abs(restoredView.paneRects.get("p1")!.width - 0.35) < 1e-6)
  assert.ok(totalEvents > layoutEvents)
})

test("canceling a drag leaves the layout tree untouched and committing executes the move", () => {
  const store = createPaneLayoutStore(
    createInitialLayout({ type: "conversation", conversationId: "c1" }, "p1"),
  )
  store.split("p1", "right", {
    newPaneId: "p2",
    splitId: "s1",
    content: { type: "conversation", conversationId: "c2" },
  })
  const before = store.getLayout()

  store.startDrag("p1")
  store.updateDropTarget({
    targetPaneId: "p2",
    zone: "bottom",
    previewRect: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  })
  store.cancelDrag()
  assert.equal(store.getLayout(), before)
  assert.equal(store.getInteraction().draggingPaneId, null)
  assert.equal(store.getInteraction().dropTarget, null)

  // Commit drag -> p1 moves below p2
  store.startDrag("p1")
  store.updateDropTarget({
    targetPaneId: "p2",
    zone: "bottom",
    previewRect: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  })
  assert.equal(store.commitDrag(), true)
  assert.equal((store.getLayout().root as SplitNode).direction, "vertical")
  assert.equal((store.getLayout().root as SplitNode).children[0].id, "p2")
  assert.equal((store.getLayout().root as SplitNode).children[1].id, "p1")
  assert.equal(store.getLayout().activePaneId, "p1")
})

test("compact viewport switches to focus mode without losing underlying layout tree", () => {
  const store = createPaneLayoutStore(
    createInitialLayout({ type: "conversation", conversationId: "c1" }, "p1"),
  )
  store.split("p1", "right", { newPaneId: "p2", splitId: "s1", ratio: 0.4 })

  const narrow = computeLayoutView(store.getLayout(), store.getInteraction(), {
    width: 600,
    height: 800,
  })
  assert.equal(narrow.isCompactFocusMode, true)
  assert.equal(narrow.allPanes.length, 2)
  assert.deepEqual(
    narrow.visiblePanes.map(p => p.id),
    ["p2"],
  )
  const narrowCaps = getPaneCapabilities(
    store.getLayout(),
    store.getInteraction(),
    "p2",
    { width: 600, height: 800 },
  )
  assert.equal(narrowCaps.canSplit, false)
  assert.equal(narrowCaps.canZoom, false)

  // Widening window restores original split and ratio untouched
  const wide = computeLayoutView(store.getLayout(), store.getInteraction(), {
    width: 1400,
    height: 800,
  })
  assert.equal(wide.isCompactFocusMode, false)
  assert.equal(wide.visiblePanes.length, 2)
  assert.ok(Math.abs(wide.paneRects.get("p1")!.width - 0.4) < 1e-6)
  assert.equal(countPanes(store.getLayout().root), 2)
  assert.ok(findPane(store.getLayout().root, "p1"))
})

test("persistence debounces rapid updates, retries remote failures, and prefers fresher timestamp", async () => {
  const storage = new Map<string, string>()
  const remoteWrites: { payload: string; keepalive?: boolean }[] = []
  let shouldFail = true
  let clock = 1000
  const persistence = createPaneLayoutPersistence({
    context: "workspace-main",
    debounceMs: 15,
    now: () => {
      clock += 10
      return clock
    },
    readLocal: key => storage.get(key) ?? null,
    writeLocal: (key, value) => {
      storage.set(key, value)
    },
    saveRemote: async (_ctx, payload, opts) => {
      if (shouldFail) throw new Error("network error")
      remoteWrites.push({ payload: JSON.stringify(payload), keepalive: opts?.keepalive })
    },
  })

  const store = createPaneLayoutStore(createInitialLayout({ type: "empty" }, "p1"))
  store.split("p1", "right", { newPaneId: "p2", splitId: "s1" })

  // Timer-driven debounce coalesces rapid updates into one save attempt
  for (const r of [0.42, 0.44, 0.46, 0.48, 0.62]) {
    store.resize("s1", r)
    persistence.scheduleSave(store.getLayout())
  }
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(remoteWrites.length, 0, "failed remote write does not mark remote synced")

  // Next flush retries with keepalive: true once network recovers
  shouldFail = false
  persistence.scheduleSave(store.getLayout())
  persistence.flush()
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(remoteWrites.length, 1)
  assert.equal(remoteWrites[0].keepalive, true)

  // Stale bootstrap with older updatedAt loses to fresher localStorage, and corrupt bootstrap falls back to localStorage
  const staleBootstrap = JSON.stringify({
    version: 1,
    context: "workspace-main",
    updatedAt: 500,
    layout: createInitialLayout({ type: "empty" }, "old"),
  })
  const reloaded = persistence.load(staleBootstrap)
  assert.equal(reloaded.restored, true)
  assert.ok(Math.abs((reloaded.layout.root as SplitNode).ratio - 0.62) < 1e-6)

  const corruptFallback = persistence.load("{bad-json")
  assert.equal(corruptFallback.restored, true)
  assert.ok(Math.abs((corruptFallback.layout.root as SplitNode).ratio - 0.62) < 1e-6)
  persistence.dispose()
})

test("closing a pane mid-drag or mid-resize clears stale transient interaction IDs", () => {
  const store = createPaneLayoutStore(createInitialLayout({ type: "empty" }, "p1"))
  store.split("p1", "right", { newPaneId: "p2", splitId: "s1" })
  store.startDrag("p2")
  store.setResizingSplit("s1")
  store.close("p2")
  assert.equal(store.getInteraction().draggingPaneId, null)
  assert.equal(store.getInteraction().dropTarget, null)
  assert.equal(store.getInteraction().resizingSplitId, null)
})
