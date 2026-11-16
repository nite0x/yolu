# Yolu global AI assistant

## Status and provenance

Design handoff prepared on 2026-11-16. Implementation status is proposed. This document records the requested product outcome, the architecture discussed in ChatGPT, and adaptations from an initial repository review. Implementation progress is tracked in [plan.md](plan.md).

The user requested a global conversation for operating Yolu, including creating work and loading projects, followed by a design and implementation plan. The discussion recommended a Go tool-calling runtime, a capability registry, reviewable action plans, and reuse of application services and conversation UI. The cached conversation contains headings for four implementation stages and an interactive architecture selector, but its stage details and selector values are unavailable. The phases in the accompanying plan are an editorial proposal, and provider selection and exact persistence contracts remain open. [Source conversation](https://chatgpt.com/c/6afab987-1c04-83ee-a4a7-d50babf23b5a)

Repository observations below refer to `main` at `6e5403a67c46b67448c2eb9d449f01c5b4f63abb`. Recheck them against the implementation branch before making code changes. Repository documentation is written in English under [AGENTS.md](../../../AGENTS.md).

## Product outcome

Users can describe a development goal, find the participating projects, review the intended changes, create a workspace with appropriate working directories, and open the result from one global assistant conversation. This supports Yolu's workspace-centered cross-project development workflow.

The assistant has a persistent main-navigation entry named **Yolu Assistant**, with access to recent assistant conversations. Users can create and restore multiple conversations independently of workspace and project selection. A conversation can use the current selection as temporary context. Switching selection preserves the conversation's identity and history.

The original discussion uses both task and workspace terminology. Repository guidance defines the user-facing workspace as the requirement container and retains `task`, `Requirement`, and `requirements` internally. In this design, “create a task” resolves to the existing workspace creation flow. A request to create work and its workspace produces one requirement record with project members. A separate task entity would require a later product decision. [Repository direction](../../../AGENTS.md)

## Initial delivery and subsequent capabilities

The first usable delivery covers the following workflow.

1. Query workspaces, registered projects, their available worktrees, and relevant Git state.
2. Register an existing local Git repository in its execution environment.
3. Create a workspace for a goal and select how each project participates.
4. Add a project to an existing workspace using the same membership rules.
5. Review one plan containing the proposed metadata and filesystem changes, approve or cancel it, and observe execution progress.
6. Open the resulting workspace, project, or existing coding conversation through validated application navigation.

Follow-up capabilities include workspace metadata updates, standalone worktree creation, and explicitly requested coding-agent session creation. The discussion also describes a compound request that prepares frontend and backend projects and starts Codex. Session creation belongs to a later phase after the core management workflow passes acceptance.

Future candidates include an external MCP adapter, additional coding agents, durable advanced orchestration, long-term memory, and model-generated interactive interfaces. Initial UI uses Markdown plus application-owned structured components. Model-supplied executable UI, generic shell access, and direct model access to SQLite fall outside the initial capability surface.

## Existing architecture and integration constraints

| Area | Observed implementation | Design consequence |
| --- | --- | --- |
| Application | Go HTTP service, Tauri host, SQLite, React workspace markup and interactive chat | Compose the runtime in Go and reuse the existing HTTP/event and UI bridges |
| Workspaces | `internal/task/requirements.go` manages requirement creation and preparation | Wrap the same domain operations for assistant calls |
| Projects | `internal/project/projects.go` validates registration and Git common-directory identity | Preserve validation, duplicate detection, environment routing, and cache invalidation |
| Membership | `internal/task/member_selection.go` supports `new`, `existing`, `project`, and `worktree` | Preserve all four modes and resolved baseline information |
| Conversation index | `internal/model/session.go` indexes independent native Codex threads | Extend conversation presentation and dispatch deliberately for assistant records |
| Conversation history | Native Codex holds full messages, SQLite stores metadata and drafts | Resolve assistant transcript persistence explicitly before implementation |
| Environments | Environment-local storage and runtime, combined frontend environment/session identity | Carry environment identity through every target, event, cache, and navigation action |
| Transport | Authenticated HTTP, CSRF checks, and `X-Environment-ID` routing | Apply existing request protections to assistant endpoints |

Current `/api/sessions/new` creation resolves a concrete task/project directory before starting Codex. The existing global conversation browser aggregates native conversations. A directory-independent Yolu assistant therefore needs an explicit conversation kind and runtime path. Its global presentation scope must coexist with native directory discovery and `task_session_pins` reference semantics. The illustrative `scope`, `scopeId`, `agentKind`, and `providerId` fields in the discussion describe concepts whose concrete representation requires repository-level design. [Session architecture](../../session-architecture.md)

Some domain operations currently live inside HTTP handlers. Extract the smallest shared service operation when necessary so manual UI and assistant execution use the same validation, locks, side effects, and result semantics. Compose cross-module interfaces in `internal/app` and retain the existing package dependency direction. [Development architecture](../../development.md)

## User interaction

### Context and resource selection

- Display any selected environment, workspace, or project used to interpret the request.
- Resolve names through application queries. Present a choice when names match multiple resources or environments.
- Ask for a repository path when local registration lacks a usable path. Use the existing directory picker where supported, and preserve execution-side path handling for WSL.
- Retrieve summaries and bounded pages on demand. Include freshness and per-environment query failures in results so the model and user can recognize incomplete state.
- Keep assistant history available while opening a target page, and preserve drafts and reading position through the shared conversation lifecycle.

### Review and execution

Read capabilities can run immediately within the application's authorized scope. Changes are collected into one action plan. The review shows the workspace goal, environment, selected project IDs and names, working-directory modes, resolved paths, source refs and commits, proposed branches, and any coding-agent launch settings.

The user can confirm or cancel the plan. Confirmation authorizes its recorded operations and parameters. Material changes to targets, paths, source baselines, branches, or side effects produce a new plan revision for review. Execution reports each step and links to resources identified by actual service results.

The UI renders application-defined cards for resources, project choices, plan approval, step progress, and recoverable errors. Navigation actions carry a supported target type, resource ID, and environment. Resolve and validate them through application routing. Clicking an existing conversation opens it. A requested continuation follows the existing session controls.

Application labels use the existing `uiText` and English catalog workflow. User-authored text and conversation content retain their original language. Plan confirmation, cancellation, and resource links must be keyboard accessible and expose their pending, completed, and failed states.

## Runtime and capability model

The logical call path is React conversation UI → authenticated Go assistant runtime → capability registry and policy checks → existing domain services → SQLite, Git, and environment execution. Coding-agent sessions continue through their existing execution runtime.

The assistant runtime owns provider communication, bounded tool-calling turns, cancellation, timeouts, and progress publication. The registry exposes named capabilities with JSON Schema inputs, structured outputs, risk metadata, approval policy, and Go handlers. The backend validates schema, resource existence, environment, authorization, and preconditions at execution time.

The provider adapter separates model configuration from agent identity. `yolu` identifies the management assistant. A provider/model configuration identifies the LLM used for that assistant. Exact providers, credentials storage, and configuration UI require implementation review. Credentials stay outside prompts, transcripts, exported action results, and client-visible events.

### Proposed capability catalog

Names are logical contracts to be finalized during implementation review.

| Capability | Target behavior | Delivery |
| --- | --- | --- |
| `app.getContext` | Read current selection and environment hints | Initial |
| `project.list`, `project.get` | Query registered repositories and available directories | Initial |
| `project.register` | Register an existing repository through current registration rules | Initial |
| `workspace.list`, `workspace.get` | Query existing requirement records and members | Initial |
| `workspace.create` | Create a requirement and prepare its selected members | Initial |
| `workspace.attachProject` | Add project members through existing preparation logic | Initial |
| `git.status`, `git.worktree.list` | Query execution-side Git state with freshness information | Initial |
| `conversation.list`, `conversation.open` | Find and open existing native conversations | Initial |
| `app.navigate` | Produce a validated in-app navigation action | Initial |
| `workspace.update` | Update requirement name or goal through current domain rules | Follow-up |
| `git.worktree.create` | Create a standalone worktree through project services | Follow-up |
| `agent.list`, `agent.session.create` | Discover supported executors and explicitly create a coding session | Follow-up |

The discussion's `task.list`, `task.get`, `task.create`, and `task.update` correspond to the workspace capabilities above. If compatibility aliases are useful, they share the same implementation and request identity. Enabling `workspace.create` includes the worktree preparation performed by its selected member modes. Avoid creating the same worktree again through a separate capability.

### Workspace membership behavior

| Mode | Existing meaning | Required plan details |
| --- | --- | --- |
| `new` | Create a worktree on a new branch | Project, destination, source ref and resolved commit, new branch |
| `existing` | Create a worktree from an available existing local branch | Project, destination, existing branch and resolved commit |
| `project` | Reuse the registered project directory | Project, actual directory, observed branch or detached state |
| `worktree` | Reuse a discovered Git worktree | Project, selected actual path, observed branch or detached state |

Creation currently requires 1–30 registered projects. A request with a goal alone can produce a draft while the assistant obtains project choices. An all-reused workspace can reserve a path with `has_workspace=false`, and its saved record can exist without a newly created workspace directory. Respect the configured root and saved paths. Project registration scans existing repositories and worktrees. Clone-from-Git remains available through the existing manual workflow and can receive its own assistant capability later. [Project registration](../../project-registration.md)

### Structured results and errors

Each invocation returns its request, run, plan revision, and step identity as applicable, its completion state, typed resource references, and validated UI actions. Errors include a stable code, readable message, execution certainty, actual resources created, and available recovery actions. Suggested error classes include invalid input, ambiguous target, permission denied, stale plan, resource conflict, environment unavailable, timeout, cancellation, partial failure, and unknown outcome.

Workspace preparation can return a saved requirement whose individual members failed. Determine success from the resulting domain state and member outcomes as well as transport status. Surface context-generation warnings and partial resources. Only report full completion after the requested steps have succeeded.

## Authorization and execution consistency

- Enforce tool permissions and approval in Go. The system prompt can explain policy, while the backend decides whether an operation may execute.
- Bind approval to a specific plan revision and canonical arguments, target environment, resource identities, and reviewed preconditions. Reject replay with a changed payload.
- Preserve local authentication, CSRF, resource ownership checks, execution-side canonical path and symlink checks, repository identity checks, and existing repository/environment locks.
- Treat repository files, tool outputs, resource names, and imported text as untrusted data. They cannot grant authority, change approved actions, or introduce new tools.
- Bound turn steps, provider/tool timeouts, input sizes, and result sizes. Expose cancellation. Stop scheduling dependent steps after failure or cancellation.
- Give mutation requests durable idempotency identities. Identical retries reuse the saved result. A changed payload conflicts with the existing identity. Serialize conflicting operations with the established domain locks.
- Persist execution intent before an external side effect and record actual resource IDs, paths, branches, and outcomes afterward. Handle uncertain results through reconciliation before any replay.
- Recheck reviewed preconditions immediately before a write. Return a conflict and updated review when concurrent activity makes the plan stale.
- Record approval decisions and execution outcomes with sensitive fields redacted. Keep useful operational summaries available for troubleshooting.

An initial run targets one explicitly resolved execution environment. A global conversation can query several environments and report successful results alongside failures. Separate per-environment plans are the proposed first implementation for requests spanning environments. This execution choice requires review during phase 1.

## Persistence and recovery

Reuse the existing SQLite infrastructure, shared conversation components, draft behavior, and event transport. Native coding threads retain their established history, runtime, directory identity, and workspace references. Define additive assistant conversation metadata and transcript storage within the existing persistence infrastructure, together with runtime dispatch by conversation kind.

The design requires logical records for assistant conversations/messages, runs, tool calls, action plans, approvals, and execution steps. The discussion suggests `assistant_runs`, `assistant_tool_calls`, `assistant_action_plans`, `assistant_approvals`, and `assistant_execution_steps`. Exact tables and their consolidation are implementation decisions. Define migration, metadata export/import, restart behavior, and history retention with the selected transcript design.

Use a lightweight execution journal for multi-step actions. Each step records dependency order, approved arguments, idempotency identity, actual effects, and state such as pending, running, succeeded, failed, cancelled, or unknown. Backend restart and interrupted HTTP requests preserve evidence needed to reconcile an unfinished operation. Reconnecting UI clients reload the authoritative snapshot before applying subsequent events.

For a failed second worktree, retain the successfully created workspace and first member, record the failed member, and show a safe recovery path. Retry only after checking the existing domain recovery state and the original plan's authorization. Additional side effects require their own reviewed plan revision. Cleanup follows the existing workspace finishing and occupancy checks. [Workspace lifecycle](../../workspace-lifecycle.md)

## Acceptance criteria

These criteria validate future implementation. They are pending in this documentation handoff.

| ID | Scenario | Observable result |
| --- | --- | --- |
| AC-01 | Create two global assistant conversations, switch projects/workspaces, restart Yolu | Each conversation restores its history and draft with stable identity and global presentation |
| AC-02 | Ask for current workspaces and projects, including an unavailable environment | Show discovered resources, environment identities, freshness, and a clear partial-query failure |
| AC-03 | Request workspace creation with a goal and an ambiguous project name | Query candidates and collect the required project choice before presenting an executable plan |
| AC-04 | Register an existing repository and repeat the same request | Enforce canonical Git identity and duplicate rules, preserve a durable request result, and open the registered project |
| AC-05 | Create a workspace with frontend and backend projects, then confirm | Display reviewed paths/refs/branches, create one requirement with both members, and link to the resulting workspace |
| AC-06 | Exercise all four membership modes, including an all-reused workspace | Match manual creation semantics, reflect actual paths and `has_workspace`, and preserve existing directory contents |
| AC-07 | Cancel a pending plan, or submit a forged approval for changed arguments | Cancellation leaves the plan unexecuted, and the backend rejects mismatched authorization |
| AC-08 | Change a target branch or repository between review and execution | Detect stale preconditions, explain the conflict, and present a revised plan for changed operations |
| AC-09 | Fail the second project's worktree preparation | Display partial completion and actual resources, retain the successful member, and offer domain-compatible recovery |
| AC-10 | Retry a write, submit it concurrently, or disconnect after its side effect | Reuse confirmed results, serialize conflicts, and reconcile unknown outcomes before replay |
| AC-11 | Restart during a run or cancel while a tool is active | Restore execution state, stop later steps, and report completed, failed, cancelled, and uncertain effects accurately |
| AC-12 | Supply an escaping symlink, wrong environment target, or instruction embedded in repository text | Enforce path and target authorization and keep execution within the approved capabilities and plan |
| AC-13 | Open a result and revisit the assistant from keyboard navigation | Navigate to the correct environment/resource and restore the conversation state with usable approval controls |
| AC-14 | Load data created before the feature and use existing native conversation flows | Preserve session discovery, task pins, drafts, creation receipts, archive behavior, worktree cleanup coordination, and saved workspace paths |
| AC-15 | Explicitly request Codex launch after workspace preparation, in the follow-up phase | Create or recover one native session in a validated directory, retain environment identity, and open the actual resulting conversation |

## Decisions for implementation review

1. Select the initial tool-calling provider and model configuration, credential storage, and behavior when configuration is unavailable.
2. Settle assistant transcript persistence and unified browser/controller identity while preserving independent native session semantics.
3. Define the capability schemas, plan revision format, approval lifetime, execution journal, event replay/snapshot behavior, and error codes.
4. Review the proposed single-environment execution boundary and storage ownership for global assistant history.
5. Confirm the initial navigation placement and core workflow, then schedule optional coding-agent launch and additional executors separately.
