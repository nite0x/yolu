# Application screenshot provenance

The homepage gallery uses unretouched captures of Yolu's production UI, served by the Go application in browser mode. These are not reconstructions, generated interfaces, or images from the design sandbox. The native operating-system window frame is not included.

- Capture date: November 5, 2026.
- Source: the Yolu working tree based on commit `95e60b7`, with the optional Yolu Mint palette implemented in this change. This palette is a development build, not a claim about a published installer.
- Theme: Settings → Appearance → Yolu Mint.
- Data: isolated temporary repositories named `storefront`, `payments-api`, and `design-tokens`, and sample development tasks. No personal repositories or real conversation history are shown.
- `assets/task-workspace.jpg`: the task list, current task goal, two associated Git worktrees, and actual working-directory status.
- `assets/changes.jpg`: the real file/change dialog, showing a Git diff from the sample `storefront` repository. Syntax highlighting and change colors are the application's actual renderer.
- `assets/terminal.jpg`: the real integrated Shell terminal, displaying local Git commands in the sample task directory. No model response is simulated for this image.

To refresh the gallery, build the production frontend and Go backend, run it with separate `--data` and `--root` directories, register sample repositories, and capture the actual UI after selecting the palette. Keep the data and version labels accurate. Do not recolor or redraw the interface to imply a shipped appearance. Capture tools may set the browser viewport; the application itself must render the image.
