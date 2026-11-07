<p><img src="web/yolu.png" width="88" height="88" alt="Yolu icon"></p>

# Yolu

A personal desktop workspace for development across multiple repositories, organized around tasks.

[User guide](docs/guide.md) · [Development](docs/development.md) · [Documentation](docs/README.md) · [Releases](https://github.com/nite0x/yolu/releases) · [Issues](https://github.com/nite0x/yolu/issues)

The standalone [application website](website/README.md) introduces the workflow in Simplified Chinese and English. Preview it with `npm run site:dev`, or build its static files with `npm run site:build`.

A task can span several repositories, branches and working directories. Yolu brings them into one place: inspect each project's state, create isolated Git worktrees, review changes, and continue in a terminal, editor or Codex conversation.

## Features

- **Organize work by task.** Associate multiple projects with a goal. Create a new branch and worktree for each project, or reuse an existing directory.
- **Inspect and manage Git work.** See actual branches, local changes and upstream status; preview diffs and perform Git operations from the task.
- **Continue conversations in context.** Create, link and resume Codex sessions with streaming replies, approvals, questions, attachments and persistent drafts.
- **Keep several workspaces open.** Use tabs and up to three panes, including embedded terminals for installed command-line tools.
- **Review before cleanup.** Archive a task, inspect its worktrees and remove eligible directories after explicit confirmation. Branches and conversation history are retained.
- **Work locally or in WSL.** Windows installations can connect to a WSL distribution and user. Each task belongs to one execution environment.

Yolu uses Tauri, Go and SQLite. Application records stay in a local data directory. Conversations use the Codex CLI installed and authenticated in the selected environment, with that environment's account and provider configuration. The interface supports English and Simplified Chinese, follows the system language by default, and remembers an explicit choice in Settings. Documentation is maintained in English.

## Get started

1. Download the package for your operating system and CPU from [Releases](https://github.com/nite0x/yolu/releases), when available. Build targets are macOS Apple Silicon and Intel, Windows x64, and Linux x64 (DEB and AppImage).
2. Install Git in the environment where your repositories live. For conversations, also install and authenticate the Codex CLI there.
3. Register a Git repository, create a task, and choose the participating projects and working directories.
4. Inspect branches and changes, then open a terminal, editor or conversation from the task.

Installed Yolu packages do not require Go, Rust or Node.js to run. See the [user guide](docs/guide.md) for platform requirements, permissions, backups and upgrades. Existing Work Hub users should read the [migration guide](docs/brand/yolu/migration.md); saved data and worktree locations remain compatible.

## Build from source

Use Node.js 22.12 or later, Go as required by `go.mod`, Rust, and the [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/nite0x/yolu.git
cd yolu
npm ci
npm run desktop:dev
```

The [development guide](docs/development.md) covers browser mode, builds, checks, native packaging and signing. Building a platform package does not establish that its installer has passed native verification; see the [release checklist](docs/open-source-release.md).

## Contributing

Report problems or discuss changes through [Issues](https://github.com/nite0x/yolu/issues). Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

Yolu focuses on the personal workflow from a task to its projects, working directories and development tools.

## License

Copyright 2026 Yolu contributors.

Unless otherwise noted, this project is licensed under the [Apache License 2.0](LICENSE). Third-party components retain their own licenses and copyright notices.
