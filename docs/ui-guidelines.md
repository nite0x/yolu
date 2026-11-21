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
| Application frame | `web/core/chrome.css`, `desktop-frame.css`, `page-host.css` | Shared navigation, pane surfaces, elevation, gutters and host geometry |
| Pane layout | `frontend/workspace/page-surface.tsx`, `page-surface.css` | Shared split layout and pane markup |
| Lists | `frontend/workspace/list-controls.tsx`, `session-browser.tsx` | List headings, creation actions, search, rows, selection and date groups |
| Working directories | `frontend/workspace/working-directories.tsx`, `working-directories.css` | Project and workspace directory tables, Git summaries and row actions |
| Conversation surface | `frontend/workspace/conversation-surface.tsx`, `conversation-surface.css` | Header, status, context and pane actions |
| Conversation panel | `frontend/chat/conversation-panel.tsx`, `use-chat-reading.ts` | Shared panel, runtime lifecycle, draft synchronization, history anchors, run state and feedback |
| Conversation content | `frontend/components/assistant-ui/elements/thread.aui.tsx` | Messages, Markdown, shared composer, send/stop and keyboard behavior |
| Basic controls | `frontend/components/ui/` | Buttons, inputs, selects, dialogs, alerts, badges and tables |
| State and persistence | `frontend/chat/`, `frontend/workspace/` controllers | Requests, drafts, history, environment identity and lifecycle |

Use component-level APIs for caller-specific labels and actions. For example, `ConversationList.onSelect` lets the global assistant use the shared rows with its own conversation identity and callback. Legacy native-session callers retain their controller attributes. The shared `Composer` accepts input labels, placeholders and limits while retaining its editor, send/stop controls and shortcut behavior.

## Layout and surfaces

The [navigation design](navigation-design.md) defines the shared navigator, pinned collections and main-pane transitions.

Workspace and project routes show a single list or detail surface at every viewport size. Their lists share `resource-list-page` and the existing creation, search and filter controls. Details use the full surface and pair a list breadcrumb with `ResourceSwitcherTrigger`. The switcher orders recently opened items by environment and identity, then offers the remaining items through search. Returning to a list restores its search, filters, scroll position and focused row.

The shared page host opens global search from the desktop title bar, the shared navigation utility row, or **Cmd/Ctrl+K**. It shows recent resources when the query is empty and groups matching names or titles by workspace, project and conversation. Results retain their execution environment and use the same navigation paths as the sidebar. Keep the modal in the host so keyboard focus and navigation work across panes. Escape returns focus to the invoking control.

Global search keeps results in memory across dialog opens and reads saved conversation titles and archive state first. Entering a search term starts background conversation discovery. Available results stay usable while discovery runs.

Use `WorkspaceSplitLayout` when a workflow requires two simultaneously visible panes, such as browsing conversations. Use `WorkspacePane` for the list and detail surfaces. Static HTML and legacy controllers apply the same `workspace-pane` class. The global assistant uses a single panel that switches between the conversation and its history.

```tsx
import {WorkspacePane, WorkspaceSplitLayout} from "@/workspace/page-surface";

<WorkspaceSplitLayout>
  <WorkspacePane as="aside" aria-label={listLabel}>
    {list}
  </WorkspacePane>
  <WorkspacePane aria-labelledby="conversationTitle">
    {conversation}
  </WorkspacePane>
</WorkspaceSplitLayout>
```

| Purpose | Existing token or contract |
| --- | --- |
| Navigation | Persistent conversation navigator beside the main pane |
| Pane gap | `--workspace-pane-gap`, currently 8px |
| Outer inset | `--workspace-pane-inset`, currently 8px |
| List width | `--workspace-list-width`, default 280px, owned by the existing list-width preference |
| Pane radius | `--yolu-pane-radius`, currently 14px |
| Pane elevation | `--yolu-elevation` |
| Small controls and selected tabs | `--yolu-chip-radius`, `--yolu-elevation-sm` |
| Floating controls and composer | `--yolu-elevation-float` |
| Narrow layout | Existing 760px product-page breakpoint |

Keep the canvas, pane gap and raised surfaces at the application-frame layer. Pane contents use the available width with `min-width: 0` and a bounded scroll region. Give list and detail areas independent scrolling when the workflow requires both. Reuse `setupSplitResize` and the corresponding saved preference when a divider is adjustable.

At narrow widths, keep the return control and switcher visible as the resource header wraps. For split conversation views, show the active pane and provide a keyboard-accessible return control. Preserve selection, unsent text and reading position while switching panes. Compare browser and desktop at the same viewport sizes.

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

Use `WorkingDirectoryTable` and `WorkingDirectoryRow` in project and workspace details. Both show the directory, branch and copyable path together, with separate remote sync and local change columns. Keep the open-tool selector, files and changes, terminal and more actions in the same order. Workspace details use a tinted overview for the goal, conversation actions and directory status filters. The project view adds a linked-workspace column, gives the primary directory a tinted row and groups derived worktrees by attention signals. These groups describe visible Git state. Callers supply directory availability, context-specific details, recovery notices and actions. The table stacks its fields when its containing surface narrows. A link between a workspace and its project detail supplies the directory path in the route so the destination can focus and reveal the matching row.

Use `ConversationHeader` and `ConversationStatusBadge` for both native and global-assistant conversations. The header title identifies the active conversation. Context and controls use the component's existing slots.

Forms use the shared `Button`, `Input`, `Textarea`, `NativeSelect`, `Label`, `Dialog` and `Alert` components. Choose variants and sizes from the shared component API. Keep one clear primary action for the current operation. Preserve editable values during polling, navigation and failed requests. Place feedback next to the affected action or field and expose pending state while preventing duplicate delivery.

Project registration uses `ProjectForm` and `ProjectScanResults` for both entry
points. Its fixed header and footer share the workspace dialog scroll layout. The
project controller owns scan results, editable names, selection and per-item
registration outcomes. Changing the scan root, source or execution environment
invalidates the results. Successful registrations return to the invoking
workspace picker with every added project selected.

## Conversation contract

Native coding conversations and the global assistant both render `ConversationPanel` from `frontend/chat/conversation-panel.tsx`. This component owns the runtime provider, labelled panel, header placement, message/composer area, return-to-latest control and feedback placement. It renders the shared `Thread` and `Composer`.

Both adapters call `useConversationRuntime` for connection lifetime and bidirectional draft synchronization, and `useChatReading` for reading anchors, automatic history loading and scroll restoration. Controllers implement the small structural contracts consumed by these hooks. Their domain-specific identity, permissions, model communication and history ownership are supplied by the native and assistant adapters. Native attachments, questions, approvals, file access and runtime controls use the panel's explicit slots.

The shared composer owns its input shell, resize behavior, send/stop controls, keyboard shortcuts and rejected-submission restoration. Settings exposes an application-wide send shortcut, defaulting to Enter. Enter-to-send uses Shift+Enter for newlines. Saved changes apply to open conversation panes, including active-turn supplements, and preserve IME composition. The controller supplies authoritative draft and run state. Coordinate draft restoration once so a failed send produces one restored copy. Pending request identities stay attached to their original payload across retries. The global assistant header exposes a clear-context action that resets the selected workspace, project and environment to local context, preserving the draft and creating a new request identity for the changed payload.

The shared composer exposes Codex voice dictation in both entry points. `frontend/chat/voice-input.ts` owns microphone and WebRTC lifetime, while `use-voice-input.ts` appends input transcript fragments through the existing composer runtime. Dictation preserves existing draft text and requires explicit sending after it stops. Connecting, listening, finishing and failed states stay next to the input. Hiding or unmounting the pane releases the microphone and signaling session. The local backend uses the installed Codex daemon and its login to negotiate a V3 WebRTC session. Linux desktop webviews without WebRTC use Codex's packaged `codex-voice-host` for capture and transport, and receive user transcript fragments over an authenticated local stream. Client-managed handoffs keep the recording separate from coding turns.

Use the shared Markdown/message rendering, history-loading controls and run indicator. Display tools and attachments according to the runtime's actual capabilities. Empty-state text should help the user start their current work. Keep release planning and implementation progress in documentation.

Coding conversations expose one settings popover on the composer's trailing side. Its model and permission rows open anchored menus with independent scrolling, and its effort and speed choices follow the selected model's catalog. Changing agents in a new conversation resets provider-specific settings and preserves the draft. When the runtime advertises response tiers, an explicit choice applies to the next turn. Review the current context in the same popover for existing and read-only conversations.

New and existing coding conversations use the same bottom-docked composer and show the selected working directory in the header. Keep the workspace directory choices and the UI/terminal switch in the welcome area. Keep the agent picker in its own creation-only section of the settings popover. The composer summary uses agent, permission and speed icons alongside a truncatable model name and exposes the full settings through its tooltip and accessible description. Show transient run and draft feedback above the composer so it can stay docked.

Standalone Codex visualization references in assistant messages render as expandable previews. Only files in the local conversation's Codex visualization folder can be served. The preview uses an opaque-origin sandbox, an inline-only resource policy and a separate frame so the message renderer and application API keep their existing content policies.

Open the global assistant from the navigation utility row or **Alt+Shift+Y**. The shared page host owns the panel across workspace and native conversation navigation. Above 760px it sits at the right edge while the current page remains visible. At 760px and below it fills the content area and moves focus into the panel. Closing returns focus to the invoking page and preserves assistant state. The panel header identifies the assistant and exposes history and the context captured when it opened. The footer launcher shows whether an assistant action is running or awaiting approval.

Application operations use `frontend/chat/assistant-actions.tsx` as custom tool content inside the corresponding assistant reply. `assistant-messages.ts` associates queries and plans with loaded transcript turns by `run_id`, including cards that arrive before the final reply text. The cards scroll with conversation history. Pending plans remain expanded and directly actionable. Resource cards carry validated environment/kind/ID targets and use the shared navigation bridge. Plan cards show resolved targets and preconditions, bind clicks to the displayed revision/digest, and expose confirmation, cancellation, member progress and recovery. Render structured domain errors as text with localized application messages. Preserve user-authored names, paths and content. Completed plans keep their result links and detailed domain outcomes available.

Plan headers identify the operation, resource name and current state. Reviews show the development goal, working directory and grouped project choices with their modes, branches and source refs. When creation includes a Codex launch, the review shows the first instruction, main and additional directories, model, and permissions above the confirmation controls. Full technical reviews include internal identifiers, baseline commits and plan versions in a disclosure. Pending plans omit empty execution progress. The footer shows the execution environment and groups cancellation with the primary confirmation action. Query results use the same compact disclosures and resource rows, with choices and errors expanded. `frontend/chat/assistant-actions.css` scopes these layouts to the shared chat panel and adapts them to the panel width.

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
