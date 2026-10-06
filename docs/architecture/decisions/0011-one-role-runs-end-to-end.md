---
id: "0011"
title: A role runs end to end as a ledger of stage artifacts; only person-affecting decisions gate
status: accepted
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
  - app/_lib/interview-sim/role-demo.ts
  - app/_lib/interview-sim/seed-origin.ts
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

## Amendments

- **2026-10-06 — a candidate's own act is not a human step.** For goal-1 scoring
  ("one role runs end to end without a human step"), a human step is one taken
  by the hiring side: a recruiter or operator. A candidate applying,
  re-applying, answering a follow-up or replying to an offer is the process
  working. The exclusion lives in `app/_lib/thread-autonomy.ts` (a third
  attribution class, `candidate`, counted in `candidateEvents` so it stays
  visible). `decision-attribution.ts` keeps its broader meaning of `human` for
  the decision log and the analytics rollup, on purpose: there a candidate's
  act is still a person acting. Before this, `applied` (written with a null
  actor) fell through to the kind map and read as human, so every applied
  thread scored a first human step at sourcing and no role could be autonomous.
- **2026-10-06 — an intake with no actor is unknown, not human.** The kinds
  `added` and `intake_degraded` are written by one writer
  (`createPipelineEntry`, `app/_lib/db/pipeline.ts`), and that writer is called
  by recruiter routes (`api/pipeline`, the outreach route), by machine intakes
  (automation rematch, the dev-case orchestrator, the agent-hire lifecycle, the
  guided-demo inbound) and by the candidate's own filing. The kind therefore
  cannot say who acted; only the actor can. For goal-1 scoring,
  `eventAttribution` in `app/_lib/thread-autonomy.ts` returns `unknown` for
  those kinds when the row has no usable actor (`INTAKE_KINDS_WITHOUT_WITNESS`)
  before it consults the shared kind map. An explicit actor still wins. Unknown
  never makes a rung autonomous and is counted in `unknownEvents`; it is not a
  first human step either, so missing data no longer reads as a hiring-side act.
  `decision-attribution.ts` is unchanged: the decision log and the analytics
  rollup keep `added` as human. Writers now stamp the actor they know
  (`CreatePipelineInput.actor`): `human:<name>` / `human:recruiter` from the
  recruiter routes, `human:candidate` from the applicant's own forms,
  `auto:<engine>` from machine paths. A door that cannot honestly name the
  actor (webhook and CV-channel relays, the ATS import, the interview-create
  promote-on-demand) stamps nothing, and its rows read unknown. Rows written
  before this change carry no actor and read unknown too.
- **2026-10-06 — the three approval gates are not human steps for goal 1.** For
  goal-1 scoring ("one role runs end to end without a human step"), a run may
  stop at the rejection, interview-invite and offer gates and still count: the
  operator decided (ask 47725201, "Gates are allowed") that goal 1 means zero
  human steps *apart from* those three approvals. Where it is measured:
  `roleRunGoalOneSteps` in `app/_lib/role-run-metrics.ts` counts the gate
  resolutions apart (per gate, approved and declined), counts the gates still
  open, and counts any row that records a human act other than a gate commit;
  the demo run (`scripts/kpi/role-demo-run.mjs`) leads with its verdict, `goal 1:
  met` only once a branch has an approved offer gate with no human step outside
  the gates. The gates stay human under Art. 22: a run still stops at each one
  for a single attributable approval act, the demo never approves one itself,
  and `gateDwell` still reports that wait. `roleRunCoverage` is unchanged and
  still reads a gated stage's `complete` as human — coverage and dwell remain
  two separate figures, and goal 1 is a third question beside them. The
  pipeline-event meter (`thread-autonomy.ts`) is unchanged: the engine writes no
  event at a gate commit, so that meter cannot tell a gate approval from another
  human act.
- **2026-10-06 — what goal 1 reads at the end of a run, and what the demo's stand-in
  is.** (a) A run whose every branch ended by gate decision without an approved
  offer is `not met`. Goal 1's end is an approved offer: a finished run that hired
  nobody has not shown the thread end to end. `roleRunGoalOneSteps` now says so
  when no gate is open and a gate resolution was `declined` — "every open branch
  ended at a gate by decision; no offer approved" — instead of "no branch reached
  a resolved offer gate", which a declined offer made false. (b) A resolution row
  without a valid gate payload counts as a human step outside the gates. The
  engine's only resolution writer (`commitRoleRunStageGate`) always stamps `gate`
  and `decision`, so the count is 0 today, and any new writer is caught. (c) The
  demo's `--approve-gates` stand-in (`scripts/kpi/role-demo-run.mjs`, approver
  `demo-stand-in`) exists only on the temp copy of the database. It is labelled in
  every reading — the headline says the gates were approved by the demo stand-in,
  not a person, with the count per gate — and it never approves anything in a real
  database.
- **2026-10-06 — the stand-in follows a stated policy, and only a policy reading counts
  for goal 1.** The first stand-in (`--approve-gates`, d9fd41f5) approved every parked
  gate, and the engine treats an approved `hold` screen as proceed
  (`commitRoleRunStageGate`), while the scorecard stage always writes `unrated` because
  no interview session exists. So 20 of 20 branches reached an approved offer, below-floor
  scores included, on no assessment, and goal 1 read `met` on a false basis. The ruling:
  the stand-in carries out the engine's own recorded proposal and adds no judgment of its
  own (`standInDecision` in `scripts/kpi/role-demo-run-reading.mjs`). At the rejection gate
  `advance` and `reject_proposed` are approved (approving the proposal is what the engine
  defines) and `hold` is **left parked** — the stand-in never decides a hold, because the
  fairness rule reserves that judgment for a person. The invite is approved only after an
  `advance` screen, else left. The offer is approved only on a positive scorecard
  recommendation and **declined** otherwise (`unrated`, a negative value, or no card), with
  the reason recorded. Every reading shows approved / declined / left per gate with each
  reason and its count, and goal 1 reads `met` only when an offer was approved on that
  basis; otherwise it names what stopped the run. The old approve-everything behaviour
  survives as `--approve-all`, labelled mechanics only: it reports the stages each branch
  reached and its goal-1 verdict is withheld, never `met`. So only `--approve-gates`
  readings count for goal 1. The invite and offer gates still sign with the engine tests'
  policy labels (`invite-1`, `offer-1`), because the engine records no policy version for
  them. The first honest reading therefore names the real gap: the interview stage
  produces no rated scorecard, so no offer has a basis. `roleRunGoalOneSteps` is unchanged.
- **2026-10-06 — S5 carries the sealed scorecard of the entry's completed candidate
  interview.** `runScorecard` reads the entry's newest `completed`, candidate-mode
  interview session that holds a scorecard, in the run's workspace
  (`latestScoredCandidateInterviewByEntry`). When one exists the card names its session id
  and its recommendation, made canonical (`advance` | `hold` | `reject`; an off-vocabulary
  value becomes `hold`; a scorecard with no recommendation stays `unrated`). In every other
  case — no session, a test-mode rehearsal, a live or revoked call, another workspace — the
  card is `unrated` with no session id, exactly as before. The stage still calls no model,
  provider or pipeline and writes no verdict of its own. Known limit, unchanged: S5 runs in
  the same pass as the invite approval, before an interview can have happened, so a real
  flow still records `unrated`; fixing that changes the engine's shape and is a later
  decision.
- **2026-10-06 — the demo holds a simulated interview, so S5 has a scorecard to read.** The
  operator's ruling (interview ask answered "Simulated interview in the demo"): under
  `--approve-gates` only, and only in the child half of `scripts/kpi/role-demo-run.mjs` (the
  scratch copy of the database), the demo plays an interview for each branch whose invite its
  stand-in approves — the candidate played by the model from the CV on the entry through the
  existing interview simulator (`app/_lib/interview-sim/role-demo.ts`, the Claude CLI as `SimLlm`;
  no new provider, key, dependency or npm script) — and seals its scorecard with the existing
  `finalizeCandidateInterviewScoring`. **Ordering, with no engine change:** the invite gate parks
  S4; the stand-in's approval is committed between two `advanceRoleRun` passes; S5 runs on the
  NEXT pass. The demo holds and seals the interview right after the approval and before that pass,
  so `runScorecard` picks it up through `latestScoredCandidateInterviewByEntry` unchanged —
  `role-run-engine.ts`, `role-run-stages.ts`, `role-run-gates.ts` and every runner are untouched.
  **'llm'-only:** a scorecard is accepted only when the scorer's `verdictSource` is `llm`; a
  template scorecard is never attached, so the card stays `unrated`, and so does a branch whose
  provider is unavailable (KP_OFFLINE, no `claude` on PATH, a throw) or that has no agenda — the
  reason is recorded and the run continues. A keyless start therefore reads exactly as before.
  **The label:** the session's candidate label ends ` (simulated)`, every reading lists one row per
  branch (`simulatedInterviews`: session, recommendation, verdict source, turns, end reason, skip
  reason — never transcript or scorecard text), and a goal-1 `met` that rests on such a scorecard
  reads "met on a SIMULATED interview (candidate played by the model from the CV on the entry), gates by
  the demo stand-in", never a plain `met`. The demo plays at most 2 branches by default
  (`--sim-interviews <n>`, hard ceiling 5; the rest read "not simulated: cap"). `roleRunGoalOneSteps`
  and the stand-in policy (`standInDecision`) are unchanged.
- **2026-10-06 — the demo simulator plays SEEDED entries only, and refuses every other entry
  with a recorded reason.** The operator's answer to finding 2b of
  [`docs/security/role-demo-sim-scan-2026-10-06.md`](../../security/role-demo-sim-scan-2026-10-06.md)
  ("Seeded entries only"), chosen over the alternative of accepting it as a disclosed
  dev-instrument behaviour. The scan established that the branches played are decided by which
  invites the stand-in approved on a copy of whatever board the demo was pointed at — so on a
  real install they are real people — and that for each one the whole CV profile and the
  entry's private interviewer brief are rendered into the system prompt of a `claude -p` call.
  `simulateInterviewForEntry` now refuses unless `seedOriginProblem`
  (`app/_lib/interview-sim/seed-origin.ts`) can PROVE the entry is seed data: the live row's
  id, `candidate_id` and `candidate_label` match a record in `data/seed_pipeline/pipeline.json`
  AND the candidate's stored CV payload equals its record in
  `data/seed_candidates/candidates.json` (canonical-JSON equality, the form `seedCandidates`
  stores). **Fail-closed:** unreadable or missing fixtures refuse every entry — there is no
  fallback to playing them. The check runs after the scratch-DB guard and the entry lookup and
  BEFORE the provider preflight, `candidatePersona`, any session and any model call, so a
  refused entry's CV never reaches a prompt; the refusal is an ordinary recorded row ("not
  simulated: not seed data (CV not sent to the provider): …"), it does not consume the
  per-run cap, and the reading reports how many branches were refused that way. **Two weaker
  signals were rejected as proof:** the `seed_marks` rows (`adoptedExistingSeed` stamps the
  mark on a database that was never seeded) and the `pe-*` / `cand-*` id shape (`seedPipeline`
  inserts `OR IGNORE`, so a real row can hold such an id). The run's output — printed and
  `--json` — also now states in one line where a played CV goes: the Claude CLI (`claude -p`)
  on this machine's Claude seat. Nothing about the engine, the stand-in policy or the goal-1
  reading changes. **What would reopen it:** a demo that has to run on an operator's real board
  to be worth running — at which point the decision is consent and disclosure, not a predicate.

- **2026-10-06 — what "met" requires in a policy demo run, and where the seed refusal is
  counted.** The reading of `1bb72d60` said `met` on 2 of 4 offer-stage branches, on two
  interviews cut at `max_turns` (the demo's own 8-candidate-turn limit, `DEMO_SIM_LIMITS`), with
  16 branches still held and 0 refusals counted. Both were the instrument's doing, not the
  engine's: the repo's detectors grade a call a harness cap ended as "a harness cap ended the
  call, not the protocol" (not evaluable), and the batch loop checked the cap *before*
  `seedOriginProblem`, so every branch past the cap was recorded "not simulated: cap" and never
  proved seed or not. **Four clauses.** Under `--approve-gates`, goal 1 reads `met` only when
  all hold: (i) at least one offer is approved on a recorded basis (unchanged); (ii) at least one
  approved offer rests on a simulated interview that ENDED BY PROTOCOL — `end_interview` or
  `director_end`; `max_turns`, `hard_stop` and `error` are not a basis; (iii) every branch is at a
  defined end state — terminal, `offer_draft` complete, or parked at the rejection gate as a hold
  the stand-in left by policy, which is a person's call under the fairness rule — and any other
  open branch is named; (iv) no branch that passed the seed proof was kept out of the
  interview by the cap. Otherwise the headline reads `not met:` and names each failing clause with
  its counts. **The end-state line.** Every policy headline, met or not, ends `run end state:
  <status>; H branch(es) held for a person at rejection` (or `complete`), and `--json` carries the
  same facts (`runEndState`, `protocolEndedBases`, `cappedSeedBranches`, `heldForPerson`,
  `openBranches`) beside `goalOneHeadline`. **Refusal-count ordering.** `createRoleDemoSimulator`
  runs the local pre-check — scratch-DB declaration, entry, profile, `seedOriginProblem` — for
  every branch before it looks at the cap: a branch that fails the proof is always recorded as a
  not-seed refusal with its reason, and only a branch that passes it and finds the cap spent reads
  "not simulated: cap". Nothing past the pre-check runs for either (no preflight, persona, session
  or model call, so no CV reaches a prompt), and a refusal still does not use up the cap. A held
  branch is an allowed gate step, so the 16 holds do not fail the verdict; `standInDecision`,
  `DEMO_SIM_LIMITS` and the engine are unchanged, and `--approve-all` stays withheld.

- **2026-10-06 — the demo's simulated interview runs a SHORT agenda, and the headline says
  so.** The operator answered the spend ask with "Short agenda, same spend". The end-state
  reading left clause (ii) as the one failure: every simulated call hit `max_turns`, because
  `DEMO_SIM_LIMITS` allows 8 candidate turns and the real kit agenda (warm-up, several scored
  topics with must-asks, role questions, close) cannot be covered and closed in 8. **The limits
  do not move:** 8 candidate turns, 48 calls, 2 interviews (`DEFAULT_SIM_INTERVIEWS`), with no
  extra seat spend. What changes is the agenda, on the demo path only:
  `interview-sim/demo-agenda.ts::shortDemoAgenda` takes the kit `buildInterviewKit` returned and
  keeps ONE scored block (the kit's first topic, at most 2 must-asks, at most 4 minutes) and the
  closing blocks; `hardCapMin` is recomputed with `HARD_CAP_FACTOR` and the close reserve is the
  closing blocks' minutes. `playCheckedEntry` applies it between `buildInterviewKit` and the
  read-only `buildGroundedInterview`, so the private brief, `instrument.agenda`,
  `record.agendaBlockIds` and the session's `durationMin` all describe the same short agenda. The
  real kit, `interview-agenda.ts`, the director, the engine and every live interview path are
  unchanged, and nothing outside the role demo calls the function. The director still refuses a
  `complete` while the one scored block is uncovered, so a protocol end on this agenda still means
  that block was covered. **What clause (ii) is read on:** a protocol end (`end_interview` or
  `director_end`) on the short agenda satisfies it, and that is a weaker basis than a protocol end
  on a full agenda, so it is labelled. Each simulated-interview row carries `agenda: 'short-demo'`
  and `agendaBlocks` (a label and a count, never agenda text); every policy headline whose
  simulated interviews used it contains the words "short demo agenda" (`met on a SIMULATED
  interview on a short demo agenda (…)`; a `not met` line names it too), and `--json` carries
  `simulatedAgenda` and `simulatedAgendaBlocks` beside `goalOneHeadline`. The four clauses keep
  their meaning.
