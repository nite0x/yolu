# Sessions, projects and worktrees

A project registers a repository. Git tracks its checkouts, branches and worktrees. A session records a native agent conversation. A directory binding connects a session to an actual execution directory, optionally associated with a registered project. A session can have one primary binding and any supported additional bindings, or start without a project.

## Identity and storage

An execution environment owns its SQLite store and provider connections. The frontend routes calls and stores drafts by environment and native session identity. A project belongs to one environment. Its related conversations include explicit project bindings and saved conversations discovered in its worktrees.

| Table | Responsibility |
| --- | --- |
| `projects` | Repository registration, path and Git common directory |
| `sessions` | Native session index, working directory, provider, title and managed-context marker |
| `session_project_bindings` | Directory identity, optional project, selected role, intended access and recorded branch |
| `session_organization` | Pins and archive state |
| `conversation_create_requests` | Durable creation identifiers and resulting session IDs |
| `conversation_drafts` | Draft text, attachments, settings, reading state and question drafts |
| `conversation_async_answers` | Receipts for asynchronous questions |
| `migration_recovery` | Historical source records and migration exceptions |

Directory identity uses normalized paths resolved in the execution environment. SQLite prevents duplicate directory bindings and more than one primary binding per session. Several sessions can bind the same worktree. A project deletion clears its registration reference in saved bindings, preserving their directories. A session deletion cascades its binding records, while Git retains its worktrees. Full messages remain in provider storage.

The recorded branch supports drift checks. The API obtains current branch, change state and worktree identity from Git. Directory validation reports missing or replaced paths. Access selection records user intent. A running provider turn can report which access is in effect in addition to that selection.

## Runtime

Creation validates the directory, registered-project membership and model selection, then saves a durable request receipt. Identical retries can reuse the resulting session. A different payload requires a new request identifier. A persisted uncertain result must be inspected before starting another creation.

Control locks serialize operations on a session. The directory reservation shared by project operations and terminal starts protects worktree switching and removal. Write conflicts between overlapping active turns are checked against the effective directories. A user can explicitly confirm sharing or create an independent checkout.

Native runtime events describe actual tool execution. Git status and file snapshots describe the directory's current state and observed changes over a turn. Existing changes, changes observed during the turn, and changes supported by direct tool evidence have separate meanings.

Model and permission defaults are stored per execution environment under `conversation_defaults:v1`. Explicit conversation settings override those defaults. Active turns retain the settings they started with. Providers advertise supported directory and approval features. When a feature requires a newer provider protocol or a subsequent turn, the UI reports that state.

Managed Codex threads require named filesystem profiles and confirmation from the app-server. Yolu checks the returned profile identity before passing text to the turn and updates the profile when resuming with changed bindings. Native directory requests are validated and shown for approval. A confirmed provider receipt governs effective access for the active turn. The persisted binding is revalidated and used to configure future turns. An unmanaged native conversation can continue under its native defaults until its directory context is explicitly adopted.

Antigravity ACP sessions retain their native primary-directory workflow. The UI shows when independent permissions or additional directories are unsupported. External terminal agents own their own authentication and sandbox. Managed Codex resume through a native terminal requires explicit acknowledgement of that execution mode.

The shared conversation controller preserves drafts and paginates history. Starting a new turn and steering an active turn use distinct provider operations. Pending structured questions can be answered without clearing the composer draft. Closing or switching panes releases UI observers while the managed run continues.

## API

Requests use the existing local authentication, CSRF protection and optional `X-Environment-ID` routing. Route declarations in `internal/session/routes.go` and `internal/project/routes.go` define the complete API.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/sessions` | List sessions, with optional `project_id` and `cwd` filters |
| `POST /api/sessions/new` | Start a session from a registered checkout, existing worktree or independent context |
| `GET /api/sessions/{session}/bindings` | Read directory bindings, validation and effective state |
| `POST /api/sessions/{session}/bindings` | Confirm an additional project or directory |
| `PUT /api/sessions/{session}/bindings/{binding}` | Update access, role or the selected worktree |
| `DELETE /api/sessions/{session}/bindings/{binding}` | Remove a directory association |
| `POST /api/session-bindings/inspect` | Validate a candidate directory and surface conflicts before confirmation |
| `GET /api/sessions/{session}/history` | Page through stored provider messages |
| `GET` / `POST /api/sessions/{session}/chat` | Read runtime state or send a turn |
| `POST /api/projects/{id}/worktrees` | Prepare a new or existing branch in a separate worktree |
| `GET` / `DELETE /api/projects/{id}/worktree` | Inspect or explicitly remove a worktree using a reviewed fingerprint |

For example, a registered project conversation can start with:

```json
{"project_id":"project-id","cwd":"/repos/app-worktree","text":"Inspect the implementation","request_id":"unique-request-id"}
```

## Upgrading existing data

The migration runs in a transaction. It backfills the independent session index from historical link records before building bindings. Explicit historical directories and available project associations carry forward. A deterministic primary is chosen using the saved working directory and historical project order. The migration records original rows, including those with no reliable session or path mapping, for recovery and metadata export. It removes the obsolete active tables after the binding conversion. No migration performs Git or filesystem mutations.

To verify an upgrade, open a copy of the old application data in an isolated profile, use the same agent history and repository paths, and check the conversation list and project context. See [migration instructions](brand/yolu/migration.md).
