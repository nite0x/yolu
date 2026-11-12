# Tasks, projects and sessions

Tasks organize a goal, project working directories and explicit session references. Projects register repositories and discover worktrees through Git. Codex sessions exist independently of both. Linking a session to a task does not establish ownership of its history or runtime.

This document describes the current implementation. See the [development guide](development.md) for service composition and the [user guide](guide.md) for workflows.

## Scope and identity

A task scope contains its members' actual paths and its task directory if that directory was created. `has_workspace=false` reserves a path without creating a directory. Existing task paths are preserved. A project scope comes from Git's worktree list, including registered and detached directories; Yolu does not maintain a second worktree inventory.

Directory discovery uses normalized path equality, not prefix matching. A session started in a subdirectory is not automatically a session of its parent. The session's `cwd` describes its primary directory, not every repository it has accessed.

Several tasks can reuse the same worktree and discover the same sessions. Their explicit references are stored separately in `task_session_pins`. Changing a task member, unlinking a project or archiving a task retains session references and Codex history. Unlinking a session does not stop it.

Each execution environment has independent storage and Codex connections. Cross-environment identity is the pair `environment_id + session_id`; a single environment database uses the native session ID as its key. Frontend controllers, drafts, caches and selections must preserve this combined identity.

## Storage

| Table | Responsibility |
| --- | --- |
| `projects` | Repository registration, path and Git common directory |
| `requirements` | Task goals, saved workspace path and preparation/archive state |
| `members` | Task project associations, actual directories, branches and preparation state |
| `sessions` | Independent session index, with no task/project ownership foreign key |
| `task_session_pins` | Explicit references, including sessions created from a task |
| `conversation_create_requests` | Durable creation identifiers, request digests and resulting session IDs |
| `conversation_drafts` | Draft text, attachments, settings, reading state and question drafts |
| `conversation_async_answers` | Receipts for answered or skipped asynchronous questions |
| `schema_migrations` | Completed migrations, preventing repeated restoration of old relationships |

The session index stores metadata such as name, `cwd`, timestamps, source and additional directories. `source` records origin, not ownership. `title_source` and `title_changed_at` separately track naming provenance. Full messages remain in Codex; active runs and approvals are held by the running service rather than making the index a transcript store.

Additional directories are snapshots chosen at creation or an explicit terminal launch. Opening another task does not recompute a session's access roots. New-conversation model and permission preferences are stored per execution environment under `conversation_defaults:v1`. Empty fields inherit Codex configuration; explicit conversation choices override saved preferences. Creation validates an explicitly selected model before saving a creation receipt or calling `thread/start`, so an unavailable selection can be corrected and retried without creating a duplicate thread. The first turn preserves the model, effort, sandbox and approval policy returned at creation, extending directory roots only when that reported sandbox is `workspaceWrite`. Saved preferences never overwrite an existing session’s execution context.

## API scopes and runtime

API routes retain local authentication, CSRF checks and `X-Environment-ID` environment routing. The current route declarations are in `internal/session/routes.go`.

| Endpoint | Purpose |
| --- | --- |
| `GET` / `PUT /api/settings/conversation-defaults` | Read or save environment-specific new-conversation model and permission preferences |
| `GET /api/sessions` | List sessions in the routed environment |
| `GET /api/sessions?task_id=...` | Discover sessions from task directories and references for linking |
| `GET /api/sessions?task_id=...&linked=true` | Show explicit task references only |
| `GET /api/sessions?project_id=...` | Aggregate all project worktrees |
| `GET /api/sessions?cwd=...` | Match an exact directory; can narrow a task/project scope |
| `POST /api/requirements/{id}/sessions` | Link an existing session without replacing its context |
| `DELETE /api/requirements/{id}/sessions/{session}` | Remove only the task reference |
| `POST /api/sessions/new` | Create in a validated task directory or project worktree |
| `GET /api/sessions/{session}/history` | Page through saved history |
| `GET /api/sessions/{session}/history/events` | Subscribe to observed history updates |
| `GET /api/sessions/{session}/chat` | Read the current managed runtime snapshot |
| `POST /api/sessions/{session}/chat` | Send a new turn |
| `POST /api/sessions/{session}/chat/steer` | Supplement the active managed turn |
| `GET /api/sessions/{session}/chat/events` | Subscribe to the managed runtime |
| `POST /api/sessions/{session}/chat/stop` | Stop the current managed turn |
| `POST /api/sessions/{session}/chat/approval` | Answer a synchronous approval or question |
| `POST /api/sessions/{session}/chat/question` | Answer or skip a pending asynchronous question |
| `POST /api/sessions/{session}/chat/approval/open` | Open an approved external request page |
| `POST /api/sessions/{session}/chat/handoff` | Hand a managed terminal session to UI chat |
| `POST /api/sessions/{session}/resume` | Resume in a terminal |

For example, creation in a registered project directory can use:

```json
{"project_id":"project-id","cwd":"/repos/app-worktree","text":"Inspect the implementation","request_id":"unique-request-id"}
```

Task creation can specify `task_id` with a member `project_id`, or choose the actual task directory through `cwd`. The server validates the main and additional directories. An explicit empty `additional_directories` array selects none; the task root is not an implicit additional permission root. A failed member does not prevent using another available member.

Creation requests are persisted before Codex is called. Identical retries reuse the result; a changed payload cannot reuse the same identifier. An uncertain result blocks implicit duplicate creation. Runtime instances are keyed by session ID within the environment, so different task/page entries share the same messages, approvals and stop controls.

`session_control.go` serializes controls by session ID and new-thread creation by durable request key. Different sessions and independent creation requests can progress while another Codex RPC is waiting. These operations hold a shared cleanup gate; worktree removal takes the exclusive gate before checking occupancy and retains it through deletion. Newly created and forked IDs acquire their own session key before publishing records, without recursively acquiring the cleanup gate. Unused keyed locks are retired after the last waiter leaves.

`session_runtime.go` owns managed turns, title workers and their cancellation/shutdown sequence. The session service composes that runtime with protocol clients, storage, directory protection and HTTP adapters.

Legacy task-specific session endpoints remain adapters over the same session operations, with their original scope checks. The generic API can continue a session after its original task is archived.

WSL ordinary requests and long-lived subscriptions use separate pools. Current limits are 32 requests and 16 watchers, defined in `internal/workspace/agent.go`. A `busy` response explicitly indicating that nothing ran may be retried with bounded backoff; uncertain writes are not replayed. Runtime occupancy checks can retry transient helper contention, while a confirmed terminal conflict still blocks a new send.

## Shared browser and conversation UI

`frontend/workspace/session-browser.tsx` defines shared browser markup; `web/features/sessions/session-workspace.js` manages scope, directory filtering, selection and host switching. The browser can move between a page and a native dialog without remounting chat. Task/Git polling refreshes lists rather than recreating the composer.

Task entry points use explicit links by default; project entry points aggregate worktree directories. The global browser queries registered environments independently and combines results, retaining successful results if another environment fails. Scope changes and environment changes invalidate stale responses. Details, subscriptions, creation and linking always route through the record's own environment.

An aggregate scope requires a concrete directory before creating a session. Selecting one directory fixes the creation target. Detached project worktrees and an actually created task directory are valid targets. History-only mode preserves history and terminal continuation while disabling UI chat creation.

Controllers are shared by environment/session identity. Unsent new-session drafts are keyed by creation target. Leaving a page cancels UI subscriptions without calling stop. Hidden panes do not mark an unseen reply as read. Browser storage is a fast cache; database-backed drafts survive desktop port changes.

## Sending, questions and recovery

Sending while a managed turn is active uses native `turn/steer`; it is not a queue disguised as input to that turn. Steering includes an expected turn ID and unique request identifier. Delivery records are saved before the RPC. Accepted retries are safe; unconfirmed delivery is surfaced for inspection rather than silently retried.

Synchronous structured questions answer the original RPC. Asynchronous questions arrive with `agentMessage.delivery=async` and a question payload. Their answers steer the active turn or start the next turn after completion. Completing a turn does not discard an asynchronous question; a later user message supersedes it. Loading a session reads enough recent history to restore pending questions across pagination. Question drafts and durable answer/skip receipts prevent lost selections and duplicate answers.

Live events, observed terminal history and saved history share visibility filtering. Messages, commands, file changes and supported tool summaries are rendered; raw internal tool parameters and private internal reasoning are not forwarded as conversation content. History is merged around message anchors to prevent a completion snapshot from reordering old history after a new turn.

Models, effort and working mode are validated against the current environment's capabilities. Changes apply on the next turn; steering keeps the active turn's configuration. Unreported context is shown as unknown rather than inferred by resuming the session. Creating or resuming a conversation does not overwrite global Codex configuration.

Rename, local pin, native archive/restore and branching from loaded history reuse the native session. Branching does not create a worktree or automatically continue the task. Archive and branch operations are unavailable while a session is running; uncertain branch creation retains its request identity.

## Native clients and file access

A native Codex client and Yolu may use different app-server instances. `thread/read.status=notLoaded`, or an interrupted status from an instance that never loaded the session, does not prove an external turn has ended. Yolu uses explicit active state and read-only observation of the metadata-provided rollout lifecycle. Missing, unknown or stale evidence produces an unverified state instead of assuming idle.

Observing a native run does not call resume, start or interrupt. Without a Yolu-managed run ID the UI does not expose a managed stop action or submit a supplement as a new turn. On observed completion it refreshes history and retains the unsent draft.

Local images in visible history use signed references bound to the session and backend instance. The authenticated environment-routed API reads a limited-size regular PNG/JPEG/GIF/WebP file on the owning execution side. The browser does not request arbitrary local file paths directly.

File links use `GET /api/sessions/{session}/file`. The server resolves real paths within the session's saved main/additional directories, rejecting escaping symlinks, directories, binary content and files over 512 KiB. Referenced excerpts contain at most 401 lines. External links use the restricted `POST /api/sessions/{session}/open-link` endpoint.

## Task updates, migration and cleanup

Task names/goals use `PATCH /api/requirements/{id}`. Member directories use `PUT /api/requirements/{id}/projects/{project}`; `DELETE` removes an association while retaining files, branches and sessions. Tasks can remove their last member and add another later. The legacy primary-project preference can be empty and must refer to a current member.

`WORK_HUB_CONTEXT.md` is the generated current goal and directory list. `BRIEF.md` remains user notes/history. A task that only reuses existing directories does not create a task root. Restart/import marks interrupted pending/creating members as retryable failures; removed members can later be recovered from retained branches.

Startup migration deduplicates old `requirement_sessions` into the independent index, preserving recent metadata and converting manual relationships to explicit references. Old creation requests migrate to the independent request table. Migration runs transactionally, and metadata import/export supports old and new records.

Session catalog queries reuse matching pages/index scans; explicit refresh and session changes invalidate cached results. Task cleanup receives an injected directory-reservation callback. It checks managed/native sessions and terminals, then retains the control lock through deletion to prevent a new managed session starting between the check and removal. WSL checks and deletion remain on the owning execution side.
