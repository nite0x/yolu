# Shared product UI

## Scope and ownership

Yolu uses one product UI across its browser and desktop entry points. These guidelines cover project, conversation and settings pages. They support starting and resuming conversations, inspecting attached directories and managing Git worktrees.

The existing project and conversation pages are the visual reference. Before implementing a page, identify the corresponding shared layout, list, form or conversation component below. Extend that component when the same behavior is needed by several callers. Feature controllers own domain data and operations. Shared components own presentation and common interaction contracts.

Native title bars, window controls, application menus and operating-system dialogs use host capabilities. The retained `data-workhub-desktop` attribute selects the shared application layout in both entry points. Native integration also supplies `data-workhub-platform` and the host bridge.

The [frontend module guide](../frontend/README.md) defines feature ownership and dependency rules. Basic controls stay in `shared`; repository/conversation records and domain presentation stay in `entities`; feature state, UI and adapters stay in their owning `features` module.

## Source map

| Layer | Source | Responsibility |
| --- | --- | --- |
| Palette | `web/core/appearance.css`, `web/core/appearance.js` | Saved palette, light/dark appearance and semantic color tokens |
| Typography | `web/core/typography.css` | Font families, text sizes and weights |
| Component tokens | `frontend/shared/styles/base.css`, `frontend/app/styles/workspace.css` | Generic tokens and application-level style composition |
| Application frame | `web/core/chrome.css`, `desktop-frame.css`, `page-host.css` | Shared navigation, pane surfaces, elevation, gutters and host geometry |
| Pane layout | `frontend/shared/ui/page-surface.tsx`, `page-surface.css` | Shared split layout and pane markup |
| Lists | `frontend/shared/ui/list-controls.tsx`, `frontend/features/conversations/list/browser.tsx` | List headings, creation actions, search, rows, selection and date groups |
| Working directories | `frontend/features/projects/ui/working-directories.tsx`, `working-directories.css` | Project directory cards, Git summaries and directory actions |
| Conversation surface | `frontend/shared/ui/conversation-surface.tsx`, `conversation-surface.css` | Header, status, context and pane actions |
| Conversation panel | `frontend/features/conversations/ui/conversation-panel.tsx`, `frontend/features/conversations/runtime/use-chat-reading.ts` | Shared panel, runtime lifecycle, draft synchronization, history anchors, run state and feedback |
| Conversation content | `frontend/features/conversations/components/assistant-ui/elements/thread.aui.tsx` | Messages, Markdown, shared composer, send/stop and keyboard behavior |
| Basic controls | `frontend/shared/ui/primitives/` | Buttons, inputs, selects, dialogs, alerts, badges and tables |
| State and persistence | `frontend/features/conversations/runtime/`, `frontend/features/conversations/list/` | Requests, drafts, history, environment identity and lifecycle |

Use component-level APIs for caller-specific labels and actions. For example, `ConversationList.onSelect` lets a caller use shared rows with its own selection callback. Legacy native-session callers retain their controller attributes. The shared `Composer` accepts input labels, placeholders and limits while retaining its editor, send/stop controls and shortcut behavior.

## Layout and surfaces

The [navigation design](navigation-design.md) defines the shared navigator, resource collections and main-pane transitions.

Project routes show a single list or detail surface at every viewport size. Their lists share `resource-list-page` and the existing creation, search and filter controls. Details use the full surface and pair a list breadcrumb with `ResourceSwitcherTrigger`. The switcher orders recently opened items by environment and identity, then offers the remaining items through search. Returning to a list restores its search, filters, scroll position and focused row.

The shared page host groups the product destination icons at the start of the header. Separators divide destinations, Back and Forward, and the two conversation creation actions. Use 14px glyphs in 32px desktop targets for the controls in these groups. Give the current page a tinted background, maintain a separate keyboard focus ring, and label icon buttons. Destinations and creation actions remain available when the conversation sidebar is closed. History restores the destination environment, resource route (including directory parameters) and specific conversation. Returning to a retained reader preserves its draft, reading position and split panes. Alt+Left/Right and macOS Cmd+[/] invoke the same history; unavailable directions are disabled. Title and run-state updates replace the current history snapshot without adding visits.

The shared page host opens global search from the centered application-header trigger or **Cmd/Ctrl+K**. On narrow viewports, shorten the search trigger and hide auxiliary labels before reducing navigation targets. Global search shows recent resources when the query is empty and groups matching names or titles by project and conversation. Results retain their execution environment and use the same navigation paths as the sidebar. Keep the modal in the host so keyboard focus and navigation work across panes. Escape returns focus to the invoking control.

The right side of the header shows the Git refresh action and the Codex quota trigger. Announce Git refresh progress and its outcome without moving focus. On hosts with an in-window native application menu, place its icon on the right with the window utilities. The quota trigger shows the remaining percentage when available and a short label otherwise. Show quota errors and retry in its popover.

Global search keeps results in memory across dialog opens and reads saved conversation titles and archive state first. Entering a search term starts background conversation discovery. Available results stay usable while discovery runs.

Use `SplitLayout` when a workflow requires two simultaneously visible panes, such as browsing conversations. Use `ApplicationPane` for the list and detail surfaces. Static HTML and legacy controllers apply the same `workspace-pane` class.

```tsx
import {ApplicationPane, SplitLayout} from "@/shared/ui/page-surface";

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
| Pane gap | `--workspace-pane-gap`, currently a 1px divider between split panes |
| Outer inset | `--workspace-pane-inset`, currently 0px |
| List width | `--workspace-list-width`, default 280px, owned by the existing list-width preference |
| Pane radius | Product panes use 0px; `--yolu-pane-radius` is reserved for contained surfaces and overlays |
| Pane elevation | `--yolu-elevation` |
| Small controls and selected tabs | `--yolu-chip-radius`, `--yolu-elevation-sm` |
| Floating controls and composer | `--yolu-elevation-float` |
| Narrow layout | Existing 760px product-page breakpoint |

Keep the canvas and pane gap at the application-frame layer. The shared navigator uses the neutral frame canvas (`--yolu-rail-canvas`, light mode `#f3f5f4`). The global header tints that canvas slightly toward the theme foreground and has a 1px bottom divider to mark the transition to the sidebar and content. Main product panes use `--yolu-surface` (white in light mode) and meet the navigator edge without outer rounding, borders, shadows or insets. Apply these two surface levels to both browser and desktop entry points, including resource pages, settings and conversation readers. Dark mode keeps the corresponding dark frame and content surfaces. Reserve elevation for overlays and the composer. Parallel conversations meet at a subtle 1px vertical divider, so the focused header tint touches the line without a surface-colored gap. A centered 12px resize target overlaps the adjacent pane edges without widening the divider track. Hover and keyboard focus reveal the resize grip. The current pane has a tinted header and full-contrast toolbar controls, while unfocused split panes dim their trailing actions until hovered or focused. These follow the host's existing focus state, independently of conversation run status. Pane contents use the available width with `min-width: 0` and a bounded scroll region. Give list and detail areas independent scrolling when the workflow requires both. Reuse `setupSplitResize` and the corresponding saved preference when a divider is adjustable.

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

Use `ListCreateButton` for a list's primary creation action and `ListSearch`/`ListFilter` when the workflow needs search or filtering. The shared conversation sidebar uses `ListSearch` with `variant="plain"`. Keep its search row borderless. Place the Recent and Grouped controls in the filter menu and retain active scope and filters in a visible, removable chip. Recent uses a second line for the project or directory. Keep sidebar names on one line and expose truncated values. Show non-local environment labels where needed. Other lists retain the default search field. Conversation lists use `ConversationList` for selection, timestamps, truncation and focus styling. Put resource identity and essential state in the row. Detail views carry longer explanations and secondary actions.

Use `WorkingDirectoryCard` in project details. Keep directory rows compact: identity, branch, local status and synchronization on the first line, and a copyable actual path and related-conversation count on the second. Disambiguate duplicate worktree leaf names with parent directory segments. Keep the main directory first when it matches the filter and expand it initially. Expanded sections show changes when uncommitted edits exist, or related conversations when clean, with a bounded preview and a link to all conversations. Do not repeat these conversations in a separate project activity list. For a single-directory project, omit the duplicate project path and multi-directory controls. Recent usage and sorting use conversation timestamps.

Project-detail toolbars use labelled icon buttons for new conversation, file browsing and expansion, with secondary checkout operations in the overflow menu. Keep menu item labels readable. The project file dock mounts the same `FileBrowser` used beside conversations, scoped to the chosen project, checkout and execution environment. Reuse its directory tree, file content, image and diff readers. Open the dock beside the directory list with the shared keyboard-accessible splitter; let users expand it within the project surface. At narrow content widths show the file pane with a close action returning to the directory list. Preserve the mounted file browser, selected file and reading position during project status refreshes. Changing checkout or execution environment clears the previous preview and cancels its requests. Keep quiet inline text for normal states so changes, divergence and errors stand out. A directory parameter clears the filter, expands the matching card and moves focus to it.

Grouped conversation navigation puts project groups and a **No project** group for unbound conversations in one scrolling list. Each group previews its two most recent conversations, with priority for the current conversation and any running conversations. When those conversations exceed two, show them all. **More conversations** reveals five at a time. **Show fewer conversations** returns to the preview and anchors the list at the group header. Closing a group also resets its preview. Group rows use a neutral hover background without a leading disclosure arrow. Collapsed groups show a running indicator when applicable. Project conversation subtitles show branch and worktree context. Unbound conversations use a type label for general conversations and a folder icon for directory names. Overly long branch and directory subtitles truncate in the middle while keeping the full value in hover text.

Embedded terminal rows show an open indicator while connected. After closing a terminal pane, its row remains available for reconnection while the process lives. The running filter and group indicators reflect chat activity.

At rest, the project badge and conversation count are visible by default. Project badges render preset theme-compatible icons rather than letter initials or arbitrary accent colors; each project receives a deterministic default icon that can be changed or randomized in the icon editor. The sidebar filter menu saves independent preferences for both. Row hover or visible keyboard focus reveals **Open project details** (for registered projects) followed by **New conversation** on the trailing side, in place of the count. Reserve space for the group's actions so long names truncate consistently. On devices without hover, the actions stay visible alongside the count. Creating a conversation from a collapsed group opens that group. The sidebar reveals the new conversation when it matches the current filters. Conversation rows identify the agent with the same icon as the agent picker and provide its accessible name. The timestamp or the enabled split action occupies the trailing position. Directory cards offer a visible **New conversation** action that starts at the project's main repository. The global action opens a draft with the default standalone directory selected. Creation inventories contain healthy main repositories; exclude temporary paths, detached checkouts, linked worktrees and historical conversation paths. Existing readers and project tools retain their complete directory inventories.

New conversation pages use the shared `renderCreationChoices` directory picker: a default-directory shortcut, at most five frequent main repositories, and a More trigger. Arrange these shortcuts vertically with a directory icon, project name and muted branch. Use transparent, borderless rows with a quiet hover surface and a trailing selection check. Bound the list to 400px; preserve the project name and truncate the branch first. A selection outside the quick choices appears on the selected More trigger without moving the other shortcuts. The pane-header directory trigger and quick shortcuts update the same hidden select and controller target. The popover searches all roots by project, branch and path, keeps full paths visible on a second line, and offers the existing native folder picker in its footer. Validate manually mounted folders with the binding inspector and retain them in the draft snapshot. Keep folder-picker failures inline. In chat creation, offer **Add an additional directory** in the working-directory popover and below the primary choices. Use the shared binding dialog for path and access confirmation. Show the selected directories and access under the primary choices, with a remove action for each. Keep them with the draft in their execution environment.

Pin quick choices through their context menu (also Shift+F10). Pinned roots rank first, then conversation creation counts and recency over fourteen days. Freeze the quick order during a draft; recompute on opening a new draft. Selecting a directory returns focus to the composer. Cmd/Ctrl+Shift+D opens the directory popover with search focused; Up/Down moves the active result, Enter selects and returns to the composer, and Escape only dismisses. Preserve drafts through mode and pane changes. Chat/Terminal uses shared plain-text controls with an underline marking the current form; omit enclosing button chrome and keep visible keyboard focus. The local default directory permits switching to the terminal launcher before choosing a terminal working directory. Remote environments and pending sends disable terminal switching. A single unchecked **Create a new Worktree** checkbox follows the directory shortcuts. Checking it creates the directory on the first send and reuses it after a failed send while preserving the main project association. Keep this out of the composer toolbar and omit branch configuration from creation. Worktree lifetime remains independent of conversation lifetime.

Each new search or status filter opens its matching groups and keeps their expansion choices until the criteria change. Clearing the search and filters restores the saved groups. A conversation can show the matching branch or working directory in its secondary line during search. Selected and parallel conversation rows use tinted backgrounds. Collapsed project rows use the default group styling and identify the current conversation's group through an accessible description. In the grouped list, the arrow keys move through group, conversation and preview controls. Enter activates the focused control. Down from the search field goes to the first result and falls back to a group header if all matching groups are collapsed.

The grouped navigator offers **Collapse all** beside the filter control and switches to **Expand all** when every group in the current list is collapsed. Both actions apply to groups beyond the mounted scroll window. A bulk change during a search or status filter uses the filter's temporary expansion state. Agent icons sit beside timestamps in a fixed-width trailing area shared with project actions. Align collapsed project run indicators with conversation run indicators, including terminal rows and groups without project details. Run and unread indicators appear to the left of the agent, keeping its position steady as status changes. Hovering or focusing a conversation row replaces its timestamp with the enabled split action. Use the same split icon as the application header and keep the adjacent agent icon in place.

Use `ConversationHeader` and `ConversationStatusBadge` for native coding conversations. The header title identifies the active conversation. Context and controls use the component's existing slots.

Forms use the shared `Button`, `Input`, `Textarea`, `NativeSelect`, `Label`, `Dialog` and `Alert` components. Choose variants and sizes from the shared component API. Keep one clear primary action for the current operation. Preserve editable values during polling, navigation and failed requests. Place feedback next to the affected action or field and expose pending state while preventing duplicate delivery.

Project registration uses `ProjectForm` and `ProjectScanResults`. The project controller owns scan results, editable names, selection and per-item registration outcomes. Changing the scan root, source or execution environment invalidates the results.

In a Codex draft on the local host, offer **Run in** with **Local** and **Codex Cloud**. The cloud choice reveals the environment picker in place of the working-directory choices. Keep the message draft when switching. For an established cloud conversation, show the selected environment beside the title and use the shared thread and composer.

## Conversation contract

Native coding conversations render `ConversationPanel` from `frontend/features/conversations/ui/conversation-panel.tsx`. This component owns the runtime provider, labelled panel, header placement, message/composer area and feedback placement. It renders the shared `Thread` and `Composer`. The thread uses assistant-ui's scroll-to-bottom control.

The native adapter calls `useConversationRuntime` for connection lifetime and bidirectional draft synchronization, and `useChatReading` for reading anchors, automatic history loading and scroll restoration. Controllers implement the small structural contracts consumed by these hooks. Their domain-specific identity, permissions, model communication and history ownership are supplied by the native adapter. Native attachments, questions, approvals, file access and runtime controls use the panel's explicit slots.

The thread's `UserText` slot supports structured user replies while retaining the shared message bubble and attachments. The native adapter recognizes complete Codex question-reply envelopes in both saved history and live entries. It supplies readable message text for search and copy, with structured question/answer pairs in message metadata for display. Show each question in secondary text above its answer, preserving order, line breaks and literal content. Ordinary messages, quoted protocol examples and malformed envelopes retain their original text.

For complete Codex desktop attachment envelopes, show the actual request and the existing image attachments without the generated file inventory, attachment flags, document-instruction reminder or request heading. Keep paths for documents and images without a rendered attachment. Apply this display conversion to saved and live user messages, including search and copy; preserve the original stored text and model input. Incomplete or quoted envelopes remain literal text.

The shared composer owns its input shell, resize behavior, send/stop controls, keyboard shortcuts and rejected-submission restoration. Settings exposes an application-wide send shortcut, defaulting to Enter. Enter-to-send uses Shift+Enter for newlines. Saved changes apply to open conversation panes, including active-turn supplements, and preserve IME composition. The controller supplies authoritative draft and run state. Coordinate draft restoration once so a failed send produces one restored copy. Pending request identities stay attached to their original payload across retries.

After a Codex turn completes successfully, the shared composer may show a suggested next prompt as gray placeholder text when the editor and attachments are empty. Tab copies it into an editable, unsent draft. Escape discards it. The input exposes keyboard help to screen readers. Preserve modified Tab navigation and IME composition. Typing, sending or leaving the conversation suppresses that turn's suggestion. Hide suggestions during voice input, pending questions, active turns, read-only views, archived conversations and unavailable send states. Prediction generation does not keep the conversation busy or block the next send.

An idle Codex CLI connected to the same daemon does not disable the shared composer or require terminal handoff. Keep its terminal connection available when a Yolu turn completes. Running or waiting external turns retain their existing status and controls; an independent app-server's writer-lock conflict shows recovery guidance without ending other conversations.

The shared composer exposes Codex voice dictation in both entry points. `frontend/features/conversations/voice/client.ts` owns microphone and WebRTC lifetime, while `use-voice-input.ts` appends input transcript fragments through the existing composer runtime. Dictation preserves existing draft text and requires explicit sending after it stops. Connecting, listening, finishing and failed states stay next to the input. Hiding or unmounting the pane releases the microphone and signaling session. The local backend uses the installed Codex daemon and its login to negotiate a V3 WebRTC session. Linux desktop webviews without WebRTC use Codex's packaged `codex-voice-host` for capture and transport, and receive user transcript fragments over an authenticated local stream. Client-managed handoffs keep the recording separate from coding turns.

Use the shared Markdown/message rendering, history-loading controls and run indicator. Display tools and attachments according to the runtime's actual capabilities. New-conversation headers and pane selectors use the first draft line as a temporary title without renaming a saved session; empty draft selectors use pane numbers. New conversations use a task-starting input prompt, while existing conversations use a follow-up prompt. Empty-state text should help the user start their current work. Keep release planning and implementation progress in documentation.

Present execution activity as compact action summaries: reading or browsing files, editing files, running commands, searching and viewing images. Use native command-action descriptions when available; older simple commands may use conservative display classification. Group adjacent operations by category and count, retaining their order and failure count in expandable details. The shared `ToolGroupTrigger.label` and `ToolFallback.Trigger` label/icon slots support these summaries. Keep command source, output, exit codes and duration readable without JSON wrappers; approvals retain their existing controls and unknown tool shapes retain the generic fallback. Show viewed-image thumbnails outside collapsed details using the session-scoped image loader and existing zoom dialog. Only public item categories and command file paths extend the history payload; raw external tool arguments/results and internal reasoning stay with Codex. Saved history, live events, browser and desktop share this presentation.

Fenced `md` and `markdown` blocks offer source and preview views. Show the source while the block streams and preview the completed document by default. Keep the reader's view choice for the block and copy its source from either view.

Code fences in conversation replies and Markdown previews preserve selectable source and offer one-click copying and a line wrap toggle. Soft wrapping starts enabled and leaves the copied source unchanged. Apply theme-aware syntax highlighting after streaming for supported languages. Plain text and unsupported languages retain the same controls.

Markdown tables size columns from their content. Keep headers and short code values readable, and contain overflow in the table viewport. Drag a column header's trailing edge to change its width or the bottom edge of the last cell in a row to change its height. Rows remain tall enough for their contents. The corner handle resizes the viewport within the conversation width. Arrow keys adjust the focused handle, and Home or a double-click restores its original size.

Coding conversations expose one settings popover on the composer's trailing side. Its model and permission rows open anchored menus with independent scrolling, and its effort and speed choices follow the selected model's catalog. Changing agents in a new conversation resets provider-specific settings and preserves the draft. When the runtime advertises response tiers, an explicit choice applies to the next turn. Review the current context in the same popover for existing and read-only conversations.

New and existing coding conversations use the same bottom-docked composer. Chat and terminal creation share a compact introduction with the mode switch above the heading. Keep agent settings with the chat composer. In terminal creation, show the project and actual working path above the available tools. Each available tool launches from its own row. Put missing commands and the custom profile editor in separate disclosures. The console retains the conversation header and exposes its working directory there.

The composer shell retains its elevation and uses a subtle border change on focus. The send and in-turn supplement controls share a line arrow on a transparent button and retain their individual keyboard focus indicators.

Keep composer run feedback in one compact, borderless row above the input. Place supplementary runtime notices behind the labelled **Status details** popover beside the run indicator; retain keyboard and touch access and keep the popover inside the conversation's dialog when applicable. Blocked states, reconnect progress, draft notices, errors and handoff actions remain directly visible. While the **Opened in another app** card is visible, hide the composer and retain its draft. Hide empty status rows and avoid extra footer gaps when the turn finishes. Browser and desktop use the same components and spacing.

Keep the conversation toolbar on one line. Place the compact project and branch summary beside the title as the trigger for the **Working details** popover, collapsing it to an icon trigger on narrow panes or when no project or branch is present. Keep the files toggle icon-only, move secondary actions (message search and history refresh) into the conversation overflow menu, and separate split-pane controls from conversation actions with a hairline divider. Use the **Working details** popover for the vertical associated-directory list, filter and add action. Each binding row shows its directory identity, observed branch, Git line diff counts when changed, effective access or pending state, and a direct jump to the existing file and diff readers. Expand a binding row inline for its full selectable path, warnings, changed files and management actions, while keeping session-level environment facts in a collapsible footer. On send, attach each distinct, unambiguous `@project` in the current environment as an additional read-only directory. A message without explicit project mentions can still attach a single uniquely named project. Show the bindings in **Working details** and preserve any access already set for a referenced directory. Selecting an `@` completion fills in the project name in the draft. A new reference during an active turn stays in the draft until the turn ends. Explicit directory management and shared write conflicts use the existing confirmation controls. Show errors or write conflicts beside the affected directory. Busy or unsupported agent actions should leave the draft and saved bindings usable.

Mermaid code fences render as static diagrams after message streaming finishes. Select a diagram to open the shared dialog at fit-to-window scale. The preview provides zoom buttons, pinch gestures on touchscreens and trackpads, drag-to-pan, and keyboard scrolling. The code-block header retains source copying, and invalid or unavailable diagrams fall back to the original code block.

Each reply's edited-file summary shows the file count and line totals with the file list collapsed by default. The summary header opens the list, and **View changes** opens the list and all file diffs.

Standalone Codex visualization references in assistant messages render as expandable previews. Only files in the local conversation's Codex visualization folder can be served. The preview uses an opaque-origin sandbox, an inline-only resource policy and a separate frame so the message renderer and application API keep their existing content policies. Standalone `::directive{...}` protocol markers render as compact status notes when they carry a title and are omitted otherwise.

## Settings organization

Settings group preferences into General, Conversation, Execution environment and Diagnostics inside quiet bordered section containers, with an in-page category index and clear H2 section headings. Keep common appearance and conversation preferences ahead of diagnostics. Category jumps scroll and focus the heading without changing the application route or remounting forms. Project management stays in resource navigation.

Single-choice preferences (appearance palette cards, per-agent new-conversation defaults, send shortcut, title model and preset terminal tools) apply and save automatically on change with inline status feedback and alert-level error reporting. Actions that reload the UI (interface language) or require multi-field input before applying (custom terminal executable path, LAN browser access) reveal or highlight their scoped primary action when modified. Consolidate model refresh into one action in the Conversation section header. The environment picker belongs inside the new-conversation form. Keep settings labels and controls visible without persistent descriptive paragraphs. Remove redundant descriptions and place necessary scope, behavior and connection notes in `HelpTip` icons beside their labels. Tips open on hover, keyboard focus or click, dismiss with Escape or outside interaction, and stay within the viewport. Initialize static help with `setupHelpTips` at its owning page boundary. `Field` supports `helpDisplay="tooltip"` for this pattern; its default remains inline help. Keep errors, save feedback and diagnostic results visible. Include the title-generation environment and application-wide shortcut scope in their tips.

The new-conversation settings form saves a default agent per execution environment, independently of the agent selected for editing. Fresh drafts use that default; restored drafts and existing conversations retain their selected agent. Agent configuration switches via icon-labelled segmented tabs and saves model, response speed, reasoning effort and permissions separately for each agent and execution environment. Show the available speeds and efforts for the selected model using segmented controls for up to five reasoning-effort choices and a select for larger catalogs, while retaining every supported value. Permissions use segmented controls with a warning cue for unrestricted access. Antigravity determines speed through its model and exposes its sandbox permissions. The defaults apply at creation, and the composer allows a draft to override them. Managed Codex conversations enforce their directory access grants unless full access is explicitly selected.

Serialize automatic writes per setting and execution environment so rapid changes cannot persist out of order. Keep failed new-conversation preferences per environment and agent, show a local retry action, and retain those drafts across agent switches and model refreshes. Permission help describes the selected choice in its tip, retaining the warning cue on unrestricted access.

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

Ownership conflicts use `ConversationOccupied` above the composer: a lock icon, a concise heading and explanation, and Retry / Create chat branch actions. Keep unsent text and attachments, avoid repeating raw writer-lock errors, and route recovery through the existing poll/send and fork operations. Disable actions while pending or unavailable; use a second action row in narrow panes.
