# Automation Orchestration — UI+Bug combined scan
> Total: 4 findings (0 crit / 2 high / 2 med / 0 low)
> Group: Automation & Simulation | Lens mix: 4 bug / 0 ui | Files read: 8

Verified-and-NOT-reflagged (prior hardening confirmed intact): per-decision apply isolation
in the policy pass (`automation-pass.ts:84-143` try/catch per decision, `errors` accounted in
summary); optimistic-CAS `expectedStage` on advance/reject so a stale verdict no-ops instead of
mutating the current stage (`automation-pass.ts:91-115`, `automation-run.ts:174-181`); reject
fairness backstop downgrade-to-hold (`automation-pass.ts:99-125`); in-process single-flight on
`runAutomationPass` (`automation-pass.ts:46-54`); cross-process clock lock via `claimDueRun`
(`scheduler-store.ts:144-158`) and the `advanceAfterForcedRun` double-fire guard
(`scheduler.ts:20`, `scheduler-store.ts:168-181`); rematch source close under `tx.immediate()`
(`db.ts:3335-3370`); reject DB commit ordered before the rejection comm so a comm throw can't
un-reject (`automation-pass.ts:106-109`).

## 1. Concurrent `/api/automation/outreach` for one entry double-sends the candidate (TOCTOU)
- **Severity**: High
- **Lens**: 🐛 Bug Hunter
- **Category**: Race condition / silent duplicate side effect at a trust boundary
- **File**: `app/_lib/automation-run.ts:240-245` (gate) + `app/_lib/comms-dispatch.ts:54-62` (marker write); entered via `app/api/automation/[task]/route.ts:13`
- **Scenario**: Two near-simultaneous POSTs to `/api/automation/outreach` for the same `entryId` (double-click, refresh-retry, a recruiter and a script). Both read `hasEvent(entry.id, "outreach_sent")` (line 240) and see no marker yet — the marker is only written *inside* `dispatchOutreach` *after* `sendComm` (`comms-dispatch.ts:61`). Both proceed to `dispatchOutreach` → the candidate gets the outreach email/outbox row twice.
- **Root cause**: Check-then-act idempotency where the guard (`hasEvent`) and the marker write (`recordAutomationEvent("outreach_sent")`) are not atomic, and the synchronous `[task]` route has no single-flight/dedup. The route comment (`[task]/route.ts:6-7`) explicitly says the hardened/dedup'd path is `/api/tasks` kind `"automation"` — but this route is still publicly exposed and runs the *same* `runAutomationTask`, so the convenience path bypasses the only dedup that exists. The prompt-cache makes the *draft* idempotent but not the *send*.
- **Impact**: Duplicate real candidate outreach (and duplicate relay POSTs when `COMMS_WEBHOOK_URL` is set). Not caught by the cache, the CAS (outreach has none), or the per-pass single-flight (that only guards `runAutomationPass`, not per-task `[task]` calls).
- **Fix sketch**: Make first-contact atomic — record `outreach_sent` *before* (or in the same transaction as) the send, gated on an INSERT-if-absent (e.g. a unique `(entry_id, kind)` insert that fails the second caller), then dispatch only on the winning insert; OR route `[task]` outreach through the dedup'd task runner. Mirror the durable single-flight already used for the pass.

## 2. `intervalMinutes: NaN` slips through the clamp and corrupts the clock cadence
- **Severity**: High
- **Lens**: 🐛 Bug Hunter
- **Category**: Validation gap at a trust boundary
- **File**: `app/api/automation/schedule/route.ts:16` → `app/_lib/scheduler-store.ts:115`
- **Scenario**: POST `/api/automation/schedule` with `{ "intervalMinutes": "fast" / 0/0 / 1e999 }`. The route guard is only `typeof body.intervalMinutes === "number"` (line 16) — `NaN` and `Infinity` are `number`. `setIntervalMinutes` clamps via `Math.max(1, Math.min(1440, Math.round(minutes)))`: `Math.round(NaN)=NaN`, `Math.min(1440,NaN)=NaN`, `Math.max(1,NaN)=NaN`. The clamp does NOT reject NaN — it is stored as `interval_minutes`.
- **Root cause**: `Math.min/Math.max` propagate `NaN` rather than clamping it; the route trusts `typeof === "number"` without a finiteness check. Downstream `nextDueAt` becomes `new Date(Math.max(anchorMs + NaN*60000, Date.now()))` → still `Date.now()` here, but the corrupt `interval_minutes` then feeds `claimDueRun` (`scheduler-store.ts:150`) and `advanceAfterForcedRun` (`scheduler-store.ts:174`): `Date.now() + NaN*60000 = NaN` → `new Date(NaN).toISOString()` **throws RangeError ("Invalid time value")** inside `claimDueRun`, so every subsequent heartbeat tick crashes before claiming/advancing — the automation clock silently stops firing until the row is repaired.
- **Impact**: A single malformed (or fat-fingered) schedule POST wedges the scheduler clock for the whole process (recurring passes stop), with the failure buried in the heartbeat. Persists across restarts (durable row).
- **Fix sketch**: In `setIntervalMinutes`, replace the clamp with `Number.isFinite(minutes)` guard → fall back to `DEFAULT_INTERVAL_MIN` (or throw a 400); and/or reject non-finite `intervalMinutes` in the route before calling the store.

## 3. Forced manual tick joins an in-flight clock pass → double clock-advance + duplicate run-log row
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter
- **Category**: Race / success-theater accounting
- **File**: `app/_lib/scheduler.ts:15-31` (force path) + single-flight at `app/_lib/automation-pass.ts:48-54`; entered via `app/api/automation/schedule/route.ts:18`
- **Scenario**: The heartbeat clock tick wins `claimDueRun`, starts `runAutomationPass`, and is mid-Python. A recruiter hits POST `/api/automation/schedule` with `{tick:true}` in that window. The forced tick runs `advanceAfterForcedRun()` (`scheduler.ts:20`) — a SECOND advance of `next_due_at` on top of the one `claimDueRun` already did — then calls `runAutomationPass()`, which (correctly) JOINS the in-flight pass and returns its summary. Both `tickScheduler` invocations then call `recordRun` with that same logical pass.
- **Root cause**: Single-flight de-dupes the *work* but not the *bookkeeping*: two tick callers observe one pass and each independently advance the clock and write a `scheduler_runs` row. `advanceAfterForcedRun` runs unconditionally on the force path even when no new pass actually started.
- **Impact**: One executed pass appears as two rows in the run log surfaced by `listRuns` / the schedule GET (run-count/last-run UI overstates activity), and `next_due_at` is pushed out an extra interval — the next scheduled pass is delayed by up to one cadence. No data corruption; degraded observability + timing.
- **Fix sketch**: Have `runAutomationPass` signal whether the caller *started* vs *joined* (e.g. return `{result, started}`), and only `advanceAfterForcedRun` + `recordRun` when this caller actually started the pass; otherwise treat the forced tick as a no-op join.

## 4. Policy-pass entry snapshot can be empty due to terminal `status` filter — pass reports success over a stale board
- **Severity**: Medium
- **Lens**: 🐛 Bug Hunter
- **Category**: Edge case / silent no-op (empty funnel)
- **File**: `app/_lib/automation-pass.ts:57-59` + `app/_lib/db.ts:2060-2082`
- **Scenario**: `listActiveEntriesForAutomation` returns only `status='active'` rows. When the funnel is empty (or every entry is terminal — rejected/rematched/declined), `executeAutomationPass` early-returns `{summary: all-zeros, decisions: []}` (line 59). `recordRun` (`scheduler.ts:25`) stamps this as `status:"ok"` with a zeroed summary — indistinguishable in the run log / schedule GET from a pass that genuinely evaluated entries and decided "nothing to do".
- **Root cause**: No distinction between "evaluated N entries, 0 actions" and "0 entries to evaluate." The summary type (`AutomationSummary`) has no `evaluated`/`scanned` count, so the run log shows a healthy green run even if, e.g., a status-filter regression or a migration left zero active rows.
- **Impact**: Success theater on the orchestration status surface — operators can't tell a healthy idle pass from a pass that saw nothing because the board was unexpectedly empty/broken. Low blast radius (read-only/observability), but it's the exact "success theater" the automation status surface is meant to prevent.
- **Fix sketch**: Add `evaluated: entries.length` (or `scanned`) to `AutomationSummary` and surface it in the run log / schedule status, so an empty-funnel pass is visibly distinct from an active one with no actions.
