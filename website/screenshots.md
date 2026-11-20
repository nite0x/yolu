# Application screenshot provenance

The homepage gallery uses unretouched captures of Yolu's production UI, served by the Go application in browser mode. These are not reconstructions, generated interfaces, or images from the design sandbox. The native operating-system window frame is not included.

- Capture date: November 20, 2026.
- Source: the workspace terminology update based on commit `c00b5d1`, captured in the browser at 1280 × 720.
- Theme: Settings → Appearance → Yolu Mint.
- Data: isolated temporary repositories named `storefront`, `payments-api`, and `design-tokens`, and sample development workspaces. No personal repositories or real conversation history are shown.
- `assets/workspace.jpg`: the workspace list, current workspace goal, two associated Git worktrees, and actual working-directory status.
- `assets/changes.jpg`: the real file/change dialog, showing a Git diff from the sample `storefront` repository. Syntax highlighting and change colors are the application's actual renderer.
- `assets/terminal.jpg`: the real integrated Shell terminal, displaying local Git commands in the sample workspace directory. No model response is simulated for this image.

To refresh the gallery, build the production frontend and Go backend, run it with separate `--data` and `--root` directories, register sample repositories, and capture the actual UI after selecting the palette. Keep the data and version labels accurate. Do not recolor or redraw the interface to imply a shipped appearance. Capture tools may set the browser viewport; the application itself must render the image.
