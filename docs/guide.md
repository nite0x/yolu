# User guide

Yolu is a desktop and browser app for multi-agent development across repositories and local directories. Conversations keep their own project bindings, execution directory and history.

[Project overview](../README.md) · [Development and packaging](development.md) · [Work Hub migration](brand/yolu/migration.md)

The interface supports English and Simplified Chinese. It follows the system language by default, using English when the system language is not Chinese. Documentation is maintained in English.

## First use

1. Install the package for your operating system and CPU. See [Installation and upgrades](#installation-and-upgrades).
2. Install Git in the local or WSL execution environment where the repository lives. For conversations, install and authenticate the Codex CLI in that same environment. Verify Git remote authentication in a terminal first.
3. Register an existing repository under Projects.
4. Select **New conversation** from the project. Use the current checkout, select an existing worktree or create an independent worktree from a chosen base.
5. Send a request. Use the conversation header to attach another project or directory and choose its access.

Codex compatibility depends on the installed CLI protocol. Check the CLI version in Settings and the tested versions in the release notes. An installed CLI alone does not establish protocol compatibility or model access; developers can run the opt-in compatibility check in the development guide.

## Projects and working directories

A project registers a Git repository. Yolu discovers its existing worktrees through Git. A conversation can use a registered project's current checkout, reuse a worktree, or create an independent worktree for parallel development. Projects can have several conversations using different worktrees.

Use `--root` to choose where Yolu creates new worktrees. The default is `~/workspaces` in the execution environment. Existing checkouts stay at their saved paths. Creating a worktree keeps the original checkout on its branch.

## Connect an agent over MCP

In the desktop app or local browser, open **Settings → Execution environment → MCP setup**. Install for Codex or Claude Code with one click. Yolu checks for the agent's CLI and registers the server for the current user and Yolu profile. Use **Refresh status** after installing an agent CLI. If a different server already uses the name `yolu`, review that entry in the agent before retrying. Reopen the agent session to load the server and keep Yolu running while you use it.

To register manually, configure the agent on the same host to launch Yolu's Go backend in stdio mode:

```sh
codex mcp add yolu -- /absolute/path/yolu-backend --mcp
claude mcp add --scope user --transport stdio yolu -- /absolute/path/yolu-backend --mcp
```

Use the command for your agent. On macOS, the installed binary is usually `/Applications/Yolu.app/Contents/MacOS/yolu-backend`. Linux DEB packages install it at `/usr/bin/yolu-backend`. For an AppImage, use the path to the AppImage itself. On Windows, use the `yolu-backend.exe` beside `yolu.exe`. From source, build the binary as described in the [development guide](development.md#build-and-check). For other MCP clients, use a stdio server with the same executable and arguments.

The server connects to the running backend for the current user's default data directory. If you run Yolu with a custom profile, add `--data /absolute/path/to/data` after `--mcp` in the agent configuration. On Windows, configure the host-side agent to launch the Windows binary. It can see the saved projects for registered WSL environments and report whether they are connected.

- `list_projects` returns project IDs and environment IDs with optional name filtering.
- `get_project` takes both IDs and returns the project's actual paths, worktrees, branches and Git status. Set `refresh` to `true` to request a scan. When `status_refreshing` is true, query again for the latest result.

Both tools read project metadata, including local paths, from the running profile without opening another listening port.

## Git status and operations

Conversation and project views show actual branches, modification state and upstream status. Ahead/behind counts use the latest fetched remote information; they are separate from comparisons against a default branch. Automatic checks use cached results, so refresh after external changes when needed.

The Git panel supports fetching branches, branch creation and switching, fast-forward pulls, pushes, merge previews, merges and opening a Git terminal. Fetch a missing remote branch before selecting it as a worktree source. Git operations use the environment's existing credential helper; Yolu does not store Git passwords in application records.

Switching branches and pulling require the relevant working-directory checks to pass. A branch checked out by another worktree cannot be checked out again. A divergent branch is not silently force-updated. Shared directories can affect several conversations. Confirm the shared-directory warning when switching branches and stop any active runs using the directory first.

Change previews cover working-tree changes, untracked files and staged changes. They are read-only and subject to size and file-type limits: untracked text previews are limited to 512 KiB, and Git diffs to 256 KiB. Use an editor for larger or binary files.

Project actions open the selected working directory in a terminal, VS Code or IntelliJ IDEA. Install the tool first. On Windows, WSL editor actions use the appropriate WSL path. An unavailable directory reports an error.

### Remove a worktree

In Projects, select the worktree and review **Remove worktree**. Removal requires explicit confirmation. Yolu checks saved conversation bindings, active agents and terminals, uncommitted or ignored files, locks and commit retention again before invoking Git. Branches and history remain available. Use the retained branch to create another worktree if needed.

## Conversations

Use **New conversation** in the global navigator to open a draft with **Default directory (no project)** selected. Yolu gives that conversation its own writable directory when you send the first message. The directory picker also lists available project checkouts and worktrees, including projects with no conversations. Select a project name in the grouped navigator to expand or collapse its conversations. Hover over or focus the project row to show **Open project details** and **New conversation**. Use the navigator's filter menu to show or hide project icons and conversation counts independently. In project details, start a conversation from a directory row to select that directory. A saved conversation can have one primary directory and additional projects or ordinary local directories. Project views list conversations associated through bindings or discovered in their worktrees. The global list can combine execution environments.

The conversation header lists directories with branch, access and validation status. Use its add button or choose an entry from the composer's `@` picker. An exact registered project name in a draft can suggest an association for review. Confirm the actual path and read or write access before the agent receives the directory. Open a directory chip to see changes or adjust the binding. Switch or remove a directory after the active turn ends.

When two active agents can write to the same directory, Yolu asks for explicit confirmation to share it. Choose an independent worktree to isolate the checkouts. Read-only and dynamic access depend on the provider and live protocol. Inspect the directory's reported status before sending, and answer an agent's structured access request in the conversation when supported.

### Voice dictation

Select the microphone button in a conversation to dictate into the current draft. Allow microphone access when prompted. Select **Stop dictation**, review or edit the text, then send it. Existing draft text is retained. Closing the pane stops recording.

Dictation uses the locally installed Codex daemon's V3 WebRTC support and its existing ChatGPT login. Sign in with `codex login` in the user account running Yolu. Codex handles authentication and speech recognition. Audio travels directly from your browser or desktop webview to the Codex voice service. On Linux desktops without WebRTC, Codex's packaged native voice component captures the host microphone and sends the audio. Microphone access in browsers requires localhost or a secure context such as HTTPS. If the installed Codex version or account cannot start voice, the composer displays the error and keeps the draft. Abandoned signaling sessions expire after ten minutes.

### Messages, permissions and questions

New conversations inherit the selected environment’s Codex model and reasoning effort by default. In Settings, use **New conversation defaults** to choose a model for future conversations or restore **Use Codex default**. These preferences are stored for each execution environment. Explicit model, effort and working-mode choices apply to the next turn.

For a Yolu-managed Codex conversation, the directory bindings define filesystem access. The Codex app-server must confirm the generated permissions profile before Yolu sends a message. The profile grants read or write access to selected directories and read access to required runtime files. It disables network access and unscoped MCP tools for the managed thread. The provider can request a separately approved directory during a turn. With an older app-server, a setup error keeps the binding available for retry after updating the CLI.

Antigravity keeps its existing native primary-directory execution. Its directory binding view shows that independent directory permissions are unavailable. Use Codex for managed multi-directory execution. Claude Code, Cursor and other installed CLIs can be used through their own native terminal integration and permission controls.

Saved model selections are checked against the current model catalog. If a selected model is no longer listed, change it in the conversation or restore the Codex default in Settings. Saved preferences remain editable when model discovery fails, so you can reset them while the CLI is offline. A model appearing in the catalog does not prove account access; an actual model request can still fail.

Enter sends by default. Change the shortcut in Settings to send with Ctrl+Enter or Command+Enter. While a Yolu-managed turn is running, sending additional input steers that turn. Stop is a separate action. If the turn has ended, send the text as a new turn. An uncertain delivery result is not automatically resent; inspect history before retrying.

Permission requests and structured questions appear within the conversation. Some asynchronous questions remain answerable after the current turn ends. Pending answers and the normal message draft are stored separately so answering a question does not discard the message you were composing.

Closing a panel, switching pages or leaving the application does not stop a running conversation. Reopening it restores the shared controller and saved draft. A backend restart does not promise restoration of every in-memory running operation; check the reported state and history.

### Attachments and file previews

Paste, drop or select files in the composer. Supported image formats are PNG, JPEG, GIF and WebP. A message can include up to four images, at most 4 MiB each and 8 MiB in total. Other attachments are limited to 8 MiB each and saved in the selected environment; Codex receives their paths. Parsing a PDF, office file or archive depends on the tools available there.

Draft attachments can be removed before sending and restored with a saved draft. Local image and file previews are served through authenticated, session-scoped APIs. Missing, binary, oversized or out-of-scope files produce an explanation instead of direct access to arbitrary local paths.

Conversation management includes renaming, local pinning, native Codex archive/restore and branching from loaded history. Branching a conversation retains its directory context and does not create a Git worktree. The backend attempts a topic title once from the first accepted input, using an additional model request; see [title behavior](session-titles.md).

## Navigation, panes and embedded terminals

Use the shared conversation navigator to open Projects, Issues or Settings. Search and group by project, or switch to Recent to see the latest conversations across environments. On narrow windows, open the navigator from the header. Conversations can open side by side in up to three panes.

The new-conversation entry also offers a terminal mode. Choose an available directory and an installed shell or CLI, such as Codex, Claude Code, Gemini CLI or OpenCode, or supply a custom executable and JSON argument array. These tools use their own authentication and permission prompts. When resuming a managed conversation in the native Codex terminal, confirm that native Codex will control access. The selected directory and conversation history remain available.

Switching pages or closing a terminal view leaves its process running. Reconnect from the existing-terminal list, or explicitly end the process to stop it and its children. The backend owns terminal processes and retains a bounded output buffer; stopping or restarting the backend ends those processes and does not restore them afterward.

Project collections retain their execution environment. Edit a project icon or color from its detail header.

## Execution environments and WSL

Local projects do not require WSL. On Windows, connect a distribution and Linux user from Settings to work in WSL. Yolu deploys its bundled helper and communicates through private stdin/stdout JSONL; no SSH server or listening WSL port is required.

Use Windows paths for local repositories and Linux paths for WSL repositories. Do not register a WSL repository through a `\\wsl.localhost` path as a local Windows project. A conversation runs in one execution environment. Use separate conversations for repositories in different environments.

WSL project and conversation metadata is held in a separate environment database under the Windows application's data directory. Git and file operations execute inside WSL. Connecting can optionally import an existing WSL user's records into an empty environment database. Import preserves repository and worktree paths and does not establish ongoing synchronization with the old database.

Disconnected environments retain their locally stored project registrations. Reconnect them in Settings. For an operation reported as uncertain, refresh the directory or conversation before retrying.

## Appearance

### Color palette

In Settings, choose **Appearance → Color palette** and select **Yolu Mint**, **Classic indigo**, **Light**, **Dark** or **Follow system**. Selection immediately updates the colors of open pages, conversations and terminals and saves automatically. A failed save restores the last saved palette. This does not reload pages or stop running work. The palette is stored in the local application database, shared across execution environments and retained when the backend port changes. Existing installations keep Classic indigo until a different palette is selected.

Yolu Mint uses a warm white background, deep teal text and mint accents. Light is a neutral white and gray palette with blue accents, and Dark is its charcoal counterpart with sky blue accents. Follow system switches between Light and Dark with the operating system appearance, including while Yolu is open. Status colors and code syntax colors retain their separate meanings.

## Interface language

Open Settings and choose Follow system, English or Simplified Chinese under Interface language. Choose **Apply and reload** to reload the application in the selected language. The choice is stored in the local application database, applies across execution environments and survives backend port changes and restarts.

Before reloading, Yolu waits for open conversation drafts to be saved. If a draft cannot be saved, the page remains open and explains the failure. Background conversations and terminal processes continue during the UI reload. Save other unfinished settings before applying a language change.

Application labels, conversation controls, accessibility labels, date formatting and desktop menus follow this setting. User-selected names, conversation messages, file contents and terminal output remain unchanged. Details returned by underlying tools or the operating system may retain their original language.

## Settings and diagnostics

Settings manages execution environments, agent preferences, terminal tools and the optional daily default-branch update configuration. Terminal actions share the configured tool. macOS defaults to Terminal; other options depend on the execution platform and installed tools.

In **Settings → Conversation → New-conversation defaults**, select the execution environment and agent before changing the model, response speed, reasoning effort or permissions. Changes save automatically and apply only to new conversations. Existing conversations can override their own settings. Larger reasoning-effort catalogs use a dropdown. Failed default changes retain your choices and offer **Retry save**, including after switching agents or environments. Automatic title settings also apply to new conversations in the selected environment; the send shortcut applies throughout the application, including open conversations.

In **Settings → Codex installation diagnostics**, check the local host or a registered WSL user. Choose **Install Codex CLI** to install the latest stable release with the OpenAI installer. **Upgrade Codex CLI** uses the detected standalone installation, npm package or Homebrew cask. Use the original installation method for other distributions.

Yolu verifies the CLI version, starts the shared daemon in the same environment and checks that it can read the conversation list. The diagnostic report refreshes after the operation and shows authentication configuration, session-list access and shared daemon status. If conversations still use an older backend after upgrading, finish active work, quit and stop the backend, then reopen Yolu. See the [official Codex CLI installation guide](https://developers.openai.com/codex/cli).

## Browser access

The installed desktop application and browser share one backend, project registry and conversation index. Git commands, embedded terminals and Codex conversations run in the host's selected execution environment.

For a browser on the same computer, run `yolu --backend-info` and open the returned `url`. On Windows use the installed `yolu.exe`; on macOS use the executable inside `Yolu.app`. The desktop endpoint uses a dynamically selected local port.

To connect from another device on your LAN, open **Settings → Browser access** in Yolu on the host. Enable **LAN access**, choose a free port (default `4318`) and save. Copy an address containing the host's LAN IP, such as `http://192.168.1.20:4318`, and open it on the other device. Enter the pairing code displayed in Settings. Allow inbound TCP traffic for the chosen port in the host firewall if needed.

Connections use HTTP and are intended for a trusted LAN. A paired browser can read and modify the host's projects and conversations and use its development tools. Keep the pairing code private. Browser sessions last up to 24 hours. Use **Change pairing code** to disconnect existing browser sessions, or disable LAN access to close the listener and its terminal connections. **Sign out of browser** clears that browser's login cookie.

The saved LAN setting is restored when the backend starts. Closing the desktop window leaves browser access running. **Quit and stop backend** stops both endpoints. If the chosen port is occupied during startup, open Settings locally to choose another port. The primary local endpoint remains available.

## Data, backups and shutdown

| Item | Default location |
| --- | --- |
| Windows application data | `%LOCALAPPDATA%\WorktreeHub` |
| macOS and Linux application data | `~/.local/share/worktree-hub` |
| New worktrees | `~/workspaces` in the execution environment |
| Backend log | `desktop.log` in the application data directory |

The retained Work Hub names are intentional compatibility identifiers. See the [migration guide](brand/yolu/migration.md).

The Tauri window and Go backend have separate lifetimes. Closing the window leaves the backend running. Choose **Quit and stop backend** from the application menu to stop it safely. Active Git writes can prevent shutdown; finish them and retry. Desktop hosts also accept `--stop` and `--data`:

```bash
# macOS example
"/Applications/Yolu.app/Contents/MacOS/yolu" --stop
"/Applications/Yolu.app/Contents/MacOS/yolu" --stop --data /path/to/data
```

On Windows use the installed `yolu.exe`; for a DEB installation use `yolu`. Stop each custom-data instance separately. Do not delete `service.json` or kill Git to bypass a shutdown conflict.

After stopping the relevant backends, copy the entire application data directory for a backup. Back up repositories, worktrees, Codex history and authentication configuration separately. Application metadata export is not a complete filesystem backup. `service.json` contains instance discovery and authentication information. `browser-access.json` contains the LAN access setting and pairing code. Keep both files private.

## Installation and upgrades

Download an artifact built for the correct target from the specific release. These are the configured build targets, not a guarantee that every target has a published or verified package:

| Platform | Package | Runtime notes |
| --- | --- | --- |
| macOS Apple Silicon / Intel | DMG for the matching CPU | macOS 12 or later |
| Windows x64 | NSIS `-setup.exe` | Windows 10/11 and WebView2; the installer can download WebView2 |
| Linux x64 | DEB / AppImage | DEB builds use Ubuntu 22.04; WebKitGTK 4.1 is required; AppImage may require FUSE 2 |

GitHub Actions downloads wrap these files in a ZIP archive. Extract it, then open
the `.dmg` or `-setup.exe`, install the `.deb`, or run the `.AppImage` as described
below. The ZIP itself is not an installer. On Windows, `yolu-upgrade.exe` is a
helper used by `Upgrade.cmd`; use the file ending in `-setup.exe` for a new install.
GitHub's **Code → Download ZIP** and **Source code** archives contain source files,
not a built application. Direct installer downloads require separately published
release assets; a successful Actions run alone does not publish a GitHub Release.

Install Git and, for conversations, the Codex CLI separately. Installed Yolu packages do not require the Go, Rust or Node.js build toolchains. A CLI's own installation method may have separate requirements.

- **macOS:** open the matching DMG and copy `Yolu.app` to `/Applications` or `~/Applications`. Before replacement or removal, quit and stop the backend. Remove the application bundle to uninstall.
- **Windows:** run the per-user installer. New installations default to `%LOCALAPPDATA%\Yolu`; data remains in `%LOCALAPPDATA%\WorktreeHub`. For a backed-up upgrade, extract the complete release directory and run `Upgrade.cmd`. It verifies checksums, stops the default backend, backs up application data and installed files, and installs the new version. Custom-data backends must be stopped separately. Use the registered uninstaller to remove the app.
- **Linux DEB:** install with `sudo apt install ./yolu_<version>_x86_64-unknown-linux-gnu.deb`. Stop the backend before upgrading or removing with `sudo apt remove yolu`. Maintenance scripts refuse replacement while installed host/backend processes remain active.
- **Linux AppImage:** store it in a stable location, make it executable with `chmod +x`, and run it. Stop the backend before replacing or deleting it. It does not automatically register a launcher or a systemd service.

Uninstalling does not remove worktrees, repositories or application data. Read the [migration guide](brand/yolu/migration.md) before replacing an older Work Hub installation.

Release directories include `SHA256SUMS` and source information in `release.json`. Check file integrity with `sha256sum -c SHA256SUMS` on Linux, `shasum -a 256 -c SHA256SUMS` on macOS, or `Get-FileHash -Algorithm SHA256` on Windows. Checksums do not establish publisher identity; check the release's stated signing and notarization status.

Yolu does not currently provide an in-app automatic updater. Use an installer or replace the application after a safe shutdown.
