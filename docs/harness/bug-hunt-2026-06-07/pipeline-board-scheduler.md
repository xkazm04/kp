# Bug Hunt — Pipeline Board & Scheduler

> Total: 7
> Critical: 0 | High: 2 | Medium: 3 | Low: 2

## 1. Manual "Run now" never advances next_due_at → heartbeat double-fires the policy pass
- **Severity**: High
- **Category**: race-condition
- **File**: C:/Users/mkdol/dolla/kp/app/_lib/scheduler.ts:15 (and app/api/automation/schedule/route.ts:18)
- **Scenario**: Recruiter flips the Automation clock to **On** (interval 15 min). `setEnabled` sets `next_due_at = now`, so the window is open immediately. Within the next ~60s the recruiter clicks **Run now**. The POST route calls `tickScheduler({ force: true, trigger: "manual" })`. The pass runs and `recordRun` writes `last_run_at` but leaves `next_due_at` untouched. ~8–60s later the in-process heartbeat (`instrumentation.ts`) fires `tickScheduler()` (no force) → `claimDueRun()` sees `next_due_at <= now` is *still true* → it claims and runs the **same policy pass again**, seconds after the manual one.
- **Root cause**: The `force` path in `tickScheduler` short-circuits `claimDueRun()` (`if (!opts?.force && !claimDueRun()) ...`), so a forced/manual run executes the pass but never advances the durable clock. `claimDueRun` is the *only* writer of `next_due_at` on the run path, and it is skipped. The manual run and the next scheduled window therefore overlap.
- **Impact**: Auto-advance / auto-reject policy runs twice in quick succession against the board — extra stage transitions, duplicate aging alerts, and (if comms are wired) potential duplicate candidate-facing automation right after an operator manually ticks. Defeats the "exactly one run per window" guarantee the durable clock is built to provide.
- **Fix sketch**: After a successful forced run, advance the clock too — e.g. in `tickScheduler`'s force branch (or in `recordRun` for `trigger !== "clock"`) push `next_due_at = now + intervalMinutes` so a manual tick resets the scheduled window. Alternatively have the force path still call the CAS but ignore its boolean result purely to advance `next_due_at`.

## 2. `runPass` swallows non-OK automation responses — silent failure
- **Severity**: High
- **Category**: silent-failure
- **File**: C:/Users/mkdol/dolla/kp/app/features/sub_pipeline/PipelineTab.tsx:171-184
- **Scenario**: User clicks **▷ Run automation pass**. The `/api/automation/run` route returns a non-2xx (e.g. `AutomationPassError` 4xx, or a 500 from a DB/contention error). `runPass` only acts inside `if (r.ok)`; the `else` is empty. The button un-disables in `finally`, no `passSummary` appears, and no error is shown.
- **Root cause**: No handling of `!r.ok` and no `catch` for a network/JSON failure. The function reads as "did nothing" identically whether the pass succeeded with zero changes or failed outright.
- **Impact**: A failing manual policy pass is indistinguishable from a successful no-op. The operator believes the funnel was processed when it wasn't; aging/decision work silently doesn't happen. Note this is inconsistent with the rest of the file, which carefully separates board vs. activity errors and clears transient errors on success.
- **Fix sketch**: Wrap the fetch in try/catch and on `!r.ok` (or thrown error) set a visible error state (reuse the existing `error` banner or a dedicated pass-error chip), e.g. `if (!r.ok) setError(p.error ?? "Automation pass failed.")`.

## 3. Candidate with an unknown/missing stage silently disappears from the board
- **Severity**: Medium
- **Category**: edge-case
- **File**: C:/Users/mkdol/dolla/kp/app/features/sub_pipeline/PipelineBoard.tsx:185-192 (also PipelineTab.tsx:142 counting)
- **Scenario**: A `pipeline_entries` row carries a `stage` not in `STAGES` (legacy stage that didn't get remapped on boot, a row inserted via a path that bypasses the POST guard, or a migration gap). The lane renders, but `STAGES.map(stage => lane.filter(e => e.stage === stage))` never matches that entry, so it appears in **no** `StageCell`.
- **Root cause**: The board only renders the fixed `STAGES` columns; any entry whose stage is outside that set has no home cell and is dropped from the view. Meanwhile it is still counted in `pos.count`, `activeCount`, and the stat chips, so the totals say N candidates but only N−k are visible.
- **Impact**: A candidate genuinely in the pipeline becomes invisible and un-actionable from the board — no row, no drawer, no decision path — while header counts claim they exist. A recovery dead-end (the operator can't even see what to fix). The POST route guards *new* entries, but nothing guards already-persisted rows.
- **Fix sketch**: Either render an "Other / unknown stage" overflow cell for entries whose stage ∉ STAGES, or surface a board-level warning ("k candidates in an unrecognized stage"). At minimum make the count and the rendered set agree so totals can't claim invisible candidates.

## 4. Candidate with no jobId and no jobTitle inflates a position count but never renders
- **Severity**: Medium
- **Category**: edge-case
- **File**: C:/Users/mkdol/dolla/kp/app/features/sub_pipeline/PipelineTab.tsx:131-139, PipelineBoard.tsx:164
- **Scenario**: An entry has `jobId == null && jobTitle == null` (e.g. a degraded-intake stub created before a job was attached). In `positions` the key is `e.jobId ?? e.jobTitle ?? "?"` → `"?"`, so a `"?"` position is created with `count += 1`. In the board, the lane filter is `(e.jobId ?? e.jobTitle) === pos.id` → `(null ?? null) === "?"` → `undefined === "?"` → false, so the entry matches no lane.
- **Root cause**: The position key uses a three-way fallback (`?? "?"`) but the lane membership test uses only a two-way fallback (`jobId ?? jobTitle`). The two key derivations disagree precisely when both job fields are null, so the entry is counted under `"?"` but never placed in the `"?"` lane.
- **Impact**: The `"?"` position row shows "N active" but its cells are empty — a confusing phantom lane, and the candidate is unreachable from the board (same recovery dead-end as #3, narrower trigger). Inflates `positions.length` / per-position counts vs. what's rendered.
- **Fix sketch**: Use one shared key function for both the `positions` map and the lane filter (e.g. `entryJobKey(e) = e.jobId ?? e.jobTitle ?? "?"`), so the count and the lane membership are computed identically.

## 5. Drawer carries over per-task state (result/notes/busy/pendingId) when `entry` changes — latent state-desync
- **Severity**: Low
- **Category**: state-corruption
- **File**: C:/Users/mkdol/dolla/kp/app/features/sub_pipeline/CandidateDrawer.tsx:49-53,118-137 ; PipelineTab.tsx:339-341
- **Scenario**: `<CandidateDrawer entry={drawerEntry} ... />` is rendered with **no `key`**, so React reuses the same instance if `drawerEntry` is swapped to a different candidate without first nulling it. Only the interview-outcome fetch is keyed on `entry.id` (line 118); `result`, `notes`, `busy`, `pendingId`, `error`, and the `voice`/`sched` token-link panels are *not* reset. The new candidate would briefly show the previous candidate's scorecard/offer/outreach result, typed notes, and any tokenized links.
- **Root cause**: Component-local result state isn't tied to the entry identity (no `key={entry.id}` on the parent, no per-`entry.id` reset effect). Today the modal overlay prevents switching candidates while open, so this is latent — but it is exactly the trap that fires the moment anyone adds prev/next candidate navigation or opens the drawer from a live-updating list.
- **Impact**: Currently dormant; if an entry swap is ever introduced, an operator could copy/apply one candidate's generated outreach/offer or a tokenized interview link against a different candidate.
- **Fix sketch**: Add `key={drawerEntry.id}` to the `<CandidateDrawer>` element in PipelineTab (cheapest, fully isolates state per candidate), or reset `result/notes/busy/pendingId/error` in an effect keyed on `entry.id`.

## 6. SchedulerControl shares one `busy` flag across toggle / interval / tick — overlapping requests
- **Severity**: Low
- **Category**: race-condition
- **File**: C:/Users/mkdol/dolla/kp/app/features/sub_pipeline/SchedulerControl.tsx:119-146,158
- **Scenario**: The On/Off toggle, the interval `commitInterval`, and "Run now" all call `update()`, which is gated only by a single `busy` boolean — and the controls are disabled by `busy`, but the *first* click of two near-simultaneous actions (e.g. toggle On, then immediately blur the interval field, or toggle then Run now before the first response returns) can launch two concurrent `update()` calls. Each sets `busy=true` and each `finally` sets `busy=false`; the earlier-resolving call clears `busy` while the other is still in flight, re-enabling the controls mid-operation.
- **Root cause**: `busy` is one flag for three distinct operations and is reset in each call's own `finally` with no in-flight bookkeeping; concurrent POSTs to `/api/automation/schedule` also race on the server (interval-then-enable ordering is only guaranteed within a single request body, not across two requests).
- **Impact**: Minor: the last response wins for `sched`, so the displayed state can briefly reflect the slower request's stale snapshot, and the controls flicker enabled. No data corruption (the store writes are independent), but the UI can momentarily show an inconsistent enabled/interval state.
- **Fix sketch**: Track an in-flight counter or disable the bar until *all* outstanding `update()`s settle; or serialize config writes by sending `{enabled, intervalMinutes}` in one request rather than separate calls from separate handlers.

## 7. Interval draft can be clobbered mid-typing by the 30s poll if another client changes the cadence
- **Severity**: Low
- **Category**: stale-closure
- **File**: C:/Users/mkdol/dolla/kp/app/features/sub_pipeline/SchedulerControl.tsx:96-110,196-208
- **Scenario**: Operator A focuses the interval field and is mid-typing a new value. Operator B (another tab/session) changes the interval. A's 30s `load()` poll returns the new stored `intervalMinutes`; the render-phase mirror (`if (sched.intervalMinutes !== mirroredInterval)`) fires and overwrites `intervalDraft` with B's value, discarding what A was typing.
- **Root cause**: The mirror is guarded only against re-applying the *same* stored value; it does not consider whether the input is currently focused/dirty. The poll is a background data source that writes directly into the editable draft.
- **Impact**: Lost keystrokes / surprising field reset during concurrent editing. Narrow (requires a second mutator and active typing in the 30s window), hence Low. The single-operator case is unaffected because the stored value doesn't change under them.
- **Fix sketch**: Skip the draft mirror while the input has focus (track `document.activeElement === inputRef` or an `isEditing` flag), or only mirror when the field is not dirty; resync on blur.
