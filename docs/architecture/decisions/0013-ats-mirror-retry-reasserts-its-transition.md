---
id: "0013"
title: An ATS mirror retry re-asserts its transition; a reverted decision ends the row
status: accepted
date: 2026-10-06
supersedes: []
superseded-by: null
tags: [integrations, candidate-data, honesty]
sources:
  - app/_lib/ats-egress.ts
  - app/_lib/ats-egress-freshness.test.ts
  - app/_lib/ats-lifecycle-events.test.ts
  - app/_lib/ats-delivery-store.ts
  - app/_lib/db/pipeline.ts
---

## Context

The outbound ATS mirror is a durable ledger with a six-attempt retry ladder
(`ats-delivery-store.ts`). Two promises were made to the receiver and they turned
out to be in tension:

1. **A redelivery is the same delivery.** Every attempt of one ledger row carries
   the row id as its `Idempotency-Key` and a byte-identical body — the envelope's
   `sentAt` is the row's creation instant, not the attempt's — "so a receiver can
   dedupe on the body alone" (`ats-egress.ts`, `ats-webhook.ts`
   `IDEMPOTENCY_HEADER`).
2. **A mirror carries the latest state.** `retryDueAtsDeliveries` rebuilds the
   record from *current* entry state on every attempt, deliberately, so a
   since-erased candidate drops off the queue rather than being re-offered to a
   third party.

Those two are only compatible while the entry does not change. The freshness
check that runs immediately before each POST (`deliveryStillJustified`,
previously `consentStillPermits`) re-read **consent and existence** — never the
transition that justified the event in the first place.

Security scan F-3 (`.ai/tasks/2026-10-06-security-scan-ats-mirror.md`, §A6) named
the consequence. A `candidate.rejected` delivery fails at attempt 1; a recruiter
reinstates the candidate (`reinstatePipelineEntry`, or a re-add that reopens a
merit terminal — `db/pipeline.ts`); attempt 2 then POSTs `event:
"candidate.rejected"` carrying `pipeline.status: "active"`, under the unchanged
key. A receiver that had already rejected the candidate sees the "same" delivery
twice; one that had not yet processed attempt 1 is told to reject somebody kp has
put back in the funnel. The receiver's own dedupe cannot help, because from its
side nothing identifies the two bodies as different.

The screening wave (`screen-wave.ts`) makes this systematic rather than rare: an
auto-rejected cohort is exactly the population a recruiter reviews and partially
reinstates, and the wave produces it unattended.

A third force: the decline path already settled the same question in the
candidate's favour. `offer-finalize.ts` mirrors `offer.declined` **only** when the
entry actually transitioned, because "telling the customer's ATS a hired candidate
declined would be a lie kp cannot retract" — pinned by
`ats-lifecycle-events.test.ts` ("a decline on a STALE link that changes nothing
mirrors nothing"). The first attempt was held to that standard. The retry was not.

## Decision

**A delivery attempt re-asserts the transition its event names. When the
transition has been reverted, the ledger row ends TERMINALLY — it is never
re-sent, and the prepared bytes are never stored and replayed.**

### 1. The re-assert

`EVENT_REQUIRES_STATUS` in `ats-egress.ts` maps an event to the
`pipeline_entries.status` the entry must still hold:

| Event | Required status | Reversal door in the code |
| --- | --- | --- |
| `candidate.rejected` | `rejected` | `reinstatePipelineEntry`; a re-add that names a human actor (`CreatePipelineInput.reopen`) |
| `offer.declined` | `declined` | a re-add that names a human actor — `declined` is the other reopenable merit terminal |

The check runs inside the existing freshness closure, so it covers the **first**
attempt's preparation window as well as every retry, and it runs as the last
statement before the POST with no `await` after it. The refusal order is
load-bearing: an anonymized entry and a vanished entry are answered *first*, so
an erasure keeps exactly the outcome it had before this rule existed.

The failure is `terminal: true`. A reinstatement is a human decision kp has
already acted on, so no amount of waiting makes the event true again — spending
six attempts on it would be noise on a settled answer, which is the same argument
`getAtsRecordResult`'s refusal already makes for an erasure.

The ledger reason names the entry id and the two statuses, both from a closed
vocabulary (`pipeline-status.ts`). It carries no candidate PII — the whole ATS
ledger is held to that (`ats-egress.ts` logging, scan §A5).

### 2. The two subscribable events deliberately left out

`SUBSCRIBABLE_EVENTS` has four members. The rule covers two, and the omissions
are reasoned, not oversights:

- **`candidate.hired`** — a hire is marked by the board's **terminal stage** while
  `status` stays `active` (`pipeline-status.ts` header), so there is no status to
  re-assert. Its reversal doors do exist (`setEntryStage` off the terminal column;
  a reject on a hired row, which has no stage guard). Asserting a stage *role*
  means resolving each workspace's stage axis at delivery time, and an axis that
  drops or renames its terminal column would then dead-letter legitimate hires —
  a worse failure than the one being fixed, and a decision of its own. Left open,
  named here so it is a known gap rather than an assumed non-problem.
- **`offer.accepted`** — an offer's response is immutable once written: every
  transition in `offers-store.ts` CASes on `status = 'extended'` and nothing sets a
  responded offer back. There is no undo to catch.

### 3. Byte-identity is now stated conditionally

The promise in `deliver`'s comment was unconditional and therefore false. It is
now: identity holds **while the transition still holds**, and a reverted
transition ends the row. A receiver sees either the same bytes again or nothing
again — never a contradicting third version of the same delivery.

## Alternatives considered

**A. Store the first attempt's body in `ats_delivery` and resend those bytes.**
The scan's option 1, and it keeps promise (1) literally true. Rejected on two
counts. It makes the retry ladder a *replay* of a claim kp has since withdrawn:
attempt 4 would tell the receiver to reject a reinstated candidate, with the
original body, and be *more* confidently wrong than today. It also puts a frozen
copy of candidate PII — name, contact, match score — in a second table, on the
erasure path, with its own retention question; `ats_delivery` rows are already
personal data kept 90 days for one operational question
(`DELIVERY_RETENTION_DAYS`), and a stored body outlives the entry it describes.

**B. Make the reverted transition retryable rather than terminal.** Cheaper to
reason about, and a reinstatement *can* in principle be reversed again. Rejected:
the ladder would then sit on a row whose meaning flips with the board, and the
attempt that happened to land while the candidate was re-rejected would send a
body whose `decision` block belongs to a different decision. Terminal is the
honest answer; the re-reject emits its own event with its own row.

**C. Emit a compensating event (`candidate.reinstated`).** The structurally right
answer for a receiver that wants to follow the funnel. Rejected here as out of
scope: it is a new member of `SUBSCRIBABLE_EVENTS`, which ADR-0008 requires to
start as `reserved` with its own emit site and catalog row, and it does not fix
the wrong body being sent in the meantime. A good follow-up, not a substitute.

**D. Leave it; let the receiver sort it out.** Rejected: the receiver has nothing
to sort with. The key is unchanged, so its dedupe reads the two attempts as one
request, and the body's `pipeline.status` is the only tell — a field a connector
built against the documented event vocabulary has no reason to re-check.

## Consequences

- **A reinstated candidate's mirror is a dead letter, visibly.** The row stays
  `failed` with `next_attempt_at` NULL, readable at `GET /api/ats/deliveries`,
  with a reason that says the transition was reversed. The receiver is told
  nothing; the operator can see that, and that asymmetry is the point.
- **The receiver's ATS keeps the candidate open.** If attempt 1 never landed, the
  customer's system of record never hears about the rejection at all — which is
  correct, because there no longer is one, but it means a recruiter cannot infer
  "mirrored" from "rejected once".
- **A new subscribable event owes a row in `EVENT_REQUIRES_STATUS` or a reason
  not to have one.** The table is keyed by event precisely so adding one forces
  the question instead of silently inheriting "irreversible".
- **`candidate.hired` remains exposed** to the narrower version of F-3 (§2). It is
  a named gap with a named reason, not a closed one.
- **The byte-identity test remains about a static entry**
  (`ats-egress-delivery.test.ts`'s idempotency case). The mutating cases live in
  `ats-egress-freshness.test.ts` alongside the consent ones, which is where the
  window they exploit is already documented.

## What would change our mind

- **If a terminal drop is observed hiding a real delivery need.** If operators
  find rows dead-lettered by this rule where the receiver genuinely still needed
  the event — a reinstatement that was itself reverted inside the ladder's reach,
  say — then alternative C (a compensating event stream) stops being a follow-up
  and becomes the fix, and this rule becomes its first half.
- **If the stage axis gains a stable role query at delivery time** that cannot
  dead-letter on a legitimate axis edit, `candidate.hired` joins §1 and §2's
  first bullet goes away.
- **If a receiver is found that dedupes on the body alone** (not the key) and
  breaks on a row that ends rather than repeats. The conditional promise in §3 is
  a weakening of a published contract; nothing in `docs/features/integrations/`
  documented the unconditional version to a customer, but a real consumer
  depending on it would force a schema-versioned answer instead.
