# Shared workspace navigation

Yolu uses one conversation navigator beside the active view. The navigator groups the work by requirement or repository, while the main pane shows a conversation, workspace, project, issue entry or settings. Desktop and browser share this layout.

## Entry points

- The topmost application header provides global search, **Issues**, refresh and remaining Codex quota in both browser and desktop entry points. The sidebar starts directly with conversation search. The workspace list is reachable from the Yolu home link or application menu; it does not occupy a navigation tab.
- Resource names stay on one line and truncate with an ellipsis. The list scrolls vertically without horizontal overflow. The search field leads directly into workspace and registered-project collections. Their names open details in the main pane, and separate disclosure buttons expand conversations. Collections remain available when they have no conversations and do not require pinning.
- Every project and workspace retains an icon and color. Edit the icon beside the name in its detail header. Appearance is stored independently of navigation membership; existing custom icons are retained.
- **Other conversations** includes conversations without a workspace or registered project collection. The existing search, filters and archived view continue to work against the conversation navigator.
- **Settings** sits at the bottom and links to **Project management**, which uses the existing registered project list. A project's detail can also open from a workspace directory row, with the relevant worktree selected. Direct project URLs remain available.
- The workspace detail remains the place to view its project directories, open or start conversations, and add projects. Its repository and conversation identities also provide the scope for a future Agent flow view.

## Navigation behavior

The shared navigator stays mounted when the main pane changes. A conversation keeps its native session identity, draft and mounted reader while a resource page is visible. If a conversation appears in two collections, both rows target that same session. Name links and disclosure buttons are separate keyboard targets. Custom resource appearances carry over from the earlier pinned navigation.

On wide windows the navigator and main pane appear together, with the existing adjustable list width. On narrow windows a header button opens the navigator full width. Selecting a destination or closing navigation returns to the main pane. Split readers keep their existing pane selector at widths where the panes cannot fit side by side.

The Issues page offers a link to Linear while tracker integration is pending. The page uses the normal navigation lifecycle so it can later show assigned issues and open or create the associated workspace.

## Acceptance checks

- Open Workspaces, a workspace, a project, Issues and Settings without remounting the navigator.
- Open workspace and project collections by name and expand or collapse them independently. Confirm that a collection with zero conversations can still open its detail. Edit its icon in details and verify the navigator updates.
- Switch away from a running or drafted conversation and return to the same native session. Verify that split readers and their drafts remain available.
- Open Project management from Settings and enter a project from within a workspace. Verify directory context and browser back navigation.
- Exercise keyboard focus, search, archived conversations and the narrow navigation toggle in the shared browser and desktop layouts.
