# Yolu design demo

A standalone interactive browser preview of the task, project and conversation UI, using shared production components and simulated data. It does not need a Go backend or Tauri host and is not part of the production application build.

## Run

Install the repository dependencies first, then run the demo from its directory:

```bash
# Repository root
npm ci
cd design-demo
npm run dev
```

Open `http://127.0.0.1:4173`. From `design-demo/`, run `npm run check` for type checking and `npm run build` for a standalone build in `design-demo/dist/`.

## Preview behavior

- The design panel changes theme color, radius, density and content width. Preferences use a separate browser-storage key and can be reset or copied.
- Scenarios simulate clean/changed/missing/checking directories, no associated projects and disconnected environments. Switching scenarios resets sample tasks.
- Task and project views reuse the shared components for search, filtering, goals, project association, directory replacement, mock diffs and Git dialogs.
- Conversation routes include `#/sessions`, `#/sessions/task/<id>` and `#/sessions/project/<id>`. Search, scope changes, mock sends and stopping replies are simulated locally.

Task edits and mock messages remain in page memory and reset on a full refresh. Conversation changes survive navigation within that browser page session. Ctrl+Enter sends a simulated reply. System/editor/terminal/Git actions show demo feedback rather than executing real operations. Replies do not call a model or production API.

The standalone demo does not load the production locale bootstrap and uses the source-language labels. Verify language selection and persistence in the production application rather than the mock-data demo.

## Files

| File | Role |
| --- | --- |
| `main.tsx` | Demo shell, page state and design controls |
| `fixtures.ts` | Simulated tasks, projects and directories |
| `style.css` | Demo-only tokens and style overrides |
| `project-preview.tsx` | Project-pane resizing and keyboard interaction |
| `conversation-preview.tsx`, `conversation.css` | Mock conversation adapter and local styling |
| `vite.config.mts` | Separate Vite development/build entry |

Business components come from `../frontend/workspace/`; base styling comes from `../frontend/styles.css` and `../web/`. Prefer local overrides for experiments, then move an approved change into the production components with appropriate tests.

This preview is a browser sandbox, not a Figma design file. Run its type check and build after changes; verify production behavior separately against the real backend.
