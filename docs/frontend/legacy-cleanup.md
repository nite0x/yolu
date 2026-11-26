# Legacy frontend cleanup

Baseline: `98dbb0af215d5a4d3c286bb720615170bc692853` on
`codex/frontend-overhaul` (draft PR #2). This follow-up uses
`codex/frontend-cleanup`; it does not merge either branch into main.

## Removed implementations

| Owner | Removed code | Reference evidence |
| --- | --- | --- |
| Application bridge | Uncalled `badge`, `branch`, `treeState`, `empty`, `offline` HTML renderers, their imports and historical status maps | No property access, destructured use, dynamic dispatch, HTML or native-host call remains; live components render these states directly |
| Git bridge | Static `git` renderer | The controller exclusively uses `mountGitView`; retain its React root, field preservation, reset and section navigation |
| Reasoning UI | Deprecated index-based `ReasoningGroup` wrapper, its streaming scan and unused compound assignments/re-exports | `thread.aui.tsx` already uses grouped parts and explicit reasoning root/trigger/content/text; `Reasoning` remains the Markdown part renderer |
| Tool grouping | Deprecated index-based `ToolGroup` wrapper and its cast/compound assignments | Thread and product tool activity both compose the live root/trigger/content components |
| Conversation records | Unreferenced `SessionsData` declaration | Repository-wide type and runtime search has no consumer |
| Project styles | Retired project activity block | Current project details display conversations inside working-directory cards |
| Git styles | Old repository-path, master-hint, tracking, credentials, source explanation and banner rules | Current Git markup uses shared fields, checks, feedback and credential disclosure |
| Conversation styles | Old search/picker rows, project selector, empty-creation view, pin/context/icon-setting controls, additional-directory disclosure, unused menu wrappers and detail-page selectors | Checked React, classic scripts, HTML, Go template transformations, native entry points and tests; retain dynamically generated history and Lucide classes |
| File/action styles | Unused split-primary and split-toggle selectors | Current action controls use the actual menu summary and shared button classes |

Whole-file reachability from all frontend build entries, classic controller
entries and tests found no additional unreachable frontend source files. Knip
was used as a candidate finder, followed by repository inspection. An unused
named export can still have live local/compound consumers or be part of the
shared primitive API; those reports are not a deletion list. No runtime or
development dependency changed.

## Terminal regression readiness

The baseline's latest GitHub run failed the desktop-chrome terminal check:
WebSocket output contained `YOLU_OK`, but copying the search selection returned
an empty string. The test searched once before polling the selection. xterm
queues output parsing, so an early miss could remain an empty selection for the
entire poll even after the output was parsed.

The existing test now repeats the real Enter/search action during polling.
It still requires copying the exact marker from xterm before and after
reconnect, retains real PTY execution and checks resize behavior. No timeout,
assertion or product behavior was relaxed. Local browser and desktop-chrome
terminal flows passed after the change; the full unmodified provider fixture
still needs confirmation in GitHub CI.

## Retained classic adapters

| Location | Active responsibility and reason to retain |
| --- | --- |
| `web/core/core.js`, `app.js` | Host context, mutation coordination, routes, project refresh and retained list position; API transport and operations already delegate to checked modules |
| `web/core/page-host.js`, `page-bridge.js` | Shared navigation, retained iframe panes, parent/child handshake, focus, history and native capabilities |
| Other `web/core` scripts | Appearance/input preferences, login/access and resource navigation/icon integration used by live HTML/host paths |
| `web/features/projects` | Project registration/scanning, native directory selection, Git/worktree forms and controller-owned fields/actions |
| `web/features/sessions` | Shared navigator integration, native session/history compatibility, approvals, streaming and creation adapters |
| `web/features/settings/settings.js` | Supplies host context/capabilities to the checked settings owner; it is not a second settings UI |

These are active owners, not abandoned copies. Moving them requires a separate
behavior-preserving migration with explicit host contracts and removal of the
old implementation in the same change. New feature behavior belongs under
`frontend/features`, not in a parallel classic controller. This cleanup does
not claim that all classic JavaScript has been migrated to TypeScript.

## Verification

| Check | Actual result |
| --- | --- |
| API contract drift | Passed |
| Frontend TypeScript, including unused locals/parameters; chat TypeScript | Passed |
| All frontend TS/TSX Biome | Passed; no errors or warnings, 31 existing informational suggestions |
| Architecture rules and regression suite | Passed; 10 tests |
| Shared UI suite | 21 passed |
| Application and conversation suites | 221 passed (50 + 171) |
| Classic controller/contracts suite | 222 passed after the final asset build |
| Bundle-budget regression suite | 3 passed |
| Production frontend and component catalog builds | Passed |
| Go embed build after frontend assets | Passed |
| Catalog Chromium/axe, light/dark at 1280/390 | 1 passed |
| Real PTY/search/copy/reconnect/resize, browser and desktop-chrome | 2 passed with the temporary provider-free fixture |
| Project list/detail, actual file rendering and settings navigation | Passed in both entry points at 1440/760; screenshots inspected |
| Changed CSS parsing and final diff whitespace | Passed |

There are **477 passing unit/controller/architecture/budget tests**, plus the
catalog browser test and two PTY browser tests. The extra project/settings page
walkthroughs are recorded separately, not counted as new committed tests.
One earlier controller run overlapped an asset rebuild and read missing output;
the authoritative 222-test run started after builds finished and passed fully.

Product source changes (excluding generated assets, documentation and tests)
remove 147 lines and add 10, net **-137 lines** across 10 files. Five CSS files
contain **39 fewer rules**; surviving dynamic history/Lucide selectors and live
group composition remain. Critical JavaScript is **767890 gzip bytes**, down
863 from the exact baseline's 768753. Existing budgets pass; no runtime speedup
claim is made.

Logs are under `/tmp/yolu-cleanup-*`; locally inspected screenshots are under
`bin/cleanup-screenshots`. Generated bundles,
temporary audit programs, browser runtime, fixtures and screenshots are not
authored by this cleanup. Build frontend assets before backend/desktop packaging.

The executor cannot bind Unix sockets. Standard `tsx` CLI startup also uses one,
so TypeScript tests run with `node --import tsx --test`, using the same loader
and assertions without the CLI IPC server. Full provider-backed browser tests
cannot use their normal daemon fixture here. Local browser verification uses
the real built Go application with isolated Git/SQLite/HTTP state and an
adapted temporary fixture that omits provider sessions. It covers project
navigation, file rendering, settings and real PTY terminals in browser and
desktop-chrome entry points. It does not establish provider integration coverage.

Native Tauri execution and physical microphone capture remain unverified.
