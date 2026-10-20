---
id: "0020"
title: An ATS decision block releases a rationale only when the server built it, and the POST re-asserts its destination
status: accepted
date: 2026-10-08
supersedes: []
superseded-by: null
tags: [integrations, candidate-data, fail-closed, tenancy]
sources:
  - app/_lib/ats-record.ts
  - app/_lib/ats-egress.ts
  - app/api/ats/candidate/ats-candidate-audit.ts
  - app/_lib/ats-egress-reasons.test.ts
  - app/_lib/ats-egress-org-scope.test.ts
---

## Context

Council-lite round 1 on `ats-candidate-egress` left two must-address lines
(`.ai/tasks/2026-10-07-ats-lite-r1-rework.md`, commit `85c810717`):

1. *Goal 4: what is sent out carries a code and a hash, not the reasons.* The
   `decision` block of the `kp.ats.v1` record held kind, reason code, actor, hash,
   policy version and time, and no rationale.
2. *The org boundary on the webhook is checked before the queue wait, not at the
   POST.* `dispatchAtsEvent` and the retry sweep check the owner organization
   before the slot wait; `deliver` reads the config again after it and then awaits
   a DNS resolve. An operator who re-pointed the integration in either window sent
   the entry's candidate to the new owner's endpoint under the old owner's check.

The first line pulls against a second force. A sealed rationale is free text in
some writers, and the ATS is a third party's system. Releasing "the reason"
wholesale would put a recruiter's prose, or another candidate's name, on the wire.

## Decision

### Does ADR 0013 already govern this? Not line 1; line 2 only in part

[ADR 0013](0013-ats-mirror-retry-reasserts-its-transition.md) decides what a
retry re-asserts about the **entry's transition** (`EVENT_REQUIRES_STATUS`). It
says nothing about what the record discloses, so line 1 is a new decision and
gets this record. The freshness closure it describes (`deliveryStillJustified`,
`app/_lib/ats-egress.ts:384`) is where line 2 landed, and the org boundary itself
is [ADR 0014](0014-org-owned-singleton-integration-config.md)'s rule. Line 2 is
recorded here, and 0013 carries a dated pointer in its Amendments.

### 1. A rationale is released only for a server-built reason code

The decision block carries `rationale` and `rationaleWithheld`
(`app/_lib/ats-record.ts:141-146`), additive to `kp.ats.v1`
(`ATS_SCHEMA_VERSION` unchanged, `:28`). `atsDecisionRationale`
(`ats-record.ts:193`) releases the sealed text only when the reason code is in
`RELEASABLE_RATIONALE_CODES` (`:180`): `reject`, `holdout`,
`autoRatifiedScreening`, `match_fit`, `scorecard`, `offer`. Those are built by the
server from the candidate's own facts or from aggregates (rank, cohort size,
score, threshold). The audit of every sealed-rationale writer is the docblock at
`:168`.

It is **withheld whole** (`rationale: null`, `rationaleWithheld: true`):

- when the record is `piiWithheld` (`ats-record.ts:199`). Withheld, not masked:
  masking free text for a name is a guess, and the reason code and sealed hash
  still say what was decided.
- for any code not in the set. The default is withhold. `lead` and `advisory`
  name the runner-up, who is another candidate; `accept` carries the recruiter's
  free-text detail; schedule, reinstate and reversal codes and calibration were
  not audited.
- on the pull door too, whose consent redaction applies the same withhold
  (`app/api/ats/candidate/ats-candidate-audit.ts:83-87`).

`rationaleWithheld` is true only when a sealed rationale exists and was held back,
never for "there is none" (`ats-record.ts:144`), so a receiver can tell silence
from absence.

### 2. The POST re-asserts the destination

`deliveryStillJustified` re-reads `getAtsConfig()` as its first step
(`ats-egress.ts:403`), synchronously, directly before the fetch (called at `:531`
for a first attempt and `:623` for a retry):

- a different owner organization is **terminal** and the row dead-letters
  (`:404-405`), in `crossOrgRefusal`'s vocabulary (org ids and entry id, no
  candidate data; `:458`);
- a changed URL is **retryable** (`:406-410`): the next attempt re-reads, re-vets
  and re-resolves whatever the operator saved. The reason carries no URL, which
  can embed a path token.

Terminal for the org, retryable for the URL: a different owner means this
candidate's data may never go there, while a changed URL under the same owner is
the operator editing their own endpoint.

## Alternatives considered

- **Send every sealed rationale.** Closes the council line in one line of code and
  leaks the runner-up's label and recruiter free text. Lost on fail-closed.
- **Mask names in the prose.** Lost: a mask is a guess about free text.
- **A deny-list of unsafe codes.** A new writer would inherit release. The
  allow-list makes each addition pass the same audit.
- **Keep the org check before the slot wait only.** It is exactly the window the
  finding exploited.

## Consequences

- **A receiver may see `rationale: null` on a rejection** and must read
  `rationaleWithheld`. A `piiWithheld` record never carries a reason.
- **A new reason code that should be released owes an edit to
  `RELEASABLE_RATIONALE_CODES`** after the same writer audit.
- **Delivery to a re-pointed integration ends the row** with both org ids in the
  ledger reason (pinned by `app/_lib/ats-egress-org-scope.test.ts`).
- **The should-change items stay queued** (task record): the `candidate.hired`
  re-assert, a longer retry ladder, an erasure event, undici lookup pinning.

## What would change our mind

- A receiver that needs the withheld kinds' reasons to meet its own legal duty.
  That is a per-kind redaction design, not a wider allow-list.
- A rationale writer found to put free text under a released code. The code
  leaves the set.
- A second ATS destination per organization, which would make "the config" plural.
