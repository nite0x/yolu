# Flexible Pane Layout

Yolu organizes conversation panes with a recursive binary layout tree in the application shell (`frontend/app/pane-layout/`). Layout geometry, focus, maximization, drag-and-drop, and persistence are decoupled from the Agent runtime.

## Architecture

- **Binary tree model (`model/`)**: `PaneNode` leaves hold a discriminated `PaneContent` union (`empty` or `conversation`); `SplitNode` internal nodes partition space along `horizontal` (left/right) or `vertical` (top/bottom) axes with a ratio in `(0, 1)`.
- **Pure tree operations (`model/operations.ts`, `model/tree.ts`, `model/validation.ts`)**: `splitPane`, `closePane`, `movePane`, `swapPanes`, `resizeSplit`, `resetSplitRatio`, `bindPaneContent`, `findPane`, `getAdjacentPane`, `normalizeLayout`, and `validateLayout` operate without React or runtime dependencies.
- **State separation (`state/layout-store.ts`, `state/selectors.ts`)**:
  - `LayoutState` owns the recursive tree, split ratios, pane bindings, and `activePaneId`.
  - `InteractionState` owns transient UI state (`maximizedPaneId`, drag source, drop preview target, active splitter resize) and is never persisted.
  - `ConversationState` remains inside each retained conversation reader iframe; layout changes only update CSS coordinates and never reparent or reload mounted iframes.
- **Recursive rendering (`components/`)**: `LayoutRoot` -> `LayoutNodeView` -> `SplitContainer` / `PaneContainer` -> `EmptyPane` + `PaneHeader` render dividers, empty panes, drop previews, and narrow-viewport focus selectors.

## Constraints and Responsive Behavior

- Default product constraints live in `DEFAULT_LAYOUT_CONSTRAINTS` (`maxPanes: 6`, `minPaneWidth: 360`, `minPaneHeight: 280`), independent of the tree model.
- Split actions that would violate minimum dimensions or the maximum pane count are disabled per direction.
- Resizing a divider enforces the recursive minimum width/height of all descendant panes. Double-clicking a divider resets its ratio to `0.5`.
- When the viewport shrinks below the active tree's usable split width or height, Yolu enters compact focus mode with `#workspaceNarrowPanes` without discarding the underlying split tree or ratios. Widening the window restores the layout automatically.

## Keyboard Shortcuts

Shortcuts are handled centrally in `frontend/app/pane-layout/interactions/shortcuts.ts` through the host's single keydown listener:

| Command | macOS | Windows / Linux |
| --- | --- | --- |
| `pane.splitRight` | `Cmd+\` | `Ctrl+\` |
| `pane.splitDown` | `Cmd+Shift+\` | `Ctrl+Shift+\` |
| `pane.splitLeft` | `Cmd+Opt+Shift+Left` | `Ctrl+Alt+Shift+Left` |
| `pane.splitUp` | `Cmd+Opt+Shift+Up` | `Ctrl+Alt+Shift+Up` |
| `pane.focusLeft` | `Cmd+Opt+Left` | `Alt+Shift+Left` |
| `pane.focusRight` | `Cmd+Opt+Right` | `Alt+Shift+Right` |
| `pane.focusUp` | `Cmd+Opt+Up` | `Alt+Shift+Up` |
| `pane.focusDown` | `Cmd+Opt+Down` | `Alt+Shift+Down` |
| `pane.toggleMaximize` | `Cmd+Shift+Enter` | `Ctrl+Shift+Enter` |
| `pane.close` | `Opt+Shift+W` | `Alt+Shift+W` |

## Persistence and Migration

- Durable layout state is persisted per layout context (`default`) via `PUT /api/settings/pane-layout` in SQLite (`internal/app/pane_layout.go`), bootstrapped synchronously in `web/app.html` (`<meta name="pane-layout">`), and cached in `localStorage` (`workhub:pane-layout:v1:<context>`).
- Splitter drags never write on every pointer move; writes are debounced and flushed on drag completion and `pagehide`.
- Normal saves are serialized and superseded queued snapshots are skipped. `pagehide` dispatches keepalive immediately; SQLite compares `updatedAt` inside the existing settings transaction so late or duplicate requests cannot replace a newer timestamped record. Records without timestamps remain readable and writable until the first timestamped save.
- Context names are trimmed, with blank names resolving to `default`. Stored envelopes use the resolved context, and reads repair historical envelopes whose context differs from their storage key without discarding conversation metadata.
- Corrupt or unsupported payloads degrade cleanly to a single empty pane. Deleted/missing conversations (`workhub:conversation-missing`) degrade only the affected pane to `{ type: "empty" }`.
- Legacy three-column state (`pages`/`sessions`, `widths`, `focused`) is migrated automatically to a horizontal binary tree preserving order, relative widths, bindings, and focus.
