# Add a project

Projects supply repositories to workspaces. Open **Projects → Add project**, or
add a project while selecting the participating projects for a workspace.

## Register a local repository

Choose **Register local repository**, select the execution environment and enter
its existing Git repository directory. Local environments support the system
folder picker; WSL paths are entered as Linux absolute paths. Registration
scans the repository and discovers its existing worktrees.

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
the new project, or returns it to the workspace project picker that opened the
dialog. Network activity does not hold the environment's metadata mutation lock.

An existing target directory, even an empty one, is rejected. Clone failures do
not create project registrations. Empty reservations are removed when possible;
remaining files are preserved for inspection. If cloning succeeds but project
registration fails, switch to local registration and enter the full cloned
repository path. No failure path recursively deletes repository files.
