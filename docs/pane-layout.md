# Flexible Pane Layout

Yolu organizes conversation, file preview and project detail panes with a recursive binary layout tree in the application shell (`frontend/app/pane-layout/`). Layout geometry, focus, maximization, drag-and-drop, and persistence are decoupled from the Agent runtime.

## Architecture

- **Binary tree model (`model/`)**: `PaneNode` leaves hold a discriminated `PaneContent` union (`empty`, `conversation`, `file` or `project`); `SplitNode` internal nodes partition space along `horizontal` (left/right) or `vertical` (top/bottom) axes with a ratio in `(0, 1)`.
- **Pure tree operations (`model/operations.ts`, `model/tree.ts`, `model/validation.ts`)**: `splitPane`, `closePane`, `movePane`, `swapPanes`, `resizeSplit`, `resetSplitRatio`, `bindPaneContent`, `findPane`, `getAdjacentPane`, `normalizeLayout`, and `validateLayout` operate without React or runtime dependencies.
- **State separation (`state/layout-store.ts`, `state/selectors.ts`)**:
  - `LayoutState` owns the recursive tree, split ratios, pane bindings, and `activePaneId`.
  - `InteractionState` owns transient UI state (`maximizedPaneId`, drag source, drop preview target, active splitter resize) and is never persisted.
  - `ConversationState` remains inside each retained conversation reader iframe; layout changes only update CSS coordinates and never reparent or reload mounted iframes.
- **Recursive rendering (`components/`)**: `LayoutRoot` -> `LayoutNodeView` -> `SplitContainer` / `PaneContainer` -> `EmptyPane` + `PaneHeader` render dividers, empty panes, drop previews, and narrow-viewport focus selectors.

## Content and navigation

The shell owns content placement and geometry. A known resource opens directly;
only a split without a destination shows **Open content**, with conversation,
file and project actions. Project selection reuses global search, filtered to
projects. File browsing uses the inherited project/directory or conversation
binding when available; otherwise it asks for a registered project.

- Conversations retain their existing reader iframe and runtime owners.
- Project panes retain the existing project page, including Git and worktree
  views and directory query parameters, beneath the shared `PaneHeader`.
  Normal project navigation still opens the full project page.
- File panes render the existing `FileBrowser` with the same read-only file,
  image and diff viewers. The resource descriptor includes environment,
  directory, project or session, binding, selected file, line and diff mode.
  The backend continues to enforce file access. A file render failure is
  contained inside its pane. Conversation and project file docks offer
  **Open in pane** to open the selected file directly beside the current view.
- File and project descriptors are restored with the split tree. They do not
  enter conversation selection lists or own an Agent runtime. File URLs include
  restoration parameters; history preserves resource identity and environment.

`model/content.ts` converts between validated page snapshots and resource pane
descriptors. Future content such as workflows should add an explicit union
member, validation, snapshot/identity conversion and a feature-owned renderer
or retained page. Keep runtime state with that feature and placement in the
shell. Do not expose unavailable workflow actions or persist arbitrary runtime
objects in the layout.

## Constraints and Responsive Behavior

- Default product constraints live in `DEFAULT_LAYOUT_CONSTRAINTS` (`maxPanes: 6`, `minPaneWidth: 360`, `minPaneHeight: 280`), independent of the tree model.
- Split actions that would violate minimum dimensions or the maximum pane count are disabled per direction.
- Resizing a divider enforces the recursive minimum width/height of all descendant panes. Double-clicking a divider resets its ratio to `0.5`.
- When the viewport shrinks below the active tree's usable split width or height, Yolu enters compact focus mode with `#workspaceNarrowPanes` without discarding the underlying split tree or ratios. Widening the window restores the layout automatically.

## Creation and split controls

The application header owns the single global **New conversation** action, and sidebar groups keep contextual conversation creation. All **New conversation** shortcuts always open inside the currently active pane without auto-splitting. On a fresh startup (or when a saved layout has no restorable content or the last pane is cleared), Yolu opens directly into a ready-to-use new conversation draft instead of an empty launcher. Reopening the app continues to restore the previous saved layout.

Conversation, resource and empty-pane headers reuse `ConversationPaneButtons`: a primary Split button splits right and directly opens a new conversation draft in the new pane (inheriting the source pane's project/directory when available, otherwise using the default directory), and its direction menu offers right, down, left and up under the full layout constraints (`maxPanes: 6`, minimum pane size `360 × 280`). Sidebar conversation rows retain their **Add to right split** action for opening existing conversations side-by-side up to three parallel panes, and file docks retain **Open in pane**. Closing a pane does not delete the underlying conversation.

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

## Verification

Mixed-content regression coverage lives in `scripts/page-navigation.test.cjs`
and `scripts/app-pane-layout-model.test.ts`: resource restoration, remote
environment/directory identity, session bindings, repeated file line navigation,
and closing a resource while retaining conversation readers. The shared file
browser tests cover automatic diff selection and restored modes.

The resource-pane implementation was checked in Chromium and an isolated macOS
desktop preview at comparable 1380 × 900 and 900 × 900 viewports, including
conversation/file/project splits, file rendering, project navigation,
maximization and compact pane switching. The desktop check reused an existing
native wrapper with a newly built backend and frontend; no installer was built.
