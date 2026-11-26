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
