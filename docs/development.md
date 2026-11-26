# Development and packaging

Run Git, build and test commands from the repository root. See the [user guide](guide.md) for day-to-day operation and the [release checklist](open-source-release.md) before publishing artifacts.

## Prerequisites

- Node.js 22.12 or later and npm. Use `npm ci` with the committed lockfile.
- Go satisfying `go.mod` (currently a minimum of 1.26.11). Core checks and desktop packaging read their Go version directly from this file.
- Rust and the [Tauri platform dependencies](https://v2.tauri.app/start/prerequisites/) for desktop work. CI uses Rust 1.95.0.
- Git. Real conversation checks also require a separately installed and authenticated Codex CLI in the target environment.

Use the CI toolchain versions when reproducing release builds. Native installers must be built on their corresponding operating system. Pure Go backend compilation does not require a C compiler, but Tauri and its platform dependencies have native build requirements.

With the default `GOTOOLCHAIN=auto` setting, an older Go installation downloads and selects the required toolchain. If automatic switching is disabled, install a compatible version before building. Updating the `go` directive also updates the CI build version; keep it on a release with current security fixes.

## Run from source

```bash
npm ci
npm run desktop:dev
```

Use isolated paths for development against unfamiliar changes:

```bash
npm run desktop:dev -- --data /path/to/test-data --root /path/to/test-worktrees
```

The desktop command prepares the frontend and Go sidecar, then launches Tauri. It does not use a separate Vite development server for the application UI: Go serves embedded assets. After changing Go or embedded web files, quit and stop the backend, rebuild and reopen. A content-derived backend identity prevents silently reusing a mismatched desktop backend.

### Browser and backend mode

On Linux or macOS:

```bash
bash scripts/run.sh --headless --listen 127.0.0.1:4317 \
  --data /path/to/test-data --root /path/to/test-worktrees
```

Open `http://127.0.0.1:4317`. The script builds both frontend bundles before building and running `bin/yolu`. An installed or separately built Go binary can use the same flags. The primary `--listen` address accepts loopback addresses. Enable the separate LAN listener through **Settings → Browser access**. It defaults to port `4318` and serves the same embedded UI, API and terminal streams after pairing.

The desktop DEB and AppImage packages include browser access through their existing Go sidecar. The desktop handshake continues to discover the primary loopback endpoint. Browser access configuration is saved atomically to `browser-access.json` in the application data directory with owner-only file permissions, independently of environment metadata exports. Startup restores an enabled listener. A port conflict leaves the desktop endpoint available and appears in Settings for correction.

The LAN listener binds IPv4 interfaces and accepts the host's assigned IPv4 addresses and loopback names on the configured port. Every application request, including terminal WebSockets, requires a signed browser-session cookie issued by pairing. API requests retain CSRF and same-origin checks. Browser sessions expire after 24 hours and are invalidated by backend restart, code rotation or listener configuration changes. Disabling the listener also closes hijacked WebSockets. Pairing settings, native directory dialogs and backend lifecycle controls are managed through the primary local endpoint.

HTTP LAN pages load `core/browser-compat.js` before their application bundles. It supplies UUID generation using `crypto.getRandomValues` when the secure-context-only `crypto.randomUUID` API is unavailable.

Browser and desktop entry points enable the same application layout in the HTML before styles and controllers load. The retained `data-workhub-desktop` attribute selects the shared navigation and pane layout. Native integration is initialized separately by Tauri through `data-workhub-platform` and its bridge. Browser pages reserve no native title-bar space.

Shared UI changes apply to both entry points by default, including project, conversation and settings pages. Reuse the same components, styles, design tokens and interaction logic. Scope host-specific rendering to native integrations such as title bars, window controls, application menus and operating-system dialogs, using the corresponding host capability. Apply responsive behavior consistently across both entry points and verify affected pages and navigation at comparable viewport sizes. See [the repository instructions](../AGENTS.md#shared-desktop-and-browser-ui).

Interactive Codex conversations are enabled by default. `--read-only-sessions` selects history-only mode for the Go entry point; `--interactive-sessions` is a retained compatibility flag. These Go flags are not desktop-host flags: the Tauri host accepts `--data`, `--root`, `--stop` and `--backend-info`.

The browser-mode process runs in the foreground. Stop the test process and use its isolated data directory when changing modes. A desktop backend can be stopped through its host or the authenticated `--stop --data /path/to/data` entry point.


## Repository structure

| Location | Responsibility |
| --- | --- |
| `main.go`, `internal/app/` | Entry point, service composition, routing, environments and process lifecycle |
| `internal/project/` | Repository registration, Git operations, worktree status and cleanup |
| `internal/session/` | Provider-neutral conversation commands, directory intent, history projection, live chat, approvals, drafts and titles |
| `internal/terminal/` | Managed embedded terminal processes |
| `internal/execution/` | Environment execution, files, Git transport, locks and WSL helper |
| `internal/store/`, `internal/model/` | SQLite migrations, metadata import/export and shared models |
| `internal/codex/`, `internal/acp/`, `internal/codexcloud/` | Provider protocol clients and lifecycle operations |
| `internal/overview/` | Read-only composition of project and terminal status |
| `internal/platform/`, `internal/httpx/` | Platform integration and shared HTTP/security helpers |
| `frontend/entrypoints/`, `frontend/app/` | Build entries, explicit startup, application shell and feature adapter composition |
| `frontend/features/` | Conversation, file, Git, project, settings and terminal modules |
| `frontend/entities/` | Shared repository/conversation data, identity context and domain presentation |
| `frontend/core/`, `frontend/api/` | Transport, pane protocol and generated API contracts |
| `frontend/shared/` | Generic controls, hooks, localization, utilities and theme tokens |
| `web/` | Embedded HTML, controllers, styles and generated UI/chat bundles |
| `desktop/`, `src-tauri/` | Startup page, Rust host and native bundle configuration |
| `scripts/`, `.github/workflows/` | Build, packaging, verification and CI entry points |

The application composes project, session, terminal and execution services. Each execution environment has its own SQLite store, path resolution and lock coordination. Sessions bind to actual directories through `session_project_bindings`. Git remains the worktree inventory.

The [frontend module guide](../frontend/README.md) defines the source tree and dependency rules enforced by `npm run web:architecture`. Entry files call explicit startup functions. Features own their rendering adapters; `frontend/app/bridge/workspace-ui.tsx` composes the browser contract.

Most product components render through `renderToStaticMarkup` and `window.WorkHubUI`. Page controllers manage navigation, data, polling and dialogs. The interactive chat UI mounts through its React bridge. The page host retains one shared application document and up to three independent same-origin conversation panes. Conversation history and drafts retain their own identities across view changes.

The conversation page controller delegates resource appearance to `frontend/shared/lib/resource-icons.ts` and list mechanics to `frontend/features/conversations/list/list.ts`. Appearance is environment-specific. The list module owns the bounded scroll window, keyboard positioning and DOM row reuse. `frontend/features/conversations/list/state.ts` owns scope preferences, environment caches, request generations and partial-result publication.

The chat controller delegates debounced, ordered draft persistence to `frontend/features/conversations/runtime/draft-persistence.ts` and saved-history pagination to `history-loader.ts`. The history loader receives connection and live-output revisions so delayed pages cannot replace a newer turn or title. Shared controller contracts live in `frontend/features/conversations/runtime/contracts.ts`; type-only dependencies do not load the controller runtime.

The page bridge, environment controls and legacy history controls access shared conversation state through `window.WorkHubConversations`. They must not depend on page-local variables for the selected view or page mode.

Git HTTP handlers decode requests and translate errors. `internal/project/git_actions.go` coordinates repository serialization and cache invalidation. Branch switching and worktree removal reserve the directory against new agent or terminal starts. Removal revalidates the worktree and its saved bindings before asking Git to remove it.

Agent defaults live under `conversation_defaults:v1` in the selected environment and are exposed through `GET` and `PUT /api/settings/conversation-defaults`. The composer keeps explicit draft settings separately. Managed Codex calls require an acknowledged directory profile before the first turn or a resumed turn. See [session architecture](session-architecture.md).

## Build and check

Build the complete embedded frontend before invoking Go directly. The canonical module boundaries are documented in [Application boundaries](architecture.md):

```bash
npm run check
npm run build
node --test scripts/*.test.cjs
npm run app:test
npm run chat:test
go test ./...
go vet ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...
npm run desktop:check
```

The shared request client and pane protocol live in `frontend/core`. `web:check`
checks their types and enforces the module boundaries in `frontend/architecture.json`. Generate transport types with `npm run api:generate` after editing
`internal/apitypes`; CI rejects drift with `api:check`. The complete production
build writes sizes and content hashes to `web/ui/build-manifest.json`.

The complete build checks `frontend/bundle-budgets.json` against that manifest.
`npm run bundle:check` repeats the asset and aggregate critical-JavaScript checks;
`npm run bundle:test` checks missing assets, invalid sizes and threshold failures.
The critical sum covers workspace, conversation and host-layout scripts across
their independent entry points, rather than claiming they all transfer on the
first page. Adjust a budget deliberately with measured output and a reason.
Mermaid keeps `/chat/mermaid.js` as its stable lazy entry and loads graph modules
from `/chat/diagrams/` only when needed. Its entry size excludes those later
requests. Browser regression tests render a graph under the real application CSP.

Biome checks the shared foundations, application shell, transport, handwritten
feature models/runtimes and the settings feature. Existing app/model/runtime
formatting is retained to keep functional changes reviewable; migrated settings
and new foundation modules use the common formatter. Generated API contracts and
registry sources retain their upstream formatting. The control-character regex
exception is limited to terminal-text/path sanitizers; chrome's non-form groups
and interactive splitter keep their ARIA roles instead of form fieldsets or a
decorative horizontal rule.

`npm run web:test` combines application type checking, the web build, application tests and the `.test.cjs` suite; it does not replace the separate chat build/check/test commands. `npm run web:watch` rebuilds application assets while editing; restart the Go process to update embedded resources.

Core CI and each native desktop packaging job run the pinned `govulncheck` command against the selected Go toolchain and the current vulnerability database. Reachable findings fail the job; module/package findings without a reachable call are still reported for review. Run the scan after building the embedded frontend assets.

Core CI also runs the isolated conversation workflow and race checks:

```bash
go build -o bin/yolu-backend .
node scripts/desktop-workflow-smoke.mjs bin/yolu-backend
go test -race ./internal/acp ./internal/codex ./internal/store ./internal/project \
  ./internal/session ./internal/terminal ./internal/execution ./internal/app
```

These checks use temporary repositories, local Git remotes, separate data directories and a deterministic Codex fixture. They do not establish that real model requests work. The exact Linux/macOS core matrix is in [.github/workflows/checks.yml](../.github/workflows/checks.yml).

### Real browser regression checks

```bash
npx playwright install --with-deps chromium
npm run build
go build -o bin/yolu-browser-backend .
YOLU_TEST_BINARY="$PWD/bin/yolu-browser-backend" npm run browser:test
```

These Linux/macOS tests start an isolated backend with temporary Git repositories,
SQLite data and the deterministic Codex daemon fixture. They exercise draft
retention, split panes, navigation, offline editing, approval recovery and narrow
layouts in Chromium. They do not send model requests. To use an existing Chromium
installation, set `YOLU_BROWSER_EXECUTABLE` to its absolute path. Native title-bar
commands and platform webview differences still require desktop verification.

### Desktop lifecycle checks

```bash
npm run desktop:prepare
npm run desktop:test
```

Preparation builds the Go sidecar and dependency notices. `desktop:test` prepares again before running the Rust tests. Before invoking Cargo directly, prepare the matching sidecar first.

A Linux x64 lifecycle example after preparing/building the corresponding artifacts:

```bash
node scripts/desktop-smoke.mjs \
  src-tauri/binaries/yolu-backend-x86_64-unknown-linux-gnu \
  src-tauri/target/debug/yolu
```

Use the actual host path if building into a target-specific directory. Adapt the binary suffix and target triple for other platforms. The smoke checks cover backend startup, authentication, reuse, path conflicts, safe shutdown and retained data. `desktop-workflow-smoke.mjs` can retain its isolated sample with `--keep`; stop that backend when inspection is complete.

The opt-in installed-CLI compatibility check is read-only and does not create a model conversation:

```bash
WORKTREE_HUB_TEST_INSTALLED_CODEX=1 go test ./internal/session \
  -run '^TestInstalledCodexSessionProtocol$' -v
```

## Native installers

| Platform | Rust target | Exported formats |
| --- | --- | --- |
| macOS Apple Silicon | `aarch64-apple-darwin` | DMG |
| macOS Intel | `x86_64-apple-darwin` | DMG |
| Windows x64 | `x86_64-pc-windows-msvc` | NSIS `-setup.exe` |
| Linux x64 | `x86_64-unknown-linux-gnu` | DEB and AppImage |

The packaging script does not provide Universal macOS, Windows ARM64, Linux ARM64 or RPM packages. Install the appropriate Rust target before selecting another architecture on the same operating system.

```bash
npm run desktop:check
npm run desktop:package -- --dry-run
npm run desktop:package
# Same-platform target selection, for example on macOS:
npm run desktop:package -- --target x86_64-apple-darwin
# Separate, unsigned local test artifacts:
npm run desktop:package -- --debug
```

`npm run desktop:build` invokes Tauri directly; `desktop:package` additionally collects and names release files, exports documents and generates checksums/source metadata. Do not set `CARGO_TARGET_DIR` when using `desktop:package`, which expects `src-tauri/target`.

The version in `package.json` is authoritative. Tauri reads it directly; `src-tauri/Cargo.toml` must match. Commit the corresponding `Cargo.lock` update when changing a version. The backend identity combines the application version with a source fingerprint.

Output is collected under `dist/desktop/<version>/<target>/release/`, or `debug/` for debug packages. It includes installers, the English README, `GUIDE.md`, `DEVELOPMENT.md`, `MIGRATION.md`, `yolu.png`, `LICENSE`, `THIRD-PARTY-NOTICES.txt`, `release.json` and `SHA256SUMS`. Exported documentation links are rewritten to exported files or the source commit. The installer also carries project and third-party license texts.

Actions uploads Linux DEB and AppImage as separate downloads, named `yolu-x86_64-unknown-linux-gnu-deb` and `yolu-x86_64-unknown-linux-gnu-appimage`. Each includes the shared documents and its own `release.json` and `SHA256SUMS`, covering only that download's files.

Windows releases additionally include `Upgrade.cmd`, `Upgrade-Yolu.ps1` and `yolu-upgrade.exe`. The upgrade script verifies the complete release, safely stops the default backend, backs up application data and installed files, verifies database backup hashes, then installs. It does not relocate repositories, worktrees or Codex history.

### macOS preview isolation

```bash
npm run desktop:package -- --preview
```

Preview packages are macOS-only and use `Yolu Preview` with application ID `dev.work-hub.desktop.preview`. Output uses `release-preview/` or `debug-preview/`. Finder launches use independent `data/` and `workspaces/` under `~/Library/Application Support/dev.work-hub.desktop.preview/`.

Keep the preview separate from `/Applications/Yolu.app`. Preview `--stop` and `--backend-info` commands require an explicit `--data` so a diagnostic cannot accidentally operate on the normal backend.

## Signing and publication

Local packaging permits test artifacts without publisher credentials by default. On macOS, `desktop:package` removes empty Apple credential variables and uses ad-hoc signing (`-`) when no signing identity is configured. These builds are not notarized and may require approval in macOS Privacy & Security settings. For a production macOS or Windows package:

```bash
npm run desktop:package -- --require-signing
```

This rejects missing signing credentials, a dirty/untracked source tree and `--debug`, and checks the working tree again after compilation. Commit reviewed source before building a signed release.

| Platform | Local configuration | Additional CI secrets |
| --- | --- | --- |
| macOS | Developer ID certificate in the keychain; `APPLE_SIGNING_IDENTITY`; notarization via `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, or `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH` | `APPLE_CERTIFICATE` (base64 P12), `APPLE_CERTIFICATE_PASSWORD`, signing identity and the Apple ID notarization secrets used by the workflow |
| Windows | Code-signing certificate in the current user's certificate store; `YOLU_WINDOWS_CERTIFICATE_THUMBPRINT` | `WINDOWS_CERTIFICATE` (base64 PFX), `WINDOWS_CERTIFICATE_PASSWORD`; the workflow imports the certificate and supplies its thumbprint |

The old Windows thumbprint variable `WORK_HUB_WINDOWS_CERTIFICATE_THUMBPRINT` remains a fallback. Windows signing uses SHA-256 and a timestamp. Hardware tokens or external signing services need separate `signCommand` configuration; the current workflow does not configure them. Never commit certificates, private keys or signing passwords.

See Tauri's [macOS signing](https://v2.tauri.app/distribute/sign/macos/) and [Windows signing](https://v2.tauri.app/distribute/sign/windows/) documentation for platform setup. An unsigned or ad-hoc local build does not demonstrate notarization or publisher verification. Linux packages have checksums; `--require-signing` is not a Linux packaging mode.

[.github/workflows/desktop.yml](../.github/workflows/desktop.yml) runs manually or on `desktop-v<version>` tags. Manual runs default to Windows x64 and can select all four configured targets. Tag builds target all platforms, require macOS/Windows signing and must match the version in `package.json`. Manual runs permit unsigned test artifacts by default. Rust dependencies and build outputs are cached by platform, toolchain and lockfile. Launcher tests use the same Release target and features as packaging.

The full Web/Chat suite runs in Core checks for branch commits. Manual packaging runs type checks, packaging contracts, the Go vulnerability scan, backend upgrade safety tests, Rust launcher tests and native lifecycle/installer checks. Tag builds also repeat the full Web/Chat suite on the native runners. Successful jobs upload Actions artifacts. GitHub Releases are published separately.

Use the [release checklist](open-source-release.md) to record the actual target commit, artifacts, signing status and native results before publication. Yolu has no automatic update server or in-app updater.

## Legacy Windows Go host

`scripts/build-desktop.sh` and `scripts/install-desktop.ps1` are retained compatibility tools for the earlier Go/WebView2 host. They are not the current Tauri release pipeline. The script builds `bin/windows-amd64/Yolu.exe`, its Linux WSL helper and `Install.cmd`/`Install.ps1`.

The legacy installation directory remains `%LOCALAPPDATA%\Programs\WorktreeHub`; business data remains `%LOCALAPPDATA%\WorktreeHub`. Do not confuse that layout with the current NSIS default `%LOCALAPPDATA%\Yolu`. See the [migration guide](brand/yolu/migration.md) before mixing an older script installation with a Tauri installation.

## Design and brand resources

Follow the [brand reference](brand/yolu/README.md) and regenerate platform assets with `npm run brand:icons` after editing `web/yolu.svg`.


## Shared UI implementation

Follow [the shared UI guidelines](ui-guidelines.md) for the component inventory, token ownership, pane layout, conversation contract and verification workflow. Product list/detail markup uses the shared `workspace-pane` class; the application shell owns pane composition and sizing. Native coding conversations render the shared `ConversationPanel`, with `useConversationRuntime` for lifecycle/draft synchronization and `useChatReading` for history/reading behavior. `ConversationList`, `ConversationHeader`, `Thread`, `Composer`, run indicators and feedback are shared within that contract. Domain-specific state and capabilities are supplied through props and controllers.


## Localization

Application text uses `uiText` from `frontend/shared/i18n/index.ts`. The source message is the Simplified Chinese fallback; English translations live in `frontend/shared/i18n/locales/en.json`. Interpolation uses numbered placeholders with values supplied separately, so user content is not translated or reordered accidentally.

The shared bootstrap is built from `frontend/entrypoints/i18n.ts` to `web/ui/i18n.js` and copied to the bundled desktop startup page. It runs before application, chat and terminal controllers. Static HTML labels must be explicitly marked with `data-i18n`; the runtime never walks or rewrites arbitrary conversation, file or terminal contents. Use `uiLocale()` for locale-dependent formatting in components that can also render without a browser.

The application-local `GET`/`PUT /api/settings/language` endpoint stores `system`, `en` or `zh-CN` under `ui_language:v1` in the settings table. It uses the existing authentication/CSRF checks and bypasses WSL environment routing. Page responses embed the saved preference, allowing restoration across random desktop ports without depending on browser storage.

A language change saves active drafts before reloading the UI; a failed save prevents the reload. Native menus use the narrowly scoped `set_ui_language` command, which accepts only the two resolved locales from the main window. This command grants no filesystem or process access.

When adding a label, supply an English catalog entry, preserve interpolation placeholders and keep user-supplied values outside the message key. Keep native menu translations in `src-tauri/src/main.rs` synchronized. Run `node --test scripts/i18n.test.cjs`, the relevant chat tests and `go test ./internal/app -run TestLanguage` after localization changes; desktop menu changes also require the Rust checks and native verification.

## Cursor integration checks

The ACP lifecycle parity test runs the same create, stream, approval, replay, management, terminal and cancellation assertions for Antigravity and Cursor. Cursor-specific tests cover native model identifiers and structured question/plan replies. Run these without contacting a model:

```bash
go test ./internal/acp ./internal/agy ./internal/cursor ./internal/session ./internal/execution
npm run chat:test
YOLU_TEST_BINARY=bin/yolu npm run browser:test
```

An explicit opt-in check uses the installed and authenticated Cursor Agent for real file read/write, native history after a fresh service connection, contextual continuation and cancellation. It makes small model requests in a temporary Git worktree:

```bash
YOLU_TEST_CURSOR_TURN=1 go test ./internal/session \
  -run '^TestInstalledCursorConversationLifecycle$' -count=1 -v -timeout 6m
```
