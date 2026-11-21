# Shared workspace navigation

Yolu uses one conversation navigator beside the active view. The navigator groups the work by requirement or repository, while the main pane shows a conversation, workspace, project, issue entry or settings. Desktop and browser share this layout.

## Entry points

- The top of the navigator provides **Workspaces** and **Issues**. Workspaces opens the complete workspace list. Issues opens a right-hand entry page for the external tracker.
- **Pinned** contains workspaces and project working directories side by side. Clicking a name opens its details in the main pane. A separate disclosure opens its conversations. Workspace membership uses the saved links. A pin on a project’s primary directory groups conversations across its recognized worktrees. A pin on an individual worktree groups that directory’s conversations. Both respect the execution environment.
- **Other conversations** includes conversations without a workspace. The existing search, filters and archived view continue to work against the conversation navigator.
- **Settings** sits at the bottom and links to **Project management**, which uses the existing registered project list. A project's detail can also open from a workspace directory row, with the relevant worktree selected. Direct project URLs remain available.
- The workspace detail remains the place to view its project directories, open or start conversations, and add projects. Its repository and conversation identities also provide the scope for a future Agent flow view.

## Navigation behavior

The shared navigator stays mounted when the main pane changes. A conversation keeps its native session identity, draft and mounted reader while a resource page is visible. If a conversation appears in two collections, both rows target that same session. Name links and disclosure buttons are separate keyboard targets. Existing pin preferences and custom pin appearances carry over.

On wide windows the navigator and main pane appear together, with the existing adjustable list width. On narrow windows a header button opens the navigator full width. Selecting a destination or closing navigation returns to the main pane. Split readers keep their existing pane selector at widths where the panes cannot fit side by side.

The Issues page offers a link to Linear while tracker integration is pending. The page uses the normal navigation lifecycle so it can later show assigned issues and open or create the associated workspace.

## Acceptance checks

- Open Workspaces, a workspace, a project, Issues and Settings without remounting the navigator.
- Open each pinned collection by its name and expand or collapse it independently. Confirm that a pinned collection with zero conversations can still open its detail.
- Switch away from a running or drafted conversation and return to the same native session. Verify that split readers and their drafts remain available.
- Open Project management from Settings and enter a project from within a workspace. Verify directory context and browser back navigation.
- Exercise keyboard focus, search, archived conversations and the narrow navigation toggle in the shared browser and desktop layouts.
