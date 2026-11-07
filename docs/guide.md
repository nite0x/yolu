# User guide

Yolu is a personal desktop workspace for development across multiple Git projects. Tasks organize the goal and participating working directories; projects supply repositories; conversations remain independent and can be linked to tasks.

[Project overview](../README.md) · [Development and packaging](development.md) · [Work Hub migration](brand/yolu/migration.md)

The interface supports English and Simplified Chinese. It follows the system language by default, using English when the system language is not Chinese. Documentation is maintained in English.

## First use

1. Install the package for your operating system and CPU. See [Installation and upgrades](#installation-and-upgrades).
2. Install Git in the local or WSL execution environment where the repository lives. For conversations, install and authenticate the Codex CLI in that same environment. Verify Git remote authentication in a terminal first.
3. Register an existing repository under Projects.
4. Create a task with a name, goal and participating projects. Choose a new branch and worktree, the original repository directory, or an existing worktree for each project.
5. Open the task, inspect each directory's actual branch and modification state, and continue in a terminal, editor or conversation.

Codex compatibility depends on the installed CLI protocol. Check the CLI version in Settings and the tested versions in the release notes. An installed CLI alone does not establish protocol compatibility or model access; developers can run the opt-in compatibility check in the development guide.

## Tasks, projects and working directories

A project is a repository used across tasks. A task is a piece of work with a goal, such as a feature, fix, refactor or experiment. Each task belongs to one execution environment and can include several projects from that environment.

The default workspace root is `~/workspaces` in the execution environment. A task with new worktrees normally uses this structure:

```text
~/workspaces/task-slug/
├── WORK_HUB_CONTEXT.md
├── BRIEF.md
├── frontend/
└── backend/
```

Each project directory is an independent Git worktree. The task directory itself is an ordinary directory. Creating an isolated worktree does not switch the original repository's branch. If all projects reuse existing directories, Yolu does not create a task directory merely to reserve a path.

Use `--root` to choose another workspace root. Existing tasks retain their saved locations; changing the default does not move them. Yolu does not automatically prefer a Windows-mounted directory when running in WSL.

`WORK_HUB_CONTEXT.md` contains the current generated goal and directory list. Yolu updates files with its generation marker and does not overwrite a conflicting user file or symbolic link. `BRIEF.md` remains task notes and history; new conversations use the current goal in the database rather than treating old notes as the current goal.

You can edit the task goal, add projects, retry a failed project, replace a working directory or remove a project association. Removing an association retains the old worktree, branch and sessions. An archived task must be restored before changing its project setup.

## Git status and operations

Task and project views show actual branches, modification state and upstream status. Ahead/behind counts use the latest fetched remote information; they are separate from comparisons against a default branch. Automatic checks use cached results, so refresh after external changes when needed.

The Git panel supports fetching branches, branch creation and switching, fast-forward pulls, pushes, merge previews, merges and opening a Git terminal. Fetch a missing remote branch before selecting it as a worktree source. Git operations use the environment's existing credential helper; Yolu does not store Git passwords in task records.

Switching branches and pulling require the relevant working-directory checks to pass. A branch checked out by another worktree cannot be checked out again. A divergent branch is not silently force-updated. Shared directories can affect more than one task; review the associated-task warning before switching branches.

Change previews cover working-tree changes, untracked files and staged changes. They are read-only and subject to size and file-type limits: untracked text previews are limited to 512 KiB, and Git diffs to 256 KiB. Use an editor for larger or binary files.

Project and task actions open the selected working directory in a terminal, VS Code or IntelliJ IDEA. Install the tool first. On Windows, WSL editor actions use the appropriate WSL path. An unavailable task directory does not silently fall back to the main repository.

### Archive and clean up

Archiving a task retains its directories, branches and conversations. Use the task's review/cleanup action to inspect linked directories and old worktrees under its saved workspace path.

Cleanup requires explicit selection and confirmation. Currently linked worktrees require the task to be archived first. The backend rechecks the preview before removal and refuses unsafe candidates, including protected or shared directories, active operations, locked worktrees and unconfirmed changes or commits. It uses `git worktree remove` without `--force`.

Cleanup retains branches, task records, conversation history, the task root and notes. Restore an archived task to recover a removed member directory from its retained branch, or choose a different working directory. Cleanup is distinct from deleting or accepting the task's development result.

## Conversations

Open related conversations from a task or project, or use the global conversation page. Task views show explicitly linked sessions by default. Project views aggregate sessions from all discovered worktrees. Directory discovery uses the exact normalized working directory, rather than every subdirectory or every repository a session has accessed.

The global list can combine registered execution environments. Search and filter by environment, task, project, directory, archive state and activity. Opening a conversation uses its own environment; it does not change a session's working directory to match the current project view.

Create a conversation in a specific available project or task directory. An aggregate scope requires choosing a concrete directory first. Linking or unlinking an existing session changes the task reference; it does not move the session, erase history or stop execution.

### Messages, permissions and questions

New conversations inherit the selected environment’s Codex model, reasoning effort and permission configuration by default. Yolu does not force a particular model or full access. In Settings, use **New conversation defaults** to choose a model and permissions for future conversations in that environment, or restore **Use Codex default** for either field. These preferences are saved separately for each execution environment and do not edit the Codex configuration file.

You can override the model, reasoning effort, working mode and permissions in an individual conversation before sending. An explicit conversation choice takes precedence over saved new-conversation defaults. Existing sessions retain their execution context, and changing defaults does not change a running turn. Saved drafts retain their explicit choices. Full access allows reading and changing files and executing commands within the current user's operating-system permissions; inheriting Codex can also select full access if that environment is configured for it.

Saved model selections are checked against the current model catalog. If a selected model is no longer listed, change it in the conversation or restore the Codex default in Settings. Saved preferences remain editable when model discovery fails, so you can reset them while the CLI is offline. A model appearing in the catalog does not prove account access; an actual model request can still fail.

Use Ctrl+Enter or Command+Enter to send; Enter inserts a newline. While a Yolu-managed turn is running, sending additional input steers that turn. Stop is a separate action. If the turn has ended, send the text as a new turn. An uncertain delivery result is not automatically resent; inspect history before retrying.

Permission requests and structured questions appear within the conversation. Some asynchronous questions remain answerable after the current turn ends. Pending answers and the normal message draft are stored separately so answering a question does not discard the message you were composing.

Closing a panel, changing tabs or leaving the page does not stop a running conversation. Reopening it restores the shared controller and saved draft. A backend restart does not promise restoration of every in-memory running operation; check the reported state and history.

### Attachments and file previews

Paste, drop or select files in the composer. Supported image formats are PNG, JPEG, GIF and WebP. A message can include up to four images, at most 4 MiB each and 8 MiB in total. Other attachments are limited to 8 MiB each and saved in the selected environment; Codex receives their paths. Parsing a PDF, office file or archive depends on the tools available there.

Draft attachments can be removed before sending and restored with a saved draft. Local image and file previews are served through authenticated, session-scoped APIs. Missing, binary, oversized or out-of-scope files produce an explanation instead of direct access to arbitrary local paths.

Conversation management includes renaming, local pinning, native Codex archive/restore and branching from loaded history. Branching a conversation retains its directory context and does not create a Git worktree. The backend attempts a topic title once from the first accepted input, using an additional model request; see [title behavior](session-titles.md).

## Tabs, panes and embedded terminals

Open tasks, projects and conversations in workspace tabs. Use Ctrl/Command+T for a new tab and Ctrl/Command+W to close the current tab. Closing a tab does not stop its background conversation. Up to three panes can hold independent tabs; panes can be resized, temporarily maximized or merged back together. Layout and navigation state are saved locally.

The new-conversation entry also offers a terminal mode. Choose an available directory and an installed shell or CLI, such as Codex, Claude Code, Gemini CLI or OpenCode, or supply a custom executable and JSON argument array. These tools use their own authentication and permission prompts. Launching a tool in a terminal does not provide Yolu's native Codex conversation integration for that tool.

Changing tabs or closing a terminal view leaves its process running. Reconnect from the existing-terminal list, or explicitly end the process to stop it and its children. The backend owns terminal processes and retains a bounded output buffer; stopping or restarting the backend ends those processes and does not restore them afterward.

Pinned task and directory shortcuts retain their execution environment and can have custom icons and colors. Pinning is navigation metadata, not exclusive ownership of a directory.

## Execution environments and WSL

Local projects do not require WSL. On Windows, connect a distribution and Linux user from Settings to work in WSL. Yolu deploys its bundled helper and communicates through private stdin/stdout JSONL; no SSH server or listening WSL port is required.

Use Windows paths for local repositories and Linux paths for WSL repositories. Do not register a WSL repository through a `\\wsl.localhost` path as a local Windows project. A task's environment is fixed at creation; repositories in different environments require separate tasks.

WSL task metadata is held in a separate environment database under the Windows application's data directory. Git and file operations execute inside WSL. Connecting can optionally import an existing WSL user's records into an empty environment database. Import preserves repository and worktree paths and does not establish ongoing synchronization with the old database.

Disconnected environments retain their locally stored task listings. Opening a task can reconnect its environment; Settings also provides reconnection. Writes with uncertain results are not silently replayed. Refresh to inspect their actual result and retry failed task preparation where offered.

## Appearance

### Color palette

In Settings, choose **Appearance → Color palette** and select **Classic indigo** or **Yolu Mint**. Save and apply to update the workspace, tabs, conversations and terminal colors immediately. This does not reload pages or stop running work. The palette is stored in the local application database, shared across execution environments and retained when the backend port changes. Existing installations keep Classic indigo until a different palette is selected.

Yolu Mint uses a warm white background, deep teal text and mint accents. Status colors and code syntax colors retain their separate meanings.

## Interface language

Open Settings and choose Follow system, English or Simplified Chinese under Interface language. Save and apply to reload the workspace in the selected language. The choice is stored in the local application database, applies across execution environments and survives backend port changes and restarts.

Before reloading, Yolu waits for open conversation drafts to be saved. If a draft cannot be saved, the page remains open and explains the failure. Background conversations and terminal processes continue during the UI reload. Save other unfinished settings before applying a language change.

Application labels, conversation controls, accessibility labels, date formatting and desktop menus follow this setting. Task descriptions, user-selected names, conversation messages, file contents and terminal output remain unchanged. Details returned by underlying tools or the operating system may retain their original language.

## Settings and diagnostics

Settings manages execution environments, new-conversation model and permission defaults, terminal tools and the optional daily default-branch update configuration. Terminal actions share the configured tool. macOS defaults to Terminal; other options depend on the execution platform and installed tools.

Codex installation diagnostics report resolved CLI paths and versions, authentication-configuration presence, session-list access and available backend information. You can inspect registered environments individually or copy a sanitized report. Diagnostics do not start a model conversation or prove that credentials are valid for a particular model. After installing or changing the CLI, quit and stop the backend, then reopen Yolu so it rediscovers the environment.

## Data, backups and shutdown

| Item | Default location |
| --- | --- |
| Windows application data | `%LOCALAPPDATA%\WorktreeHub` |
| macOS and Linux application data | `~/.local/share/worktree-hub` |
| New task worktrees | `~/workspaces` in the execution environment |
| Backend log | `desktop.log` in the application data directory |

The retained Work Hub names are intentional compatibility identifiers. See the [migration guide](brand/yolu/migration.md).

The Tauri window and Go backend have separate lifetimes. Closing the window leaves the backend running. Choose **Quit and stop backend** from the application menu to stop it safely. Active Git writes can prevent shutdown; finish them and retry. Desktop hosts also accept `--stop` and `--data`:

```bash
# macOS example
"/Applications/Yolu.app/Contents/MacOS/yolu" --stop
"/Applications/Yolu.app/Contents/MacOS/yolu" --stop --data /path/to/data
```

On Windows use the installed `yolu.exe`; for a DEB installation use `yolu`. Stop each custom-data instance separately. Do not delete `service.json` or kill Git to bypass a shutdown conflict.

After stopping the relevant backends, copy the entire application data directory for a backup. Back up repositories, worktrees, Codex history and authentication configuration separately. Application metadata export is not a complete filesystem backup. `service.json` contains instance discovery and authentication information and must not be shared.

## Installation and upgrades

Download an artifact built for the correct target from the specific release. These are the configured build targets, not a guarantee that every target has a published or verified package:

| Platform | Package | Runtime notes |
| --- | --- | --- |
| macOS Apple Silicon / Intel | DMG for the matching CPU | macOS 12 or later |
| Windows x64 | NSIS `-setup.exe` | Windows 10/11 and WebView2; the installer can download WebView2 |
| Linux x64 | DEB / AppImage | DEB builds use Ubuntu 22.04; WebKitGTK 4.1 is required; AppImage may require FUSE 2 |

Install Git and, for conversations, the Codex CLI separately. Installed Yolu packages do not require the Go, Rust or Node.js build toolchains. A CLI's own installation method may have separate requirements.

- **macOS:** open the matching DMG and copy `Yolu.app` to `/Applications` or `~/Applications`. Before replacement or removal, quit and stop the backend. Remove the application bundle to uninstall.
- **Windows:** run the per-user installer. New installations default to `%LOCALAPPDATA%\Yolu`; data remains in `%LOCALAPPDATA%\WorktreeHub`. For a backed-up upgrade, extract the complete release directory and run `Upgrade.cmd`. It verifies checksums, stops the default backend, backs up application data and installed files, and installs the new version. Custom-data backends must be stopped separately. Use the registered uninstaller to remove the app.
- **Linux DEB:** install with `sudo apt install ./yolu_<version>_x86_64-unknown-linux-gnu.deb`. Stop the backend before upgrading or removing with `sudo apt remove yolu`. Maintenance scripts refuse replacement while installed host/backend processes remain active.
- **Linux AppImage:** store it in a stable location, make it executable with `chmod +x`, and run it. Stop the backend before replacing or deleting it. It does not automatically register a launcher or a systemd service.

Uninstalling does not remove task worktrees, repositories or application data. Read the [migration guide](brand/yolu/migration.md) before replacing an older Work Hub installation.

Release directories include `SHA256SUMS` and source information in `release.json`. Check file integrity with `sha256sum -c SHA256SUMS` on Linux, `shasum -a 256 -c SHA256SUMS` on macOS, or `Get-FileHash -Algorithm SHA256` on Windows. Checksums do not establish publisher identity; check the release's stated signing and notarization status.

Yolu does not currently provide an in-app automatic updater. Use an installer or replace the application after a safe shutdown.
