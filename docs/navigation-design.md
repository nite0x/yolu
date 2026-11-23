# Shared application navigation

Yolu keeps the conversation navigator beside the active pane. Desktop and browser share this layout.

## Entry points

- Conversations is the landing view. The shared header also opens Projects, Issues and Settings. Back and Forward traverse the application history. Global search finds projects and conversations.
- Recent shows a flat list ordered by activity with project or directory context beneath the title. Grouped shows registered projects and independent conversations. A collection can open its project detail separately from expanding its conversation rows.
- The compose action starts an independent conversation. Project details also provide **New conversation** with the project selected. Choose the primary checkout, an existing worktree or an independent worktree.
- Project details contain worktrees, Git operations, files, changes and related conversations. Issues opens the existing link to Linear.

## Pane behavior

The navigator stays mounted when the main pane changes. An open conversation keeps its session identity, reader and draft while showing a project or settings. On wide windows, panes can sit side by side. On narrow windows, a header button opens the navigator and the pane selector switches between open conversations.

## Verification

- Open a project from a fresh session, then create a conversation from a worktree. Verify context and navigation with Back and Forward.
- Toggle Recent and Grouped with a search and filters applied. Verify the selected project or conversation stays open.
- Switch away from a conversation with a draft and come back. Check the retained draft and split panes.
- Check keyboard access, browser and desktop layouts, and the narrow navigation toggle.
