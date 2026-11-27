# Backend overhaul verification

## Baseline and scope

The branch starts at `8825d072623291ab5324606299fc2f3e711ad1e9` on
`origin/main`, including the merged frontend overhaul and cleanup. The original
`work` checkout at `7399171` was clean and remained in its own worktree.
Baseline frontend build and checks, Go tests, vet and the core race suite
passed on Linux using Go 1.26.11 and Node 24.22.3. The baseline race suite was
run in a detached reference worktree to avoid concurrent source edits.

The implementation keeps the modular monolith and existing product surfaces.
See [application boundaries](architecture.md) and
[session architecture](session-architecture.md) for the current dependencies,
lock order, provider lifecycle, receipt handling and stream behavior.

## Independent review passes

| Pass | Evidence and findings | Resolution |
| --- | --- | --- |
| Architecture and cleanup | Import and call-site inspection after the implementation commits found the ACP and Antigravity catalogs still importing the Codex model type. Steering also still combined HTTP writes, durable receipts and a protocol call in one method. A route and production caller search found the retired assistant business API reachable only from its own tests. | Shared the catalog model through `internal/model`, extracted `SteerTurn`, and reused exact-turn Codex acknowledgement logic for async answers. Removed obsolete assistant polling, action and run APIs. The migration and transfer tests now seed historical rows and verify the retained evidence. Focused model, steering, approval, metadata and lifecycle checks passed. |
| Correctness and concurrency | A checkout hook can leave a path visible before Git has completed. Session and terminal admission previously relied on an environment lock that did not cover all those callers. Remote helper closure preceded the abort of its managed turns. In a delayed-interrupt fixture, a successful turn could complete before the stop error arrived. | Added checkout destination claims consulted by chat, binding and terminal admission. Narrowed registration locking around local uniqueness and commit, rechecked repository identity under the Git lock, ordered session cleanup before remote closure, and preserved completed turn state after a late stop error. Verified using the blocked checkout hook, the delayed start/interrupt fixtures, and focused race tests. |
| Workflow and integration | Reviewed live route callers and tested the compiled sidecar with temporary repositories, a fake provider, isolated storage, two Chromium entry modes, and actual terminal transport. Added a shutdown case with an open SSE stream and pending directory approval, a cloud metadata transfer and reopen test, and a transient media retry regression. A provider could receive an ordinary turn before its acknowledgement was lost. After a restart the request identity was missing, creating a resubmission risk. | Reserved ordinary turn receipts immediately before provider submission. Verified uncertain and acknowledged sends across restart, shutdown and reconnection with saved bindings and history, cloud account isolation after transfer, and media retry without a new run event. Installed and authenticated providers and a native Tauri host require separate environment checks. |

## Performance measurement

Measurements use Linux amd64, Intel Xeon Platinum 8573C, Go 1.26.11 and
`GOMAXPROCS=4`. Copy the two test files below to a detached checkout of the
baseline to repeat the same workload. Build embedded assets first.

```sh
go test ./internal/session -run '^$' -bench '^BenchmarkChatEventsIdle$' -benchtime=3x -count=3 -benchmem
go test ./internal/project -run '^TestMeasureWorktreeCreationOverlap$' -count=3 -v
```

Use `internal/session/chat_stream_benchmark_test.go` and
`internal/project/worktree_concurrency_test.go` for the reference checkout.

| Workload | Baseline median | Overhaul median |
| --- | ---: | ---: |
| Four open SSE readers, 120 history entries, 20 async question entries and 550 ms idle per sample | 3.38 MB and 9,982 allocations per sample | 1.40 MB and 531 allocations per sample |
| Two concurrent worktree creation requests in different repositories, 250 ms post-checkout hook each | 575 ms | 294 ms |

The SSE run measures allocation under idle pane fan-out after the initial
frame. The fixed idle period dominates elapsed time. The worktree run measures
wall time through the HTTP route with local Git. Remote filesystem latency and live model throughput remain unmeasured. SQLite keeps its existing
connection and WAL settings.

## Boundaries still governed by the existing product

Destructive cleanup uses an environment cleanup gate while verifying native
activity, including native discovery across working directories. Checkout
creation uses scoped claims. The native Codex protocol still has no atomic
idle-only start condition across separate clients. The completed-run byte
budget estimates retained payload and does not measure process heap or limit
active provider output.

## Verification and platform limits

The verification set includes `go test ./...`, `go vet ./...`, the expanded
core race suite, `npm run check` and the generated API contract check. Frontend
verification includes the production bundle budget, the Node script, application
and chat suites, the Chromium UI check, and desktop packaging contracts.
The isolated sidecar smoke exercises shutdown and rejected replay after restart.
The embedded Chromium workflow suite covers browser and desktop-chrome entry
modes, conversations, directories, panes, reconnects and PTY transport.
The Go sidecar also cross-builds for Windows and macOS amd64.

An initial parallel verification run let desktop preparation rebuild embedded
assets while the Node tests were reading them. That run reported missing
generated files and one 15-second conversation list timeout. The rerun builds
assets first and runs the frontend suites without a competing build.
The expanded shutdown fixture initially reused an existing directory grant
and completed automatically. A fresh unbound directory keeps the test in
a pending approval until shutdown.

The Linux environment lacks `rustc`, `cargo` and the GTK/WebKit development
packages used by Tauri. `npm run desktop:test` stopped at
`spawnSync rustc ENOENT` during sidecar preparation. Native Tauri and native
platform behavior therefore remain unverified here. Installed Codex, Cursor,
Antigravity, real cloud and WSL integration require their established
explicitly enabled environments. Automated provider tests used isolated
fixtures without real credentials or model calls.
