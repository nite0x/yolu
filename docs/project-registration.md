# Add a project

Projects register repositories for conversations and Git operations. Open **Projects → Add project**.

## Register a local repository

Choose **Register local repository**, select the execution environment and enter
its existing Git repository directory. Local environments support the system
folder picker; WSL paths are entered as Linux absolute paths. Registration
scans the repository and discovers its existing worktrees.

## Scan a directory for repositories

Choose **Scan directory and add in bulk**, select the execution environment and
enter a parent directory, such as `~/project`. Local environments also support
the system folder picker. Paths refer to the selected execution environment,
including when using Yolu through a browser.

Choose **Scan directory** to discover repositories recursively, including a
repository at the selected root and nested repositories. Checkouts sharing a
Git common directory appear once. Already registered repositories are marked
and excluded from selection. New repositories are selected by default. Use the
select-all checkbox or individual checkboxes, edit project names if needed, then
choose **Register selected repositories**. Name suggestions distinguish
repositories with identical directory names.

Registration reuses the existing project and worktree discovery workflow. Each
repository has an independent result. A
failed item retains its name and selection for retry, and successful items stay
registered. Retrying a batch recognizes repositories that were already added.

The scan includes repositories in hidden and dependency directories. It skips
directory symlinks and `.git` metadata below the chosen root. Bare repositories are outside the existing working-directory
registration workflow. Scans stop after 50,000 directories or 1,000 repositories
and have a 60-second deadline. Results indicate when a count limit was reached
and list up to 100 read failures. Choose a smaller directory when needed.

Directory scans are initiated manually. Startup discovery and saved scan roots
are future additions.

## Clone from Git

Choose **Clone from Git** and supply:

- An HTTPS or SSH repository address, including SCP-style SSH addresses.
- The execution environment where Git should run.
- An existing destination directory in that environment.
- A new folder name, initially suggested from the repository address.
- An optional project name; otherwise the new folder name is used.

The folder picker selects the parent directory. Yolu creates the new folder and
runs a regular clone using the remote's default branch and the environment's
existing Git credential helpers or SSH keys. It does not perform an interactive
login. Configure authentication in that environment's terminal first if needed.
The existing Git network timeout also applies to cloning.

After cloning, Yolu registers the repository, scans its worktrees and selects
the new project. Network activity does not hold the environment's metadata mutation lock.

An existing target directory, even an empty one, is rejected. Clone failures do
not create project registrations. Empty reservations are removed when possible;
remaining files are preserved for inspection. If cloning succeeds but project
registration fails, switch to local registration and enter the full cloned
repository path. No failure path recursively deletes repository files.
