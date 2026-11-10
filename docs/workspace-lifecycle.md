# Workspace and project lifecycle

A workspace organizes one requirement across projects. Archive it when the work
is finished and its history should remain available. Archiving preserves project
links; it does not prevent an explicit project deregistration.

## Delete a workspace record

Open the workspace and choose **More → Delete workspace record**. The confirmation
dialog explains what is retained. Deletion removes the workspace record, project
memberships, conversation links and workspace session pins in one transaction.
The original conversations remain available through the conversation browser.

Repository files, workspace directories, branches and worktrees remain on disk.
This operation does not stop conversations or terminals. A workspace that is
being prepared cannot be deleted until preparation completes. Deleting a record
cannot be undone; recreating it does not automatically adopt retained directories.

## Remove a project registration

Choose **Remove registration** in the project's menu. The dialog lists all linked
workspaces, including archived ones, with links for inspection. Confirm **Unlink
and remove registration** to remove only that project's memberships and its
registration. Other projects, workspace records and conversations remain intact.
The launch preference is reassigned to a remaining project, or cleared if none
remain. Archived workspaces stay archived.

The server checks the reviewed workspace IDs again during the transaction. If
links changed, close the dialog and review the current list. If a linked workspace
is being prepared, wait for preparation to finish.

## Clean up files separately

Use the existing workspace finishing review to inspect worktrees before cleaning
up disk space. Review and clean them before deleting the workspace record if you
want Yolu to retain the workspace context during cleanup. Removing a registration
or workspace record never runs Git worktree removal or deletes directories.
