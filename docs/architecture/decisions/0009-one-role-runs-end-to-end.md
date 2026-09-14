---
id: "0009"
title: A role runs end to end as a ledger of stage artifacts; only person-affecting decisions gate
status: proposed
date: 2026-09-14
supersedes: []
superseded-by: null
tags: [pipeline, automation, compliance]
sources:
  - app/_lib/pipeline-stages.ts
  - app/_lib/approval-kinds.ts
  - app/_lib/screen-wave-approval.ts
  - app/_lib/automation-pass.ts
  - app/_lib/consent.ts
  - app/_lib/decision-record-store.ts
  - app/_lib/schedule-store.ts
  - app/_lib/offers-store.ts
  - app/_lib/interview-scorecard.ts
  - app/_lib/devcase-orchestrator.ts
  - app/_lib/rediscover.ts
  - app/_lib/jd-build-run.ts
---

## Context

kp already owns every individual step of a hire. A job description is built by
`runJdBuild` (`jd-build-run.ts`), a pool is ranked and re-surfaced by
`rediscoverForJob` (`rediscover.ts`), screening decisions are produced by
`runAutomationPass` (`automation-pass.ts`) and `runScreenWave`, a case runs
through the D0–D8 lifecycle in `devcase-orchestrator.ts`, interviews are minted
and booked by `createScheduleInvite` / `confirmScheduleInvite`
(`schedule-store.ts`), a scorecard is synthesised into the `Scorecard` shape
(`interview-scorecard.ts`), and an offer is minted and answered by
`offers-store.ts` / `offer-finalize.ts`.

What does **not** exist is the thread. Each step is entered by a recruiter from
a different surface, and the state that connects them lives only in the
recruiter's head and in `pipeline_entries.stage`. The consequence is that the
product's claim — *one role runs end to end, the human only approves the
decisions that affect a person* — is today false for a reason that has nothing
to do with the quality of any step: nothing sequences them.

Three forces constrain any answer:

1. **ADR-0002 / ADR-0003.** Persistence is one SQLite file and the heavy work
   is a spawned Python process. There is no broker, no worker fleet, and
   `docs/architecture/self-hosting.md` promises a populated board in two
   minutes with no key and no service. A workflow engine is not available to us.
2. **Art. 22 GDPR / the EU AI Act gate already enacted in
   `screen-wave-approval.ts`.** A human approval is a review *of a moment, of a
   set* — it carries an issue time, a 15-minute window, a signature over the
   exact cohort, and it is spent on one commit. Any automation that reaches a
   person-affecting decision must arrive at that gate, not around it.
3. **The 20-minute execution ceiling** on a single autonomous pass. A run that
   must complete inside one process cannot include a candidate sleeping on an
   interview invite for three days.

The tempting shape — one long orchestrator function that calls the seven steps
in order — fails (1) and (3) at once: it cannot survive a restart, and it
cannot survive a candidate.

## Decision

**A role run is a persisted ledger of typed stage artifacts. Each stage is a
resumable step from the previous artifact to the next, and exactly three
transitions require a human: rejection, interview invite, and offer.**

### 1. The run is state, not a call stack

A `role_run` row exists per (job, cycle). Each stage writes one immutable
`role_run_stage` artifact row and advances the run. A stage reads the previous
artifact and the live stores; it never receives state in memory from the stage
before it. Resuming a run is re-reading its last artifact — so a crash, a
restart, a 20-minute ceiling, and a candidate who answers on Thursday are the
same case, handled the same way.

An artifact **references** the existing store rows (`entryId`, `inviteId`,
`offerId`, `devcaseId`). It never copies them. The stores named in `sources:`
remain the single source of truth for their own domain; the ledger records
only *what this run did and when*.

### 2. Stage outputs

| # | Stage | Artifact kind | Payload (beyond `runId`, `producedAt`, `status`) | Source of truth |
| --- | --- | --- | --- | --- |
| S0 | JD ingest | `role_spec` | `jobId`, `roleSpecHash`, `rubricVersion`, `rubricKeys`, `lintFindings[]` | `jobs`, `jd-build-run.ts` |
| S1 | Sourcing | `slate` | `candidates[]` of `{ candidateRef, origin: "inbound" \| "pool" \| "rediscovery" \| "agent", priorOutcomeRef? }`, `truncated` | `candidate-pool.ts`, `rediscover.ts` |
| S2 | Screening | `screen` | `decisions[]` of `{ entryId, route: "advance" \| "hold" \| "reject_proposed", matchScore, reasonCode, reasonParams }`, `policyVersion`, `fairnessAlerts[]` | `automation-pass.ts`, `screen-wave.ts` |
| S3 | Case assignment | `case_assignment` | `assignments[]` of `{ entryId, devcaseId, timeboxMinutes, seedRef }`, `caseDesignHash` | `devcase-orchestrator.ts` |
| S4 | Interview scheduling | `interview` | `invites[]` of `{ entryId, inviteToken, status, slotAt?, rescheduleCount }` | `schedule-store.ts` |
| S5 | Scorecard | `scorecard` | `cards[]` of `{ entryId, sessionId, recommendation, rubricVersion, rubricKeys, source: "ai" }` | `interview-scorecard.ts` |
| S6 | Offer draft | `offer_draft` | `drafts[]` of `{ entryId, terms: OfferTerms, ttlDays, rationaleRef }` — **draft only, never minted** | `offer-policy.ts`, `offers-store.ts` |

Every artifact carries the run's `workspaceId` and is tenancy-scoped like every
other store in this codebase.

`status` on an artifact obeys ADR-0008: a stage may not read `complete` unless
its artifact row exists and its referenced rows exist. A contract test asserts
this in both directions, the same shape as `integrationsCatalog.test.ts`.

### 3. The three gates

A gate is a decision **about a person that the person would feel**. There are
three, and they map onto values already in `APPROVAL_KINDS`
(`approval-kinds.ts`):

| Gate | Where it fires | `approvalKind` | What the human sees |
| --- | --- | --- | --- |
| **Rejection** | S2, and any later stage that would end a candidacy | `rejection_review` | The set the policy would reject, with per-candidate reasons |
| **Interview invite** | S4, before `createScheduleInvite` mints a token | `calendar` | Who is being invited, to what, on the strength of what |
| **Offer** | S6, before `createOffer` mints an offer token | `offer_review` | The drafted terms and the rationale behind them |

Every gate is the `screen-wave-approval.ts` protocol, generalised — preview →
token signed over the exact set → single-spend commit inside a 15-minute
window. It is already the right mechanism and already carries the Art. 22
argument; the change is that three call sites use it instead of one.

Everything else runs unattended: sourcing, scoring, case design, case
assignment, slot generation, reminders, scorecard synthesis, and the *drafting*
of an offer. `screening_review` and `scorecard_review` stay in the taxonomy as
a recruiter's own escalation, not as a gate the run waits on.

### 4. A gate blocks a candidate, not the run

The run fans out per candidate after S1. A candidate parked at a gate holds
that candidate's branch; the other branches proceed. A run reaches `complete`
when every branch is terminal (hired, rejected, withdrawn, lapsed) — not when
every branch reached S6.

This is the whole reason the ledger is per-candidate rather than per-stage: a
per-stage barrier would make one unreviewed rejection stop a slate of twenty.

### 5. PII touchpoints

Each artifact declares a PII class, and the run has exactly five places where
candidate PII crosses a boundary:

| # | Touchpoint | Stage | Control |
| --- | --- | --- | --- |
| P1 | Pool / rediscovery read of a previously-rejected person | S1 | `outreachSuppressionReason()` — `anonymized` and `consent_expired` are suppressed before the slate is written |
| P2 | CV text into the Python screening process | S2 | Referenced by `entryId`; the artifact stores scores and reason codes, never CV prose |
| P3 | Case submission and its transcript | S3, S5 | `consentRequired()` / `isPersistConsentSatisfied()` (`interview-consent.ts`); `redactTranscriptForConsent()` at every read boundary |
| P4 | Candidate address on an invite, reminder, or offer mail | S4, S6 | Comms dispatch, ADR-0008 delivery truth; recipient resolved per-send, never stored on the artifact |
| P5 | The sealed decision record behind each gate | S2, S4, S6 | `sealDecisionRecord()` — hash-chained, tenancy-scoped, `candidateRef` not name |

The standing rule, which the contract test enforces: **a `role_run_stage`
payload may contain identifiers, scores, codes and hashes. It may not contain a
candidate's name, contact, CV text or transcript.** The consequence is that
`consentWithholdsPii()` at a read boundary is sufficient — there is no second
copy of the candidate's words in the ledger to forget to scrub. Expiring a
consent mid-run does not corrupt the run; it withholds at read and suppresses
the next outreach.

## Alternatives considered

**A. Grow `runAutomationPass` into the chain.** It already walks active entries
and applies policy. Rejected: the pass is a stateless per-entry sweep with an
in-process guard (`isPassInFlight`) and no cross-stage memory. Giving it seven
stages means giving it durable state anyway — that is this ADR, with the
fairness-backstop code as collateral damage. The pass stays what it is: S2's
engine.

**B. Drive the run from `devcase-orchestrator.runLifecycle`.** It is a working
resumable state machine over D0–D8. Rejected: its gates
(`isAtReviewGate`) are *quality* gates on a case artifact, not person-affecting
ones. Reusing it would put a human in the loop at case design — precisely the
step this work exists to automate — and would couple the hiring thread's
lifetime to one case's.

**C. An external workflow engine (Temporal, a BullMQ queue, a cron fleet).**
The textbook answer for durable multi-day orchestration. Rejected on ADR-0002,
ADR-0003 and ADR-0004: it is a new service and a new dependency, it breaks the
two-minute keyless start, and the durability we actually need is one table and
a resume read.

**D. One gate at the end — "approve the slate".** Cheapest for the recruiter.
Rejected: by the time a slate is presentable, the rejections have already been
sent. An approval that arrives after the effect is not an approval, and
`screen-wave-approval.ts` exists because we already rejected this shape once.

## Consequences

- **Wall-clock is now dominated by human latency, and that is visible.** A run
  will sit for days at a gate. "End to end without a human *step*" is not "end
  to end without a human *decision*" — the KPI must be autonomous-stage
  coverage and gate dwell time separately, never a single "time to hire" that
  hides which half is slow.
- **Seven new artifact kinds are seven new things that can lie.** They get an
  ADR-0008-style contract test from the first commit, not later.
- **The offer stage produces a draft and stops.** `createOffer` is never called
  by the run; it is called by the gate commit. This is a deliberate asymmetry
  with S4, where the invite token is also minted by the gate commit.
- **Cost per run is unbounded by construction** — S1 fan-out times S2 LLM calls.
  A per-run budget ceiling is a prerequisite, not a follow-up.
- **A candidate can be at a different stage than their `pipeline_entries.stage`
  says**, briefly, between an artifact write and a stage move. The artifact is
  the run's truth; the entry stage stays the board's truth. Reconciliation is
  the run's job, and a divergence that persists past one pass is a bug with a
  test.

## What would change our mind

- **If gate dwell dominates.** If measurement shows the autonomous stages are a
  rounding error against time spent waiting on the three gates, the valuable
  work is gate *ergonomics* (batching, mobile approval, delegated authority),
  not more automation, and this ADR's premise is the wrong one to invest behind.
- **If a regulator or a large deployer requires a human on scoring or on case
  assessment.** The gate list is the load-bearing claim here; a fourth gate at
  S5 would change the run's shape from "three pauses" to "a supervised
  pipeline", and §4's per-candidate fan-out would need rethinking.
- **If a second product genuinely needs the same durable-run machinery**
  (agent hiring, dev-case cohorts). Two consumers is the threshold at which
  extracting a general run ledger — or reconsidering alternative C — stops
  being speculative.
