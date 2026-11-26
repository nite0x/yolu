# Frontend changes

Follow [the frontend source map](README.md), [engineering conventions](../docs/frontend/conventions.md) and [shared UI guidelines](../docs/ui-guidelines.md).

- Search and reuse existing components, hooks, API clients and tokens before adding an implementation.
- Keep feature state and resource lifetime with the feature; keep navigation and pane placement in the application shell. Do not add global stores without a demonstrated cross-feature need.
- Preserve browser/native adapter names, IDs/data-action attributes, preference keys and backend protocols. Backend agent/workspace rules stay on the backend.
- Respect `architecture.json`. No source cycles, reverse dependencies, catch-all barrels or redundant forwarding layers.
- Dispose listeners, observers, timers and async owners. Validate stored/event data and guard late results by resource identity.
- Remove superseded implementations after checking dynamic, CSS, host and test references.
- Do not weaken types, Lint or regression assertions. Use scoped explanatory Lint exceptions only for verified analyzer false positives.
- Run relevant behavior tests and full checks/build for shared changes. Build assets before backend/native packaging; verify browser and desktop entry points at matched sizes and report actual native-host limits.
- Keep changes scoped to the requested task and documentation in English.
