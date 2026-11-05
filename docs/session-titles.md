# Session titles

This document describes current title behavior. Upgrading does not bulk-rename existing sessions, and there is no bulk legacy-title repair action.

## Current naming behavior

An empty `name` means no formal title. The UI displays a localized unnamed/new-session placeholder without writing that placeholder into the name field. A user can deliberately choose the same text as a manual name; its provenance matters more than its spelling.

For a new session, preserve an existing Codex title first. Otherwise extract an initial title from the first meaningful line of the submitted user text, up to 28 Unicode characters including any ellipsis. Strip common Markdown syntax and link targets; skip fenced code, standalone images, context blocks and bare URLs. This extraction makes no model request.

Write the initial title with `thread/name/set` on the creation connection, then save `title_source=initial` after success. If no meaningful text exists, retain the empty name. Initial naming is attempted once and does not block the first turn on failure. An uncertain result is checked through metadata rather than blindly resent.

After Codex accepts the first input of a Yolu-created session, the backend can attempt one topic-title generation in parallel with the main reply. It uses at most the first 4,000 Unicode characters of that input and an independent ephemeral model conversation, requesting a structured title of at most 28 characters with low reasoning effort. Image-only, code-only or context-only input is skipped; an assistant reply is not used as replacement input.

The title-model setting is independent of the body model. Settings offers models from the current environment, with following the conversation model as the default. It is saved in that environment's `settings.session_title` and does not change global Codex configuration. A failed selected model does not silently switch to another model.

Title generation consumes an additional model request and has a 30-second deadline. Its isolated, read-only temporary conversation disables tools/integrations such as MCP, plugins, apps, hooks, web search and multi-agent execution. The naming prompt/output is not appended to the original session history. Backend shutdown cancels the operation and cleans up its connection.

Before writing the generated title, recheck local provenance, timestamps, archive state and Codex's current title. Write only while the title still matches the original expected value; manual or external renames take precedence. Confirmed success is stored as `title_source=generated`. Later turns can proceed while naming is pending.

Failure, timeout or invalid output leaves the existing title and surfaces a notice. An uncertain write asks for a refresh/check. Later sends, refreshes and retried creation requests do not trigger another model naming attempt. Existing historical sessions do not receive generated titles in bulk.

Manual renaming writes to Codex first and then saves `title_source=manual`. A session's title does not subsequently track task names, project names or page scopes. Later explicit Codex renames can synchronize through a fresh metadata read.

## Provenance and concurrency

| `title_source` | Meaning |
| --- | --- |
| `initial` | Deterministic title extracted from first input |
| `generated` | Topic title generated from first input |
| `manual` | Explicit rename through Yolu |
| `codex` | Name read/notified by Codex |
| `legacy` | Older nonempty name with unknown origin |
| Empty string | No known name |

`title_changed_at` records the update time. Metadata reads carry their start time, so a read started before a manual rename cannot restore an older title. Empty responses retain a known name; unchanged responses retain provenance. Unversioned rename notifications do not directly replace manual names, while newer metadata can still discover external changes.

Provenance and timestamps are included in metadata backup/import. Older backups remain importable. Migration marks older nonempty names as `legacy`; it does not clear a name merely because it matches a localized placeholder.

Codex's public rename API has no compare-and-set version parameter. Yolu serializes its own final title writes and rechecks state, but cannot eliminate the final cross-client check/write race.
