# Tasks & System Operations — bug-hunter + ui-perfectionist scan

> Context: The background task tracker (provider, indicator, tasks tab), system/backup cards, health and ops telemetry, and the Python runner bridge.
> Files reviewed: 16 of 27
> Total: 5

## 1. Health/ops report "Healthy" even when the background scheduler clock is dead

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `instrumentation-node.ts:119-133`, `app/api/health/route.ts:33`, `app/api/ops/route.ts:29`, `app/_lib/scheduler-health.ts` (whole file)
- **Scenario**: The clock is a single self-rescheduling `setTimeout` chain (`armNext`/`runTick`) that drives interview reminders, offer-expiry lapses, pre-boarding nudges, and the **GDPR consent-anonymization sweep**. If that chain ever stops — the instrumentation hook didn't fire for this runtime, an out-of-`try` throw broke the re-arm, the process was replaced by a platform that doesn't keep a long-lived worker, or the timer was `unref`'d and the loop drained — every time-sensitive sweep silently ceases. Meanwhile `/api/health` still returns 200 and `SystemCard` shows a green "Healthy" dot.
- **Root cause**: The health verdict (`ok = degradedReasons.length === 0`) is computed only from seed health + an empty job catalog + queue depth. Nothing reads the scheduler's `last_run_at` freshness. `scheduler-health.ts` reasons only about whether an *error row* is current (`isCurrentRunError`), never whether the scheduler is *alive*. There is no liveness signal anywhere on the ops surface.
- **Impact**: A wedged scheduler stops candidate-facing comms and lapses a legal consent-expiry obligation with zero operator signal — the dashboard actively reassures "Healthy." This is the exact "reports healthy when the scheduler is wedged" failure.
- **Fix sketch**: Have the clock stamp a `last_tick_at` heartbeat each `runTick`; add `schedulerStale(lastTickAt, now)` to `scheduler-health.ts` (stale if `now - lastTickAt > 3×HEARTBEAT_MS`) and push a `degradedReason` from `/api/ops` + a 503 reason from `/api/health` when stale, so the green dot can never lie about a dead clock.

## 2. A hung task handler permanently consumes one of only two concurrency slots — two hangs deadlock the whole queue

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure
- **File**: `app/_lib/tasks.ts:33` (`MAX_CONCURRENT = 2`), `:232-281` (`runOne`), `:210-223` (`cancelTask`)
- **Scenario**: `runOne` does `await spec.run(...)` with no wall-clock bound. The only thing that ever aborts a live task is a user clicking cancel. A crash rejects and finishes the row, but a handler that *hangs* (a JS-side LLM/HTTP call with no timeout, an await on a stuck lock, SQLite contention) never settles, so the row stays `running` forever and never releases its slot. With `MAX_CONCURRENT = 2`, two such hangs mean every subsequent task sits `queued` forever; the UI polls indefinitely and no work runs until a full process restart.
- **Root cause**: The runner delegates *all* liveness to each handler's own discipline. `spawnPython` self-limits (10-min timeout), but any handler path that doesn't go through it — or any await nested before/after it — is unbounded, and the scarce 2-slot budget makes even a partial stall queue-wide.
- **Impact**: Invisible background-processing outage (health still green per Finding 1), starving all queued analyze/screen/JD/eval work until an operator notices and restarts.
- **Fix sketch**: Wrap `spec.run` in a per-kind wall-clock budget (`Promise.race` against a timeout that fires `controller.abort()` and marks the row `interrupted`), making "a stuck handler holds a slot forever" impossible at the runner level rather than per handler.

## 3. The `tasks` table grows without bound — no retention/prune for finished runs

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/_lib/db/tasks.ts:285-294` (`finishTask`), `app/_lib/tasks.ts:39-42` (`RECENT_TASK_WINDOW_DAYS`), `app/api/tasks/history/route.ts`
- **Scenario**: Every enqueued task inserts a permanent row carrying `params_json` (the *full* original request, deliberately retained so retry can replay it) and `result_json` (arbitrary handler output — analyses, group-eval payloads). Nothing ever deletes rows: `RECENT_TASK_WINDOW_DAYS` only bounds the live *read* window and history just pages the rest. A confirming grep finds no `DELETE FROM tasks` / prune / VACUUM anywhere.
- **Root cause**: The 7-day window was treated as a retention policy, but it is only a read filter — the underlying table accumulates one large-blob row per run forever.
- **Impact**: On a busy workspace the SQLite file (and every backup/`workspace/export`) bloats over months; history queries and the ops `countActiveTasks`/scans slow; the same store that must stay fast for live polling carries unbounded dead weight.
- **Fix sketch**: Add a retention sweep to the existing clock (delete terminal rows older than e.g. 90 days, or null out `result_json`/`params_json` past the retry window while keeping the audit row), and expose the prune count on the ops payload.

## 4. Live poll re-renders every `useTasks` consumer every 2s even when nothing changed

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: component-architecture
- **File**: `app/features/tasks/TasksProvider.tsx:71-79` (`refresh`/`setTasks`), `:181-192` (context `value`), `:157-179` (poll loop)
- **Scenario**: `refresh` runs every 2s while any task is active and calls `setTasks(p.tasks)` with a freshly parsed array on *every* tick, so the reference always changes even when the payload is identical. The provider then rebuilds its `value` object (no `useMemo`) plus new `running`/`findActive` references, so every component reading `useTasks()` — the always-mounted sidebar `TasksIndicator`, the whole Tasks tab, every `ActiveCard`/`DoneRow` — re-renders on each poll. Because the provider sits above the tabs, this churn runs continuously during long pipeline work.
- **Root cause**: Polled state is committed unconditionally and the context value isn't memoized, so an unchanged 2s poll still cascades a full consumer re-render.
- **Impact**: Steady wasted render work (and jank on low-end devices) for the entire lifetime of any running task, with expanded outcome drawers and history rows re-rendering needlessly.
- **Fix sketch**: Skip the `setTasks` commit when a cheap signature (ids+status+progress) matches the current list, and wrap the context `value` in `useMemo`; consider memoizing `DoneRow`/`ActiveCard` so unchanged rows stay put across ticks.

## 5. [STILL-OPEN] Indeterminate runs render a frozen fake ~8% progress bar

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/tasks/TasksTab.tsx:41-44` (`pct`), `:393-395` (bar)
- **Scenario**: Still present from the 2026-06-20 report (finding 6). A running task with no `progressTotal` — the common case for LLM kinds like `analyze`/`reasoning` — gets `pct()` = 8, and the bar renders at a static `Math.max(6, 8)%` width that never moves for the entire multi-minute run. It reads as a determinate bar stalled at ~8%, not as "working / indeterminate." It still matters because it directly undermines the "status legibility" the tasks list is supposed to provide and prompts needless cancels of healthy long runs.
- **Root cause**: A determinate bar is reused for genuinely indeterminate work by faking a small constant percentage instead of rendering an indeterminate treatment.
- **Impact**: The progress affordance lies — a long, healthy indeterminate task looks frozen, eroding trust in the live view.
- **Fix sketch**: When `progressTotal <= 0`, render an animated indeterminate bar (marquee/shimmer) gated on `useReducedMotion` (already imported here), and show the determinate `%` fill only when `progressTotal > 0`.
