# Product direction and scope

Yolu is a multi-agent development conversation tool. Projects register repositories, conversations organize the work, and Git worktrees provide independent development directories.

## Current core scope

- Start or resume conversations from the shared navigator or a project.
- Associate each conversation with a primary project and additional projects or local directories in the same execution environment.
- Show the actual directory, Git branch, file changes, and effective agent access for each binding. Reuse the existing file, diff, Git and terminal components.
- Support registered directories, existing worktrees and new independent worktrees. Keep worktree lifetime independent of conversation lifetime.
- Keep the Issues page linked to the external tracker. If issue integration is added, retain external tracker ownership.
- Worktrees created by Yolu default to `~/workspaces` in the execution environment. Use `--root` to choose another location. Preserve saved paths and existing directories.

## Before adding a feature

1. Identify the developer problem in the conversation, project or worktree workflow.
2. Explain how the proposed change supports this direction.
3. Reuse an existing capability or choose the smallest change that solves the problem.

## Shared desktop and browser UI

Desktop and browser access are entry points to the same application. Use shared frontend components, layouts, design tokens and interaction logic for all product pages. Apply UI improvements and fixes to both entry points by default.

Scope host-specific rendering to desktop integrations such as native title bars, window controls, application menus, operating-system dialogs and desktop capabilities. Detect the corresponding host capability when rendering these controls. Keep project, conversation and settings UI shared across entry points. Adapt layouts to viewport size consistently in both environments.

When changing shared UI, verify the affected pages through browser and desktop entry points at comparable viewport sizes. Include normal navigation and pane transitions in the checks. Build frontend assets before embedding them in the backend or generating installation packages.

Before changing product UI, read [the shared UI guidelines](docs/ui-guidelines.md) and inspect the nearest existing page. Reuse the documented components and tokens. Extend shared component APIs when several pages need the same pattern, and keep the guidelines aligned with those APIs.

## Brand reference

Before creating logos, icons, diagrams or brand artwork, read the [Yolu brand reference](docs/brand/yolu/README.md) and use the approved reference image and the `web/yolu.svg` vector master. Preserve the recognizable antler-shaped Y silhouette. Do not put Chinese text in the logo; use only `Yolu` for the English wordmark and center it visually against the symbol. The default colors are deep teal and mint. After editing the master, run `npm run brand:icons` to synchronize platform assets. Compatibility rules for historical data, protocols and installation identities are documented in `docs/brand/yolu/migration.md`.

## Documentation language

Write and maintain all repository documentation in English, including READMEs, development guides, contributor instructions and issue/PR templates.
