import assert from "node:assert/strict"
import { test } from "node:test"
import { JSDOM } from "jsdom"
import { createElement } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { LayoutRoot } from "../frontend/app/pane-layout/components/layout-root"
import { createInitialLayout, splitPane } from "../frontend/app/pane-layout/model/operations"
import type { SplitNode } from "../frontend/app/pane-layout/model/types"
import { createPaneLayoutStore } from "../frontend/app/pane-layout/state/layout-store"

function mountLayoutDom(t: { after: (fn: () => void) => void }) {
  const dom = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>", {
    url: "http://localhost:4317/",
  })
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevHTMLElement = globalThis.HTMLElement
  const prevElement = globalThis.Element
  const prevNode = globalThis.Node
  const prevEvent = globalThis.Event
  const prevMouseEvent = globalThis.MouseEvent
  const prevKeyboardEvent = globalThis.KeyboardEvent

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
  })

  const host = dom.window.document.getElementById("host")!
  host.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 1400, bottom: 900, width: 1400, height: 900, x: 0, y: 0, toJSON() {} }) as DOMRect
  const root = createRoot(host)

  t.after(async () => {
    flushSync(() => root.unmount())
    await new Promise(resolve => setTimeout(resolve, 10))
    dom.window.close()
    Object.assign(globalThis, {
      window: prevWindow,
      document: prevDocument,
      HTMLElement: prevHTMLElement,
      Element: prevElement,
      Node: prevNode,
      Event: prevEvent,
      MouseEvent: prevMouseEvent,
      KeyboardEvent: prevKeyboardEvent,
    })
  })

  return { dom, host, root }
}

test("LayoutRoot renders nested horizontal and vertical splits, dividers, and interactive EmptyPane", t => {
  const { dom, host, root } = mountLayoutDom(t)

  let layout = createInitialLayout({ type: "conversation", conversationId: "c1" }, "p1")
  layout = splitPane(layout, "p1", "right", {
    newPaneId: "p2",
    splitId: "s-root",
    ratio: 0.4,
    content: { type: "conversation", conversationId: "c2" },
  })
  layout = splitPane(layout, "p2", "down", {
    newPaneId: "p3",
    splitId: "s-sub",
    ratio: 0.5,
    content: { type: "empty", context: { environment: "local", projectId: "proj-1" } },
  })
  const store = createPaneLayoutStore(layout)
  const actions: string[] = []

  const render = () => {
    flushSync(() => {
      root.render(
        createElement(LayoutRoot, {
          layout: store.getLayout(),
          interaction: store.getInteraction(),
          viewport: { width: 1400, height: 900 },
          container: host,
          recentConversations: [
            { id: "recent-1", title: "Fix login bug", environment: "local", detail: "app · main" },
          ],
          canCreateConversation: true,
          onCreateConversation: (paneId, ctx) =>
            actions.push(`create:${paneId}:${ctx?.projectId || ""}`),
          onPickConversation: paneId => actions.push(`pick:${paneId}`),
          onOpenRecentConversation: (paneId, item) => actions.push(`recent:${paneId}:${item.id}`),
          onSplit: (paneId, placement) => {
            store.split(paneId, placement)
            actions.push(`split:${paneId}:${placement}`)
          },
          onToggleMaximize: paneId => {
            store.toggleMaximize(paneId)
            actions.push(`max:${paneId}`)
          },
          onClose: paneId => {
            store.close(paneId)
            actions.push(`close:${paneId}`)
          },
          onFocus: paneId => store.focus(paneId),
          onResizeStart: splitId => store.setResizingSplit(splitId),
          onResize: (splitId, ratio) => store.resize(splitId, ratio),
          onResizeCommit: () => store.setResizingSplit(null),
          onResetRatio: splitId => {
            store.resetSplit(splitId)
            actions.push(`reset:${splitId}`)
          },
        }),
      )
    })
  }

  render()

  // Two split nodes rendered recursively with horizontal and vertical dividers
  const dividers = [...host.querySelectorAll<HTMLElement>('[role="separator"]')]
  assert.equal(dividers.length, 2)
  assert.equal(dividers[0].getAttribute("aria-orientation"), "vertical")
  assert.equal(dividers[1].getAttribute("aria-orientation"), "horizontal")

  // Double-clicking a divider resets its ratio to 0.5
  dividers[0].dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }))
  assert.equal((store.getLayout().root as SplitNode).ratio, 0.5)
  assert.ok(actions.includes("reset:s-root"))

  // Empty pane offers create (with inherited project context), open existing, recent list, and cancel split
  const createBtn = host.querySelector<HTMLButtonElement>(".pane-layout-empty-primary")!
  createBtn.click()
  assert.ok(actions.includes("create:p3:proj-1"))

  const pickBtn = host.querySelector<HTMLButtonElement>(".pane-layout-empty-secondary")!
  pickBtn.click()
  assert.ok(actions.includes("pick:p3"))

  const recentBtn = host.querySelector<HTMLButtonElement>(".pane-layout-empty-recent-item")!
  assert.match(recentBtn.textContent || "", /Fix login bug/)
  recentBtn.click()
  assert.ok(actions.includes("recent:p3:recent-1"))

  // Cancel split closes the empty pane
  const cancelBtn = host.querySelector<HTMLButtonElement>(".pane-layout-empty-cancel")!
  cancelBtn.click()
  assert.ok(actions.includes("close:p3"))
  render()
  assert.equal(host.querySelectorAll('[role="separator"]').length, 1)
})

test("LayoutRoot renders compact focus switcher on narrow viewports and drop preview during drag", t => {
  const { host, root } = mountLayoutDom(t)

  let layout = createInitialLayout({ type: "conversation", conversationId: "c1" }, "p1")
  layout = splitPane(layout, "p1", "right", {
    newPaneId: "p2",
    splitId: "s1",
    content: { type: "empty" },
  })
  const store = createPaneLayoutStore(layout)
  const selected: string[] = []

  // Narrow viewport -> compact switcher renders with both panes
  flushSync(() => {
    root.render(
      createElement(LayoutRoot, {
        layout: store.getLayout(),
        interaction: store.getInteraction(),
        viewport: { width: 520, height: 700 },
        container: host,
        recentConversations: [],
        canCreateConversation: true,
        narrowPaneOptions: [
          { paneId: "p1", label: "Conversation 1" },
          { paneId: "p2", label: "Empty pane" },
        ],
        onSelectNarrowPane: id => selected.push(id),
        onCreateConversation: () => {},
        onPickConversation: () => {},
        onOpenRecentConversation: () => {},
        onSplit: () => {},
        onToggleMaximize: () => {},
        onClose: () => {},
        onFocus: () => {},
        onResizeStart: () => {},
        onResize: () => {},
        onResizeCommit: () => {},
        onResetRatio: () => {},
      }),
    )
  })
  const switcher = host.querySelector<HTMLSelectElement>("#workspaceNarrowPanes")!
  assert.ok(switcher)
  assert.equal(switcher.options.length, 2)
  assert.equal(host.querySelectorAll('[role="separator"]').length, 0)

  // Wide viewport with active drop preview -> preview overlay renders with badge
  store.startDrag("p1")
  store.updateDropTarget({
    targetPaneId: "p2",
    zone: "center",
    previewRect: { x: 0.5, y: 0, width: 0.5, height: 1 },
  })
  flushSync(() => {
    root.render(
      createElement(LayoutRoot, {
        layout: store.getLayout(),
        interaction: store.getInteraction(),
        viewport: { width: 1400, height: 900 },
        container: host,
        recentConversations: [],
        canCreateConversation: true,
        onCreateConversation: () => {},
        onPickConversation: () => {},
        onOpenRecentConversation: () => {},
        onSplit: () => {},
        onToggleMaximize: () => {},
        onClose: () => {},
        onFocus: () => {},
        onResizeStart: () => {},
        onResize: () => {},
        onResizeCommit: () => {},
        onResetRatio: () => {},
      }),
    )
  })
  const preview = host.querySelector<HTMLElement>(".pane-layout-drop-preview")
  assert.ok(preview)
  assert.equal(preview.dataset.zone, "center")
})

test("SplitContainer supports live pointer and keyboard resize without aborting on re-render and ignores modified arrows", t => {
  const { dom, host, root } = mountLayoutDom(t)
  // Disable rAF so pointermove applies synchronously in test
  dom.window.requestAnimationFrame = undefined as unknown as typeof window.requestAnimationFrame

  let layout = createInitialLayout({ type: "empty" }, "p1")
  layout = splitPane(layout, "p1", "right", { newPaneId: "p2", splitId: "s1", ratio: 0.5 })
  const store = createPaneLayoutStore(layout)
  let commits = 0

  // Intentionally pass fresh inline callbacks on every render (matching host re-renders)
  const render = () => {
    flushSync(() => {
      root.render(
        createElement(LayoutRoot, {
          layout: store.getLayout(),
          interaction: store.getInteraction(),
          viewport: { width: 1400, height: 900 },
          container: host,
          recentConversations: [],
          canCreateConversation: true,
          onCreateConversation: () => {},
          onPickConversation: () => {},
          onOpenRecentConversation: () => {},
          onSplit: () => {},
          onToggleMaximize: () => {},
          onClose: () => {},
          onFocus: () => {},
          onResizeStart: splitId => {
            store.setResizingSplit(splitId)
            render()
          },
          onResize: (splitId, ratio) => {
            store.resize(splitId, ratio)
            render()
          },
          onResizeCommit: splitId => {
            store.setResizingSplit(null)
            if (splitId) commits += 1
            render()
          },
          onResetRatio: splitId => {
            store.resetSplit(splitId)
            render()
          },
        }),
      )
    })
  }
  render()

  const divider = host.querySelector<HTMLElement>('[role="separator"]')!
  const PointerCtor = dom.window.MouseEvent
  const pEvent = (type: string, props: Record<string, unknown>) => {
    const ev = new PointerCtor(type, { bubbles: true, cancelable: true, button: 0, ...props })
    Object.defineProperty(ev, "pointerId", { value: 1 })
    return ev
  }

  // Live drag: pointerdown -> re-render -> pointermove -> pointerup must NOT abort
  divider.dispatchEvent(pEvent("pointerdown", { clientX: 700, clientY: 300 }))
  assert.equal(host.dataset.splitResizing, "x")
  dom.window.document.dispatchEvent(pEvent("pointermove", { clientX: 560, clientY: 300 }))
  assert.ok(Math.abs((store.getLayout().root as SplitNode).ratio - 0.4) < 1e-4)
  dom.window.document.dispatchEvent(pEvent("pointerup", { clientX: 560, clientY: 300 }))
  assert.equal(commits, 1)
  assert.equal(host.hasAttribute("data-split-resizing"), false)

  // Keyboard resize works for plain arrows, and modified arrows (e.g. Alt+ArrowRight) are ignored
  const beforeRatio = (store.getLayout().root as SplitNode).ratio
  divider.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true }),
  )
  assert.equal((store.getLayout().root as SplitNode).ratio, beforeRatio)
  divider.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true }),
  )
  assert.ok((store.getLayout().root as SplitNode).ratio > beforeRatio)
})

test("EmptyPane header supports pointer drag threshold, Escape cancel, and keyboard-accessible overflow menu", t => {
  const { dom, host, root } = mountLayoutDom(t)
  let layout = createInitialLayout({ type: "empty" }, "p1")
  layout = splitPane(layout, "p1", "right", { newPaneId: "p2", splitId: "s1" })
  const store = createPaneLayoutStore(layout)
  const dragLog: string[] = []

  flushSync(() => {
    root.render(
      createElement(LayoutRoot, {
        layout: store.getLayout(),
        interaction: store.getInteraction(),
        viewport: { width: 1400, height: 900 },
        container: host,
        recentConversations: [],
        canCreateConversation: true,
        onCreateConversation: () => {},
        onPickConversation: () => {},
        onOpenRecentConversation: () => {},
        onSplit: () => {},
        onToggleMaximize: () => {},
        onClose: () => {},
        onFocus: () => {},
        onResizeStart: () => {},
        onResize: () => {},
        onResizeCommit: () => {},
        onResetRatio: () => {},
        onDragStart: id => dragLog.push(`start:${id}`),
        onDragMove: (x, y) => dragLog.push(`move:${x},${y}`),
        onDragEnd: () => dragLog.push("end"),
        onDragCancel: () => dragLog.push("cancel"),
      }),
    )
  })

  // Open overflow menu -> focus moves to first menuitem, Escape closes & restores focus to trigger
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
  flushSync(() => trigger.click())
  assert.equal(trigger.getAttribute("aria-expanded"), "true")
  const firstItem = host.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')!
  assert.equal(dom.window.document.activeElement, firstItem)
  flushSync(() => {
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  })
  assert.equal(trigger.getAttribute("aria-expanded"), "false")
  assert.equal(dom.window.document.activeElement, trigger)

  // Header drag starts only past 6px threshold and cancels on Escape
  const header = host.querySelector<HTMLElement>(".pane-layout-header")!
  const pEvent = (type: string, props: Record<string, unknown>) => {
    const ev = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...props })
    Object.defineProperty(ev, "pointerId", { value: 2 })
    return ev
  }
  header.dispatchEvent(pEvent("pointerdown", { clientX: 100, clientY: 20 }))
  dom.window.document.dispatchEvent(pEvent("pointermove", { clientX: 103, clientY: 20 }))
  assert.equal(dragLog.length, 0)
  dom.window.document.dispatchEvent(pEvent("pointermove", { clientX: 120, clientY: 20 }))
  assert.deepEqual(dragLog, ["start:p1", "move:120,20"])
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  assert.equal(dragLog.at(-1), "cancel")
})
