# Frontend modules

The frontend uses explicit layers and feature ownership. Browser and desktop
entry points compose the same modules. The directory tells you which module
owns a component, state transition, style or browser integration.

```text
frontend/
  entrypoints/                  Build entries and explicit startup calls
  app/
    bootstrap/                  Workspace assembly and static mounts
    bridge/                     Composition of the legacy browser contract
    shell/                      Navigation, window layout, sidebar and dialogs
    model/                      Application operation ownership
    styles/                     Product-wide style composition
  features/
    conversations/
      creation/                 New-conversation directory selection
      list/                     Catalog state, rows, navigation and file dock
      model/                    Message conversion, settings and approval data
      runtime/                  Controller, drafts, history and reading lifetime
      ui/                       Chat panels, questions, context and media
      voice/                    Dictation transport and composer integration
      usage/                    Codex usage display
      components/assistant-ui/  Registry-derived conversation components
      bridge.tsx                Conversation methods exposed to native controllers
    files/                      File browser, diffs and lazy source viewer
    git/                        Git views, dialogs and interactive operations
    projects/                   Registration, scanning and directory cards
    settings/
      model/                    Typed host context and settings records
      runtime/                  Serialized saves per setting/environment scope
      ui/                       React preferences, diagnostics and native form adapters
      bridge.tsx                Explicit settings mount and retained presentation contract
    terminal/                   Terminal page and its presentation
  entities/
    conversations/              Catalog records, bindings, context and status rules
    projects/                   Repository types, root selection and presentation
  core/                         HTTP transport, shared reads and pane protocol
  api/                          Generated Go/TypeScript transport contracts
  shared/
    ui/primitives/              shadcn controls
    ui/actions/                 Named actions, icon buttons and pending buttons
    ui/forms/                   Field associations, validation and checkboxes
    ui/feedback/                Messages, loading and empty states
    ui/layout/                  Dialog and section presentation
    ui/data-display/            Status badges, tables and code previews
    ui/                         Lists, surfaces, help and resource icons
    hooks/                      Reusable React hooks and input preference
    lib/                        Identity, preferences, resizing and utilities
    i18n/                       Localization API and catalogs
    styles/                     Theme tokens and base control styles
  dev/                          Independent shared-component catalog
  architecture.json             Allowed dependencies and feature integrations
```

## Dependency rules

| Layer | Allowed dependencies |
| --- | --- |
| `entrypoints` | Application assembly and lower layers |
| `app` | Feature adapters, entities, transport and shared modules |
| `features` | Own implementation, entities, transport and shared modules |
| `entities` | Other entities, transport contracts and shared modules |
| `core` | Transport contracts and shared infrastructure |
| `shared` | Other shared modules and transport contracts |
| `api` | Generated contracts only |

Business modules never import application assembly or tooling entrypoints.
Models and runtime state never import rendered UI. Feature-to-feature imports
must name an integration file explicitly allowed in `architecture.json`; the
current integration is the conversation file dock using the file browser and
its change records. Features cannot form dependency cycles.

Use direct imports such as `@/entities/conversations/catalog` across layers and
relative imports within a feature. Do not create a catch-all export barrel.
Shared controls cannot reach into a feature to fetch data or manage a run.
Primitives cannot depend on composed UI. Developer catalog sources depend only
on shared components and cannot be imported by production code. See the
[shared component guide](shared/ui/README.md) for APIs, examples and checks.
The conversation runtime tracks connection failures separately from operation
failures: recovered reads clear only the connection error they own, preserving
failed sends and approval errors for their explicit recovery actions.
Conversation controllers use an LRU cache targeting eight retained owners per
reader. Eviction waits for durable draft writes and never discards an active
owner, an uncertain send/fork, pending approval work or unsent blocking answers.
Failed writes retain their owner until a later successful retry. Reload checks
flush every retained draft, including inactive conversations. Pane render
boundaries contain component failures and retry without replacing the controller.
Keep project-specific status, root filtering and editor actions in the project
entity instead of adding them to generic form controls.

## Startup and browser adapters

`entrypoints/workspace.tsx` invokes `app/bootstrap/workspace.tsx`.
`entrypoints/conversation.tsx` owns the document's chat mount and retained
controller bridge. Terminal and file-viewer entries call their explicit mount
or installation functions. Importing feature presentation does not start a page.

Each feature owns its `bridge.ts` or `bridge.tsx` renderer/adapter. Only
`app/bridge/workspace-ui.tsx` composes those adapters into the existing
`window.WorkHubUI` contract. Keep its names stable for the native page
controllers. New business behavior belongs in the owning feature; application
assembly should only compose it.

`web/` remains the Go hosting boundary: HTML templates, icons, legacy page
controllers and generated bundles. `web/core` owns the existing host/page glue;
`web/features` contains feature-specific native controllers. They consume the
composed browser interfaces. Add new checked logic to its feature under
`frontend/`, or to `core` for provider-independent transport. Avoid adding another
parallel implementation to a legacy controller.

Public asset URLs, storage keys, conversation identities and pane messages are
independent of these source paths. The browser and Tauri host keep using the
same emitted assets.

## Styles, builds and checks

Generic tokens live in `shared/styles/base.css`. Feature styles stay with their
own components. `app/styles/workspace.css` composes project and file styles for
the workspace; the conversation stylesheet composes its own styles and shared
tokens. Shared styles do not import a feature stylesheet.

Build scripts select files in `entrypoints`. They preserve the existing emitted
names such as `ui.js`, `page-layout.js`, `terminal.js` and `assistant.js`.

```bash
npm run web:architecture
npm run ui:dev
npm run ui:check
npm run ui:test:browser
npm run check
npm run build
npm run bundle:check
npm run app:test
npm run chat:test
node --test scripts/*.test.cjs
```

`web:check` includes the architecture checker and its rule tests, so the existing
CI check also enforces module boundaries. The checker includes type-only imports,
re-exports, literal lazy imports and CSS dependencies. Update the manifest only
when adding a deliberate integration, and document who owns its lifecycle.
See [development and browser verification](../docs/development.md) for the real
Chromium workflow and [application boundaries](../docs/architecture.md) for
backend ownership and API contract generation.

Settings presentation has explicit owners: React controls appearance, language,
send shortcuts and diagnostic reports; feature-local typed adapters own the
remaining native forms. `web/features/settings/settings.js` only supplies host
context and capabilities. Polling refreshes context through that mount and does
not replace preference form state. Settings writes are serialized by scope while
independent environments can save concurrently.
