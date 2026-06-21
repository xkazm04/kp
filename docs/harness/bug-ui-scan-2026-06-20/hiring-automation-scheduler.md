# Hiring Automation & Scheduler — Bug Hunter scan

> Context: The background automation engine that advances the pipeline on a schedule: passes, fairness/ROI gating, cache keys, and the persistent scheduler (incl. Python automation CLI/eval).
> Files reviewed: 16 of 19
> Total: 7 findings — Critical: 1, High: 3, Medium: 2, Low: 1

## 1. Every automation API route is unauthenticated and unauthorized — anyone can spend LLM budget, email candidates, and arm the autonomous clock

- **Severity**: Critical
- **Category**: auth-gap / trust-boundary
- **File**: `app/api/automation/[task]/route.ts:8`, `app/api/automation/run/route.ts:12`, `app/api/automation/schedule/route.ts:33` (no `middleware.ts` exists for the app)
- **Scenario**: An unauthenticated client POSTs `/api/automation/outreach {"entryId":"…"}` (or `/screen`, `/offer`, `/rejection`), or POSTs `/api/automation/schedule {"enabled":true,"intervalMinutes":1,"tick":true}`. There is no session check, no API key, no `cookies()` read, and the project has no `middleware.ts`. Each call runs.
- **Root cause**: These handlers were written as "local-first single-tenant" helpers and never gained a trust boundary, but they perform real money/side-effect actions (spawn the LLM, `dispatchOutreach` → `sendComm` POSTs to the candidate relay, `setApproval`, `actOnPipelineEntry`). The `[task]` route forwards an arbitrary `task` path segment straight into `runAutomationTask`, and `runAutomationPass` snapshots and mutates the *entire* board.
- **Impact**: Unbounded LLM/billing spend, candidate-facing emails sent on demand, the autonomous policy clock can be enabled and its cadence dropped to 1 minute, and the whole pipeline can be advanced — all without credentials. If this is ever exposed beyond localhost, it is a full data-mutation + cost-amplification surface.
- **Fix sketch**: Add an auth gate (session/recruiter check or a server-only secret) in a shared wrapper used by all three routes, or a `middleware.ts` matching `/api/automation/*`. At minimum require a non-public token for the `run`/`schedule`/`[task]` mutating verbs; reject unknown `task` before any work.

## 2. `claimDueRun` recomputes `next_due_at` from `now`, not from the prior due time — the clock drifts and slowly loses ticks

- **Severity**: High
- **Category**: edge-case / clock-drift
- **File**: `app/_lib/scheduler-store.ts:209` (`const next = new Date(Date.now() + interval)…`), claimed at `:203-217`
- **Scenario**: Interval 15 min. The heartbeat is every 60 s, and a pass takes ~40 s, or the box sleeps/GC-pauses. When the window finally fires at, say, due+90 s, `claimDueRun` sets `next_due_at = now + 15min` — i.e. 16.5 min after the previous fire, not 15. Each late tick re-anchors on "now", so the cadence permanently slides later.
- **Root cause**: The next due time is computed from wall-clock `Date.now()` at claim time instead of from the previous `next_due_at` (anchored advancement). Any per-tick lateness is baked into the next interval rather than caught up.
- **Impact**: A "15-minute" pass drifts to effectively 16–17+ minutes and keeps slipping; over a day the board is evaluated noticeably fewer times than configured. `setIntervalMinutes` already does anchored math (`anchorMs + interval`, `:185-186`) — the clock's own claim path is the inconsistent one.
- **Fix sketch**: Anchor on the prior boundary: `next = max(prevNextDueAt + interval, now)` (catch up in whole intervals, clamp to now), mirroring `setIntervalMinutes`. Keeps the cadence phase-stable across slow ticks.

## 3. Unscored `ds-` candidates (and any entry with an unresolvable pool candidate) deadlock at the Accepted gate forever

- **Severity**: High
- **Category**: latent-failure / state-corruption
- **File**: `app/_lib/automation-pass.ts:133-135` (filter excludes `candidateId.startsWith("ds-")` and requires a resolvable pool entry at `:148-151`), gate at `pipeline/jobfit/automation.py:199-201`
- **Scenario**: An inbound/sourced entry lands in `Accepted` with `matchScore = null` and a `ds-` candidate id (or a candidate id that `resolveCandidatePoolEntry` can't resolve — no profile and no stored analysis). `scoreUnscoredEntries` filters it out, so it is never scored. `evaluate_entry` then returns `hold "accepted; awaiting match score"` on every pass — forever.
- **Root cause**: The auto-score sweep was the fix for "inbound applicants deadlock awaiting a score that nothing computes" (AUTO1), but it silently skips `ds-` ids and unresolvable candidates with no alert and no terminal disposition. The policy gate has no escape hatch for an entry that is permanently unscoreable.
- **Impact**: Affected candidates sit invisibly in `Accepted` indefinitely — never advanced, never rejected, never surfaced to a human. The `evaluated` counter hides it (the pass looks healthy: "evaluated N, held N"), so the stall is success-theater-shaped and won't trigger investigation.
- **Fix sketch**: When an `Accepted` entry stays unscored past an age threshold (reuse `daysInStage`), emit an `unscoreable`/`needs_human` alert and route it to the Decisions gate instead of holding silently; or have `scoreUnscoredEntries` log which entries it deliberately skipped so the gap is observable.

## 4. Reminder sweep `last_run_at` advances even when the sweep crashes, masking a dead candidate-reminder job

- **Severity**: Medium
- **Category**: silent-failure / success-theater
- **File**: `instrumentation-node.ts:47-65` (claim → try send → on error `recordRun(status:"error")`); `app/_lib/scheduler-store.ts:203-217` (claim advances `last_run_at`/`next_due_at` first)
- **Scenario**: `claimDueRun(REMINDERS_JOB)` advances `last_run_at = now` and `next_due_at` *before* the sweep body runs. If `sendDueInterviewReminders()` throws every minute (e.g. a persistent relay/DB fault), each tick still stamps `last_run_at = now`. The schedule payload's `reminders.lastRunAt` looks fresh ("ran a minute ago").
- **Root cause**: The liveness signal (`last_run_at`, claimed before work) and the success signal (an `ok` run row, written after work) are conflated by anyone reading `lastRunAt`. The comment at `instrumentation-node.ts:50-53` even states `last_run_at` is meant to "prove the sweep is alive" — but it proves only that the *clock* claimed the window, not that any reminder was sent.
- **Impact**: Time-sensitive interview reminders can stop going out while the Schedule UI shows the reminders job as healthy and recently run. The error rows exist in `scheduler_runs` but the headline `lastRunAt` contradicts them.
- **Fix sketch**: Surface the most recent run *status* (not just `lastRunAt`) in `schedulePayload()`/the UI, or stamp a separate `last_success_at` only after a successful sweep so a stuck job is visibly stale.

## 5. A forced/manual tick that joins an in-flight pass returns the running pass's summary but records no run — and a forced tick on a disabled schedule still executes the pass

- **Severity**: Medium
- **Category**: race-condition / bookkeeping
- **File**: `app/_lib/scheduler.ts:15-39`, `app/api/automation/schedule/route.ts:59`, `advanceAfterForcedRun` at `app/_lib/scheduler-store.ts:227-240`
- **Scenario A**: A clock tick starts a pass; a user clicks "Run now" (`tick:true`) mid-flight. `tickScheduler({force:true})` sees `startsPass = !isPassInFlight()` = false, so it neither advances the clock nor records a run — correct — but it *returns* `{ran:true, summary}` from the joined pass, so the manual click reports the *other* pass's result as if it were its own (the user thinks their forced run completed). **Scenario B**: `{tick:true}` while the schedule is *disabled* still calls `runAutomationPass()` (force bypasses `claimDueRun`); `advanceAfterForcedRun` no-ops because disabled, but the pass runs and applies decisions regardless — a "Run now" on an off schedule mutates the board.
- **Root cause**: `force` was designed to bypass the due-gate, but it also bypasses the *enabled* check before running the pass; and the join-vs-start bookkeeping only governs recording, not what summary is handed back to the joiner.
- **Impact**: Confusing/non-attributable run history (a forced run with no recorded row), and an "off" automation schedule that still executes a full applying pass on manual tick — surprising for an operator who toggled it off for safety.
- **Fix sketch**: Gate the forced pass on `getSchedule().enabled` (or make "Run now" an explicit, separately-authorized action that is honest about being unscheduled); when a forced tick joins an in-flight pass, return a distinct `{ran:true, joined:true}` rather than the other pass's summary.

## 6. `recordRun` writes `last_summary_json` for whichever job ran, but `getSchedule()` (policy) is read independently — a reminders `ok` run can leave the policy summary stale with no staleness marker

- **Severity**: Low
- **Category**: data-consistency
- **File**: `app/_lib/scheduler-store.ts:268-274` (updates `scheduler.last_summary_json` keyed by `name`), `rowToSchedule:86-106`
- **Scenario**: `last_summary_json` is the only persisted "what did the last run look like" and is updated only on `status==="ok" && summary!=null`. An `error` run never updates it, so `schedule.lastSummary` can reflect a successful pass from hours ago while every pass since has errored — the UI shows the last *good* summary with no indication the recent runs failed.
- **Root cause**: `lastSummary` conflates "last successful summary" with "current state"; the error path deliberately doesn't overwrite it (so you don't lose the good one) but nothing flags that newer runs failed.
- **Impact**: Minor operator confusion — the at-a-glance summary can look fine while the job is failing. Mitigated because `listRuns(10)` is also returned and carries the error rows.
- **Fix sketch**: Include the latest run's status alongside `lastSummary` in `getSchedule`/the payload, or stamp a `last_error_at` so a fresh failure is visible next to the stale-but-good summary.

## 7. Two same-process automation passes cannot overlap, but a manual `[task]` outreach and the policy pass can both touch one entry with no cross-guard

- **Severity**: Low
- **Category**: race-condition
- **File**: `app/_lib/automation-run.ts:57,281-300` (per-entry `outreachInFlight` Set), `app/_lib/automation-pass.ts:102-121` (separate `inFlightPass`)
- **Scenario**: The single-flight in `automation-pass.ts` serializes whole policy passes, and `outreachInFlight` serializes concurrent outreach *for one entry*. But a policy pass applying an `advance`/queueing a reject for entry X (via `actOnPipelineEntry`/`setApproval`) and a concurrent `/api/automation/outreach` for the same X run under *different* guards. The DB write itself is CAS/IMMEDIATE-tx protected (`actOnPipelineEntry`), so corruption is unlikely — but the outreach reads `entry` once (`automation-run.ts:89`) and acts on a snapshot the pass may have just moved/closed.
- **Root cause**: The two surfaces have independent in-flight guards and don't share a per-entry lock; only the final DB transition is serialized, not the read→decide window in `runAutomationTask` (outreach has no `expectedStage` CAS the way the policy/screen paths do).
- **Impact**: Low — worst case an outreach is dispatched against a candidate the policy pass just rejected/rematched in the same instant. Bounded by `hasEvent("outreach_sent")` idempotency, so at most one stray send.
- **Fix sketch**: Thread an `expectedStage`/status re-check into the outreach branch (re-read the entry under the same guard before `dispatchOutreach`), mirroring the screen-path CAS at `automation-run.ts:215-221`.
