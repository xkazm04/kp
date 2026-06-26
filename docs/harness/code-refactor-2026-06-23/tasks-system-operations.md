> Total: 6 findings (0c critical, 1h high, 2m medium, 3l low)

## 1. `commit_reflection` task kind is registered but never created
- **Severity**: High
- **Category**: dead-code
- **File**: app/_lib/tasks.ts:111-114 (HANDLERS), app/_lib/task-dedupe.ts:61-64 (DEDUPE_BUILDERS), app/_lib/devcase-run.ts:372 (runCommitReflection)
- **Scenario**: A full HANDLERS entry + a DEDUPE_BUILDERS entry + the `runCommitReflection` handler exist for kind `"commit_reflection"`, but nothing ever calls `startTask("commit_reflection", …)`. Confirmed: `grep -rn 'commit_reflection'` over the whole repo (excluding `.next`/`.claude/worktrees`/`node_modules`) returns ONLY the handler definition, the dedupe-builder definition, and the dedupe unit test — no UI button, no API route, no automated trigger creates it. `grep -rn 'runCommitReflection'` finds only its definition in devcase-run.ts and its single import/use inside the dead HANDLERS entry. (The Python `commit_reflection` in `pipeline/.../models.py:294` is an unrelated model field, not a task.) This is the focus list's "a task kind defined but never created."
- **Root cause**: A planned/abandoned feature (per-commit reflection) left a complete vertical slice — handler, dedupe key, run function, and a pinning test — wired into the registry but never given a caller.
- **Impact**: Dead reachable code that masquerades as live: it inflates the HANDLERS surface, the kind-filter dropdown in TasksTab would offer `commit_reflection` only if a row ever existed (it can't), and the dedupe test (`task-dedupe.test.ts:68-71`) gives false confidence that an exercised path is covered. `runCommitReflection` (a non-trivial CLI-spawning function) and its types in devcase-run.ts are kept alive solely by this dead reference, blocking dead-code elimination there too.
- **Fix sketch**: Either (a) wire up the missing creator if the feature is wanted, or (b) delete the HANDLERS entry, the DEDUPE_BUILDERS entry, the dedupe test case, and `runCommitReflection` (after confirming devcase-run.ts has no other internal caller). Prefer (b) unless a near-term plan exists.

## 2. `/api/health` and `/api/ops` duplicate the entire "degradedReasons" build
- **Severity**: Medium
- **Category**: duplication
- **File**: app/api/health/route.ts:18-25, app/api/ops/route.ts:22-28
- **Scenario**: Both routes independently run the same five-step health computation: `getSeedHealth()` → push `seed:<seed> <reason> (<path>)` for each `error` issue → `coreTableCounts()` → `countActiveTasks()` → push `"job catalog is empty"` when `tables.jobs === 0`. Confirmed by diffing the two grep outputs — the strings `seed:${...}`, `job catalog is empty`, and the table/queue calls are byte-for-byte mirrored.
- **Root cause**: `/api/ops` (DATA2) was added later as a 200-always dashboard read but re-implemented the readiness math that `/api/health` already had, instead of sharing a helper.
- **Impact**: The two health verdicts can silently drift — e.g. a new degraded condition added to one route but not the other means the dashboard ("Healthy") and the uptime probe (503) disagree. Two places to edit for every health-rule change.
- **Fix sketch**: Extract one `computeSeedHealth(): { degradedReasons, tables, queue, seedOk }` (next to `getSeedHealth` in db, or a small `_lib/health.ts`) and have both routes call it; each route keeps only its own response shaping (503 vs 200-with-body).

## 3. Retryable-status set encoded twice (server Set vs client predicate)
- **Severity**: Medium
- **Category**: duplication
- **File**: app/api/tasks/[id]/retry/route.ts:16, app/features/tasks/TasksTab.tsx:428
- **Scenario**: The server gate is `const RETRYABLE = new Set(["failed", "interrupted", "canceled"])`; the client decides whether to render the Retry button with `task.status === "failed" || task.status === "interrupted" || task.status === "canceled"`. Confirmed identical membership via grep — same three statuses, two encodings.
- **Root cause**: The client UI and the server validation each spelled out the policy inline rather than sharing it; `TaskStatus` lives in TasksProvider (a client module) so the server can't trivially import a client const.
- **Impact**: If the retryable policy changes (e.g. allow retrying `succeeded`, or stop allowing `canceled`), one side can be missed: the button would show but the POST returns 409 (a dead click surfaced via `startError`), or the button would hide a path the server still allows. Currently consistent, so low blast radius — but a latent drift hazard.
- **Fix sketch**: Define `RETRYABLE_STATUSES: TaskStatus[]` once in a shared, server-safe spot (e.g. alongside the `TaskStatus` type, or in `_lib/tasks.ts`) and import it into both the route and TasksTab.

## 4. `ACTIVE` (running||queued) predicate copy-pasted across files
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/tasks/TasksProvider.tsx:65, app/features/tasks/TasksTab.tsx:36, app/features/sub_dev/DevTab.tsx:143 (inline)
- **Scenario**: `const ACTIVE = (t: Task) => t.status === "running" || t.status === "queued";` appears verbatim in both TasksProvider and TasksTab, and the same expression is inlined in DevTab's `lifecycleActive`. Confirmed via grep for the expression.
- **Root cause**: Each consumer redeclared the "is this task active" rule locally; no shared helper was exported.
- **Impact**: Minor — three places agree today, but the "active" definition (e.g. if `interrupted` ever counts as in-flight) would have to change in all three. TasksTab even re-derives `running` itself instead of consuming the provider's already-computed `running` list.
- **Fix sketch**: Export `isActiveTask(t: Task): boolean` from TasksProvider and reuse it in TasksTab/DevTab; consider having TasksTab read the provider's `running` rather than re-filtering.

## 5. `RECENT_WINDOW_DAYS` restated in the client, hand-synced to the server const
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/tasks/TasksTab.tsx:17 (vs app/_lib/tasks.ts:39 `RECENT_TASK_WINDOW_DAYS`)
- **Scenario**: TasksTab declares `const RECENT_WINDOW_DAYS = 7` with a comment that it "Mirrors RECENT_TASK_WINDOW_DAYS in app/_lib/tasks.ts (server-only, so the value is restated here)". Confirmed both literals are `7`. The window value is the contract that keeps the recent list and the history endpoint from drifting (per the tasks.ts header), yet the client copy is a free-floating literal that the code comment itself flags as a manual mirror.
- **Root cause**: `app/_lib/tasks.ts` pulls in server-only deps (db, the run-* modules) so importing it into the client bundle is undesirable, and the value was duplicated rather than placed in a dependency-free shared module.
- **Impact**: Low but real: changing the server window to e.g. 14 days without updating the client makes the UI copy ("last 7 days", "older than 7 days") lie about what the server actually returns. It's a documented-but-fragile sync point.
- **Fix sketch**: Move the bare number into a tiny dependency-free constants module (e.g. `_lib/task-window.ts` exporting `RECENT_TASK_WINDOW_DAYS`) that both the server `tasks.ts` and the client TasksTab import — no server deps cross into the bundle.

## 6. Over-exported internal-only types in python-runner
- **Severity**: Low
- **Category**: cleanup
- **File**: app/_lib/python-runner.ts:24 (PythonError), :63 (SpawnResult), :69 (SpawnOptions)
- **Scenario**: `PythonError`, `SpawnResult`, and `SpawnOptions` are `export`ed but have zero references outside python-runner.ts. Confirmed: grep over `app/` (excluding `.next`/worktrees/the file itself) returns 0 other-file refs for each, while every actually-shared symbol (`spawnPython` 44, `parsePythonJson` 47, `parseStderrError` 33, `PipelineError` 12, `createWorkdir`/`cleanupWorkdir`/`persistFile`) has many. `PythonError` is only the constructor-arg type of `PipelineError`; `SpawnResult`/`SpawnOptions` only annotate `spawnPython`'s own signature.
- **Root cause**: Types exported by reflex when the module was written, before it was clear which were part of the public surface.
- **Impact**: Negligible runtime impact; just a slightly misleading public API (these read as "meant to be imported" when nothing does). Not worth a big change.
- **Fix sketch**: Drop `export` on the three (keep `PipelineError`, the spawn functions, and the workdir/file helpers exported). Leave if a public typing surface is intentionally wanted — purely cosmetic.
