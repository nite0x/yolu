# Component inventory

Use the live [shared component guide](../../frontend/shared/ui/README.md) and `npm run ui:dev` catalog. Components below describe the actual four levels; they are not a mandate to create every possible control.

| Level | Existing modules | Reuse contract |
| --- | --- | --- |
| UI primitives | `shared/ui/primitives/{button,input,textarea,native-select,label,badge,alert,card,table,dialog,tooltip,avatar,skeleton}` | Native/Radix controls and variants; no feature data access |
| Shared compositions | `actions/button`, `forms/{field,check}`, `feedback/{message,loading-state,empty-state,render-boundary,root}`, `layout/{dialog,section-heading}`, `data-display/{table,status-badge,code-preview}` | Named icon/pending actions, accessible fields, status/error/loading, recoverable rendering, dialog sections and data presentation |
| Shared interactions/layout | `list-controls`, `conversation-surface`, `help-tip`, resource/file icons, `shared/lib/split-resize` | Search/filter/switcher, conversation headers/context/pane actions, help lifecycle, pointer/keyboard bounds and cleanup |
| Feature compositions | `projects/ui/working-directories`, `git/ui/git`, `files/ui/{browser,split}`, `conversations/ui`, registry assistant-ui elements, `settings/ui/diagnostics`, `terminal/ui/surface` | Resource-specific state and presentation stay local |
| Page assembly | `app/bootstrap/workspace`, app shell, feature bridges, conversation/terminal entrypoints | Stable host contracts and product flows |

Use native checkbox via `Check`; do not add a competing switch/select system. Popovers, dropdown/context menus use the existing Radix dependency or retained native details/dialog owner. Confirmation, form and page headings reuse existing dialog/field/section APIs. There is no generic application DataTable/search/page/layout framework to invent beyond current controls.

`DiagnosticResultView` is a **feature-local** shared composition used by Codex and Antigravity wrappers. It shares status/header/report/check/fact rendering while wrappers retain recovery messages, provider facts and the Codex installation slot. Twenty rendered states were compared byte-for-byte against baseline before integration.

Removed: unused `SplitLayout`/`ApplicationPane` wrapper and its unused grid stylesheet, unreferenced `ProjectOpenActions`, and unused registry surface animation constants/components. Live `workspace-pane` class, directory card open actions, media-player styles and third-party primitive APIs remain.

Search for an existing component before adding one. Prefer a caller slot over boolean-driven variants. Keep controller IDs/data-action attributes and focus behavior when migrating callers. Do not abstract a single feature's behavior into shared UI.
