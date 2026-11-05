# Product direction and scope

This project is a personal development workspace with tasks as its primary entry point. A project is a codebase maintained over time. A task is a piece of development work with a clear objective, organizing the participating projects and their working directories, branches and sessions. Tasks can cover features, fixes, refactoring or technical experiments. The core goal is to open a task, see all its associated projects and their directories, branches and change states in one place, and enter the appropriate working environment to continue.

## Current core scope

- Tasks are the main entry point; project management supplies repositories for tasks.
- A task can include multiple projects, with their worktrees grouped under one task workspace directory.
- Inspect each project's working-directory state from the task and open a terminal or Git operation directly.
- Prefer reusing existing capabilities to reduce searching and switching between pages.

The workspace root defaults to `~/workspaces` in the execution environment. Use `--root` to explicitly select another location; do not automatically switch to a Windows-mounted directory merely because one exists. Existing tasks keep their saved paths and are not moved automatically.

Complete this minimal workflow first, then add capabilities incrementally to address concrete problems encountered in use. Previously discussed directions such as session management, service operation, notifications and complex state transitions are candidates, not established development commitments.

## Before adding a feature

1. Which concrete user problem in the core workflow does it solve?
2. Does it fit the direction of organizing cross-project work through tasks?
3. Can existing capabilities or a smaller change solve it?

Before implementation, briefly explain how the feature fits the direction. If that cannot be answered clearly, defer it; do not add a feature solely because similar tools offer it. If a feature expands the product direction, explain the departure and let the user decide whether to change scope.

## Brand reference

Before creating logos, icons, diagrams or brand artwork, read the [Yolu brand reference](docs/brand/yolu/README.md) and use the approved reference image and the `web/yolu.svg` vector master. Preserve the recognizable antler-shaped Y silhouette. Do not put Chinese text in the logo; use only `Yolu` for the English wordmark and center it visually against the symbol. The default colors are deep teal and mint. After editing the master, run `npm run brand:icons` to synchronize platform assets. Compatibility rules for historical data, protocols and installation identities are documented in `docs/brand/yolu/migration.md`.

## Documentation language

Write and maintain all repository documentation in English, including READMEs, development guides, contributor instructions and issue/PR templates.
