# Product direction and scope

This project is a personal development workspace with workspaces as its primary entry point. A project is a codebase maintained over time. A workspace is where one complete requirement is developed: it organizes the participating projects and their working directories, branches and sessions, and stays in use until the requirement is done. A requirement can be a feature, fix, refactoring or technical experiment, and may involve several branches and iterations. The core goal is to open a workspace, see all its associated projects and their directories, branches and change states in one place, and enter the appropriate working environment to continue.

## Current core scope

- Workspaces are the main entry point; project management supplies repositories for workspaces.
- A workspace can include multiple projects, with their worktrees grouped under one workspace directory.
- Inspect each project's working-directory state from the workspace and open a terminal or Git operation directly.
- Issues: a separate page aggregates issues assigned to me (Linear first, GitHub later). From an issue I can create a workspace, change its status, and post a reply. All other issue management stays in the source platform.
- Prefer reusing existing capabilities to reduce searching and switching between pages.

The workspace root defaults to `~/workspaces` in the execution environment. Use `--root` to explicitly select another location; do not automatically switch to a Windows-mounted directory merely because one exists. Existing workspaces keep their saved paths and are not moved automatically.

Use workspace consistently in the interface, documentation, domain models, routes and storage. A workspace can have its own directory or reuse existing project directories.

Complete this minimal workflow first, then add capabilities incrementally to address concrete problems encountered in use. Previously discussed directions such as session management, service operation, notifications and complex state transitions are candidates, not established development commitments.

## Before adding a feature

1. Which concrete user problem in the core workflow does it solve?
2. Does it fit the direction of organizing cross-project work through workspaces?
3. Can existing capabilities or a smaller change solve it?

Before implementation, briefly explain how the feature fits the direction. If that cannot be answered clearly, defer it; do not add a feature solely because similar tools offer it. If a feature expands the product direction, explain the departure and let the user decide whether to change scope.

## Shared desktop and browser UI

Desktop and browser access are entry points to the same application. Use shared frontend components, layouts, design tokens and interaction logic for all product pages. Apply UI improvements and fixes to both entry points by default.

Scope host-specific rendering to desktop integrations such as native title bars, window controls, application menus, operating-system dialogs and desktop capabilities. Detect the corresponding host capability when rendering these controls. Keep workspace, project, conversation and settings UI shared across entry points. Adapt layouts to viewport size consistently in both environments.

When changing shared UI, verify the affected pages through browser and desktop entry points at comparable viewport sizes. Include normal navigation and pane transitions in the checks. Build frontend assets before embedding them in the backend or generating installation packages.

Before changing product UI, read [the shared UI guidelines](docs/ui-guidelines.md) and inspect the nearest existing page. Reuse the documented components and tokens. Extend shared component APIs when several pages need the same pattern, and keep the guidelines aligned with those APIs.

## Brand reference

Before creating logos, icons, diagrams or brand artwork, read the [Yolu brand reference](docs/brand/yolu/README.md) and use the approved reference image and the `web/yolu.svg` vector master. Preserve the recognizable antler-shaped Y silhouette. Do not put Chinese text in the logo; use only `Yolu` for the English wordmark and center it visually against the symbol. The default colors are deep teal and mint. After editing the master, run `npm run brand:icons` to synchronize platform assets. Compatibility rules for historical data, protocols and installation identities are documented in `docs/brand/yolu/migration.md`.

## Documentation language

Write and maintain all repository documentation in English, including READMEs, development guides, contributor instructions and issue/PR templates.
