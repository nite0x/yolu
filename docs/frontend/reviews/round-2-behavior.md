# Round 2: behavior and regression

Baseline: `e60c004` (after round 1). Fresh independent reviewer: `review_round2`; root coordinated verification and the only product-source cleanup. Round 1 closed in `e60c004`.

## Coverage

Reviewed the complete original-to-current source diff and existing behavior owners across conversations/assistant, projects/worktrees, Git, files, settings, terminal and voice. Challenged file resource remounts and late metadata, per-operation errors, theme observer disposal, splitter persistence/teardown, terminal connection/output-drain identity, draft restore/write ordering, cloud capability restrictions and malformed voice events. Inspected retained page adapters and native/browser integration paths.

Independent app 50, chat 168, UI 20 and chat TypeScript checks passed. A real application browser exercise passed in browser and desktop-chrome entries: Pierre file/patch/unified rendering, dark appearance, file expand/restore at 1440/760, Git directory selection and actual worktree creation. The script was retained as `scripts/browser/resources.test.mjs`.

Retained terminal tests verify real PTY input/output before and after reconnect, search-selected/copied xterm display contents (not merely websocket receipt), and outbound column resizing between 1440/760. Independent durable terminal tests: 2 passed. Reviewer advice improved test validity and immediate fixture cleanup; it was not mislabeled a product defect.

## R2-001 — unused classic-controller helpers

- Round/module/priority: 2; retained page adapters; **P2**.
- Baseline locations: `web/core/core.js:2,18,19,47,51`; `web/features/settings/settings.js:28`; `web/features/sessions/session-history.js:35`; `web/features/sessions/conversations.js:283`.
- Evidence: whole-document classic-script audit identified eight unreferenced declarations. Root and reviewer independently searched identifiers, call syntax, string/dynamic references, HTML script loading and native eval paths. The `historyText` fixture property is itself unused; similarly named settings TS bindings are local owners.
- Cause/impact: old lexical aliases survived presentation/controller migrations, adding misleading duplicate entrypoints. No runtime failure was observed.
- Reproduction: repository searches for `desktopListWidth`, `historyText`, `enqueueSettingsSave`, `conversationFilteredDirectories`, and calls to `badge`, `branch`, `empty`, `treeState`, followed by checking actual shared adapter references and host loading.
- Fix: removed exactly eight declarations / 18 lines across four files. Kept real `WorkHubUI` APIs, `WorkHubListWidth`, settings queue ownership, and meaningful classic-script strict directives.
- Verification: independent syntax/diff checks, history/chat 22 tests, root adapter/settings/navigation 15 tests, and independent rebuilt-binary resources/terminal Chromium 4 tests all passed. Logs: `/tmp/yolu-r2-closure-history.log`, `/tmp/yolu-r2-closure-browser.log`, `/tmp/yolu-round2-adapters.log`.
- Independent disposition: `review_round2` confirmed exact removals and closed the finding after rerunning tests. Commit: the round-2 commit containing this report; exact SHA is recorded by the following progress/review record.
- Status: **closed**. Confirmed/fixed/independently closed: **1/1/1**; P0/P1: **0/0**. No unresolved product finding.

Whole-document lint was interpreted in the actual classic-script loading context: repeated global declarations and required strict directives are not obsolete modules. No global Lint rules were disabled to silence these diagnostics. The persistent pipeline checks all frontend TS/TSX; classic adapters additionally receive syntax, integration and source-reference checks.

Native Tauri execution and physical microphone capture remain unverified. Desktop-chrome is host simulation.
