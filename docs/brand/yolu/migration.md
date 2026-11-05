# Migrating from Work Hub to Yolu

The application is now **Yolu**. The main executable is `yolu` (`yolu.exe` on Windows), the backend is `yolu-backend`, and release filenames begin with `yolu_`. The public repository is <https://github.com/nite0x/yolu>.

## Before upgrading

1. Finish active Git operations and session work. In the old application choose **Quit and stop backend**; closing the window alone leaves the backend running.
2. Stop backends using custom `--data` paths separately. Back up the whole business data directory: `%LOCALAPPDATA%\WorktreeHub` on Windows, or `~/.local/share/worktree-hub` on macOS/Linux, unless overridden.
3. Back up repositories, worktrees and Codex data separately. The rename does not require manually renaming the database or moving workspaces.

## Platform steps

- **macOS:** stop the old application, remove the old `Work Hub.app` from Applications, install `Yolu.app`, and update Dock pins. Do not run the old and new normal editions together. Preview builds retain their separate application identity and data paths.
- **Windows Tauri packages:** extract the complete Yolu release directory and run `Upgrade.cmd`. The script identifies the current user's Yolu/Work Hub installation, verifies files, safely stops the default backend, creates a backup, removes the old-name NSIS installation when necessary, and installs Yolu. If multiple installations exist, use `Upgrade-Yolu.ps1 -InstallDir <path>` after stopping them. For manual migration, stop and uninstall the old app while retaining data, then install Yolu.
- **Early Windows script installations:** the compatibility `Install.cmd` writes `Yolu.exe` to the existing installation directory, uses the old executable's stop entry point when needed, and replaces Start menu shortcuts. Stop launching the old executable. This is the legacy Go/WebView2 path, not the current Tauri release pipeline.
- **Linux DEB:** stop the old application, then use `sudo apt install ./yolu_<version>_x86_64-unknown-linux-gnu.deb`. The new package declares replacement/conflict with `work-hub`; apt handles removing that package. If a direct `dpkg -i` encounters a conflict, remove the old package before installing. Maintenance scripts check both old and new host/backend process names.
- **AppImage:** safely stop the old backend, replace the file and update any manually created launcher path.

Open Yolu and verify projects, tasks, working directories and session references before removing remaining old application files. A mismatched old backend is not silently reused; stop it through the old application and retry. Do not remove authentication/discovery files to bypass this check.

## Intentionally retained identifiers

| Identifier | Reason |
| --- | --- |
| `WorktreeHub`, `~/.local/share/worktree-hub`, `worktree-hub.db` | Existing data, database locking and backup paths; new installations use the same data convention |
| `dev.work-hub.desktop` and `.preview` | Stable desktop identity and preview isolation |
| `WORK_HUB_CONTEXT.md`, `work-hub:task-context` marker | Existing generated context and agent instructions |
| Go module `worktree-hub`, backend protocol/authentication identifiers and WSL helper paths | Module and cross-process compatibility |
| `workhub:*` storage keys, events, CSS and `WorkHub*` internal interfaces | Existing preferences, drafts and frontend/backend integration |
| `WORK_HUB_*` / `WORKTREE_HUB_*` environment variables | Script compatibility; Windows signing prefers `YOLU_WINDOWS_CERTIFICATE_THUMBPRINT` |

These are compatibility identifiers, not alternate public product names. The rename does not introduce an automatic updater or relocate saved task workspaces.
