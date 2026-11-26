# Frontend audit

Baseline: `4e9ff1790708dfae10545a2fabfe89e519350843`. Branch: `codex/frontend-overhaul`.
Both initial uploads were identical; the corrected second upload adds three serial independent review rounds.

## Inventory

| Owner | Source files | Lines |
| --- | ---: | ---: |
| `frontend/api` | 1 | 48 |
| `frontend/app` | 12 | 1043 |
| `frontend/architecture.json` | 1 | 20 |
| `frontend/bundle-budgets.json` | 1 | 10 |
| `frontend/core` | 3 | 176 |
| `frontend/dev` | 2 | 265 |
| `frontend/entities` | 9 | 154 |
| `frontend/entrypoints` | 7 | 101 |
| `frontend/features/conversations` | 72 | 11794 |
| `frontend/features/files` | 7 | 644 |
| `frontend/features/git` | 4 | 161 |
| `frontend/features/projects` | 8 | 709 |
| `frontend/features/settings` | 14 | 2829 |
| `frontend/features/terminal` | 3 | 565 |
| `frontend/shared` | 47 | 4333 |
| `frontend/vite-env.d.ts` | 1 | 1 |

The Go-hosted application loads checked React islands and retained browser controllers from `web/core` and `web/features`. Those controllers are active integrations, not dead code. The standalone marketing website and native host implementation are outside this refactor.

Projects own registration, scanning, directory cards and worktree forms. Git owns overview and operation dialogs. Files own tree/diff reading. Conversations own the shared navigator, messages, assistant presentation, approvals, drafts, streaming, voice and usage. Terminal owns xterm and its page adapter. Settings own preferences, native forms and diagnostics. There is no independent workspace CRUD or task feature: workspace is the application shell, Issues remains an external tracker, and the assistant uses conversation rendering. Do not invent these features.

## Evidence and priorities

| ID | Priority | Evidence | Action |
| --- | --- | --- | --- |
| A01 | P1 | `scripts/frontend-architecture.mjs` only builds a feature-level graph; same-feature and core/shared file cycles are invisible | Check resolved source-file graph and test it |
| A02 | P1 | `biome.json` includes settings and selected runtime/foundation directories, omitting projects, Git, file UI, conversation UI and terminal UI | Expand lint across owned frontend; preserve meaningful checks |
| A03 | P2 | `frontend/shared/ui/page-surface.tsx` is unreachable from all build entries and tests (Knip plus repository search) | Remove unused wrappers/styles; retain live `workspace-pane` contract |
| A04 | P2 | jscpd found 6 clones / 107 duplicated lines across 212 analyzed sources, predominantly two diagnostics renderers | Compose shared diagnostic presentation, retain provider differences |
| A05 | P1 | `features/conversations/list/resize.ts` repeats pointer/keyboard bounds and leaves window listeners beyond owner lifetime | Reuse existing splitter and expose disposal |
| A06 | P1 | File browser `DirectoryTree` retains `data`/`error` on endpoint changes and shares list/preview error state | Resource identity and request ownership regression checks |
| A07 | P2 | `features/conversations/components/assistant-ui/elements/surfaces.tsx` contains unreferenced animation constants/components | Verify imports, build CSS and registry usage before deletion |
| A08 | P1 | Terminal page restores native createElement through a Proxy but disposal does not restore it or remove document/window listeners | Make page resources explicitly owned and disposable |

No P0 verified during initial audit. Further independently verified findings are recorded as implementation proceeds.

## Tool interpretation

Knip was run first with defaults, then with explicit build entries, browser controller entries and tests. The default report incorrectly calls lazy conversation, terminal, file and layout entries unused. CSS imports keep JetBrains Mono, Tailwind and animation packages live. AST types `hast` and `mdast` need direct type dependencies. Do not delete live assets or compatibility contracts based on these reports.

jscpd used a 12-line minimum. Similar provider diagnostics have genuine shared presentation; tool root controllers retain provider-specific APIs and should not be merged solely to eliminate a numerical clone count.

## Baseline verification

- `npm ci`: passed (Node 24.22.3, npm 11.19.1).
- `npm run web:check` and `npm run chat:check`: passed.
- `npm run app:test`: 40 passed; `npm run chat:test`: 167 passed.
- `npm run build`: passed; critical JavaScript 766447 bytes gzip.
- Chromium component catalog with axe, light/dark and 1280/390 widths: passed.
- Initial `npm run check` could not use `/usr/bin/go` (a different program). Downloaded SHA-256-verified Go 1.26.11 into `/tmp/yolu-toolchain`; API contract check then passed. No repository/backend files changed.
- Baseline legacy suite: 221 passed; real Go-hosted application Chromium suite: 6 passed across browser and desktop-chrome entries. Screenshots are under `/tmp/yolu-baseline-screenshots`.
