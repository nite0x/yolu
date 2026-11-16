# Shared product UI

## Scope and ownership

Yolu uses one product UI across its browser and desktop entry points. These guidelines cover workspace, project, conversation, assistant and settings pages. They support the core workflow of finding a workspace, inspecting its participating projects and continuing development with consistent navigation and controls.

The existing workspace and conversation pages are the visual reference. Before implementing a page, identify the corresponding shared layout, list, form or conversation component below. Extend that component when the same behavior is needed by several callers. Feature controllers own domain data and operations. Shared components own presentation and common interaction contracts.

Native title bars, window controls, application menus and operating-system dialogs use host capabilities. The retained `data-workhub-desktop` attribute selects the shared application layout in both entry points. Native integration also supplies `data-workhub-platform` and the host bridge.

## Source map

| Layer | Source | Responsibility |
| --- | --- | --- |
| Palette | `web/core/appearance.css`, `web/core/appearance.js` | Saved palette, light/dark appearance and semantic color tokens |
| Typography | `web/core/typography.css` | Font families, text sizes and weights |
| Component tokens | `frontend/styles.css` | Scoped shadcn aliases, utility layers and shared imports |
| Application frame | `web/core/chrome.css`, `desktop-frame.css`, `page-host.css` | Rail, pane surfaces, elevation, gutters and host geometry |
| Pane layout | `frontend/workspace/page-surface.tsx`, `page-surface.css` | Shared split layout and pane markup |
| Lists | `frontend/workspace/list-controls.tsx`, `session-browser.tsx` | List headings, creation actions, search, rows, selection and date groups |
| Conversation surface | `frontend/workspace/conversation-surface.tsx`, `conversation-surface.css` | Header, status, context and pane actions |
| Conversation content | `frontend/components/assistant-ui/elements/thread.aui.tsx` | Messages, Markdown, shared composer, send/stop and keyboard behavior |
| Basic controls | `frontend/components/ui/` | Buttons, inputs, selects, dialogs, alerts, badges and tables |
| State and persistence | `frontend/chat/`, `frontend/workspace/` controllers | Requests, drafts, history, environment identity and lifecycle |

Use component-level APIs for caller-specific labels and actions. For example, `ConversationList.onSelect` lets the global assistant use the shared rows with its own conversation identity and callback. Legacy native-session callers retain their controller attributes. The shared `Composer` accepts input labels, placeholders and limits while retaining its editor, send/stop controls and shortcut behavior.

## Layout and surfaces

Use `WorkspaceSplitLayout` for a list/detail page with two participating panes. Use `WorkspacePane` for the list and detail surfaces. Static HTML and legacy controllers apply the same `workspace-pane` class. Workspace and project panes already use this class, and the global assistant uses the React components.

```tsx
import {WorkspacePane, WorkspaceSplitLayout} from "@/workspace/page-surface";

<WorkspaceSplitLayout>
  <WorkspacePane as="aside" aria-label={uiText("助手历史")}>
    {list}
  </WorkspacePane>
  <WorkspacePane aria-labelledby="conversationTitle">
    {conversation}
  </WorkspacePane>
</WorkspaceSplitLayout>
```

| Purpose | Existing token or contract |
| --- | --- |
| Navigation rail | 52px shared application rail |
| Pane gap | `--workspace-pane-gap`, currently 8px |
| Outer inset | `--workspace-pane-inset`, currently 8px |
| List width | `--workspace-list-width`, default 280px, owned by the existing list-width preference |
| Pane radius | `--yolu-pane-radius`, currently 14px |
| Pane elevation | `--yolu-elevation` |
| Small controls and selected tabs | `--yolu-chip-radius`, `--yolu-elevation-sm` |
| Floating controls and composer | `--yolu-elevation-float` |
| Narrow layout | Existing 760px product-page breakpoint |

Keep the canvas, pane gap and raised surfaces at the application-frame layer. Pane contents use the available width with `min-width: 0` and a bounded scroll region. Give list and detail areas independent scrolling when the workflow requires both. Reuse `setupSplitResize` and the corresponding saved preference when a divider is adjustable.

At narrow widths, show the appropriate list or detail pane and provide a keyboard-accessible return control. Preserve selection, unsent text and reading position while switching panes. Compare browser and desktop at the same viewport sizes.

## Color and typography

Use semantic palette values such as `--yolu-canvas`, `--yolu-surface`, `--yolu-foreground`, `--yolu-muted-ink`, `--yolu-primary`, `--yolu-selected`, `--yolu-border` and `--yolu-ring`. Components inside `.shadcn-scope` use the corresponding `--background`, `--foreground`, `--muted-foreground`, `--primary`, `--accent`, `--border` and `--ring` aliases. Changes to a shared palette or text role belong in its source file.

Use the existing typography roles.

| Role | Token | Current size |
| --- | --- | --- |
| Labels and secondary controls | `--yolu-font-size-label` | 12px |
| Compact metadata | `--yolu-font-size-compact` | 13px |
| Resource rows | `--yolu-font-size-row` | 14px |
| Body text | `--yolu-font-size-body` | 15px |
| List titles | `--yolu-font-size-list-title` | 16px |
| Detail titles | `--yolu-font-size-detail-title` | 19px |

Use `--font-sans` for application text and `--font-mono` for code and paths. Existing conversation headers and message components own their role-specific typography. Keep user content selectable and preserve its language and formatting. Brand artwork follows the separate [brand reference](brand/yolu/README.md).

## Lists, headers and forms

Use `ListCreateButton` for a list's primary creation action and `ListSearch`/`ListFilter` when the workflow needs search or filtering. Conversation lists use `ConversationList`, including its selected state, date groups, timestamps, truncation and focus styling. Put resource identity and essential state in the row. Detail views carry longer explanations and secondary actions.

Use `ConversationHeader` and `ConversationStatusBadge` for both native and global-assistant conversations. The header title identifies the active conversation. Context and controls use the component's existing slots.

Forms use the shared `Button`, `Input`, `Textarea`, `NativeSelect`, `Label`, `Dialog` and `Alert` components. Choose variants and sizes from the shared component API. Keep one clear primary action for the current operation. Preserve editable values during polling, navigation and failed requests. Place feedback next to the affected action or field and expose pending state while preventing duplicate delivery.

## Conversation contract

Both native coding conversations and the global assistant render the shared `Thread` and `Composer`. Their controllers preserve their respective identity, permissions, model communication and history ownership.

The shared composer owns its input shell, resize behavior, send/stop controls, keyboard shortcuts and rejected-submission restoration. The controller supplies authoritative draft and run state. Coordinate draft restoration once so a failed send produces one restored copy. Pending request identities stay attached to their original payload across retries.

Use the shared Markdown/message rendering, history-loading controls and run indicator. Display tools and attachments according to the runtime's actual capabilities. Empty-state text should help the user start the current task. Keep release planning and implementation progress in documentation.

## Accessibility and localization

Use semantic buttons, headings, lists, forms and labelled regions. Icon-only actions need accessible names and tooltips. Keep keyboard focus visible with the shared ring, expose selection and pending states, and respect reduced-motion preferences. Long titles and paths need safe truncation with the full value available where relevant. Error feedback uses an alert and loading/progress feedback uses a status region.

Application text uses `uiText` with Simplified Chinese source messages and English catalog entries. Static HTML uses explicit `data-i18n` attributes. Preserve interpolation values, user-authored content, drafts and terminal output. See [localization guidance](development.md#localization).

## Change and verification workflow

1. Read these guidelines and inspect the nearest existing page at the same state and viewport size.
2. Choose the shared components and identify the owning token files before adding feature-specific styles.
3. Keep domain-specific controllers and identities explicit while sharing presentation through component props and callbacks.
4. Build both frontend bundles before backend or desktop compilation.
5. Exercise populated, empty, loading and failed states relevant to the change. Verify keyboard navigation, list/detail transitions, draft restoration and long content.
6. Compare browser and desktop entry points at comparable wide and narrow viewports. Check the saved appearance and language choices relevant to the changed surface.
7. Run the affected workspace/chat checks and existing navigation/localization tests. Record visual evidence and any unavailable native-host verification.

A change to these shared contracts updates the owning component, affected callers and this document together. This keeps the implementation and the guidance aligned as the application grows.
