---
id: "0021"
title: An erasure revokes every live capability link the candidate holds
status: accepted
date: 2026-10-08
supersedes: []
superseded-by: null
tags: [compliance, erasure, tokens, candidates, offers, scheduling]
sources:
  - app/_lib/db/pipeline.ts
  - app/_lib/offers-store.ts
  - app/_lib/offer-reminders.ts
  - app/_lib/schedule-store.ts
  - app/api/schedule/[token]/route.ts
  - app/_lib/offer-erasure.test.ts
  - app/_lib/schedule-erasure.test.ts
  - app/_lib/calendar/erasure-events.ts
  - app/_lib/calendar/erasure-events.test.ts
  - instrumentation-node.ts
  - app/_lib/decision-attribution.ts
  - app/_lib/db/analytics.ts
---

## Context

[ADR 0005](0005-hmac-sessions-and-capability-tokens.md) makes candidate-facing
routes capability links: the token is the credential. An erasure that masks the
candidate's label and payload but leaves the token leaves a working door onto
someone who asked to be forgotten. Two such doors were found by council-lite
runs and closed in two commits:

- **Offer** (`a7972f67d`, `.ai/tasks/2026-10-07-offer-erasure-token.md`): a POST
  accept on an erased candidate's old link ran `respondToOffer`: the entry went
  to Hired, the hire meter was debited and `candidate.hired` was sent to the ATS.
- **Schedule** (`0e500c302`, `.ai/tasks/2026-10-08-schedule-erasure-token.md`):
  GET answered 200 and POST could book, withdraw or propose. A booking writes the
  interviewer's calendar and mails the candidate.

The rule they share is this record's decision. The two shapes differ on purpose.

## Decision

**An erasure revokes every capability link the candidate holds, in the same
synchronous transaction as the scrub (`scrubEntryLinkedPii`,
`app/_lib/db/pipeline.ts`). A new token-keyed table owes a revocation there.**

### Offer: NULL the token, close the open row

`app/_lib/db/pipeline.ts:2513-2522`: on every offer row of the entry,
`token = NULL`; a row still `extended` becomes `expired`; a later `expires_at` is
clamped to the erasure moment. Accepted and declined rows keep their status and
lose the token. The column is `token TEXT UNIQUE` with no `NOT NULL`
(`offers-store.ts:31`); `OfferRow.token` became `string | null` (`:85`) and the
readers skip a null (`offer-reminders.ts:27`, `pipeline-entry-action.ts:320`).
`getOfferByToken` matches `token = ?` (`offers-store.ts:200`), which never matches
NULL, so the old link answers not-found.

### Schedule: overwrite the token, keep the status, refuse at the door

`pipeline.ts:2495-2501`: every invite row of the entry gets
`token = 'erased-' || lower(hex(randomblob(16)))` and `meeting_url = NULL`. The
row keeps its status. Two further layers:

- `dueReminders` excludes rows whose entry is anonymized, in SQL
  (`app/_lib/schedule-store.ts:856`), since the status stays `confirmed`.
- The token route answers GET and every POST with `SCHEDULE_LINK_NOT_FOUND`/404
  when the linked entry is anonymized (`app/api/schedule/[token]/route.ts:89`,
  used at `:101` and `:220`).

### Why two shapes

| | Offer | Schedule |
| --- | --- | --- |
| Token column | nullable; a retained offer is a record with no link | `ScheduleInvite.token: string`, non-null (`schedule-store.ts:181`); the recruiter Schedule UI and the calendar sync key on it |
| Open row | has a stored terminal state the deadline sweep already reaches (`expired`) | `expired` is derived from the clock, not stored; no stored state fits "the candidate vanished" |
| Revocation | NULL | overwrite with a random, never-sent value |
| Reminders stopped by | the status flip | a SQL exclusion in `dueReminders` |

### Alternatives that lost

- **A new status** (`erased`, or `declined` for the schedule). Every reader of
  status (sweeps, analytics, UI) would have to learn it. `declined` would also
  lie: the candidate declined nothing. Lost for both rows.
- **NULL the schedule token.** Breaks a non-null key that two readers depend on.
  The random overwrite gives the same outcome with no type or schema change.
- **A door check alone.** The schedule route has one, as defence in depth, but a
  live token plus a check is one forgotten check from a live link: any new reader
  or route would have to remember it. The offer door has no such check; its
  revocation is the data. Lost as the *only* layer.

## Consequences

- **No `offer_expired` event is emitted for an offer the erasure expired.**
  `offer_expired` is recorded only by `expireOfferIfDue` (`offers-store.ts:221`)
  and `lapseExpiredOffers` (`:245`); the latter selects `status = 'extended'`, so
  it never sees a row the erasure already moved. The offers block of
  `scrubEntryLinkedPii` records no event. `offer_expired` is known to the decision
  log (`decision-attribution.ts:65`) and the analytics reader
  (`db/analytics.ts:610`), and both count events, so **an erased offer is not
  counted as expired.** The offer task record says the opposite ("the analytics
  offer leg will now count an erased open offer as expired"); the code does not
  show that. Whether the gap is deliberate is **not recorded anywhere**: neither
  the commit nor the task record names it as a choice. A plausible reason is that
  an event row would name an entry whose candidate has just been erased, but
  nothing in the tree says so. This record states the gap and decides nothing
  about it.
- **The erased offer then reads as extended and unresolved in the funnel**
  (`offer_sent` counted, no resolution event).
- **A new table keyed by a capability token owes a revocation in the scrub.** The
  offer task record says other token doors were not audited then; the schedule
  commit closed `schedule_invites`. This record does not claim the rest were
  audited.
- **An erased schedule row stays `confirmed`**, so a recruiter list can still show
  a confirmed interview for an anonymized candidate.

## Open question (answered 2026-10-08, see Amendments)

The Google Calendar event of a confirmed invite stays on the interviewer's
calendar and still names the erased candidate as an attendee, because the erasure
makes no outbound call (the comment in the schedule block of
`scrubEntryLinkedPii`; task record, "Questions left open"). The options, not
chosen:

1. **Leave it.** Erasure stays synchronous and offline. The attendee remains until
   the interviewer deletes the event.
2. **Outbound delete inside the erasure.** Removes the event. Puts a network call,
   its failure and its retry inside the erasure, and a failed delete must not be
   reported as done.
3. **Queue a delete after the commit.** Keeps the erasure synchronous; adds a
   durable outbox row and a sweep, and the row must not carry the candidate's
   address.
4. **Tell the interviewer** to remove it, by task or notice. Weakest: a process,
   not a guarantee.

## What would change our mind

- A reader of status that needs to tell "erased" from "retained", which would
  justify a new status and its migration.
- A third token door found live after an erasure. The fix then is one list of
  token-keyed tables that the scrub is checked against.
- A calendar provider other than Google, or a delete that must be proven rather than retried: the sweep keys on the invite's kept event id and Google's idempotent 404/410, and would need a receipt.

## Amendments

- **2026-10-08 — the calendar event is removed after the erasure commits.** The operator chose option 3, "queue a delete after the commit", plus an immediate attempt on the candidate's own door. `anonymizeEntry` and the scrub stay synchronous and make no network call. After the commit, `POST /api/data/[token]` awaits `removeErasedEntryEvents` (`app/_lib/calendar/erasure-events.ts`), which reads the entry's invites fresh (the scrub replaced their tokens) and calls `removeInterviewEvent` for each one that holds a `calendar_event_id`. The response stays `{erased: true}` whatever Google answers. The durable state is the invite row itself: an invite of an anonymized entry that still holds `calendar_event_id`. There is no new table and no stored address. `sweepErasedInterviewEvents`, run by `sweepExpiredConsents` in `instrumentation-node.ts` (statutory, so also while autonomy is paused), selects those rows across workspaces, oldest attempt first, at most 25 per tick, and skips a row whose `calendar_event_at` is younger than 15 minutes, so an outage is retried slowly. Each call uses the invite's own workspace connection. The delete passes `sendUpdates=none`: an erased person gets no cancellation mail from Google (cancel and withdraw keep their request unchanged). Because the sweep selects on `anonymized_at`, it also covers the consent-expiry door, an erasure whose attempt failed or never ran, and entries erased before this change; it does not tell those apart. The events of past interviews are removed too. A delete that never lands stays `orphaned` with its id kept, and the recruiter panel already renders that state (`ScheduleCalendarEventChip.tsx`, red); a workspace with no calendar connection also stays `orphaned` and is re-checked every 15 minutes at the cost of a local read. Orphaned events of entries that are NOT anonymized (failed cancels) are not retried by this sweep. The Decision text is not rewritten.
