---
id: "0017"
title: A human adverse decision is sealed before it commits
status: accepted
date: 2026-10-07
supersedes: []
superseded-by: null
tags: [compliance, audit, decisions, pipeline]
sources:
  - app/_lib/pipeline-entry-action.ts
  - app/_lib/decision-record-store.ts
  - app/_lib/screen-wave.ts
  - app/_lib/api-response.ts
  - app/api/pipeline/decision-not-sealed.test.ts
  - app/_lib/pipeline-entry-action.test.ts
---

## Context

Key goal 4 is that no rejection exists without a reasons block. The full council
on `compliant-hiring-decision` (round 1, run d676869f, head 718f51723) found the
recruiter's commit door short of it. Its must-address lines, verbatim:

- "craft: Q#3 answered YES: human and ratified rejections are sealed with no
  reasons block"
- "robustness: A failed seal on the recruiter's commit door still gets a 200,
  and only a server log records it"

Its craft lens cited the registry technique
`decision-audit-and-traceability/seal-actor-policy-version-and-decisive-inputs`,
step 4: if the record cannot be sealed, the decision does not commit. That step
names two shapes that do not satisfy it: a seal on a separate connection after
the state write, and a best-effort wrapper that catches every seal failure.

The commit door sealed after the write through `sealDecisionSafe`
(`app/_lib/decision-record-store.ts:384-387`), whose docstring made the opposite
rule: a seal must never fail the decision it records. Under it a candidate could
receive a rejection email and an ATS event with no durable record. That policy
was a deviation from the technique that nobody had written down.

## Decision

**The recruiter's commit door seals an accept or a reject before it writes, and
refuses when the seal fails.** The door is `runPipelineEntryAction`
(`app/_lib/pipeline-entry-action.ts:374`), reached from `app/api/pipeline/[id]`,
the batch route and the command bar. Behavior at the main head 88abd1301:

- **Re-read, then refuse stale.** It re-reads the row synchronously
  (`pipeline-entry-action.ts:560`). If the stage moved, or an accept targets a
  closed-out entry, it answers 409 `PIPELINE_STAGE_CHANGED` with nothing sealed
  (`:562-563`).
- **Seal against that row and check the result** (`:577-607`). A failed seal
  changes no state, sends no rejection letter, fires no ATS event, and answers
  503 `PIPELINE_DECISION_NOT_SEALED`. The code is registered in
  `app/_lib/api-response.ts`.
- **Then write**, with the `expectedStage` compare-and-swap pinned to the sealed
  stage and no `await` between seal and write (`:616`; commit 0bfded05e).
- **A reject that resolves a `rejection_review`** seals the recruiter's note when
  one was typed, otherwise the policy's own rationale, and never the
  "Recruiter reject from <stage>." template (`:573`, `:582`).
- **Every accept/reject seal carries** `aiRationale`, `aiReasonCode` and
  `aiReasonParams` in its inputs (`:594-596`; commit 88abd1301).
- **Keyless dev still seals**, with the legacy keyless hash
  (`decision-record-store.ts:125-133`, [ADR 0004](0004-keyless-degradation-is-a-product-property.md)),
  so the refusal fires on a real seal failure, not on a missing key in dev.

The precedent is `app/_lib/screen-wave.ts` (about `:526-564`): no seal, no
rejection.

`sealDecisionSafe`'s docstring is amended to name the decisions it still serves
and to point here for the seal-first rule.

## Alternatives considered

1. **The old policy: `sealDecisionSafe` after the write, best-effort.** Lost
   because a candidate could be rejected, emailed and mirrored to the ATS with no
   durable record, and only a log line said so. It is exactly what the registry
   technique's step 4 rules out.
2. **Seal and write in one `IMMEDIATE` transaction.** This is the complete fix
   and it was not taken. The seal runs on `decision-record-store`'s own
   connection and the write lives in `app/_lib/db/pipeline.ts`, so the two cannot
   share a transaction today. **It is the named next step.**

## Consequences

- **A residue remains.** If another process moves the row between seal and
  write, the chain holds a sealed record of a decision that did not apply. It is
  logged with the record's `seq` and the door answers 409 (`:617-619`). Nothing in
  this process can interleave, because there is no `await` between the two.
- **These seals are still best-effort, after their write:** the `offer_terms`
  seal in `extendDraftedOffer` (`pipeline-entry-action.ts:308`), the human-round
  handoff seal (`:521`), reinstate in `app/api/pipeline/[id]/route.ts:162`, and
  the reversal in `app/api/pipeline/command/reverse.ts`.
- **A plain human reject with no note and no machine verdict still seals the
  template rationale**, e.g. the Decisions bulk reject
  (`app/features/hiring/decisions/useDecisionsQueue.ts`, `bulkDecideReviews`, about
  `:482`).
- **`aiReasonCode` is null on pass-queued rows.** The policy
  (`pipeline/jobfit/automation.py`, `evaluate_entry`) emits prose only.
- **Doors that act on an accept/reject must handle 503.** The single route
  reports the status, the batch route a per-id row, the command bar its `failed`
  bucket.
- Pinned by `app/api/pipeline/decision-not-sealed.test.ts` and
  `app/_lib/pipeline-entry-action.test.ts`.

## What would change our mind

- **The seal and the write sharing one connection**, which makes the
  single-`IMMEDIATE`-transaction fix possible and retires the residue.
- **A seal failure rate that makes the door refuse real decisions** often enough
  that operators prefer a queued retry to a 503; that would need a durable
  pending-seal state, not a return to best-effort.
