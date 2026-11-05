# Development and packaging

Run Git, build and test commands from the repository root. See the [user guide](guide.md) for day-to-day operation and the [release checklist](open-source-release.md) before publishing artifacts.

## Prerequisites

- Node.js 22.12 or later and npm. Use `npm ci` with the committed lockfile.
- Go satisfying `go.mod` (currently a minimum of 1.26.10). Core checks and desktop packaging read their Go version directly from this file.
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
npm run desktop:dev -- --data /path/to/test-data --root /path/to/test-workspaces
```

The desktop command prepares the frontend and Go sidecar, then launches Tauri. It does not use a separate Vite development server for the application UI: Go serves embedded assets. After changing Go or embedded web files, quit and stop the backend, rebuild and reopen. A content-derived backend identity prevents silently reusing a mismatched desktop backend.

### Browser and backend mode

On Linux or macOS:

```bash
bash scripts/run.sh --headless --listen 127.0.0.1:4317 \
  --data /path/to/test-data --root /path/to/test-workspaces
```

Open `http://127.0.0.1:4317`. The script builds both frontend bundles before building and running `bin/yolu`. An installed or separately built Go binary can use the same flags. Only loopback listen addresses are accepted.

Interactive Codex conversations are enabled by default. `--read-only-sessions` selects history-only mode for the Go entry point; `--interactive-sessions` is a retained compatibility flag. These Go flags are not desktop-host flags: the Tauri host accepts `--data`, `--root`, `--stop` and `--backend-info`.

The browser-mode process runs in the foreground. Stop the test process and use its isolated data directory when changing modes. A desktop backend can be stopped through its host or the authenticated `--stop --data /path/to/data` entry point.

## Repository structure

| Location | Responsibility |
| --- | --- |
| `main.go`, `internal/app/` | Entry point, service composition, routing, environments and process lifecycle |
| `internal/task/` | Task preparation, members, context, archive and recovery |
| `internal/project/` | Repository registration, Git operations, worktree status and cleanup |
| `internal/session/` | Codex sessions, history, chat, approvals, questions, drafts and titles |
| `internal/terminal/` | Managed embedded terminal processes |
| `internal/workspace/` | Environment execution, files, Git transport, locks and WSL helper |
| `internal/store/`, `internal/model/` | SQLite migrations, metadata import/export and shared models |
| `internal/codex/` | Codex protocol clients, event dispatch and relay |
| `internal/overview/` | Read-only composition of workspace state |
| `internal/platform/`, `internal/httpx/` | Platform integration and shared HTTP/security helpers |
| `frontend/workspace/` | React-rendered workspace markup, forms, lists and tab bar |
| `frontend/chat/`, `frontend/components/assistant-ui/` | Interactive chat adapter and registry-derived message/composer components |
| `web/` | Embedded HTML, controllers, styles and generated UI/chat bundles |
| `desktop/`, `src-tauri/` | Startup page, Rust host and native bundle configuration |
| `scripts/`, `.github/workflows/` | Build, packaging, verification and CI entry points |
| `design-demo/` | Separate mock-data design sandbox |

The application composes task, project, session and workspace services; lower-level packages do not depend on `app`. Each environment shares its workspace storage, root and write locks. Cross-module behavior uses small interfaces and injected callbacks rather than making sessions owned by tasks. Existing `Requirement` types, `requirements` tables and API paths are retained for compatibility.

Most workspace components render static HTML through `renderToStaticMarkup` and `window.WorkHubUI`; existing controllers retain event handling, polling, forms and dialog lifecycles. The interactive chat UI mounts through its own React bridge. Avoid a global CSS reset that changes legacy pages. The tab container loads independent same-origin workspace pages and persists layout through `/api/workspace-tabs`.

The conversation page controller delegates shortcut persistence to `frontend/workspace/shortcut-pins.ts` and list mechanics to `conversation-list.ts`. The shortcut store owns legacy browser-cache migration, serialized database writes, cross-window reloads and rollback after failed saves. The list module owns the bounded scroll window, keyboard positioning and DOM row reuse. `conversation-state.ts` owns scope preferences, environment caches, request generations and partial-result publication. The page controller connects these modules to navigation, filters and DOM events.

The chat controller delegates debounced, ordered draft persistence to `frontend/chat/draft-persistence.ts` and saved-history pagination to `history-loader.ts`. The history loader receives connection and live-output revisions so delayed pages cannot replace a newer turn or title. Shared controller contracts live in `controller-types.ts`; type-only dependencies do not load the controller runtime.

The tab bridge, environment controls and legacy history controls access shared conversation state through `window.WorkHubConversations`. They must not depend on page-local variables for the selected view or page mode.

Git HTTP handlers decode requests and translate errors. `internal/project/git_actions.go` coordinates repository serialization, task metadata changes and cache invalidation, with network, branch and merge operations in the corresponding `git_actions_*.go` files. Branch switching keeps its metadata lock through task-context publication.

New-conversation defaults are runtime preferences stored under `conversation_defaults:v1` in each execution environment’s settings table, exposed through `GET`/`PUT /api/settings/conversation-defaults`. Empty model and permission fields inherit the native Codex configuration. `chat-options` includes these preferences for the composer, while explicit draft settings remain separate. Creation merges explicit choices over saved preferences and leaves unspecified native fields out of the protocol request; existing sessions do not receive the creation defaults. The first turn uses the actual context returned by `thread/start`, including its sandbox and approval policy. See [session architecture](session-architecture.md) for runtime, storage and routing details.

## Build and check

Build both embedded frontend bundles before invoking Go directly:

```bash
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
```

`npm run web:test` combines workspace type checking, the web build, workspace tests and the `.test.cjs` suite; it does not replace the separate chat build/check/test commands. `npm run web:watch` rebuilds workspace assets while editing; restart the Go process to update embedded resources.

Core CI and each native desktop packaging job run the pinned `govulncheck` command against the selected Go toolchain and the current vulnerability database. Reachable findings fail the job; module/package findings without a reachable call are still reported for review. Run the scan after building the embedded frontend assets.

Core CI also runs the isolated task workflow and race checks:

```bash
go build -o bin/yolu-backend .
node scripts/desktop-workflow-smoke.mjs bin/yolu-backend
go test -race ./internal/store ./internal/task ./internal/project \
  ./internal/session ./internal/terminal ./internal/workspace ./internal/app
```

These checks use temporary repositories, local Git remotes, separate data directories and a deterministic Codex fixture. They do not establish that real model requests work. The exact Linux/macOS core matrix is in [.github/workflows/checks.yml](../.github/workflows/checks.yml).

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

Windows releases additionally include `Upgrade.cmd`, `Upgrade-Yolu.ps1` and `yolu-upgrade.exe`. The upgrade script verifies the complete release, safely stops the default backend, backs up application data and installed files, verifies database backup hashes, then installs. It does not relocate repositories, worktrees or Codex history.

### macOS preview isolation

```bash
npm run desktop:package -- --preview
```

Preview packages are macOS-only and use `Yolu Preview` with application ID `dev.work-hub.desktop.preview`. Output uses `release-preview/` or `debug-preview/`. Finder launches use independent `data/` and `workspaces/` under `~/Library/Application Support/dev.work-hub.desktop.preview/`.

Keep the preview separate from `/Applications/Yolu.app`. Preview `--stop` and `--backend-info` commands require an explicit `--data` so a diagnostic cannot accidentally operate on the normal backend.

## Signing and publication

Local packaging permits unsigned test artifacts by default. For a production macOS or Windows package:

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

[.github/workflows/desktop.yml](../.github/workflows/desktop.yml) runs manually or on `desktop-v<version>` tags. The tag must match `package.json`. Tag builds require macOS/Windows signing; manual runs default to permitting unsigned test artifacts. The jobs build the four configured targets, run native lifecycle/installer checks and upload Actions artifacts. They do not automatically create a GitHub Release.

Use the [release checklist](open-source-release.md) to record the actual target commit, artifacts, signing status and native results before publication. Yolu has no automatic update server or in-app updater.

## Legacy Windows Go host

`scripts/build-desktop.sh` and `scripts/install-desktop.ps1` are retained compatibility tools for the earlier Go/WebView2 host. They are not the current Tauri release pipeline. The script builds `bin/windows-amd64/Yolu.exe`, its Linux WSL helper and `Install.cmd`/`Install.ps1`.

The legacy installation directory remains `%LOCALAPPDATA%\Programs\WorktreeHub`; business data remains `%LOCALAPPDATA%\WorktreeHub`. Do not confuse that layout with the current NSIS default `%LOCALAPPDATA%\Yolu`. See the [migration guide](brand/yolu/migration.md) before mixing an older script installation with a Tauri installation.

## Design and brand resources

Use [design-demo](../design-demo/README.md) for mock-data UI experiments without a backend. It is excluded from production entry points. Follow the [brand reference](brand/yolu/README.md) and regenerate platform assets with `npm run brand:icons` after editing `web/yolu.svg`.


## Localization

Application text uses `uiText` from `frontend/i18n.ts`. The source message is the Simplified Chinese fallback; English translations live in `frontend/locales/en.json`. Interpolation uses numbered placeholders with values supplied separately, so user content is not translated or reordered accidentally.

The shared bootstrap is built from `frontend/i18n-runtime.ts` to `web/ui/i18n.js` and copied to the bundled desktop startup page. It runs before workspace, chat and terminal controllers. Static HTML labels must be explicitly marked with `data-i18n`; the runtime never walks or rewrites arbitrary conversation, file or terminal contents. Use `uiLocale()` for locale-dependent formatting in components that can also render without a browser.

The application-local `GET`/`PUT /api/settings/language` endpoint stores `system`, `en` or `zh-CN` under `ui_language:v1` in the settings table. It uses the existing authentication/CSRF checks and bypasses WSL environment routing. Page responses embed the saved preference, allowing restoration across random desktop ports without depending on browser storage.

A language change saves active drafts before reloading the UI; a failed save prevents the reload. Native menus use the narrowly scoped `set_ui_language` command, which accepts only the two resolved locales from the main window. This command grants no filesystem or process access.

When adding a label, supply an English catalog entry, preserve interpolation placeholders and keep user-supplied values outside the message key. Keep native menu translations in `src-tauri/src/main.rs` synchronized. Run `node --test scripts/i18n.test.cjs`, the relevant chat tests and `go test ./internal/app -run TestLanguage` after localization changes; desktop menu changes also require the Rust checks and native verification.
