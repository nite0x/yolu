# Flexible Pane Layout

Yolu organizes parallel conversation panes with a recursive binary layout tree in the application shell (`frontend/app/pane-layout/`), paired with an independent right-hand multi-tab file panel (`frontend/app/right-panel/`). Layout geometry, implicit conversation groups, focus, maximization, drag-and-drop, and persistence are decoupled from the Agent runtime.

## Architecture

- **Binary tree model (`model/`)**: `PaneNode` leaves hold conversation content (`conversation`, or transient `empty` fallback); `SplitNode` internal nodes partition space along `horizontal` (left/right) or `vertical` (top/bottom) axes with a ratio in `(0, 1)`.
- **Implicit conversation groups (`model/groups.ts`)**:
  - Multi-pane layouts (`>= 2` panes) automatically form implicit conversation groups with strict **1:1 exclusive membership** (each conversation belongs to at most one multi-pane group).
  - Selecting a conversation in the sidebar restores its entire multi-pane group with its exact split structure and ratios when it belongs to a group, or switches to a standalone maximized conversation window without disturbing remembered groups.
  - Dragging or adding a conversation into another panel automatically removes it from its previous group; if the previous group drops to a single pane, it dissolves automatically.
- **Pure tree operations (`model/operations.ts`, `model/tree.ts`, `model/validation.ts`)**: `splitPane`, `closePane`, `movePane`, `swapPanes`, `resizeSplit`, `resetSplitRatio`, `bindPaneContent`, `findPane`, `getAdjacentPane`, `normalizeLayout`, and `validateLayout` operate without React or runtime dependencies.
- **State separation (`state/layout-store.ts`, `state/selectors.ts`)**:
  - `LayoutState` owns the active recursive tree, split ratios, pane bindings, `activePaneId`, and the implicit multi-pane `groups` registry.
  - `InteractionState` owns transient UI state (`maximizedPaneId`, internal/external drag state, drop preview target, active splitter resize) and is never persisted.
  - `ConversationState` remains inside each retained conversation reader iframe; layout changes and group switches keep active, running, and recently used iframes mounted (with bounded LRU background retention) and never reload them unnecessarily.
- **Recursive rendering (`components/`)**: `LayoutRoot` -> `LayoutNodeView` -> `SplitContainer` / `PaneContainer` -> `EmptyPane` + `PaneHeader` render dividers, empty panes, drop previews, and narrow-viewport focus selectors.

## Independent Right Multi-Tab Panel

File previews, directory browsing and Git diff views live in the shared right-hand multi-tab panel (`frontend/app/right-panel/`) at the host shell layer, independent of conversation splits:

- Clicking a file link, **View changes**, directory binding file action, or the **Files** button in any conversation opens or focuses a tab in the right panel (deduplicating identical resources and jumping to the requested line).
- Each tab retains its own environment, directory, binding, file path, and diff mode independently. Switching conversations, switching multi-pane groups, or creating a new conversation does not change or close open right-panel tabs.
- Duplicate tab titles across projects or worktrees are disambiguated automatically with their directory/environment context.
- A header utility toggle shows or hides the right panel without discarding open tabs. The panel resizes horizontally via `setupSplitResize` (double-click resets to default width) and automatically overlays on narrow viewports so conversation panes stay readable.
- Normal project navigation continues to open the full project page.

## Constraints and Responsive Behavior

- Default product constraints live in `DEFAULT_LAYOUT_CONSTRAINTS` (`maxPanes: 6`, `minPaneWidth: 360`, `minPaneHeight: 280`), independent of the tree model.
- Split actions and edge drop zones that would violate minimum dimensions or the maximum pane count are disabled per direction.
- Resizing a divider enforces the recursive minimum width/height of all descendant panes. Double-clicking a divider resets its ratio to `0.5`.
- When the viewport shrinks below the active tree's usable split width or height, Yolu enters compact focus mode with `#workspaceNarrowPanes` without discarding the underlying split tree or ratios. Widening the window restores the layout automatically.

## Creation, Drag-and-Drop and Split Controls

- **Global New conversation** (application header and sidebar project/assistant creation actions) always opens a new standalone maximized conversation window without modifying or dissolving existing multi-pane groups.
- **Sidebar drag-to-split**: Dragging any conversation row from the shared navigator onto the main stage (single-pane or multi-pane) previews Left, Right, Top, Bottom, or Center-Replace drop zones and automatically lays out or updates the split group.
- **Pane-header split controls**: Conversation and empty-pane headers reuse `ConversationPaneButtons`: a primary Split button splits right and directly opens a new conversation draft inside the current group (inheriting project/directory context when available, otherwise using the default directory), and its direction menu offers right, down, left and up under the full layout constraints (`maxPanes: 6`, minimum pane size `360 × 280`).
- **Sidebar highlighting**: Only members of the currently displayed multi-pane group are highlighted in the sidebar, each individually in its own project or list row, supporting cross-project splits naturally.
- Sidebar conversation rows retain **Add to right split** up to three parallel panes. Closing a pane removes it from the active group without deleting the underlying conversation, and dissolves the group when only one pane remains.

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

- Durable layout state (active layout, implicit multi-pane `groups`, `activeGroupId`, independent `rightPanel` tabs/width/open state, and conversation metadata) is persisted per layout context (`default`) via `PUT /api/settings/pane-layout` in SQLite (`internal/app/pane_layout.go`), bootstrapped synchronously in `web/app.html` (`<meta name="pane-layout">`), and cached in `localStorage` (`workhub:pane-layout:v1:<context>`).
- Splitter drags never write on every pointer move; writes are debounced and flushed on drag completion and `pagehide`.
- Legacy three-column state (`pages`/`sessions`, `widths`, `focused`) is migrated automatically to a horizontal binary tree.
- Legacy saved `file` panes in historical split layouts are automatically migrated into independent right-panel tabs while stripping non-conversation panes from the conversation split tree.
- Corrupt or unsupported payloads degrade cleanly to a single empty pane. Deleted/missing conversations (`workhub:conversation-missing`) degrade only the affected pane to `{ type: "empty" }`.
