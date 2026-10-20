---
id: "0019"
title: The apply knockout decline is automatic, names the must-have, and offers a person to review it
status: accepted
date: 2026-10-07
supersedes: []
superseded-by: null
tags: [apply, compliance, automation, candidates, decisions]
sources:
  - app/api/apply/[id]/route.ts
  - app/api/apply/[id]/quick/route.ts
  - app/_lib/lead-intake.ts
  - app/_lib/comms-dispatch.ts
  - app/_lib/apply.ts
  - app/_lib/db/pipeline.ts
  - app/_lib/decision-attribution.ts
  - app/_lib/trust-posture.ts
  - app/apply/[id]/ApplyDeclineDetail.tsx
  - app/api/apply/[id]/ko-decline-door.test.ts
  - app/_components/ai-disclosure-copy.test.ts
---

## Context

When a candidate answers no to a must-have the role states (a knockout, KO,
question), the apply door ends the application with no person in the loop. The
gate existed before this record. What was missing was the decision about it, and
two council lines (intake lite, round 1) said so:

- "value: A knockout decline tells the candidate nothing about why, and offers no
  person to contest it"
- "craft: The candidate-facing AI disclosure says 'a rejection is always a
  person's' while the knockout gate rejects with no person"

The forces:

1. **Key goal 2**: one role runs end to end without a human step.
2. **Key goal 4**: no rejection without a reasons block.
3. **ADR 0011, force 2**: "Any automation that reaches a person-affecting
   decision must arrive at that gate, not around it." The KO decline does not
   arrive at the gate. It is the decision that force describes, taken around it.
4. **The compliance pack** said the same thing from the other side: its GDPR
   Art. 22 row read "no solely-automated significant decision".

The owner took the decision on 2026-10-07 (ask 1df7d0a0): keep KO automatic and
say so, then record the policy. This ADR is that record. It does not reopen the
choice.

## Decision

The apply knockout gate stays automatic. A no to a stated must-have ends the
application with no person in the loop. In return, the candidate is owed the
following, and one claim is narrowed:

- **Told which must-have it was**, on the decline screen (`failedKoNames`,
  localized server-side, rendered by `ApplyDeclineDetail`) and by email whenever
  a valid address is in hand.
- **Offered a person.** The email says a person did not make the decision and
  that a reply reaches a person. This is the existing human-review route the
  status page promises (`status.decisions.humanReviewNote`), not a new queue.
- **Never told more than the server knows.** `reviewByEmail` means "we are
  handing it to a relay" (address in hand and a relay configured), never "it
  arrived". With it false, the screen sends the candidate to the hiring team
  directly.
- **Every other rejection is a person's.** The candidate-facing and
  visitor-facing copy in en/cs/de/fr says "every rejection except the apply
  knockout" (`app/_lib/trust-posture.ts:142`), pinned by
  `app/_components/ai-disclosure-copy.test.ts:100`.

### What enacts it (read on main at b7d7d670a)

| Piece | Where |
| --- | --- |
| Conversational door: verdict, record, deferred email, response | `app/api/apply/[id]/route.ts:244` (`failedKoStepIds`), `:249` (`recordKnockoutDecline`), `:267` (`dispatchKnockoutDecline`), `:282` (`reviewByEmail`) |
| Quick-apply door: verdict and response (record and email via the intake core) | `app/api/apply/[id]/quick/route.ts:134`, `:195` |
| Intake core, shared by quick-apply and channel leads: record, then email | `app/_lib/lead-intake.ts:127`, `:150` |
| The letter: names the must-have, says no person decided, carries the review route | `app/_lib/comms-dispatch.ts:640` (kind `ko_decline` at `:661`); copy `comms.koDecline.body` in `messages/*.json` |
| Must-have names | `koMustHaveNames`, `app/_lib/apply.ts:305` |
| The record | `recordKnockoutDecline`, `app/_lib/db/pipeline.ts:3231` |
| The class | `ko_declined: { auto: true, ... }`, `app/_lib/decision-attribution.ts:91` |
| The screen | `app/apply/[id]/ApplyDeclineDetail.tsx` |
| Pins | `app/api/apply/[id]/ko-decline-door.test.ts` (both doors name the must-have as data and send the email; with no usable address nothing is sent and the screen says so), `ai-disclosure-copy.test.ts` |

It landed in `80e63e9fc` (a quick-apply repeat no longer renews consent),
`eba4a4517` (the decline names the must-have and offers a person),
`7e4760e8e` (the disclosure and landing say a no to a must-have ends an
application automatically), `4b8a9a7af` (the status reconciliation test pins the
reworded promise) and `3004516d7` (the comms doc: the decline is sent at every
door).

### What record a KO decline leaves

- One `pipeline_events` row of kind `ko_declined`, written by
  `recordKnockoutDecline` through `recordEvent`. It is **entry-less**
  (`entryId: null`): a failed KO creates no pipeline entry, deliberately, so a
  mis-tapped toggle cannot mint a terminal row the candidate can never retry past.
- Its fields: the applicant's display name (`candidate_label`), the role title,
  the workspace id (required, so the team that owns the opening sees it), and a
  `detail` of the form `knockout declined via <channel> — failed: <step ids>`,
  capped at 200 characters. `actor` is not set.
- **Class `auto`** in `decision-attribution.ts:91`, so the decision log and the
  analytics rollup count it as a machine decision (`app/_lib/db/analytics.ts`
  counts it as "turned away at the gate").
- **It is not sealed in the decision chain.** Nothing on the KO path
  (`route.ts`, `quick/route.ts`, `lead-intake.ts`, `recordKnockoutDecline`)
  calls a seal or writes a decision record. ADR 0017 and 0018 govern sealed
  records for a recruiter's decision and a Match verdict; the KO decline sits
  outside both. It leaves an event row with no actor, policy version, decisive
  inputs or rationale. Today it is an audited discard, not a reasons block in
  the key-goal-4 sense.
- **What it does not store:** the candidate's answers or the text of the
  must-have; the step ids name which gates failed. No entry exists, so no
  deliverable identity is kept past a fixed window. The email goes out as a
  ref-less outbox row of kind `ko_decline` in the opening's workspace, and that
  row holds the address, name and role until
  `KO_DECLINE_CONTACT_RETENTION_DAYS` (30, no env override) have passed. A sweep
  (`sweepKoDeclineContacts`, run from the clock's statutory consent block, not
  under the autonomy pause) then blanks the row's recipient, subject and body and
  the `ko_declined` event's `candidate_label`; kind, status, job title, detail,
  timestamps and workspace stay, so the delivery audit and the gate counts do not
  move. If the same address becomes an entry and that entry is erased or expires,
  `anonymizeEntry` blanks the matching ref-less rows of its own workspace at
  once. The letter states the window.

## Alternatives considered

- **(a) A person confirms every KO decline.** A failed KO answer files a
  `rejection_review` that a recruiter seals in one click through the ADR 0017
  door, and the disclosure stays as written. It is the cleanest fit with ADR 0011
  and Art. 22, and it would give every decline a sealed reasons block (goal 4).
  It costs goal 2 directly: every role that draws an unqualified applicant now
  has a human step and a queue of decisions nobody disputes. It also needs an
  entry to hang the review on, which reverses the no-terminal-row choice above.
  Lost on goal 2.
- **(b) Flag, never decline.** A failed KO answer files the application with a
  must-have-missing flag that scoring and the recruiter see, and the candidate
  may continue. It keeps the disclosure true and removes the automatic adverse
  decision. It also costs goal 2 (the recruiter now reads every flagged
  application), and it gives goal 4 nothing, because no rejection happens for
  the rule to apply to. It turns a must-have into a hint. Lost on goal 2 and on
  what a must-have means.

## Consequences

- **A no to a must-have is now a solely automated adverse decision.** This is the
  first record in the tree to say so without softening it. The compliance pack's
  Art. 22 row said the opposite until the change that added this ADR.
- **Review happens after the decision, not before it.** The candidate has to
  act: they reply. Nobody looks until they do. There is no SLA and no queue
  behind the reply (backlog R-26, "Art. 22(3) contest is prose with no
  mechanism", still applies to this route).
- **The legal basis under GDPR Art. 22(2) for this exception is not recorded
  anywhere in the tree.** `docs/features/compliance/` was searched for "22(2)"
  and has no match. This ADR does not supply one and must not be read as
  claiming one. Choosing and recording the basis is a legal call.
- **Not a reasons block on the record side.** The decline is not sealed in the
  chain (above). Goal 4 is met for the candidate, who is told the must-have, and
  not for the audit record.
- **ADR 0011's rule has a named exception.** Its Amendments now say so and point
  here. Any other automatic decline is a new decision this one does not cover.
- **The send is best-effort.** A comms failure never changes the verdict. With
  no relay or no address, the screen says no email is coming and points to the
  hiring team.

## What would change our mind

- A KO question that is not a stated must-have of the role. The decision rests
  on the candidate having been told the requirement up front.
- A decline sent with no address in hand and no visible review route on the
  screen: a candidate with no way to reach a person.
- A legal ruling or counsel's advice that the exception lacks an Art. 22(2)
  basis. Alternative (a) is then the fallback.
- Review requests that go unanswered. The route is a promise made in a letter;
  if replies are not read, it is not a route.
- Measured evidence that declines are often contested and overturned, which
  would say the gate is wrong on the facts and not only on process.

## Amendments

- **2026-10-07 — the Art. 22(2) basis is left to counsel.** The owner answered ask 37e31cc8 with "Leave it to counsel, mark amber". Choosing the GDPR Art. 22(2) basis for this exception is counsel's call. The GDPR Art. 22 row in `docs/features/compliance/ai-act-conformity.md` is now 🟡 until counsel records a basis, and [R-64](../../features/compliance/regulatory-backlog.md) tracks it. The KO gate is unchanged: it stays automatic. The body of this record is not rewritten, and this ADR still supplies no basis.
