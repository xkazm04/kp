# Wave 1 — Duplicate side-effects & double-firing (READY TO APPLY)

> Status: **paused before any commit** — kp working tree had pre-existing WIP at scan time;
> user is committing their WIP first. Resume by re-applying the 5 fixes below on the clean tree,
> then run the Wave verification + write FIXES-WAVE-1.md.
> Baselines to preserve: `tsc --noEmit` = 0 · `npm run test:unit` = 570/570 · `npm run test:python` = 472 (4 skipped).
> NOTE: kp's unit runner is `node --test` (`npm run test:unit`), NOT vitest.

6 findings, 5 distinct code changes (Auto#3 and Pipeline#1 share one fix). Atomic commit per change.

---

## Fix 1 (CRITICAL, Auto#1) — outreach re-send. Files: `app/_lib/db.ts`, `app/_lib/automation-run.ts`
- **db.ts**: add `hasEvent(entryId, kind)` (unbounded twin of `hasEventToday`) just before `hasEventToday` (~line 1994):
  ```ts
  export function hasEvent(entryId: string, kind: string): boolean {
    const db = ensureDb();
    return !!db.prepare(`SELECT 1 FROM pipeline_events WHERE entry_id=? AND kind=? LIMIT 1`).get(entryId, kind);
  }
  ```
- **automation-run.ts**: import `hasEvent` from `./db`; gate the `task === "outreach"` branch (~line 189):
  ```ts
  if (hasEvent(entry.id, "outreach_sent")) { applied = "already_sent"; }
  else { await dispatchOutreach(entry, result); applied = "sent"; }
  ```
  Why: prompt cache makes the DRAFT idempotent but `dispatchOutreach` (outbox row + relay POST) re-fired on every cache HIT within the 7-day TTL. `outreach_sent` is recorded by `dispatchOutreach` itself.
- Commit: `fix(automation): make outreach delivery idempotent per entry` — Refs finding #1 (automation-orchestration.md).

## Fix 2 (HIGH×2, Auto#3 + Pipeline#1) — forced tick never advances next_due_at. Files: `app/_lib/scheduler-store.ts`, `app/_lib/scheduler.ts`
- **scheduler-store.ts**: add `advanceAfterForcedRun(name = POLICY_JOB)` — mirrors `claimDueRun`'s advancement (`last_run_at = now`, `next_due_at = now + interval`), no-op when disabled:
  ```ts
  export function advanceAfterForcedRun(name = POLICY_JOB): void {
    const d = db(); ensureSchedule(name);
    const sched = getSchedule(name);
    if (!sched.enabled) return;
    const now = new Date().toISOString();
    const next = new Date(Date.now() + sched.intervalMinutes * 60_000).toISOString();
    d.prepare(`UPDATE scheduler SET last_run_at = ?, next_due_at = ?, updated_at = ? WHERE name = ?`).run(now, next, now, name);
  }
  ```
- **scheduler.ts**: import `advanceAfterForcedRun`; in `tickScheduler`, right after the `claimDueRun` gate, before `startedAt`:
  ```ts
  if (opts?.force) advanceAfterForcedRun();
  ```
  Why: the force path skips `claimDueRun` (the only writer of `next_due_at` on the run path), so a manual "Run now" / `{enabled,tick}` left the window already-due and the next 60s heartbeat re-fired the same pass.
- Commit: `fix(scheduler): advance the clock after a forced/manual tick` — Refs automation-orchestration.md #3 + pipeline-board-scheduler.md #1.

## Fix 3 (HIGH, Scheduling#1) — reminders to rejected/declined/hired. File: `app/_lib/schedule-store.ts`  ⚠ COLLIDES with user WIP
- In `dueReminders` (~line 239), change the SELECT to LEFT JOIN `pipeline_entries` and exclude terminal status + Hired stage:
  ```sql
  SELECT s.* FROM schedule_invites s
    LEFT JOIN pipeline_entries p ON p.id = s.entry_id
   WHERE s.status = 'confirmed' AND s.slot_at IS NOT NULL AND s.reminder_sent_at IS NULL
     AND s.reminder_attempts < ?
     AND (p.id IS NULL OR (p.status = 'active' AND p.stage != 'Hired'))
  ```
  Why: a confirmed invite kept getting a reminder after the candidate was rejected/declined (terminal status) or Hired (status stays 'active', stage='Hired' — see pipeline-status.ts). LEFT JOIN preserves the orphaned-invite (no entry) behavior. Same kp.sqlite file, different connection — JOIN is valid.
- Commit: `fix(schedule): stop reminding candidates who left the interview track` — Refs scheduling-offers.md #1.

## Fix 4 (MEDIUM, Auto#5) — rematch re-emits event. File: `app/_lib/automation-run.ts`
- In the `task === "rematch"` branch (~line 172), capture `created` and gate the event:
  ```ts
  const { created } = createPipelineEntry({ ... });
  if (created) { recordAutomationEvent(entry.id, "rematched", `${entry.jobId ?? "?"} -> ${result.jobId}`); applied = "rematched"; }
  else { applied = "already_rematched"; }
  ```
  Why: `createPipelineEntry` is idempotent (returns `created:false` for existing) but the caller logged `rematched` regardless, inflating the activity feed on every corpus-edit-triggered re-run.
- Commit: `fix(automation): only log rematched when a new entry is actually created` — Refs automation-orchestration.md #5.

## Fix 5 (MEDIUM, Auto#6) — UTC-midnight dedup vs operator local day. File: `app/_lib/db.ts`
- Add a business-TZ day helper and rewrite `hasEventToday` to compare local-date strings:
  ```ts
  const BUSINESS_TZ = process.env.BUSINESS_TZ || "Europe/Prague";
  function businessDay(iso: string): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TZ, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(iso));
  }
  export function hasEventToday(entryId: string, kind: string): boolean {
    const db = ensureDb();
    const row = db.prepare(`SELECT created_at FROM pipeline_events WHERE entry_id=? AND kind=? ORDER BY created_at DESC LIMIT 1`).get(entryId, kind) as { created_at: string } | undefined;
    return !!row && businessDay(row.created_at) === businessDay(new Date().toISOString());
  }
  ```
  Why: `start.setUTCHours(0,0,0,0)` bucketed by UTC midnight; for CET/CEST the "once per day" alert dedup reset at ~01:00–02:00 local, double-firing aging/stale/fairness alerts. `Intl` is DST-correct. Used by automation-pass.ts alert dedup.
- Commit: `fix(db): dedup once-per-day alerts on the business-timezone day` — Refs automation-orchestration.md #6.

---

## After all 5 commits — Wave verification (Phase B6.3)
1. `npx tsc --noEmit` → must be 0.
2. `npm run test:unit` → must be 570 pass (check for any new schedule-store / db tests).
3. `npm run test:python` → 472 pass (no Python touched in Wave 1, should be unchanged).
4. Write `FIXES-WAVE-1.md` (commits table, narrative, before/after, patterns), commit it separately.
5. Update `docs/harness/harness-learnings.md` Structural facts + Open follow-ups.
