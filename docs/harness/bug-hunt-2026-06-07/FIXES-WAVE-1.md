# Bug Hunt Fix Wave 1 — Duplicate side-effects & double-firing

> 5 commits, 6 findings closed (1 critical, 3 high, 2 medium).
> Baseline preserved: tsc 0→0 · unit 585→585 · python 474→474 (4 skipped). No regressions.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `ed235a6` | automation #1 | Critical | `automation-run.ts`, `db.ts` |
| 2 | `6d5eca6` | automation #3 + pipeline #1 | High ×2 | `scheduler.ts`, `scheduler-store.ts` |
| 3 | `363040e` | scheduling #1 | High | `schedule-store.ts` |
| 4 | `e36e093` | automation #5 | Medium | `automation-run.ts` |
| 5 | `1d9b635` | automation #6 | Medium | `db.ts` |

## What was fixed

1. **Outreach re-send (critical).** The prompt cache made the outreach *draft* idempotent, but `dispatchOutreach` (outbox row + relay POST) re-fired on every cache HIT inside the 7-day TTL — duplicate first-contact emails to candidates. Added `hasEvent(entryId, kind)` (unbounded twin of `hasEventToday`) and gated the send on the `outreach_sent` marker `dispatchOutreach` already records, so an outreach is delivered at most once per entry.

2. **Forced-tick double-fire (high ×2, one root).** A manual "Run now" / `{enabled,tick:true}` calls `tickScheduler({force:true})`, which bypasses `claimDueRun` — the only writer of `next_due_at` on the run path. The window stayed due, so the next ~60s heartbeat ran the *same* policy pass again. Added `advanceAfterForcedRun` (mirrors `claimDueRun`'s advancement; no-op when disabled) and call it on the force path. Closes both the automation-side and pipeline-board-side reports of the same bug.

3. **Reminders to candidates who left the track (high).** `dueReminders` selected purely on `schedule_invites`, so a confirmed invite still in the 24h window kept emailing "see you at your interview" after the candidate was rejected/declined (terminal status) or Hired (status stays `active`, stage `Hired`). Now LEFT JOINs `pipeline_entries` and requires `status='active' AND stage!='Hired'` (LEFT JOIN preserves the orphaned-invite case).

4. **Rematch event spam (medium).** `createPipelineEntry` is idempotent and a corpus edit self-invalidates the rematch cache, so re-runs are common — yet the caller logged a `rematched` event every time. Gated the event + `applied` state on the returned `created` flag (`already_rematched` on a no-op re-run).

5. **UTC-vs-local alert dedup (medium).** `hasEventToday` bucketed by UTC midnight, so for CET/CEST the once-per-day aging/stale/fairness dedup reset at ~01:00–02:00 local and could double-fire in a single local evening. Now compares the **business-timezone** local-date (DST-correct via `Intl`, `BUSINESS_TZ` default `Europe/Prague`) of the most recent matching event.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `npm run test:unit` (node --test) | 585 pass | 585 pass |
| `npm run test:python` | 474 (4 skipped) | 474 (4 skipped) |

## Patterns established (catalogue items 1–5)

1. **Cache makes the computation idempotent, not the delivery.** A content/prompt cache stabilises *what* is produced; it says nothing about whether a real-world side effect (email, webhook, charge) already happened. Gate the *send* on a durable per-entity marker (event row / outbox row), never on a cache HIT/MISS.
2. **A forced/manual bypass must still advance the durable clock.** When a "run now" path skips the atomic claim that advances a schedule's `next_due_at`, it has to advance the clock itself — otherwise the window stays open and the next tick re-fires.
3. **A due-work sweep keyed on one table ignores the linked entity's lifecycle.** Reminder/retry sweeps that select only on their own rows keep acting on items whose linked entity has gone terminal. Join the entity and filter on its status/stage.
4. **Idempotent create + unconditional audit = phantom events.** If a create returns a `created` flag, gate the event/side-effect on it; reaching the call site is not proof a new thing was made.
5. **"Once per local day" must bucket in the business timezone.** UTC day-bucketing for an operator-facing daily window drifts by the UTC offset and resets mid-evening under CET/CEST. Use `Intl` (DST-correct) keyed on a configurable `BUSINESS_TZ`.

## Cumulative status (waves 1–1)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Duplicate side-effects & double-firing | 6 |

Pattern catalogue: 5 items. **6 / 51 findings closed.**

## What remains

W2 Python numeric safety (incl. 1 critical: `Infinity` crash), W3 analyze lifecycle (incl. 1 critical: poll-loop leak), W4 voice end-of-call, W5 dev-case provenance, W6 silent failures, W7 status/uniqueness guards, W8 board/form UI — 45 findings open per `INDEX.md`.

> Note for W5/W8: the pre-Wave-1 WIP snapshot (`7597c20`) already modified `evaluate.py`/`models.py` (W5) and `schedule-slots.ts`/`route.ts`/`SchedulePicker.tsx` (W8) — re-read those before applying those waves; some findings may already be addressed.
