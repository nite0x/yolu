# Regression review issue ledger

Each confirmed finding records ID, round, module, priority, file/location, evidence/cause/impact, reproduction, planned and actual fix, tests, independent verification, commit and status. Zero-finding rounds retain coverage in their reports; counts are not targets.

| Round | Baseline | Independent role | Confirmed / fixed / independently closed | Open P0/P1 | Report |
| --- | --- | --- | --- | --- | --- |
| 1 | `eb901ad` | Architecture/component/quality | 0 / 0 / 0 | 0 | [Architecture](round-1-architecture.md) |
| 2 | `e60c004` | Behavior/state/lifecycle | 1 / 1 / 1 (P2) | 0 | [Behavior](round-2-behavior.md) |
| 3 | Pending | Final independent full quality | Pending | Pending | Pending |

Initial implementation findings and their fixes are documented in [audit](../audit.md) and [progress](../progress.md); they are not falsely counted as discoveries from the post-refactor reviews.

- **R2-001 (P2, closed):** eight unused classic-controller declarations removed and independently verified. Full locations, evidence, cause, impact, reproduction, fix and tests are in [round 2](round-2-behavior.md). The round-2 commit is recorded in subsequent progress/history.
