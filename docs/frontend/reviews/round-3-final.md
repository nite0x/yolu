# Round 3: independent full quality review

Baseline: `1adb140`, after round 2 closed. Reviewer: fresh read-only `review_round3`; root implemented fixes and coordinated verification. Original baseline: `4e9ff17`. Round-2 commit: `1adb140`.

## Coverage

Re-read original-to-current diff and actual owners across all six features, retained host adapters, component/style/deletion contracts, source/type cycles, request identity/cache/errors, draft decode/restore/disposal/cloud capabilities, file cancellation/theme lifetime, terminal attempt/output-drain/socket teardown, multi-pane integration, tests, conventions and AGENTS accuracy. Rechecked the eight R2 removals. Inspected full TS/TSX Biome scope and explained exceptions; classic scripts remain explicitly audited in their shared-global HTML context.

Independent architecture 10, graph 187 sources/6 features, draft/splitter/transport 12, modified JS syntax and diff checks passed. Root's pre-fix integration gate passed app50/chat168/UI20/legacy221/browser10/catalog1, then the stronger renderer test exposed the actual theme defect below. Those earlier green checks were not treated as sufficient final proof. Final full gates run after this round's commit.

## Findings

### R3-001 — stale progress summary (P2)

- Module/location: governance, `docs/frontend/progress.md:7,8,17,21`; associated baseline status in `audit.md`.
- Evidence/cause/impact: appended completion records coexisted with an initial-audit/reviews-not-started header and pending baseline tests, misleading task resumption.
- Reproduction: compare the header and Next against committed R1/R2 records.
- Fix: reconciled current phase, baseline results, review commits and actual remaining gates. Historical checkpoints are explicitly historical.
- Validation: reviewer independently re-read the corrected summary and next steps. **Closed**.

### R3-002 — renderer tests accepted fallback (P2)

- Module/location: browser regression, `scripts/browser/resources.test.mjs:26-38` at review baseline.
- Evidence: reviewer aborted `/ui/files/file-display.js` in an in-memory variant; both original browser/desktop-chrome tests still passed because plain-text fallback contained the same strings.
- Cause/impact: text-only assertions could not detect missing renderer, unchanged Diff mode or ineffective theme updates.
- Fix: require an actual `diffs-container`, populated shadow `pre`, split-to-single renderer attributes (Pierre calls unified mode `single`) and effective computed light/dark color scheme, while retaining content assertions.
- Validation: real strengthened tests pass2; intentionally blocked viewer now fails2 at renderer count1 vs0. Reviewer independently executed both variants. **Closed**.

### R3-003 — live viewer stayed light (P2)

- Module/location: files, `frontend/features/files/runtime/viewer.ts:90` at review baseline (theme observer).
- Evidence: strengthened browser and desktop-chrome tests failed computed color-scheme: expected `dark`, actual `light`. Pierre's `setThemeType` changes its style node without invoking `onPostRender`; the CSP-compatible adopted stylesheet retained old text.
- Cause/impact: incomplete style synchronization produced a visible theme mismatch in an open file/Diff reader. P2 reflects a visual defect without blocked workflow/data loss; it was fully fixed, not deferred.
- Fix: track rendered nodes through the existing callback and resynchronize their existing adopted sheets after theme updates. Clear ownership on fallback/disposal; retain renderer objects, selected lines and reading position. No CSP relaxation.
- Validation: root and reviewer normal real-browser tests pass2 with effective light-to-dark assertions; types/lint/UI/build passed. Reviewer inspected lifetime/no-remount behavior. **Closed**.

### R3-004 — fixture snapshot read/write race (P2)

- Module/location: frontend test infrastructure, `scripts/fixtures/desktop-codex.cjs:43,52,81,121`, `scripts/fixtures/browser-app.mjs:68` at review baseline.
- Evidence: a real desktop-chrome regression intermittently failed startup with `Unexpected end of JSON input`. Protocol snapshot writers truncated the live file while daemon CLI readers parsed the same pathname. The post-start assistantLink writer also used the live path.
- Cause/impact: partial JSON publication made otherwise valid UI regression runs nondeterministic; product/backend data was not involved.
- Fix: one shared fixture writer publishes unique same-directory temporary files via atomic rename and cleans temporary files. All four live writers use it; pre-launch initial setup remains direct. No retries, skips or relaxed assertions.
- Validation: new deterministic test forces a concurrent read between writer truncation and byte output. Original writer fails1 with empty JSON; current writer passes1, preserving unrelated RPC log writes. Reviewer independently reran both, checked all writer callers and syntax/diff checks, and reviewed resource-repeat2 passes. **Closed**.

Confirmed/fixed/independently closed: **4/4/4**, all P2; P0/P1: **0/0**. No open finding or product defect remains. Commit: round-3 commit containing these fixes; exact SHA appears in the final report/progress and Git history.

Rejected candidate: Pierre's DOM names unified layout `single`; expecting the literal `unified` attribute was a test-author assumption, not a product defect. It was corrected before classifying R3-003.

Native Tauri and physical microphone execution remain unverified. Final quality gates and source/worktree/remote checks are recorded in the final report.
