# Refactoring plan

Preserve product behavior, public asset names, IDs/data-action attributes, preference keys, backend protocols and native host code. Keep the existing lightweight feature organization. No additional state framework, layout framework or component library.

1. Establish audit, source inventory, reproducible baseline and branch.
2. Verify unreachable code, remove dead local wrappers/exports and reconcile direct dependencies without removing live CSS tooling.
3. Consolidate repeated diagnostics and existing interaction/layout capabilities. Keep product styles and provider differences.
4. Correct data/resource ownership, cancellation, pane identity and disposal in affected features. Audit every existing feature, including auxiliary dialogs and retained controllers.
5. Strengthen full-source lint and source dependency checks; add focused behavior regressions and update component/development guidance.
6. Run all frontend suites, build and real Chromium flows with browser/desktop chrome at matched sizes. Record limitations of native Tauri verification.
7. Conduct **three serial independent reviews**: architecture, behavior, final full quality. Each starts from the preceding committed state; reviewers read only, root coordinates fixes/tests and commits. Maintain issue ledger and per-round reports. Do not treat the initial audit as a review round.
8. Execute final gates, check prohibited paths and worktree, publish branch and draft PR when access permits. Never merge main.

Each meaningful phase is committed after relevant validation. Generated assets are built for tests but excluded from refactoring commits. Documentation uses English and links to existing ownership references instead of duplicating them.
