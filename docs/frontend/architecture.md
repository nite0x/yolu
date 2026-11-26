# Frontend architecture

The authoritative source map and dependency table are in [frontend/README.md](../../frontend/README.md). Product rendering and token contracts are in [UI guidelines](../ui-guidelines.md). This refactor retains those layers instead of introducing another `src` tree.

## Actual owners

| Owner | Responsibility |
| --- | --- |
| `frontend/entrypoints` | Workspace, conversation, locale, layout, browser runtime, terminal and lazy file-display builds |
| `frontend/app` | Shell/navigation, pane geometry, shared interactions, host assembly and bridge composition |
| `frontend/features` | Conversations (including assistant, voice, usage), files, Git, projects (including worktrees), settings and terminal |
| `frontend/entities` | Cross-feature project/conversation identity, transport-shaped records and shared presentation |
| `frontend/core` | HTTP errors/environment guards, read coordination and validated pane messages |
| `frontend/shared` | Existing primitives/composed UI, hooks, identity, preferences and generic resize mechanics |
| `frontend/api` | Generated backend contracts, unchanged by this task |
| `frontend/dev` | Standalone component gallery, excluded from product bundles |
| `web/core`, `web/features` | Active Go-hosted page adapters and native controller integration, not an abandoned product implementation |

There are six registered features. Workspace is shell composition, worktrees belong to projects/Git, assistant uses conversations, Issues links to the external tracker. No new workspace/task business system is introduced.

## Dependencies

`architecture.json` explicitly enumerates allowed layers and feature integration paths. The checker resolves type imports, re-exports, literal lazy imports and CSS imports, rejects source-tree escapes, checks feature integration cycles, and checks cycles between every resolved source file. Chat model/catalog types live with settings; message conversion re-exports the existing type contract without a reverse dependency.

Keep direct imports; do not introduce all-purpose barrels, repositories, use cases or duplicate provider runtimes. The only deliberate cross-feature integration is conversations using the file browser and changed-file records.

## State, requests and resources

| State | Owner / lifetime |
| --- | --- |
| Dialog input, expanded rows, file mode/selection | Local component or feature view |
| Navigation, active/focused panes, saved geometry | Host shell and existing preference keys |
| Conversation draft/messages/history | Existing controller keyed by environment, conversation or creation identity; retained LRU cache protects unsaved work |
| Backend catalog reads | Existing host read coordinator; environment/header/query identity; one-second retention; mutations invalidate before and after |
| File tree/preview | Browser resource key includes environment/session/binding/path (project only for project readers); request cancellation plus stale-response guards |
| Terminal | Page owner with connection-attempt identity, output-parser sequence, socket/addon/timer/listener teardown |
| Settings writes | Existing serialized per-setting/environment queue; independent environments can save concurrently |

Explicit `no-store`, `reload`, `no-cache` and abortable reads bypass retained responses. Quota reads use the shared API client with explicit environment. Controller drafts remain the single persistence source; completed queued writes are allowed to finish after disposal, but cannot restore state, notify or create retry timers. Persisted image records are validated before restoration.

The backend retains agent execution, permission enforcement, workspace rules, Git semantics and protocol ownership. Native Tauri capabilities are supplied by the host. No database/backend/native business files change.

## Styles and delivery

Reuse `web/core/appearance.css`, typography and the scoped aliases in `shared/styles/base.css`. Native and browser readers use the same components. Product `workspace-pane` markup and shell modules replace the unused layout wrapper; no second layout framework is added. File/Diff renderers follow the owning document's appearance and disconnect their observer when closed. Dynamic geometry stays inline because it depends on measured user resizing.

Build output names and lazy Mermaid/Shiki/xterm loading remain stable. Generated application assets are built for verification and excluded from source commits; backend/package builds must build frontend assets first.
