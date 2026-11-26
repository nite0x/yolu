# Regression review issue ledger

Each confirmed finding records ID, round, module, priority, file/location, evidence/cause/impact, reproduction, planned and actual fix, tests, independent verification, commit and status. Zero-finding rounds retain coverage in their reports; counts are not targets.

| Round | Baseline | Independent role | Confirmed / fixed / independently closed | Open P0/P1 | Report |
| --- | --- | --- | --- | --- | --- |
| 1 | `eb901ad` | Architecture/component/quality | 0 / 0 / 0 | 0 | [Architecture](round-1-architecture.md) |
| 2 | `e60c004` | Behavior/state/lifecycle | 1 / 1 / 1 (P2) | 0 | [Behavior](round-2-behavior.md) |
| 3 | `1adb140` | Final independent full quality | 5 / 5 / 5 (P2) | 0 | [Final review](round-3-final.md) |

Initial implementation findings and their fixes are documented in [audit](../audit.md) and [progress](../progress.md); they are not falsely counted as discoveries from the post-refactor reviews.

- **R2-001 (P2, closed):** eight unused classic-controller declarations removed and independently verified. Full locations, evidence, cause, impact, reproduction, fix and tests are in [round 2](round-2-behavior.md). The round-2 commit is recorded in subsequent progress/history.

- **R3-001 (P2, closed):** progress summary reconciled with actual committed phase and verification.
- **R3-002 (P2, closed):** renderer tests now prove real shadow rendering/mode/effective theme and reject blocked-viewer fallback.
- **R3-003 (P2, closed):** live file/Diff theme updates now resynchronize CSP-compatible adopted styles without remounting.
- **R3-004 (P2, closed):** all live fixture snapshots publish atomically; deterministic concurrent-read test fails against original writer and passes after fix.

Full locations, evidence, causes, impact, reproduction, actual fixes, validation and independent closure are in [round 3](round-3-final.md). Review totals: **6 confirmed / 6 fixed / 6 independently closed**, all P2; **0 open P0/P1/P2**. No defect was reclassified to defer its fix. Final report records exact review commit SHAs.

- **R3-005 (P2, closed):** catalog axe checks await finite theme transitions; independent controlled old/current comparisons prove the timing fix without changing product colors or accessibility assertions.

## Fix commit references

- R2-001: `1adb14020694c2a78e45506135abea8351d5486f`.
- R3-001, R3-002, R3-003, R3-004: `b6cfbbcb8fc75d8f2deee3216fe469061054202a`.
- R3-005: `8c6f87c1df306d07e0d17663bee92abb3eda759e`.
- Zero-finding round1 record: `e60c00489c3d0d1b647190c13f59608fb7c482c3`.
