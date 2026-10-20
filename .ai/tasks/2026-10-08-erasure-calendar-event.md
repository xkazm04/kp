# Erasure removes the interviewer's calendar event

**Operator decision (2026-10-08):** delete the event. ADR 0021's open question is answered
with option 3 (queue a delete after the commit) plus an immediate post-commit attempt on
the candidate's door.

**Reconciled first:** no commit after dd850e3e3 removed events on erasure; the only
callers of `removeInterviewEvent` were the schedule cancel/withdraw routes.

**What changed**
- `app/_lib/calendar/erasure-events.ts` (new): `removeErasedEntryEvents(entryId, workspaceId)`
  and `sweepErasedInterviewEvents(now, limit)`. Spacing 15 min, cap 25 per tick. Never throw.
- `schedule-store.ts`: `invitesWithCalendarEvent`, `erasedInvitesWithCalendarEvent`
  (`-- tenancy:global`, LEFT JOIN pipeline_entries on `anonymized_at`).
- `deleteInterviewEvent` / `removeInterviewEvent`: optional `sendUpdates: "none"`; the erasure
  path passes it, cancel and withdraw send the request they always did.
- `POST /api/data/[token]` awaits the removal in its own try/catch; the answer stays
  `{erased: true}`. `sweepExpiredConsents` runs the sweep (also while autonomy is paused).
- `db/pipeline.ts`: comment only.
- No table, column, status or state value. Durable state = the kept `calendar_event_id` on an
  invite of an anonymized entry.

**Tests:** `app/_lib/calendar/erasure-events.test.ts` (8): delete + sendUpdates=none, 500 then
spacing then retry, untouched invites, expiry door, second workspace, route 200 on 500/throw,
cancel request unchanged.

**Questions left open:** `orphaned` events of NON-anonymized entries (failed cancels) are still
never retried. A workspace with no calendar connection stays `orphaned` and is re-checked
every 15 minutes for as long as the entry's invite holds an id.
