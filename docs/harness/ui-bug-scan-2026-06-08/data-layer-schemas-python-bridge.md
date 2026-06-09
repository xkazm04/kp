# Data Layer, Schemas & Python Bridge — UI+Bug combined scan
> Total: 4 findings (0 crit / 1 high / 2 med / 1 low)
> Group: Platform & Shared Infrastructure | Lens mix: 3 bug / 1 ui | Files read: 16

Hardened paths re-verified, NOT re-flagged: `spawnPython` signal→SIGKILL + timeout + `maxBufferBytes` ceiling (python-runner.ts:148-205); `parsePythonJson` end-scan robustness (226-246); opportunistic + boot cache prune with bounded LIMIT (db.ts:842-865); `serializeResult` circular-ref guard (db.ts:2396-2407); `markTaskRunning`/`setTaskProgress` terminal-status guards (db.ts:2380/2387); atomic `uq_tasks_active_dedupe` + `createTask` collision-reuse (db.ts:463-470, 2295-2304); synchronous (race-free) `ensureDb` init. `spawn(PYTHON_CMD, args[])` is array-form, not shell — no argument injection (confirmed; not flagged).

## 1. A DB write that throws inside `runOne`'s catch leaks the task as permanently 'running'
- **Severity**: High
- **Lens**: 🐛 Bug Hunter
- **Category**: Race condition / silent failure under contention
- **File**: `app/_lib/tasks.ts:244-252` (with `app/_lib/db.ts:2409-2418`, `2376-2381`)
- **Scenario**: The runner's whole reason for moving `markTaskRunning` inside the `try` is the SQLITE_BUSY-under-contention case (the scheduler ticks on its own connection, busy_timeout can lapse). When `markTaskRunning` throws, control enters the `catch`, which immediately calls `finishTask(id, "failed", …)` — another `UPDATE` on the same contended DB. Under the same lock pressure that just failed the first write, `finishTask` can throw too. That throw is NOT caught (the `catch` body is unguarded), so it propagates out of `async runOne`, and since `runOne` is invoked as `void runOne(id)` (pump():213) it becomes an **unhandled promise rejection**. More importantly the row is never transitioned: it was left `'running'` by the failed `markTaskRunning` (or stuck `'queued'`), so it now stays a phantom forever until the next process restart's `interruptStaleTasks` sweep.
- **Root cause**: The error-recovery write reuses the same failure-prone resource (the busy DB connection) with no guard; the comment at 226-231 anticipates `markTaskRunning` throwing but not `finishTask` throwing in the handler for it.
- **Impact**: Under write contention a task both (a) emits an unhandled rejection (noisy, and a crash risk under strict process settings) and (b) becomes an undead `'running'` row — `TasksProvider` shows a perpetual spinner and polls every 2s, and the `MAX_CONCURRENT` accounting in *this* process is fine (finally restores it) but the DB depth in `/api/health.queue.running` is permanently inflated until restart.
- **Fix sketch**: Wrap the `catch`-body `finishTask` in its own `try/catch` (log on failure); the `finally` already restores the in-memory slot. Optionally retry the status write once after a short delay, or downgrade to a best-effort `markTaskRunning`-style guarded UPDATE.

## 2. Large pasted JD / company text is shoved into a single argv entry — no length cap → spawn fails with an opaque OS error
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter
- **Category**: Edge case / validation at the TS↔Python bridge
- **File**: `app/_lib/python-runner.ts:64-73` (`buildCliArgs`) and `app/_lib/analyze-run.ts:34-42` (`cliArgs`)
- **Scenario**: Uploaded *files* are capped at `MAX_FILE_BYTES` (8 MB) at the route boundary, and `spawnPython`'s `maxBufferBytes` caps the child's *output* — but pasted **text** (`jobDescriptionText` / `companyText`) is forwarded verbatim as one `--job-description-text <entire-string>` argv element with no input-size guard anywhere. A multi-MB paste (or an automated client posting a big blob) exceeds the OS command-line limit — ~32 KB total on Windows (`CreateProcess`), `MAX_ARG_STRLEN` (≈128 KB per single arg) on Linux — so `child_process.spawn` rejects with `E2BIG`/`ENAMETOOLONG` before Python ever runs.
- **Root cause**: The 8 MB contract guards the file path, not the inline-text path; an argv string is the wrong transport for unbounded user text.
- **Impact**: Analyze/match silently fails with a cryptic spawn error (the `child.once("error")` reject at python-runner.ts:189 surfaces a raw `spawn E2BIG`, not a user-fixable 400). On Windows the threshold is low enough that a long pasted job description can trip it in normal use.
- **Fix sketch**: Cap pasted text length at intake (reuse the 8 MB ceiling, reject with 413/400), OR pass long text via a temp file (`persistFile`, already used for the CV) / via the child's stdin instead of argv. A defensive length check in `buildCliArgs`/`cliArgs` is the cheapest stopgap.

## 3. `interview_prep` handler ignores the abort signal, so cancel can't actually stop it
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter
- **Category**: Async runner lifecycle / ineffective cancellation
- **File**: `app/_lib/tasks.ts:127-130` (vs every other handler, e.g. 80-126)
- **Scenario**: Every other `HANDLERS` spec threads `ctx.signal` into its run function (`runReasoning(ctx.params, ctx.signal)`, `runAnalyze(…, ctx.signal)`, etc.), and `cancelTask` for a *running* task only calls `controller.abort()` (tasks.ts:197-199) — it does NOT write the DB or kill anything itself, relying entirely on the handler observing the signal to short-circuit and stop its child process (spawnPython wires abort→SIGKILL). But `interview_prep` is wired as `run: (ctx) => runInterviewPrep(ctx.params)` — `ctx.signal` is dropped. So a DELETE on a running interview_prep task aborts a signal nobody listens to: the underlying Python/LLM work runs to completion, holding a `MAX_CONCURRENT` slot, and the row is only stamped `'canceled'` afterwards (because `controller.signal.aborted` is true at the end, runOne:243).
- **Root cause**: One handler omits the signal arg the runner's cancellation contract depends on.
- **Impact**: User "cancel" on an interview-prep run does nothing for the (often slowest, LLM-bound) work — the slot stays occupied and the spend still happens; the UI misleadingly flips to canceled. Degraded, not data-loss.
- **Fix sketch**: Forward the signal: `run: (ctx) => runInterviewPrep(ctx.params, ctx.signal)` and have `runInterviewPrep` pass it into its `spawnPython({ signal })` call (matching `reasoning-run.ts:46`).

## 4. Task indicator's live count and start-error alert have no `aria-live` — screen readers never hear them
- **Severity**: Low
- **Lens**: 🎨 UI Perfectionist
- **Category**: Accessibility (dynamic content announcement)
- **File**: `app/features/tasks/TasksIndicator.tsx:16-32, 46-50`
- **Scenario**: The whole point of this component (per its own header comment) is the "always-at-a-glance signal" — a running count that ticks up/down and a start-failure banner. Both update purely visually: the running-count badge (46-50) and the "Couldn't start the task" error block (16-32) are inserted/changed in the DOM with no `role="status"`/`role="alert"` or `aria-live` region. A keyboard/screen-reader user who clicks a button that calls `startTask` and silently fails (the exact silent-no-op the `startError` plumbing was built to fix, per TasksProvider:88-93) gets no announcement — the visible fix is invisible to them. The spinner is also `aria-hidden`-less decorative iconography with no accessible "running" text.
- **Root cause**: Dynamic status surfaced visual-only; the a11y affordance the feature's intent requires is absent.
- **Impact**: Assistive-tech users lose the start-failure feedback and the task-progress signal entirely — high-value precisely because this surface exists to make state non-silent.
- **Fix sketch**: Wrap the error block in `role="alert"` (assertive) and give the count badge / button label an `aria-live="polite"` region (e.g. "2 background tasks running"); mark the spinner `aria-hidden` with adjacent SR-only text.
