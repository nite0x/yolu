# Global assistant implementation plan

## Status and use

Prepared on 2026-11-16 against `main` at `6e5403a67c46b67448c2eb9d449f01c5b4f63abb`. The original proposal is preserved below with the phase 1 implementation review and verification evidence. Phase 1 is implemented. Phases 2–4 remain pending. The original conversation's four-stage details and interactive selections were unavailable in the retrieved text, so the phases below were reconstructed for review. The [specification](spec.md) defines the intended behavior and acceptance criteria.

The design handoff delivered two documents. Phase 1 implementation rechecked [AGENTS.md](../../../AGENTS.md), [CONTRIBUTING.md](../../../CONTRIBUTING.md), and the specification, and updated this plan with the actual branch state and verified implementation decisions.

## Initial repository review

| Area | Reviewed evidence | Reuse and remaining work |
| --- | --- | --- |
| Product direction | `AGENTS.md`, `docs/brand/yolu/migration.md` | Use workspace terminology, retain task identifiers, and keep cross-project work central |
| Documentation | `docs/README.md`, `docs/development.md` | Write English Markdown and add the feature documents under `docs/features/global-assistant/` |
| Creation | `internal/task/requirements.go`, `internal/task/member_selection.go`, `internal/task/requirement_projects.go` | Reuse preflight, member modes, preparation, warnings, and retry behavior through shared service operations |
| Registration and Git | `internal/project/projects.go`, `internal/project/routes.go`, `internal/project/service.go` | Preserve registration checks, Git locks, cache invalidation, and worktree coordination |
| Reads | `internal/overview/state.go`, `internal/app/routes.go` | Reuse resource composition and expose bounded assistant read results |
| Native conversations | `internal/model/session.go`, `internal/session/session_create.go`, `docs/session-architecture.md` | Preserve independent Codex index and request receipts, resolve assistant history and runtime dispatch |
| Persistence | `internal/store/store.go`, `internal/store/task_schema.go` | Add migrations and recovery records using existing storage infrastructure |
| Frontend | `docs/development.md`, `web/core/page-host.js` | Reuse React/chat bridges and route host, extend supported routes and validation deliberately |
| Checks | `CONTRIBUTING.md`, `.github/workflows/checks.yml` | Use the existing suites and isolated workflow smoke test |

This review establishes integration entry points. Detailed provider support, every controller contract, export/import changes, and platform behavior still require implementation-time verification.

## Phase 1 — Resolve contracts and add the conversation foundation

Dependencies are the current source tree and the open design decisions in the specification.

- [x] Recheck repository instructions and document how the assistant serves workspace creation, project selection, and resuming work.
- [x] Map each initial capability to a domain operation, identify handler logic that needs extraction, and keep existing HTTP callers on the same behavior.
- [x] Finalize global assistant conversation identity, storage ownership, transcript retention, and dispatch. Preserve combined environment/session identity and native directory-based discovery.
- [x] Choose the initial provider adapter, configuration path, credential storage, and tool-calling protocol. Record the choice and its actual limitations in the specification.
- [x] Define additive migrations for assistant conversations/messages and execution records, including metadata export/import and interrupted-run handling.
- [x] Add the Yolu Assistant navigation entry, new/restored conversation flow, draft persistence, and a basic bounded read-only provider turn.
- [x] Define the per-run environment boundary, timeouts, step limits, and event/snapshot contract.

Exit evidence includes a restored global conversation after restart, correct behavior across selection changes, a provider configuration failure shown in the UI, and verified legacy data loading. Trace acceptance to AC-01 and AC-14.

### Implementation review on 2026-11-16

The implementation branch is `codex/global-assistant-phase1`, based on `origin/main` at `695d053`. The original checkout contains unrelated uncommitted browser-access and shared-layout work. Implementation uses a separate worktree and preserves that checkout. At the user’s subsequent request to use the latest UI, its complete browser-access/shared-layout snapshot was carried forward in prerequisite commit `955028b`. The assistant is the first navigation item as requested. Commits use the Codex agent identity because this checkout has no configured Git author.

The assistant supports the workspace-centered workflow by keeping a directory-independent conversation available while users select projects and resume work. Phase 1 establishes that conversation foundation. Application resource queries and reviewed writes follow in phases 2 and 3.

| Contract | Implementation decision and evidence |
| --- | --- |
| Provider | The user selected the existing authenticated Codex CLI. Reuse `internal/codex.LiveClient` and the ephemeral, tool-disabled thread pattern in `internal/session/session_title.go`. Inherit the installed CLI model and authentication. Credentials remain in Codex configuration. |
| Identity and ownership | Local application-owned assistant IDs have an explicit `yolu` kind and `local` storage identity. They never enter `sessions` or `task_session_pins`. Workspace/project/environment selection does not rekey history. |
| Transcripts | Add assistant conversation, message and run tables through `internal/store`. Include them in metadata export/import. Existing `conversation_drafts` stores text and reading position with a namespaced assistant key. Preserve full saved history, page UI history, and bound model context independently. |
| Provider lifecycle | Each turn uses a fresh ephemeral Codex thread with a bounded transcript. Reuse the no-tools configuration from title generation, enforce read-only sandbox and never approvals, reject unexpected tools/approval requests, interrupt unfinished turns and unsubscribe on exit. |
| Recovery | Persist input and request identity transactionally before inference. Retrying the same request reuses its receipt, changed content conflicts. Serialize sends per conversation and mark unfinished runs interrupted on restart/import. Require a fresh explicit send after interruption. |
| Transport | Authenticated local `/api/assistant` endpoints return authoritative persisted snapshots. The shared React adapter polls active runs and reloads on reconnect. UI navigation does not cancel runs. Explicit stop and shutdown cancel bounded provider contexts. |
| Bounds | One active run per conversation, at most four concurrent assistant runs, two-minute turn deadline, bounded input/output/history context, paged stored history. Application capability execution begins in phase 2. |
| UI | Add `/assistant` to the existing page host and shared navigation. Reuse the assistant-ui Thread, shared conversation header, draft persistence and localized labels. Retain selection and drafts through ordinary navigation. |

### Capability-to-domain mapping

| Capability | Existing implementation and later extraction |
| --- | --- |
| Context and resource reads | `internal/overview/state.go`, store project/requirement queries and session catalog. Add bounded read adapters in phase 2. |
| Project registration | `internal/project/projects.go` validates repositories inside HTTP handlers. Extract its domain operation in phase 3 while keeping manual callers. |
| Workspace creation | `internal/task/requirements.go` handles validation, metadata and preparation. Extract the smallest shared operation in phase 3. |
| Project membership | `internal/task/requirement_projects.go` and `member_selection.go` retain all four modes, locks and partial preparation semantics. |
| Git/worktrees | Existing project Git actions and execution-side workspace helpers provide locks and canonical paths. |
| Conversation navigation | Existing environment/session identity and page bridge remain the native coding-session path. Add validated resource actions in phase 2. |

Provider and credential choices are resolved for phase 1. Global history lives in the primary local database and uses the local CLI. Future cross-environment reads carry explicit environment identities. Phase 3 will finalize immutable approvals, mutation schemas and execution journals before enabling writes.

## Phase 2 — Add read capabilities and resource navigation

Depends on phase 1 conversation identity, provider adapter, and registry contracts.

- [ ] Implement registry discovery, JSON Schema validation, structured results, and backend-enforced capability permissions.
- [ ] Expose context, project/workspace queries, Git/worktree summaries, conversation discovery, and validated navigation.
- [ ] Bound and page query results, expose timestamps, and retain successful environment results when another environment is unavailable.
- [ ] Add application-owned resource cards and choice controls using the current UI bridge, routing, localization, and keyboard conventions.
- [ ] Reject model-supplied target identities that fail resource/environment validation. Keep external text as data throughout the tool loop.

Exit evidence includes finding workspaces/projects, disambiguating repeated names, opening an existing conversation in its owning environment, and showing partial query failures. Trace acceptance to AC-02, AC-03, AC-12, and AC-13.

## Phase 3 — Deliver reviewed writes and the workspace creation workflow

Depends on phases 1–2 and durable approval, idempotency, and journal contracts. Ship approval and recovery alongside the write capabilities.

- [ ] Implement immutable plan revisions, canonical parameter binding, approval/cancellation, and precondition revalidation before writes.
- [ ] Extract shared project registration and workspace creation/member-addition operations where handlers currently contain the business logic. Preserve manual UI and legacy API behavior.
- [ ] Implement `project.register`, `workspace.create`, and `workspace.attachProject` with all four member modes, current validation limits, and result-state inspection.
- [ ] Bind durable mutation request identities to payload digests and reuse confirmed results across retries and concurrent callers.
- [ ] Journal execution intent and actual side effects, publish step progress, and reconcile uncertain outcomes before replay. Preserve the existing domain lock and cleanup coordination.
- [ ] Handle partial preparation, context-generation warnings, cancellation during active work, UI reconnection, and backend restart.
- [ ] Provide structured plan, progress, resource, and recovery views with useful domain errors and correctly routed links.

Exit evidence includes one approved request creating a workspace across two projects, a cancelled plan, a stale-plan conflict, all four directory modes, a failed second worktree, repeated request delivery, and restart reconciliation. Trace acceptance to AC-04 through AC-14.

The representative scenario is “Create a workspace for the payment module using the frontend and backend projects.” The assistant resolves projects, presents actual branch/path choices, receives one plan approval, prepares the existing requirement/member model, and opens the saved workspace. Record resources from domain results at each step.

## Phase 4 — Add explicitly requested coding-session handoff

Depends on the accepted phase 3 workflow and a usable prepared directory.

- [ ] Add supported executor discovery and the native Codex session-creation adapter, preserving existing creation receipts and directory validation.
- [ ] Include executor, model/permission settings, main directory, additional roots, and first instruction in the reviewed plan when session creation is requested.
- [ ] Start the session only when its approved prerequisite resources are ready. Reuse its durable creation identity when the result is known and reconcile uncertain creation outcomes.
- [ ] Open the resulting native conversation with its existing environment/session identity, runtime controls, and workspace reference behavior.
- [ ] Consider workspace metadata updates and standalone worktree creation as small follow-up increments using the same registry and policy mechanisms.

Exit evidence includes the explicit “prepare both projects and start Codex” scenario and a retried or interrupted session creation. Trace acceptance to AC-15 and the relevant recovery cases. Additional execution-agent adapters and an external MCP surface can be planned after this handoff has been verified.

## Verification strategy

Use temporary repositories, separate data/workspace directories, and deterministic provider fixtures. Add focused coverage for the new approval, request identity, partial-failure, migration, and environment-routing behavior. Exercise each feature through its normal UI and authenticated HTTP entry points. Record the exact commands, results, platform, source revision, and acceptance IDs in each implementation PR.

### Documentation handoff checks

- Verify the new paths were absent in the base tree and the final diff contains only the two added documents.
- Validate relative Markdown links, repository path references, required sections, and agreement between scope, phases, and acceptance criteria.
- Check formatting with `git diff --check` and compare the committed tree against its parent.
- Record remote branch, commit, and PR identities after publication.

### Implementation checks

Run relevant focused package and frontend tests during each phase. Before the implementation is considered complete, run the core checks documented in the repository from its root.

```bash
npm ci
npm run web:check
npm run chat:check
npm run web:build
npm run chat:build
node --test scripts/*.test.cjs
npm run workspace:test
npm run chat:test
go test ./...
go vet ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
npm run desktop:check
go build -o bin/yolu-backend .
node scripts/desktop-workflow-smoke.mjs bin/yolu-backend
go test -race ./internal/store ./internal/task ./internal/project \
  ./internal/session ./internal/terminal ./internal/workspace ./internal/app
```

Build both embedded frontend bundles before invoking Go checks. Include new runtime packages in relevant focused/race coverage if introduced. Desktop-host changes also use the native checks described by the development guide. Verify a real configured provider separately from deterministic fixtures before claiming model interoperability. [Check guidance](../../development.md)

## Progress reporting

Update the phase checkboxes only with implementation evidence. Each phase summary records completed acceptance criteria, changed modules, migration effects, validation results, design deviations, and remaining decisions. Any change to conversation identity, workspace meaning, approval scope, or execution authority should be explained against the specification and existing product direction.

## Phase 1 verification evidence on 2026-11-16

Implementation and checks ran on Linux x86_64 with Go 1.26.11, Node.js 24.22.2 and installed `codex-cli 0.167.1`. Frontend assets were built before the final Go and native checks.

| Check | Result and evidence |
| --- | --- |
| Type checking and embedded bundles | `npm ci`, `npm run web:check`, `npm run chat:check`, `npm run web:build`, `npm run chat:build` and `npm run desktop:prepare` completed successfully. |
| Frontend regression checks | All 23 workspace tests, 124 chat tests and 261 `.test.cjs` checks passed, including assistant send receipts, uncertain-response recovery, isolated drafts, pagination and leaving before draft restoration. The `.test.cjs` coverage includes shared navigation, browser compatibility and retained native conversation panes. |
| Backend checks | `go test ./...` and `go vet ./...` passed. Focused tests cover assistant creation, duplicate/changed requests, concurrent sends, capacity, cancellation/shutdown, escaped-input byte limits, redacted failures, authentication, local ownership and read-only mode. |
| Persistence and compatibility | Store tests cover full paged transcript restoration, interrupted-run recovery, metadata export/import, loading older snapshots and preservation of native session behavior. |
| Race checks | `go test -race ./internal/assistant ./internal/store ./internal/task ./internal/project ./internal/session ./internal/terminal ./internal/workspace ./internal/app` passed. The changed assistant/store/app packages were checked again after final fixes. |
| Vulnerability scan | `go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...` reported zero reachable vulnerabilities. It also reported 13 imported-package and 10 required-module findings without reachable calls. |
| Native build and lifecycle | `npm run desktop:check`, `npm run desktop:test`, `cargo build --manifest-path src-tauri/Cargo.toml` and `desktop-smoke.mjs` against the prepared sidecar and actual `yolu-desktop` host passed. The Rust suite has two launcher tests. |
| Existing workflow | `desktop-workflow-smoke.mjs` passed with temporary repositories, two-project workspace preparation, Git operations, history, archive/restore and cleanup recovery. |
| Real provider | `YOLU_TEST_ASSISTANT_CODEX=1 go test ./internal/assistant -run TestInstalledCodexAssistantProvider -v` passed against the authenticated installed CLI. The UI also sent a real Chinese test request and displayed its requested reply. |
| Actual browser flow | The latest shared UI displayed the assistant as the first rail item. Created two assistant conversations, retained the second draft through project navigation, restarted the backend onto a new port with the same data directory and restored both draft and first transcript. Opened the native conversation page and returned to the assistant with its history retained. Checked the normal 1280×720 viewport and a 390×844 narrow viewport. |
| Configuration failure | A separate isolated backend with a failing CLI fixture displayed the localized recovery message and retained the submitted message in history. |

AC-01 is verified through the actual browser/restart flow. AC-14 is covered by migration, session, existing workflow and shared-navigation checks. Native-window visual interaction remains for manual verification because this session exposes browser control while native computer control is disabled. Native compilation and host/sidecar startup lifecycle were exercised independently.

To experience this branch, run `npm run desktop:dev -- --data /tmp/yolu-assistant-data --root /tmp/yolu-assistant-workspaces` from its worktree, or `bash scripts/run.sh --headless --listen 127.0.0.1:4317 --data /tmp/yolu-assistant-data --root /tmp/yolu-assistant-workspaces`. Open the first navigation item, create a conversation, and send a message. The local user account should already be authenticated with Codex. The development guide includes the restoration walkthrough and opt-in real-provider check.
