# Frontend refactoring progress

## Current state

- Original baseline: `4e9ff1790708dfae10545a2fabfe89e519350843`.
- Branch: `codex/frontend-overhaul`; no pre-existing user edits (uploaded task files excluded).
- Phase: initial audit complete; safe cleanup and implementation beginning.
- Post-refactor review rounds: not started. Must execute all three serially.
- Initial read-only agents: `audit_state` (data/state/lifecycle); `audit_components` (components/styles/modules). These are not post-refactor review rounds.

## Decisions

Keep actual `frontend/{app,features,entities,core,api,shared}` organization and live browser adapters. No Go or Tauri native business changes. Reuse mature UI controls and splitter. Do not create workspace/task features absent from this product.

## Validation

See [audit](audit.md) for established baseline. Logs are temporary `/tmp/yolu-baseline-*.log` files. Node checks, build, app/chat tests and component Chromium baseline passed; legacy tests and Go application browser baseline pending. Verified Go 1.26.11 is installed outside the repository; prefix commands with `PATH=/tmp/yolu-toolchain/go/bin:$PATH`. Chromium is `/usr/bin/chromium`.

## Next

Finish initial independent findings, remove confirmed dead code, consolidate shared presentation, resolve resource/state issues and strengthen automated boundaries. Then full validation, three serial review/fix/verify/commit rounds and final gates.

## Safe cleanup

- Baseline commit: `83fa728`.
- Removed unreachable `page-surface.tsx` and its unused split CSS; updated documentation to the actual shell and `workspace-pane` owners.
- Removed unused `ProjectOpenActions` (live directory card implementation retained) and unused registry surface constants/components; four media-player roles remain.
- Declared direct `@types/hast` and `@types/mdast` development dependencies for imported AST contracts. No runtime dependency removed: CSS/build references prove reported candidates live.
- Strict TypeScript passed after cleanup. Baseline legacy suite: 221 passed. Go contract check passed; real baseline binary built without backend edits.

## Implementation integration

- Cleanup commit: `4725ce2`.
- Independent owners: audit_components (diagnostics consolidation, project semantics, dead shell branch); audit_state (terminal connection/disposal + shared guards); files_refactor (file resource/errors/theme + 6 regressions); lint_list (list/creation semantics); lint_conversations (conversation UI/voice lint and malformed event regression).
- Shared diagnostics are feature-local; no extra library or global store. Twenty SSR states matched baseline exactly.
- File browser owns errors per operation and remounts on actual resource identity while preserving reading across late project metadata. Renderer follows appearance; splitter rejects invalid saved sizes.
- Conversation list reuses shared splitter with explicit teardown. Removed unreachable project-resizer branch and styles.
- Draft decode rejects malformed reading state and ignores damaged image records. Disposal cannot schedule retry/restore callbacks. Cloud draft restore retains capability restrictions. Explicit freshness reads bypass shared retention; quota uses shared API errors/transport.
- Source graph check now detects all file cycles; eliminated original settings/messages type cycle. Full frontend TS/TSX Biome enabled without globally disabling recommended rules; actual accessibility/correctness fixes plus explained local analyzer exceptions.
- Current validation: `npm run check` passed; app 50 passed; UI 20 passed; focused data/splitter 12 passed. Full rebuilt application browser and 221 legacy regressions running. Three review rounds still not started.

## Review round 1

- Baseline: `eb901ad`; fresh read-only `review_round1` covered original-to-current diff, all six features, host adapters, module/source graph, components/styles, state/persistence/resources and engineering rules.
- Confirmed P0/P1/P2: 0; no manufactured code change. Independent web:check (architecture10/UI20/lint/type), app50 and chat168/chat types passed.
- Integration completed: legacy221, real app Chromium6, catalog Chromium/axe1, production build and Go embed build passed. Extra actual PTY shell/output/reconnect/resize exercise passed for browser and desktop chrome.
- Round 1 report and ledger recorded; next: start round 2 only after this round's commit.
- Test harness correction: an earlier parallel build removed generated assets during legacy test startup; reran all 221 after build and passed. Initial drag-order test depended on backend enumeration; seeded its saved starting order without changing movement/persistence assertions; all 6 browser tests passed.

## Review round 2

- Round 1 commit: `e60c004`; round-2 baseline: `e60c004`. Fresh read-only `review_round2` inspected source/diff across all features and ran independent app50/chat168/UI20/chat types plus real file/Git/worktree and terminal exercises.
- Root's additional classic-controller scan found R2-001 P2: eight unused lexical aliases/functions. Independent reference/dynamic/native checks confirmed it; root removed only those declarations (18 lines), preserving public adapter contracts.
- Independently closed R2-001 after syntax/diff checks, history/chat22, adapter15 and rebuilt-binary resources/terminal Chromium4 passed. Confirmed/fixed/independently closed1/1/1. Product behavior defects0; open P0/P1=0.
- Retained actual resources and terminal browser exercises with real renderer/PTY assertions; strengthened terminal tests based on reviewer advice and registered fixture cleanup immediately.
- Native execution unavailable: no Cargo/Rust compiler and missing GTK/WebKit pkg-config dependencies. Use real browser + desktop-chrome simulations; do not claim native Tauri or physical microphone verification.
- Next: commit round2, then fresh final independent round3 and final quality gates.
