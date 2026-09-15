# The autonomous role run — task breakdown

**Status:** proposal. The decision this implements is
[ADR-0009](../architecture/decisions/0009-one-role-runs-end-to-end.md), which is
`proposed` and awaiting stakeholder sign-off. Nothing below should be built
until that ADR reads `accepted`.

**Goal served:** *One role runs end to end without a human step* — JD in;
sourced and screened candidates; case; interview; scorecard; offer draft. The
human only approves the decisions that affect a person.

This file is the work. ADR-0009 is the why, the data model and the gate list;
this is the sequence of increments that gets there, each sized to **one Dev
Clone pass (under 20 minutes)** and scoped to **non-overlapping files** so
several can run in parallel.

Estimates are on the project's 1–8 story-point scale.

## What already exists

Nothing in the list below is a new capability. Every stage has a working
engine; what is missing is the ledger that sequences them and the two gate call
sites that do not exist yet.

| Stage | Engine that already works |
| --- | --- |
| S0 JD ingest | `runJdBuild` (`app/_lib/jd-build-run.ts`) |
| S1 Sourcing | `buildCandidatePool`, `rediscoverForJob` (`candidate-pool.ts`, `rediscover.ts`) |
| S2 Screening | `runAutomationPass`, `runScreenWave` (`automation-pass.ts`, `screen-wave.ts`) |
| S3 Case assignment | `runLifecycle` (`devcase-orchestrator.ts`) |
| S4 Interview scheduling | `createScheduleInvite` / `confirmScheduleInvite` (`schedule-store.ts`) |
| S5 Scorecard | `Scorecard` synthesis (`interview-scorecard.ts`) |
| S6 Offer draft | `validateOfferTerms`, `createOffer` (`offer-policy.ts`, `offers-store.ts`) |
| Gate protocol | `screen-wave-approval.ts` — preview → signed token → single-spend commit |
| Gate routing | `APPROVAL_KINDS` (`approval-kinds.ts`) |
| Audit | `sealDecisionRecord` (`decision-record-store.ts`) |

## Dependency shape

```
R1 ──┬─ R2 ─┬─ R4  (S1 sourcing)
     │      ├─ R5  (S2 screening + rejection gate)
     │      ├─ R6  (S3 case)
     │      ├─ R7  (S4 invite gate)
     │      ├─ R8  (S5 scorecard)
     │      └─ R9  (S6 offer gate)
     └─ R3 ─────── (generalised gate protocol; R5/R7/R9 consume it)
                        │
                    R10 ─ R11 ─ R12
```

R1–R3 are the foundation and are strictly serial with what follows. **R4–R9 are
deliberately one-per-stage and touch disjoint files** — they are the parallel
wave. R10–R12 close the loop.

---

## R1 — The run ledger: schema + store

**5 points.** Files: `app/_lib/db/migrations/*` (new migration),
`app/_lib/role-run-store.ts`, `app/_lib/role-run-store.test.ts`.

Two tables. `role_runs` (`id`, `workspaceId`, `jobId`, `status`, `createdAt`,
`completedAt`, `budgetCeilingUsd`) and `role_run_stages` (`id`, `runId`,
`workspaceId`, `candidateRef` nullable, `kind`, `status`, `payload` JSON,
`producedAt`). Artifact rows are append-only: a correction is a new row, never
an `UPDATE` of an old one.

Both tables tenancy-scoped like every other store here, with the tenancy test
the repo's gate expects.

**Done when:** the migration runs on a fresh DB and on a populated one; the
store round-trips every artifact kind; the tenancy test proves a second
workspace cannot read the first's rows. Tests execute the real migration file —
never an inline copy of the schema.

## R2 — The stage contract and the resume read

**5 points.** Files: `app/_lib/role-run-stages.ts`,
`app/_lib/role-run-stages.test.ts`.

Pure, DB-free, in the shape of `pipeline-stages.ts`: the `RoleRunStageKind`
literal union (`role_spec` … `offer_draft`), the payload type per kind, the
legal transition table, and `nextStageFor(artifacts)` — the resume read that
turns "what artifacts exist for this candidate" into "what runs next".

Carries the ADR-0008-style contract test in both directions: a stage may not
read `complete` without its artifact row, and an artifact row may not exist for
a stage the transition table says is unreachable.

**Done when:** a run's next step is derivable from its rows alone, with no
in-memory state, proven by a test that reconstructs a half-finished run from
the store.

## R3 — Generalise the approval gate beyond the screen wave

**8 points.** Files: `app/_lib/approval-gate.ts`,
`app/_lib/approval-gate.test.ts`; `screen-wave-approval.ts` becomes a thin
re-export.

Lift `screenWaveApprovalToken` / `verify` / `consume` into a gate-kind-generic
module: the token signs `(gateKind, jobId, policyVersion, subjectIds, issuedAt)`
instead of hardwiring the wave. Keep the 15-minute window, the single-spend
ledger, and the five refusal reasons verbatim — they are settled and this
increment must not re-decide them.

**Risk to manage:** `screen-wave-approval.ts` is live compliance code with an
Art. 22 argument attached. The existing tests must pass unchanged through the
re-export; if any assertion needs editing, that is the signal the lift changed
behaviour and the increment should stop.

**Carried limitation, unchanged:** the spend ledger is in-process, so a
multi-worker deployment has one ledger per worker. Do not silently "fix" it
here — it is recorded in `docs/features/compliance/ai-act-conformity.md` and
needs its own increment (R12).

**Done when:** every existing screen-wave approval test passes against the
generalised implementation with no assertion edited.

---

*The wave below can run in parallel. Each increment writes one stage's runner,
its artifact, and its tests, and touches no file another increment in this wave
touches.*

## R4 — S1 sourcing runner

**3 points.** Files: `app/_lib/role-run/source-stage.ts` + test.

Composes `buildCandidatePool` and `rediscoverForJob` into a `slate` artifact.
Applies `outreachSuppressionReason()` (P1) **before** the slate is written, so
an anonymized or consent-expired person never appears in a run record. No gate:
sourcing affects no person until someone is contacted.

**Done when:** a suppressed candidate is absent from the artifact and the
suppression reason is recorded as a count, not as a name.

## R5 — S2 screening runner + the rejection gate

**8 points.** Files: `app/_lib/role-run/screen-stage.ts`,
`app/api/role-runs/[id]/gates/rejection/route.ts` + tests.

Wraps `runAutomationPass` into a `screen` artifact. The fairness backstop and
`markQueuedForApproval` stay exactly as they are — a proposed rejection becomes
a `rejection_review` approval and the candidate's branch parks. The gate route
is preview → token → commit on R3's protocol, and the commit seals a decision
record before any comms dispatch.

**Non-negotiable:** the runner never rejects. It proposes.

**Done when:** a test proves that with no approval token, zero rejection comms
are dispatched and zero entries leave the board — and a positive control proves
that with a valid token they do.

## R6 — S3 case assignment runner

**5 points.** Files: `app/_lib/role-run/case-stage.ts` + test.

Drives `runLifecycle` per advanced candidate into a `case_assignment` artifact.
No gate: assigning a case affects a person's time, not their candidacy, and the
`isAtReviewGate` quality gates inside the dev-case lifecycle are the dev-case's
own business (ADR-0009 alternative B).

Consent (P3) is checked before a case is issued, not after.

## R7 — S4 scheduling runner + the interview-invite gate

**8 points.** Files: `app/_lib/role-run/interview-stage.ts`,
`app/api/role-runs/[id]/gates/invite/route.ts` + tests.

The runner produces a *proposed* invite set. `createScheduleInvite` is called
by the **gate commit**, never by the runner — minting a token is the act the
candidate sees. Reminder and reschedule behaviour is unchanged and stays owned
by `schedule-store.ts`.

**Done when:** no schedule token exists in the DB for a run whose invite gate
was never committed.

## R8 — S5 scorecard runner

**3 points.** Files: `app/_lib/role-run/scorecard-stage.ts` + test.

Reads the interview session into a `scorecard` artifact, stamping
`rubricVersion` and `rubricKeys` at write time. No gate: a synthesised
scorecard is evidence, not a decision. Transcripts pass
`redactTranscriptForConsent()` at the read boundary (P3) and the artifact
stores the recommendation and the rubric stamp only — never a quote.

## R9 — S6 offer-draft runner + the offer gate

**8 points.** Files: `app/_lib/role-run/offer-stage.ts`,
`app/api/role-runs/[id]/gates/offer/route.ts` + tests.

The runner validates terms through `validateOfferTerms` and writes an
`offer_draft`. `createOffer` is called by the gate commit only. The drafted
terms and the rationale are what the human reads; the commit seals the decision
record and mints the offer token in one transaction.

---

## R10 — The run driver and its budget ceiling

**5 points.** Files: `app/_lib/role-run/driver.ts`, `app/api/role-runs/route.ts`
+ tests.

Walks each candidate branch to its next runnable stage per pass, respecting the
per-run `budgetCeilingUsd` from R1. A pass is bounded and idempotent: running
it twice must not double-spend an LLM call or duplicate an artifact.

**Explicitly out of scope:** any attempt to run the whole role inside one
process. The driver's job is one bounded pass; the scheduler calls it again.

## R11 — Surfacing the run

**5 points.** Files: `app/features/hiring/role-run/**` + tests.

A run view: the seven stages, which candidates are on which, what is parked at
which gate and for how long. The three gate approvals route into the existing
Decisions queue through `APPROVAL_KINDS` — no new approval surface.

## R12 — The two honesty follow-ups

**5 points.** Two independent pieces, filed together because they share a
theme.

1. **Persist the single-spend ledger.** A `consumed_at` column beside the seal,
   replacing R3's in-process map, so a replay routed to a second worker is
   caught. Closes the limitation named in `ai-act-conformity.md`.
2. **Split the KPI.** Autonomous-stage coverage and gate dwell time are
   measured and reported *separately*. ADR-0009 is explicit that a single
   "time to hire" number would hide which half is slow, and the goal this work
   serves is about the autonomous half.

---

## What this breakdown deliberately does not do

- **No new external service, no broker, no queue.** ADR-0009 alternative C, and
  ADR-0002/0003/0004 before it. The two-minute keyless start must still reach a
  populated board after every increment here.
- **No fourth gate.** Screening holds and scorecard reviews remain a
  recruiter's own escalation, not a stop the run waits on. Adding a gate is an
  ADR amendment, not an implementation detail.
- **No change to any existing engine's behaviour.** R4–R9 wrap; they do not
  rewrite. Where a wrapper needs an engine to behave differently, that is its
  own increment with its own review.
