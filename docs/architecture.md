# Application boundaries

Yolu is a modular monolith: the Go backend serves both the browser UI and the
Tauri host. Each execution environment retains its own store, provider clients
and directory coordination. Worktree lifetime remains independent of a
conversation. See [session architecture](session-architecture.md) for identities,
provider ownership and persistence semantics.

## Frontend modules

The [frontend module guide](../frontend/README.md) documents the complete directory
map. `frontend/entrypoints` selects build/startup boundaries; `app` composes the
shell and per-feature adapters; `features` owns business UI and runtime; `entities`
owns shared project/conversation records and rules; `core` and `api` own transport;
`shared` owns generic controls, localization and utilities. The manifest in
`frontend/architecture.json` rejects reversed dependencies, undeclared feature
integrations and feature cycles during `web:check`.

## Frontend ownership

| Owner | State and responsibilities |
| --- | --- |
| Application host (`web/core/page-host.js`) | URL history, pane placement, focus, visibility and shared read coordinator |
| Page controller and bridge | Page scope, selection restoration, dialogs and subscription lifetime |
| Conversation controller | Draft identity, pending submission, history pagination and live display state |
| Backend and provider | Directory grants, authoritative turn execution and native conversation history |

Static React views supply markup; native page controllers own their DOM and
listeners. Interactive React islands own their mounted subtrees. Do not
attach a second state owner or replace an island's DOM from a native controller.
When moving more controller logic, add checked TypeScript modules under
`frontend/features` or `frontend/core` according to ownership; keep the remaining JavaScript
as integration glue. A full framework rewrite is not required to cross this
boundary.

`frontend/core/api-client.ts` owns environment headers, decoding, structured
errors and rejection of ambient responses after environment changes. Explicitly
scoped requests retain their original environment. Both ordinary pages and the
terminal use this client. Errors retain the server's code, command and request
identity for recovery.

`frontend/core/request-cache.ts` owns one application-wide read coordinator.
Same-environment startup and session reads share responses for one second;
every caller receives an independent body. Headers and query order are
normalized. Mutations invalidate before and after delivery, explicit refreshes
invalidate immediately, and abortable requests retain their own cancellation.
Page-specific query generations and list caches still belong to their views.

## Pane protocol

`frontend/core/page-protocol.ts` defines message payloads for the host, ordinary
readers and terminal readers. Both receiving boundaries verify the origin, known source window and message
payload before acting on a message. Unsupported or
malformed messages are ignored; outgoing messages are checked too. Keep the
existing `workhub:` wire names for compatibility. Optional layout fields retain
their existing false/default semantics.

The host can request restoration and visibility changes without owning a
reader's draft or cancelling its provider turn. Closing a reader disposes its
observers and streams; the backend remains responsible for the run. Retain the
same-origin iframe isolation until measured performance justifies another
rendering arrangement.

## Session creation

`session.Service.CreateSession` is an application use case callable without
HTTP. It validates input, checks durable creation receipts, resolves bindings,
reserves directories and selects the provider adapter. The HTTP adapter only
decodes input, translates failures and reads the resulting session for output.

`session_provider_codex.go` and `session_provider_acp.go` own provider startup and
their connection lifetime. `chatRuntime` owns active runs and title workers;
`controlCoordinator` owns per-session serialization and the cleanup gate.
Preserve the lock order documented in `session_control.go`. Provider-specific
capabilities remain explicit instead of pretending both protocols support the
same operations.

Creation fingerprints keep their original JSON representation and field order.
An uncertain provider mutation leaves a durable receipt and is never retried
implicitly. A caller disconnect does not cancel an accepted run.

## API contracts and diagnostics

`internal/apitypes` owns creation requests, directory binding inputs, turn
settings and the common error envelope. Run `npm run api:generate` after changing
those types. `npm run api:check` rejects drift in the generated
`frontend/api/contracts.ts`; the generator does not import runtime services or
embedded frontend assets. Frontend domain types narrow permission and access
values while deriving shared fields from those contracts.

Errors keep their existing human-readable `error` and add a stable `code`.
Creation distinguishes conflicting payloads, uncertain receipts, directory
conflicts and provider failures. The HTTP diagnostics boundary generates
`X-Request-ID`; common error bodies include the same identity. Structured logs
follow request, environment, creation receipt, session, run and turn identities.
Do not log prompts, attachments, credentials or provider output. The original
ResponseWriter passes through unchanged so SSE and WebSocket capabilities are
preserved.

## Builds and verification

`npm run build` is the complete frontend build used by browser startup, desktop
preparation and CI. It compiles application and chat assets before Go embeds
them, then writes `web/ui/build-manifest.json` with byte counts, gzip sizes and
SHA-256 hashes. The manifest has no timestamps and can be compared across builds.
Use its per-entry measurements before introducing shared runtime chunks or
changing pane isolation.

`frontend/` contains the layered component and module sources; `web/core` and `web/features`
contain the remaining native controllers and styles. `web/ui` and
`web/chat/highlight` are ignored build outputs. Existing checked-in chat bundles
are distribution snapshots, not edit targets; regenerate them from their source.
The build manifest is generated, ignored and embedded with the application UI.

Keep focused TypeScript tests for stale responses, invalidation and protocol
validation, and Go tests for creation receipts and lock ordering. The Chromium
suite in `scripts/browser` exercises the real embedded UI, Git and SQLite with a
deterministic provider fixture. It does not contact a model or use personal
projects. Native window commands still require platform-specific desktop checks.
