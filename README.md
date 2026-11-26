<p><img src="web/yolu.png" width="88" height="88" alt="Yolu icon"></p>

# Yolu

A desktop and browser app for multi-agent development across Git repositories and local directories.

[User guide](docs/guide.md) · [Development](docs/development.md) · [Documentation](docs/README.md) · [Releases](https://github.com/nite0x/yolu/releases) · [Issues](https://github.com/nite0x/yolu/issues)

The standalone [application website](website/README.md) introduces the workflow in Simplified Chinese and English. Preview it with `npm run site:dev`, or build its static files with `npm run site:build`.

Start a conversation from a project, choose a Git worktree or use the current checkout, and add other projects or directories as the task develops. Each conversation keeps its own directory choices.

## Features

- **Work across projects.** Attach project worktrees and ordinary directories to the same conversation, review directory access, and follow live Git status.
- **Inspect and manage Git.** Preview staged and working changes, fetch, switch branches, and create or review independent worktrees from Projects.
- **Continue conversations.** Resume native sessions with streaming replies, approvals, questions, attachments and persistent drafts. Open up to three conversation panes.
- **Use your tools.** Open embedded terminals for installed CLIs. Connect external Codex or Claude Code clients to the [read-only project MCP tools](docs/guide.md#connect-an-agent-over-mcp).
- **Work locally or in WSL.** Windows installations can connect to a WSL distribution and user. Each conversation belongs to one execution environment.

Yolu uses Tauri, Go and SQLite. Application records stay in a local data directory. Conversations use an installed and authenticated Codex CLI, Antigravity CLI or Cursor Agent in the selected environment, with that environment's account and provider configuration. The interface supports English and Simplified Chinese, follows the system language by default, and remembers an explicit choice in Settings. Documentation is maintained in English.

## Get started

1. Download the package for your operating system and CPU from [Releases](https://github.com/nite0x/yolu/releases), when available. Build targets are macOS Apple Silicon and Intel, Windows x64, and Linux x64 (DEB and AppImage).
2. Install Git in the environment where your repositories live. For conversations, also install and authenticate Codex CLI, Antigravity CLI or Cursor Agent there.
3. Register a Git repository in Projects and choose **New conversation**.
4. Send a request in the current checkout or choose a different worktree. Use **Add project or directory** in the conversation to expand its context.

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

Yolu focuses on conversations, repositories, working directories and development tools.

## License

Copyright 2026 Yolu contributors.

Unless otherwise noted, this project is licensed under the [Apache License 2.0](LICENSE). Third-party components retain their own licenses and copyright notices.
