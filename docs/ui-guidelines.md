# Shared product UI

## Scope and ownership

Yolu uses one product UI across its browser and desktop entry points. These guidelines cover project, conversation and settings pages. They support starting and resuming conversations, inspecting attached directories and managing Git worktrees.

The existing project and conversation pages are the visual reference. Before implementing a page, identify the corresponding shared layout, list, form or conversation component below. Extend that component when the same behavior is needed by several callers. Feature controllers own domain data and operations. Shared components own presentation and common interaction contracts.

Native title bars, window controls, application menus and operating-system dialogs use host capabilities. The retained `data-workhub-desktop` attribute selects the shared application layout in both entry points. Native integration also supplies `data-workhub-platform` and the host bridge.

## Source map

| Layer | Source | Responsibility |
| --- | --- | --- |
| Palette | `web/core/appearance.css`, `web/core/appearance.js` | Saved palette, light/dark appearance and semantic color tokens |
| Typography | `web/core/typography.css` | Font families, text sizes and weights |
| Component tokens | `frontend/styles.css` | Scoped shadcn aliases, utility layers and shared imports |
| Application frame | `web/core/chrome.css`, `desktop-frame.css`, `page-host.css` | Shared navigation, pane surfaces, elevation, gutters and host geometry |
| Pane layout | `frontend/app/page-surface.tsx`, `page-surface.css` | Shared split layout and pane markup |
| Lists | `frontend/app/list-controls.tsx`, `session-browser.tsx` | List headings, creation actions, search, rows, selection and date groups |
| Working directories | `frontend/app/working-directories.tsx`, `working-directories.css` | Project directory cards, Git summaries and directory actions |
| Conversation surface | `frontend/app/conversation-surface.tsx`, `conversation-surface.css` | Header, status, context and pane actions |
| Conversation panel | `frontend/chat/conversation-panel.tsx`, `use-chat-reading.ts` | Shared panel, runtime lifecycle, draft synchronization, history anchors, run state and feedback |
| Conversation content | `frontend/components/assistant-ui/elements/thread.aui.tsx` | Messages, Markdown, shared composer, send/stop and keyboard behavior |
| Basic controls | `frontend/components/ui/` | Buttons, inputs, selects, dialogs, alerts, badges and tables |
| State and persistence | `frontend/chat/`, `frontend/app/` controllers | Requests, drafts, history, environment identity and lifecycle |

Use component-level APIs for caller-specific labels and actions. For example, `ConversationList.onSelect` lets a caller use shared rows with its own selection callback. Legacy native-session callers retain their controller attributes. The shared `Composer` accepts input labels, placeholders and limits while retaining its editor, send/stop controls and shortcut behavior.

## Layout and surfaces

The [navigation design](navigation-design.md) defines the shared navigator, resource collections and main-pane transitions.

Project routes show a single list or detail surface at every viewport size. Their lists share `resource-list-page` and the existing creation, search and filter controls. Details use the full surface and pair a list breadcrumb with `ResourceSwitcherTrigger`. The switcher orders recently opened items by environment and identity, then offers the remaining items through search. Returning to a list restores its search, filters, scroll position and focused row.

The shared page host groups the product destination icons at the start of the header, with a separator before the Back and Forward controls. Use a 16px glyph in a 32px desktop target for each destination. Give the current page a tinted background, maintain a separate keyboard focus ring, and show each label on hover and keyboard focus. The destination icons remain available when the conversation sidebar is closed. History restores the destination environment, resource route (including directory parameters) and specific conversation. Returning to a retained reader preserves its draft, reading position and split panes. Alt+Left/Right and macOS Cmd+[/] invoke the same history; unavailable directions are disabled. Title and run-state updates replace the current history snapshot without adding visits.

The shared page host opens global search from the centered application-header trigger or **Cmd/Ctrl+K**. On narrow viewports, shorten the search trigger and hide auxiliary labels before reducing navigation targets. Global search shows recent resources when the query is empty and groups matching names or titles by project and conversation. Results retain their execution environment and use the same navigation paths as the sidebar. Keep the modal in the host so keyboard focus and navigation work across panes. Escape returns focus to the invoking control.

The right side of the header shows the Git refresh action and the Codex quota trigger. Announce Git refresh progress and its outcome without moving focus. On hosts with an in-window native application menu, place its icon on the right with the window utilities. The quota trigger shows a percentage when available and a short label otherwise. Show quota errors and retry in its popover.

Global search keeps results in memory across dialog opens and reads saved conversation titles and archive state first. Entering a search term starts background conversation discovery. Available results stay usable while discovery runs.

Use `SplitLayout` when a workflow requires two simultaneously visible panes, such as browsing conversations. Use `ApplicationPane` for the list and detail surfaces. Static HTML and legacy controllers apply the same `workspace-pane` class.

```tsx
import {ApplicationPane, SplitLayout} from "@/app/page-surface";

<SplitLayout>
  <ApplicationPane as="aside" aria-label={listLabel}>
    {list}
  </ApplicationPane>
  <ApplicationPane aria-labelledby="conversationTitle">
    {conversation}
  </ApplicationPane>
</SplitLayout>
```

| Purpose | Existing token or contract |
| --- | --- |
| Navigation | Persistent conversation navigator beside the main pane |
| Pane gap | `--workspace-pane-gap`, currently 8px between split panes |
| Outer inset | `--workspace-pane-inset`, currently 0px |
| List width | `--workspace-list-width`, default 280px, owned by the existing list-width preference |
| Pane radius | Product panes use 0px; `--yolu-pane-radius` is reserved for contained surfaces and overlays |
| Pane elevation | `--yolu-elevation` |
| Small controls and selected tabs | `--yolu-chip-radius`, `--yolu-elevation-sm` |
| Floating controls and composer | `--yolu-elevation-float` |
| Narrow layout | Existing 760px product-page breakpoint |

Keep the canvas and pane gap at the application-frame layer. The shared navigator uses the neutral frame canvas (`--yolu-rail-canvas`, light mode `#f3f5f4`). The global header tints that canvas slightly toward the theme foreground and has a 1px bottom divider to mark the transition to the sidebar and content. Main product panes use `--yolu-surface` (white in light mode) and meet the navigator edge without outer rounding, borders, shadows or insets. Apply these two surface levels to both browser and desktop entry points, including resource pages, settings and conversation readers. Dark mode keeps the corresponding dark frame and content surfaces. Reserve elevation for overlays and the composer. Parallel conversations have a persistent 1px vertical divider centered in the existing 8px resize gutter. Hover and keyboard focus reveal the resize grip. The current pane has a tinted header and full-contrast toolbar controls, while unfocused split panes dim their trailing actions until hovered or focused. These follow the host's existing focus state, independently of conversation run status. Pane contents use the available width with `min-width: 0` and a bounded scroll region. Give list and detail areas independent scrolling when the workflow requires both. Reuse `setupSplitResize` and the corresponding saved preference when a divider is adjustable.

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

Use `ListCreateButton` for a list's primary creation action and `ListSearch`/`ListFilter` when the workflow needs search or filtering. The shared conversation sidebar uses `ListSearch` with `variant="plain"` and inline split/compose actions. Keep its search row borderless. Place the Recent and Grouped controls in the filter menu and retain active scope and filters in a visible, removable chip. Grouped uses section headings and dividers above resource rows. Recent uses a second line for the project or directory. Keep sidebar names on one line and expose truncated values. Show non-local environment labels where needed. Other lists retain the default search field. Conversation lists use `ConversationList` for selection, timestamps, truncation and focus styling. Put resource identity and essential state in the row. Detail views carry longer explanations and secondary actions.

Use `WorkingDirectoryCard` in project details. Project detail pages use a fluid single-column surface aligned with the header. Render collapsed directory cards as compact two-row entries with the directory identity, branch, local status and synchronization on the first line, the copyable path and latest conversation context on the second line, and the new-conversation, file and diff, compact open-tool, terminal, more and expand actions aligned on the trailing side (wrapping below on narrow containers). Disambiguate duplicate worktree leaf folder names with their parent directory segments. Keep the main directory first when it matches the filter and expand it initially. Default the expanded card section to changes when uncommitted edits exist, or related conversations when clean and conversations are present (capping inline previews with a link to view all). Keep quiet inline text for normal synced/clean states so changes, divergence and errors stand out. A directory parameter clears the filter, expands the matching card and moves focus to it. Use the same card in single-directory projects and omit the controls for comparing multiple directories. Recent activity and directory sorting use conversation timestamps.

Grouped conversation navigation shows projects with visible conversations. The project name expands or collapses its group. At rest, the project badge and conversation count are visible by default. The sidebar filter menu saves independent preferences for both. Row hover or visible keyboard focus reveals **Open project details** followed by **New conversation** on the trailing side, in place of the count. On devices without hover, both actions stay visible alongside the count. Conversation rows show the timestamp or the enabled split action in the trailing position. Directory cards also offer a visible **New conversation** action for the selected checkout. The global action opens a draft with the default standalone directory selected. Keep all available project directories in its picker.

Each new search or status filter opens its matching project groups and keeps their expansion choices until the criteria change. Clearing the search and filters restores the saved groups. A conversation can show the matching branch or working directory in its secondary line during search. A collapsed group containing the current conversation uses a subtle tint and an accessible description. In the grouped list, the arrow keys move through project, conversation and more rows. Enter activates the focused row. Down from the search field goes to the first result and falls back to a project row if all matching groups are collapsed.

Use `ConversationHeader` and `ConversationStatusBadge` for native coding conversations. The header title identifies the active conversation. Context and controls use the component's existing slots.

Forms use the shared `Button`, `Input`, `Textarea`, `NativeSelect`, `Label`, `Dialog` and `Alert` components. Choose variants and sizes from the shared component API. Keep one clear primary action for the current operation. Preserve editable values during polling, navigation and failed requests. Place feedback next to the affected action or field and expose pending state while preventing duplicate delivery.

Project registration uses `ProjectForm` and `ProjectScanResults`. The project controller owns scan results, editable names, selection and per-item registration outcomes. Changing the scan root, source or execution environment invalidates the results.

## Conversation contract

Native coding conversations render `ConversationPanel` from `frontend/chat/conversation-panel.tsx`. This component owns the runtime provider, labelled panel, header placement, message/composer area, return-to-latest control and feedback placement. It renders the shared `Thread` and `Composer`.

The native adapter calls `useConversationRuntime` for connection lifetime and bidirectional draft synchronization, and `useChatReading` for reading anchors, automatic history loading and scroll restoration. Controllers implement the small structural contracts consumed by these hooks. Their domain-specific identity, permissions, model communication and history ownership are supplied by the native adapter. Native attachments, questions, approvals, file access and runtime controls use the panel's explicit slots.

The shared composer owns its input shell, resize behavior, send/stop controls, keyboard shortcuts and rejected-submission restoration. Settings exposes an application-wide send shortcut, defaulting to Enter. Enter-to-send uses Shift+Enter for newlines. Saved changes apply to open conversation panes, including active-turn supplements, and preserve IME composition. The controller supplies authoritative draft and run state. Coordinate draft restoration once so a failed send produces one restored copy. Pending request identities stay attached to their original payload across retries.

The shared composer exposes Codex voice dictation in both entry points. `frontend/chat/voice-input.ts` owns microphone and WebRTC lifetime, while `use-voice-input.ts` appends input transcript fragments through the existing composer runtime. Dictation preserves existing draft text and requires explicit sending after it stops. Connecting, listening, finishing and failed states stay next to the input. Hiding or unmounting the pane releases the microphone and signaling session. The local backend uses the installed Codex daemon and its login to negotiate a V3 WebRTC session. Linux desktop webviews without WebRTC use Codex's packaged `codex-voice-host` for capture and transport, and receive user transcript fragments over an authenticated local stream. Client-managed handoffs keep the recording separate from coding turns.

Use the shared Markdown/message rendering, history-loading controls and run indicator. Display tools and attachments according to the runtime's actual capabilities. New-conversation headers and pane selectors use the first draft line as a temporary title without renaming a saved session; empty draft selectors use pane numbers. New conversations use a task-starting input prompt, while existing conversations use a follow-up prompt. Empty-state text should help the user start their current work. Keep release planning and implementation progress in documentation.

Coding conversations expose one settings popover on the composer's trailing side. Its model and permission rows open anchored menus with independent scrolling, and its effort and speed choices follow the selected model's catalog. Changing agents in a new conversation resets provider-specific settings and preserves the draft. When the runtime advertises response tiers, an explicit choice applies to the next turn. Review the current context in the same popover for existing and read-only conversations.

New and existing coding conversations use the same bottom-docked composer. Keep the project, working directory and UI/terminal choices in the creation view. Reuse the shared welcome layout and typography. Keep the agent picker in the creation settings. Terminal launch buttons follow the directory options and retain the conversation header when they open terminal output.

Keep the conversation toolbar on one line. Place the compact project and branch summary beside the title as the trigger for the **Working details** popover, collapsing it to an icon trigger on narrow panes or when no project or branch is present. Keep the files toggle icon-only, move secondary actions (message search and history refresh) into the conversation overflow menu, and separate split-pane controls from conversation actions with a hairline divider. Use the **Working details** popover for the vertical associated-directory list, filter and add action. Each binding row shows its directory identity, observed branch, Git line diff counts when changed, effective access or pending state, and a direct jump to the existing file and diff readers. Expand a binding row inline for its full selectable path, warnings, changed files and management actions, while keeping session-level environment facts in a collapsible footer. Use one confirmation interaction for adding from the popover, selecting an `@` mention or accepting a project suggestion. Show errors or write conflicts beside the affected directory. Busy or unsupported agent actions should leave the draft and saved bindings usable.

Standalone Codex visualization references in assistant messages render as expandable previews. Only files in the local conversation's Codex visualization folder can be served. The preview uses an opaque-origin sandbox, an inline-only resource policy and a separate frame so the message renderer and application API keep their existing content policies.


## Settings organization

Settings retain independent forms and their scoped save actions. Group the page into General, Conversation, Execution environment and Diagnostics, with an in-page category index. Keep common appearance and conversation preferences ahead of diagnostics. Category jumps scroll and focus the heading without changing the application route or remounting forms. Project management stays in resource navigation.

The new-conversation settings form saves model, response speed, reasoning effort and permissions separately for each agent and execution environment. Show the available speeds and efforts for the selected model. Antigravity determines speed through its model and exposes its sandbox permissions. The defaults apply at creation, and the composer allows a draft to override them. Managed Codex conversations enforce their directory access grants unless full access is explicitly selected.

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
7. Run the affected application and chat checks and existing navigation/localization tests. Record visual evidence and any unavailable native-host verification.

A change to these shared contracts updates the owning component, affected callers and this document together. This keeps the implementation and the guidance aligned as the application grows.
