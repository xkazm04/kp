# Ambiguity+Business — Comms/Reliability Wave 1: deliverability & candidate-experience

> 5 commits, 5 High findings closed. The theme the user asked for: sourced-candidate
> deliverability, bounce/engagement feedback, dead-letter handling, and the
> sim/automation comms gaps where a real artifact never reaches the person who needs it.
> Baseline preserved: tsc 0 · JS 1033 → 1055 · Python 695 · i18n 2883 → 2904 (en/cs). 0 regressions.

## Commits

| # | Commit | Finding | Files |
|---|---|---|---|
| 1 | `996a7f8` | sourced/manual candidates have no deliverable address (dead-letter, no signal) | comms-recipient.ts (+test), api/comms/route.ts, CommsCenter.tsx, en/cs |
| 2 | `895cfca` | "sent" ≠ delivered — no bounce/engagement feedback | comms-status.ts (+test), comms-view.ts (+test), api/comms/route.ts, api/comms/callback/route.ts, CommsCenter.tsx, OutboxSection.tsx, COMMS_DELIVERY.md, en/cs |
| 3 | `f0ed1c3` | assigned interviewer gets nothing — no prep/.ics/reminder | comms-dispatch.ts (+test), schedule/[token]/route.ts, decision-attribution.ts (+test), en/cs |
| 4 | `3c9f4f8` | pre-boarding questionnaire one-click-only, no resend, no recruiter visibility | preboarding-reminder-policy.ts (+test), preboarding-reminders.ts, onboarding-store.ts, comms-dispatch.ts, instrumentation-node.ts, OnboardingTab.tsx, decision-attribution.ts (+test), en/cs |
| 5 | `b7c40a8` | OFFER_TTL_MS a global 7-day constant — the "primary lever" didn't exist | offer-policy.ts (+test), offers-store.ts, pipeline/[id]/route.ts, DecisionsTab.tsx, AiReviewCard.tsx, en/cs |

## What was fixed

1. **Unaddressable-recipient signal (CW-1).** `candidateRecipient` resolves a captured
   contact, else a display name, else the candidate id, else the literal `"candidate"` —
   and only inbound applicants (E4/APP2) carry a real contact. With a relay configured,
   every comm to a *sourced/manual* candidate resolves to a name a mail provider can't
   deliver to, and dead-letters with nothing flagging it first. New pure
   `isDeliverableAddress` (a recipient is deliverable only with a single well-formed email
   shape); `/api/comms` returns `deliverable` per message; the Comms Center shows a "no
   address" chip + an aggregate amber count/filter — gated on `relayConfigured`, since
   with no relay every message is a local outbox row anyway.

2. **Bounce / delivery-receipt path (CW-2).** A relay's HTTP 2xx means "the relay accepted
   the POST", not "the candidate received it" — and a hard bounce / spam complaint at the
   offer/rejection moment is exactly what a recruiter must chase. Added a 4th `bounced`
   outbox state and `POST /api/comms/callback` (fail-closed behind `COMMS_CALLBACK_SECRET`)
   where a configured relay reports receipts keyed by ref+kind. A bounce records an
   append-only `bounced` RECEIPT row; the new pure `deriveCommsView` (replacing the route's
   inline recovery logic) folds it onto the originating sent row — flipping the green
   "sent" to a red "bounced" badge, making it actionable, and surfacing the reason. This
   is the exact inverse of the existing sent-supersedes-failed `recovered` derivation.

3. **Interviewer brief (CW-3).** The recruiter assigns an interviewer + generates a rich
   prep pack, but that interviewer was only ever *displayed* — no dispatcher targeted them,
   so they got no prep, no calendar hold, no reminder (the only path was a manual clipboard
   paste). On a confirmed booking, `dispatchInterviewerBrief` now emails the brief
   (candidate/role/slot/plan/focus) + an inline `.ics` hold when the free-text interviewer
   field carries a deliverable `Name <email>` (reusing CW-1's classifier); otherwise it's
   skipped and recorded `interviewer_brief_skipped` so the recruiter sees the gap.
   Best-effort — a brief failure never breaks the candidate's confirmation.

4. **Pre-boarding reminder + visibility (CW-4).** The onboarding link is already emailed
   once on accept (offers #5), but if the candidate closes the tab nothing resends it, so
   the questionnaire stays unfilled in the accept→day-one ghosting window and the recruiter
   sees nothing. Added a single at-most-once nudge: a pure policy
   (`isPreboardingReminderDue`, env-tunable `KP_PREBOARDING_REMINDER_DAYS`, default 3) + a
   heartbeat sweep mirroring `sendDueOfferReminders`, CAS-claiming a new
   `onboarding_runs.reminder_sent_at` before dispatch. The recruiter onboarding card now
   shows a "questionnaire pending/done" chip (`listRuns` carries `intakeSubmitted`).

5. **Per-offer deadline lever (CW-5).** `offer-policy` promised "a deadline is the
   recruiter's primary tool", yet `OFFER_TTL_MS` was one hardcoded 7-day window with no way
   to set it. Added `resolveOfferTtlMs` (pure, validated 1..90 days) threaded from a new
   "respond within N days" input on the offer-approval card through the accept request into
   `createOffer`, so the minted offer's expiry + the candidate's countdown reflect the
   chosen deadline. The 7d default + 48h reminder lead are now deployment-tunable
   (`KP_OFFER_TTL_DAYS` / `KP_OFFER_REMINDER_LEAD_HOURS`).

## Verification

| Gate | Result |
|---|---|
| tsc --noEmit | 0 |
| JS unit (`node --test`) | 1055 (1033 → 1055, +22) |
| Python (`unittest discover`) | 695 OK / 4 skip (unchanged) |
| i18n en/cs parity | OK (2904) |

## Patterns established (catalogue items 18–21)

18. **Carry deliverability as a derived signal, not a discovered failure.** A recipient that
    can't be delivered to is knowable *before* send (it has no email shape) — surface it up
    front (a chip gated on whether a relay even exists) instead of letting it dead-letter and
    hoping someone reads the audit log.
19. **"Accepted" ≠ "delivered" on an async channel — model the late truth as append-only
    supersession.** A relay 2xx and a later bounce are two events; record both and let a
    later receipt supersede the earlier optimistic status (symmetric to recovery), rather
    than mutating one row and losing the audit trail.
20. **A generated artifact must reach the human who acts on it.** A prep pack/brief/link that
    only renders in one UI is "value left on the table" — wire a dispatcher to the actual
    recipient, and when you *can't* reach them, record the skip so the gap is visible.
21. **A one-shot side effect on a candidate-facing channel claims before it sends.** Both new
    sweeps (interviewer brief is per-booking; pre-boarding reminder CAS-claims
    `reminder_sent_at`) follow the offer-reminder rule: a duplicate nudge is worse than a
    missed one, so the claim precedes the dispatch and a post-claim failure is logged, not
    retried.

## Coupling touched (so the next editor knows)

- **New automation-event kinds** `interviewer_brief_sent`, `interviewer_brief_skipped`,
  `onboarding_reminder_sent` were added to **all four** coupled places: `DECISION_META`,
  `COMM_SENT_KINDS` (the two `_sent` ones), the writer-coverage list in
  `decision-attribution.test.ts`, and the `analytics.log.kinds` labels (en/cs). Adding a
  kind without all four shows an UNKNOWN badge and drops it from rollups.
- **`OutboxStatus` widened to 4** (`bounced`): both `STATUS_STYLE` `Record<OutboxStatus>`
  maps (CommsCenter + OutboxSection) and the membership lock in `comms-status.test.ts`.

## What was already done (so it wasn't re-fixed)

- The onboarding **link email** on accept (`dispatchOnboarding` linkFooter) — closed earlier
  under offers #5. CW-4 added only the missing *reminder* + recruiter *visibility*.
- The **dead-letter loud alert** on a configured-relay drop (`alertDeadLetter`) and the
  **relay-not-configured banner** — closed in Wave 5 (W5-1). CW-1/CW-2 add the *addressing*
  and *async-bounce* halves the synchronous path couldn't see.

## What remains (comms tail, not in this wave)

- comms #4 (Medium): inbound webhook auth is a URL-embedded token only — no payload HMAC.
- comms-envelope #5 (Low): `KNOWN_COMM_KINDS` export list is stale vs emitted kinds (now also
  missing `interviewer_brief` / `onboarding_reminder`) — pin it with a dispatcher↔list parity test.
- A true **.ics attachment** for the interviewer (the outbox is text-only, so CW-3 inlines the
  hold); engagement **opens/clicks** into a candidate timeline (CW-2 handles the bounce half).
- Quiet-hours/timezone gating on automated sends; no-show outcome capture; scheduling funnel
  aggregate — the remaining Medium comms/scheduling findings.
