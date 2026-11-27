# Shared application navigation

Yolu keeps the conversation navigator beside the active pane. Desktop and browser share this layout.

## Entry points

- Conversations is the landing view. The shared header also opens Projects, Issues and Settings. Back and Forward traverse the application history. Global search finds projects and conversations.
- The conversation filter menu offers Recent and Grouped views. Recent shows a flat list ordered by activity with project or directory context beneath the title. Grouped shows registered projects and independent conversations. A collection can open its project detail separately from expanding its conversation rows.
- Grouped view puts the Yolu project first among registered projects by default. Drag a project heading or focus it and press Alt+Up or Alt+Down to rearrange the groups. Clicking the heading toggles its expansion. Browser and desktop entry points use the order saved in the same application database. Filtered views preserve the positions of hidden projects.
- The compose action starts an independent conversation. Project details also provide **New conversation** with the project selected. Choose the primary checkout, an existing worktree or an independent worktree. Opening a draft and sending its first message preserve the navigator's current search and filters.
- Project details contain worktrees, Git operations, files, changes and related conversations. Issues opens the existing link to Linear.

## Pane behavior

The navigator stays mounted when the main pane changes. An open conversation keeps its session identity, reader and draft while showing a project or settings. Conversations support recursive horizontal and vertical splits (up to six panes by default), divider resizing with double-click reset, temporary pane maximization/restoration, pane header drag-and-drop move/swap, and persistence across reloads (see [flexible pane layout](pane-layout.md)). Splitting creates an empty pane that offers creating a new conversation with inherited context, opening an existing/recent conversation, or cancelling the split. On narrow windows, a header button opens the navigator and the pane selector switches between open panes without discarding the underlying split tree.

On a wide window that opens Conversations without a selection, the shared navigator initializes before the empty reader. A conversation link starts restoring its reader alongside the navigator. The resource pane loads on the first visit to Projects, Issues or Settings and stays mounted for later visits.

## Verification

- Open a project from a fresh session, then create a conversation from a worktree. Verify context and navigation with Back and Forward.
- Toggle Recent and Grouped with a search and filters applied. Verify the selected project or conversation stays open.
- Reorder project groups, then reload the app and clear any filters. Check the resulting order and the expanded state of each group.
- Switch away from a conversation with a draft and come back. Check the retained draft and split panes.
- Check keyboard access, browser and desktop layouts, and the narrow navigation toggle.
