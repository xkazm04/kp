# Role run end to end - 2026-10-23

The second architecture review, scoped to one question: **what still stops ONE role on the
seeded demo corpus from running from JD to decision with zero manual edits between steps?**
It reads code and changes none.

- **Head.** `cd075cc39` (local `main` when the review started). Every `file:line` below is
  at that head.
- **Which goal.** The charter calls it key goal 3. ADR 0011, `role-run-metrics.ts` and
  `scripts/kpi/role-demo-run*.mjs` call the same goal "goal 1", and the Personas KPI is
  `df4812da` on goal `14b80beb` (`scripts/kpi/role-run-anchors.mjs:2-3`). They are the
  same goal under three names. This review uses "the goal".
- **Constraints.** ADR 0011 with all its amendments, ADRs 0004, 0008, 0015, 0017, 0019 and
  0030 were read first and treated as settled (section 6). No recommendation below reverses
  one. The 2026-10-07 review is the baseline; its finding #3 is re-checked in section 2.
- **One reading was taken** to ground section 3: the KPI demo, keyless, on a freshly seeded
  scratch database. Command and result are in section 3. Nothing else was run against data.

## Summary

The sequencer is real and resumable, and three of the seven stages (S0 role spec, S1
slate, S2 screen) now have live producers. The thread does not reach a candidate:

1. **No person can drive it from the product.** No `.tsx` file calls `/api/role-runs`, there
   is no GET for a run's state, and the clock job is off by default. Every start and every
   gate is an HTTP call by hand or the KPI script's stand-in.
2. **A gate approval changes nothing outside the ledger.** Approving a rejection rejects
   nobody on the board, approving an invite mints no invite, approving an offer creates no
   offer, and nothing is sealed (finding #3 of the 2026-10-07 review, still open, and its
   own trigger "before any production door" has now fired: `142eb2e` added the door).
3. **The goal's instrument measures the floor, not the product.** `role-demo-run.mjs` runs
   `DEFAULT_STAGE_RUNNERS`, never the live producers, and every recorded reading was taken
   on a copy of the operator's accumulated database rather than the seed.
4. **S3 to S6 have no producer.** The case is never assigned (`devcaseId: null`), the
   interview is never held without the demo's simulator, so the scorecard is `unrated` and
   every offer is declined on the keyless start.

What is **not** a gap: the three Art. 22 gates, the hold-for-a-person rule at screening,
and the named-approver requirement. Each is a deliberate human step and stays (section 2).

## 1. The thread, stage by stage

"Reached" means the engine `advanceRoleRun` (`app/_lib/role-run-engine.ts:347`) produces an
artifact for the stage today. The live runner set is `liveRoleRunRunners()`
(`app/_lib/role-run-live.ts:31-33`): producers over the keyless floor, each falling back to
the floor when unavailable or throwing (`app/_lib/role-run-producers/index.ts:59-77`).

Triggers for every stage are the same three doors, all calling `advanceRoleRunLive`
(`app/_lib/role-run-live.ts:57-73`):

- `POST /api/role-runs` (`app/api/role-runs/route.ts:24-45`) creates or resumes the run for a
  job and takes one pass.
- `POST /api/role-runs/[id]/advance` (`app/api/role-runs/[id]/advance/route.ts:65-83`).
- The clock job `role_run_advance`, every 5 minutes, **`defaultEnabled: false`**
  (`app/_lib/scheduler-jobs.ts:94`), handled at `instrumentation-node.ts:179-181`.

A pass stops at the first gate on each branch and at `LIVE_MAX_STAGES = 60`
(`app/_lib/role-run-live.ts:46`). A gate commit does not advance the run: the next pass
needs one of the three doors again.

| Stage (charter name) | Ledger kind | Producer, file:line | Reached today? | Notes |
| --- | --- | --- | --- | --- |
| JD / role spec | `role_spec` (S0) | Floor `runRoleSpec` `role-run-engine.ts:96-128`; live `roleSpecProducer` `role-run-producers/role-spec.ts:36-77` | **Yes** | Live path reuses the job's stated requirements (`role-spec.ts:44`) and calls the JD builder only when there are none (`:46-58`). Seeded `job-001` states 8, so no model call. |
| Sourcing / slate | `slate` (S1) | Floor `runSlate` `role-run-engine.ts:138-153`; live `slateProducer` `role-run-producers/slate.ts:49-102` | **Yes** | Live path adds rediscovered silver medalists after the board (`slate.ts:66-94`), consent-checked again before the board write (`:78`). Capped at `SLATE_CAP = 20` (`role-run-engine.ts:134`). Runs **once** per run (`role-run-stages.ts:46-49`, `:136-137`). |
| Intake | none | Not a run stage. Filing is `app/_lib/application-filing.ts` | **No** | An applicant filed after S1 never gets a branch: the slate is run-wide and is never re-read. A quick-apply or ATS lead is a profile-less stub by design (`application-filing.ts:46-48`) and is never scored (`app/_lib/entry-scoring-policy.ts:18-19`), so its screen routes `hold`. |
| Screen | `screen` (S2) | Floor `runScreen` `role-run-engine.ts:166-192`; live `screenProducer` `role-run-producers/screen.ts:56-89` | **Yes, parks** | Live path is a scoped dry run of the automation pass (`screen.ts:57`, `app/_lib/automation-pass.ts:223-228`). Always `awaiting_approval` (`screen.ts:70`). The floor uses a fixed `SCREEN_ADVANCE_FLOOR = 60` (`role-run-engine.ts:160`). |
| Score | inside S2 | Automation pass scoring `automation-pass.ts:585` (dry run: snapshot only, `:651`) | **Yes, read-only** | On a dry run the score is previewed, not written: the board entry stays unscored if it was. |
| Assessment (case) | `case_assignment` (S3) | Floor only, `runCaseAssignment` `role-run-engine.ts:201-214` | **Yes, empty** | `devcaseId: null` always (`:207`). The real dev-case lifecycle is a separate orchestrator with its own gates (`app/_lib/devcase-orchestrator.ts:115`) that the run does not call. |
| Interview | `interview` (S4) | Floor only, `runInterview` `role-run-engine.ts:221-226` | **Yes, parks** | Drafts `inviteRef: null`, `status: "drafted"` and parks at the invite gate. |
| Scheduling | inside S4 | `createScheduleInvite` `app/_lib/schedule-store.ts:290` exists | **No** | Neither the stage nor the gate commit calls it (ADR 0011 amendment 2026-10-07). No invite token, so no candidate can self-schedule. |
| Scorecard | `scorecard` (S5) | Floor only, `runScorecard` `role-run-engine.ts:232-260` | **Yes** | Reads the entry's own completed, sealed candidate interview (`:239-241`). With none, `recommendation: "unrated"` (`:252`). |
| Decision / shortlist | `offer_draft` (S6) | Floor only, `runOfferDraft` `role-run-engine.ts:265-280` | **Yes, parks** | Terms are a reference (`band: "job_posted_range"`, `currency: "EUR"`, `:273`). `createOffer` (`app/_lib/offers-store.ts:137`) is never called. The workspace shortlist (ADR 0030) is not touched. |
| Outreach and comms | none | `releaseOutreachLetter` `app/_lib/outreach-release.ts:91`; `sendComm` | **No** | Not a run stage. A rediscovered candidate gets a board entry and no outreach (`slate.ts:34-35`). No gate resolution sends a rejection, invite or offer message. |

**One gap the table hides: the board and the ledger never meet.** The engine writes only
`role_run_stages` rows (`role-run-engine.ts:386-389`, `:555-575`). The one board write in the
whole thread is the slate producer minting an entry for a rediscovered candidate
(`slate.ts:85-92`). A seeded entry already at the `Interview` column (`pe-018` in
`data/seed_pipeline/pipeline.json`) is screened again from S2, and nothing a run decides is
visible on the board, the journey view or the decision log.

## 2. Every human step left

"Deliberate" means keep it: it is a decision ADR 0011 or a later ADR assigns to a person.
"Gap" means a person is needed only because something is missing.

| # | Step | Where | Kind | Why |
| --- | --- | --- | --- | --- |
| H1 | Rejection gate per branch | `STAGE_GATE.screen` `role-run-stages.ts:73`; commit `role-run-engine.ts:523-576` | **Deliberate** | ADR 0011 §3 and the 2026-10-06 amendment: an Art. 22 gate is an allowed step for the goal. Even an empty rejection set parks (`role-run-engine.ts:162-165`). |
| H2 | Invite gate per branch | `role-run-stages.ts:76` | **Deliberate** | Same. |
| H3 | Offer gate per branch | `role-run-stages.ts:79` | **Deliberate** | Same. |
| H4 | A `hold` at screening waits for a person | Floor routes low score to `hold`, never `reject_proposed` (`role-run-engine.ts:155-160`); stand-in leaves holds (`scripts/kpi/role-demo-run-reading.mjs:104`) | **Deliberate** | The fairness rule: an automated screen does not auto-reject. Consequence worth stating: a run with one hold never reaches `complete` (`role-run-engine.ts:447-464`). The goal's clause (iii) already counts a hold as a defined end state. |
| H5 | A named approver on every gate commit | `app/api/role-runs/[id]/gate/commit/route.ts:54`, `:64`; `app/_lib/auth/operator-approver.ts:18`, `:36-39`; `role-run-gates.ts:135-137` | **Deliberate**, with a cost | On the two-minute open start (no sign-in, no `KP_OPERATOR_NAME`) every HTTP gate commit is refused `unattributed`. Keep the refusal, and know that the demo needs one env var or a sign-in to cross any gate by hand. |
| H6 | Someone must start the run | No `.tsx` calls `/api/role-runs` (grep at head); `POST /api/role-runs` only | **Gap** | There is no button. A recruiter cannot start a role run from the product. |
| H7 | Someone must re-trigger after each gate | Clock off by default `scheduler-jobs.ts:94`; gate commit appends only `role-run-engine.ts:555` | **Gap**, small | Turning the clock on is one setting, so this is a default, not missing code. Off by default is deliberate (a pass may call a model). |
| H8 | Someone must find the parked branches | No GET route (`docs/architecture/api-reference.md:619-622` lists four POSTs); `awaiting` is returned only by a pass (`role-run-engine.ts:315`) | **Gap** | The only way to learn which branches wait at which gate is to take another pass. |
| H9 | Preview then commit, per branch, per gate | `role-run-gate-preview.ts:44-74` (one `branchRef` per preview) | **Gap**, UX | With a slate of 20 that is up to 60 preview/commit pairs, by hand, inside a 15-minute token window. The screen-wave protocol it reuses already signs a set (`role-run-gates.ts:74-84`), so a batch preview is possible without a new protocol. |
| H10 | The approved rejection, invite and offer must be carried out by hand on the board | Gate commit is ledger-only, ADR 0011 amendment 2026-10-07 (a); doors exist: `runPipelineEntryAction` `pipeline-entry-action.ts:376`, `createScheduleInvite` `schedule-store.ts:290`, `extendDraftedOffer` `pipeline-entry-action.ts:245`, `getOrCreateOpenOffer` `offers-store.ts:310` | **Gap** | The biggest one. A run's "decision" is a ledger row. The owner's call is open (amendment (d)). |
| H11 | A held interview, so S5 has a basis | `runScorecard` `role-run-engine.ts:239-252` | **Optional service** | A real interview needs a voice provider (ADR 0010). The demo replaces it with a simulated interview through the Claude CLI seat (ADR 0011 amendment, "Short agenda, same spend"). Keyless, every card is `unrated` and the stand-in declines every offer (reading in section 3). |
| H12 | A late applicant needs a manual board-to-run step | S1 runs once (`role-run-stages.ts:136-137`) | **Gap**, needs an ADR call | No artifact kind can add a branch after the fan-out. |
| H13 | Loading the seeded corpus | `app/_lib/db/core.ts:2840-2849` | **Deliberate** (operator triage T1, 2026-10-22) | A fresh database no longer seeds by default. The demo needs `KP_SEED_DEMO=1` or the first-run screen's demo choice. One step, before the run, not between steps. |
| H14 | A quick-apply lead must enrich before it can be screened | `entry-scoring-policy.ts:18-19`; `automation-pass.ts:296-302` | **Deliberate** | The stub is unscored by design. Enrichment is the candidate's own act, which ADR 0011's 2026-10-06 amendment does not count as a human step. |

Prior finding #3 (2026-10-07) re-checked: the routes it asked for now exist
(`app/api/role-runs/[id]/gate/commit/route.ts`), the commit still calls no board door and
seals nothing, and the approver is still only a hash (`role-run-engine.ts:570`). The code
comments and ADR now say so honestly (`role-run-stages.ts:75`, `:78`;
`role-run-engine.ts:216-220`, `:262-264`), which settles the "false claims" half of #3. The
behaviour half is H10.

## 3. Is there a KPI that measures "zero manual edits"?

**Not as worded.** Three instruments touch the goal and none counts manual edits:

| Instrument | What it counts | Why it is not "zero manual edits" |
| --- | --- | --- |
| `scripts/kpi/role-run-anchors.mjs` (Personas KPI `df4812da`) | Seven code anchors, a self-declared delivery proxy (`:5-10`) | Reads **7/7 at `cd075cc39`** (run during this review). It is saturated and can no longer move. |
| `roleRunGoalOneSteps` `app/_lib/role-run-metrics.ts:218-266`, printed by `scripts/kpi/role-demo-run.mjs` | `humanStepsOutsideGates`: ledger rows that resolve a parked chain without a gate payload (`:178-183`) | **0 by construction** on any ledger the engine writes (`:180-182`). It cannot see a step taken outside the ledger: a board edit, an env var, a re-trigger, a simulated interview. |
| `app/_lib/thread-autonomy.ts` via `scripts/kpi/thread-autonomy.mjs` | Hiring-side events per rung on the **board** (`thread-autonomy.ts:1-3`, `:23-31`) | Reads `pipeline_events`, which a role run never writes (section 1), so it cannot see a run at all. |

**Where it is recorded.** Nowhere durable. The reading is printed. The three readings on
record are prose notes in `.ai/tasks/2026-10-06-goal1-reading-*.md` with the raw JSON not
committed. All three:

- ran `DEFAULT_STAGE_RUNNERS` (`scripts/kpi/role-demo-run-child.mjs:116-118`), never
  `liveRoleRunRunners`, so S0 to S2's producers (`57d6593`, `61e7bbf`, `3fe5d19`) have never
  been measured;
- predate the producers and the live trigger (`142eb2e`, 2026-10-16);
- ran on a copy of the operator's own `data/kp.sqlite`, not the seed. That is why they show
  20 branches and "refused as not seed data: 2": the seed holds 4 entries for `job-001`
  (`data/seed_pipeline/pipeline.json`: `pe-003` 69, `pe-011` 75, `pe-018` 51, `pe-027` 69).

**One reading on the seed, taken for this review.** Fresh empty file, keyless, no model:

```
KP_SEED_DEMO=1 KP_DB_PATH=<empty temp file> KP_OFFLINE=1 KP_ROLE_RUN_LLM=0 \
  node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
  scripts/kpi/role-demo-run.mjs --approve-gates --sim-interviews 0
```

Without `KP_SEED_DEMO=1` the same command reads `not measured: run cancelled (job_not_found)`
(H13). With it: 4 branches; 3 screened `advance`, approved by the stand-in through the
rejection and invite gates, reached `offer_draft`, and were **declined** ("scorecard
unrated: no interview session"); `pe-018` held for a person at rejection. Autonomous coverage
8/27, `humanStepsOutsideGates` 0, goal verdict `not met`, run end state `running`. So on the
keyless start the goal cannot be met, and the reason is H11, not the engine.

**The smallest honest measure.** No schema change, no new service:

1. Give `role-demo-run.mjs` a `--live` flag that passes `liveRoleRunRunners()` instead of
   `DEFAULT_STAGE_RUNNERS`, and a `--seed` mode that builds the scratch database from an
   empty file under `KP_SEED_DEMO=1` instead of copying the operator's. The seed is then the
   denominator, and the reading is reproducible on any clone.
2. Add one count to the reading: **interventions**, each a closed code: `gate_commit`
   (allowed, the stand-in's), `simulated_interview` (labelled, already counted),
   `retrigger` (each pass after the first that followed a gate commit), and any other act
   the child performs between passes. "Zero manual edits" then means zero interventions
   outside `gate_commit` and `simulated_interview`, read off the harness's own log, which is
   the only place an out-of-ledger act can be seen.
3. Commit the JSON reading (dated, with the head sha) beside the task record, so the KPI
   has a history instead of three prose notes.

## 4. Explainability (key goal 4)

`app/_lib/reasons-coverage.ts` defines a reasons block for three verdict kinds, ranking,
scorecard and rejection (`:37`), and counts one only when it **resolves** to text through
the same renderer the product uses (`:14-22`, `reasonsBlockOf` `:188-250`). Against that
rule:

| Role-run output | Carries | Reasons block? |
| --- | --- | --- |
| Role spec (S0) | `lintFindings` codes (`role-run-engine.ts:114-116`; `role-spec.ts:61-63`) | Not a verdict kind. Codes only, no catalog. |
| Ranking (S1 slate) | `origin` and, for a rediscovery, `priorOutcomeRef` (`slate.ts:93`) | **No.** The slate orders nothing by reason, and a rediscovered entry is filed through `createPipelineEntry` with a score and no explanation (`slate.ts:85-92`), not through Match's sealed `match_verdict` (ADR 0018). |
| Screen proposal (S2) | `reasonCode` + `reasonParams` (`role-run-engine.ts:184-185`; `screen.ts:77-78`) | **Codes, unresolved.** `score_above_floor`, `score_below_floor`, `not_active` and `policy_<action>` are not keys in `decisions.wave.reasons` (checked in `messages/en.json`), which is what `waveReasonText` resolves (`app/_lib/decision-attribution.ts:538-539`). The policy's own rationale is prose and is dropped on purpose (`screen.ts:22-25`). |
| Rejection (gate resolution) | The parked payload copied, plus `decision` and `approverRef` (`role-run-engine.ts:562-571`) | **No.** Nothing is sealed, so no rejection record exists for the meter or the candidate (H10). |
| Scorecard (S5) | `recommendation` + `sessionId` (`role-run-engine.ts:248-252`) | **By reference.** When a session is attached, its sealed scorecard's per-axis evidence is what the meter's scorecard arm reads. `unrated` carries no reason. |
| Offer draft (S6) | `rationaleRef` (`role-run-engine.ts:275`) | **No.** The ref is a hash of run, branch and a constant. No rationale exists for it to refer to. |

## 5. Next deliveries, ranked

Scores are 1 (low) to 5 (high). None of the six needs a schema migration as specified;
where a variant would, it is flagged.

| # | Delivery | Files | Acceptance | Effort / Impact / Risk | Migration |
| --- | --- | --- | --- | --- | --- |
| 1 | **Measure the goal on the seed with the live runners** (section 3, steps 1-3) | `scripts/kpi/role-demo-run.mjs`, `scripts/kpi/role-demo-run-child.mjs`, `scripts/kpi/role-demo-run-reading.mjs`, its `__tests__`, one `.ai/tasks/` reading | `--live --seed` runs from an empty file with no network; the reading names the runner set, the head sha and an interventions count; a fixture test pins that a gate commit is not counted as an intervention and a retrigger is | 2 / 5 / 1 | None |
| 2 | **A recruiter can reach the run**: a GET for a run's state and parked gates, and a job-page panel to start a run, preview and commit a gate (batch per gate), and advance | new `app/api/role-runs/[id]/route.ts` (GET), `app/features/...` job page panel, `messages/{en,cs,de,fr}.json`, `docs/architecture/api-reference.md`, `docs/features/hiring-pipeline/role-run-ledger.md` | Closes H6, H8, H9: a run on `job-001` can be started and every gate crossed from the UI in both themes, with the named-approver refusal shown as a code (H5 stays) | 3 / 4 / 2 | None |
| 3 | **The gate commit calls the board doors and seals** (prior #3's shape: rejection via `runPipelineEntryAction`'s seal-first reject, invite via `createScheduleInvite`, offer via `extendDraftedOffer` / `getOrCreateOpenOffer`) | `app/_lib/role-run-engine.ts`, `app/_lib/role-run-gates.ts`, `app/_lib/pipeline-entry-action.ts`, `app/_lib/schedule-store.ts`, `app/_lib/offers-store.ts`, ADR 0011 amendment | Closes H10 and the rejection row of section 4: an approved gate moves the board, mints the token or offer, and seals one record naming the approver; a refused door leaves the ledger unresolved | 4 / 5 / 4 | None if the run reference stays in the ledger payload (`inviteRef`). Linking `schedule_invites`/`offers` back to a run would be an ALTER, out of loop scope. **Needs the owner's decision first** (ADR 0011 amendment (d); money and data path) |
| 4 | **Role-run outputs say why**: catalog entries for the screen codes, a real rationale behind `rationaleRef` (the scorecard recommendation and band it drew on, as codes), and a role-run arm in the reasons meter | `app/_lib/role-run-engine.ts`, `app/_lib/role-run-producers/screen.ts`, `app/_lib/reasons-coverage.ts`, `messages/{en,cs,de,fr}.json` | Every S2 `reasonCode` the engine or producer can emit resolves in all four locales (a test enumerates them); the meter reports a measured role-run arm | 2 / 3 / 1 | None |
| 5 | **An S3 case producer** that attaches the job's existing dev case, when one exists, instead of `devcaseId: null` | `app/_lib/role-run-producers/case.ts` (new), `app/_lib/role-run-live.ts`, tests | A job with a `dev_cases` row gets its id on every assignment; a job without one keeps the floor's honest `null`; no second lifecycle orchestrator is started | 3 / 3 / 2 | None |
| 6 | **Late applicants reach the run**: decide whether a branch can be added after S1 | ADR 0011 amendment first, then `app/_lib/role-run-stages.ts` transition table and `app/_lib/role-run-engine.ts` | An entry filed after the slate gets a branch on the next pass, under `SLATE_CAP`, without re-running S1 | 3 / 2 / 3 | None, but it changes ADR 0011 §2's "one slate per run": **owner decision** |

Not on the list on purpose: a keyless S5 that rates candidates without an interview. The
only honest basis for a scorecard is a held interview or a work sample, and inventing one
is the fabricated-assessment class ADR 0008 forbids (`role-run-engine.ts:249-251`). H11 is
met by the Claude CLI seat the operator chose on 2026-10-16, labelled as simulated.

## 6. What not to change

- **ADR 0011 §3, the three gates and only three.** Scorecard stays unattended
  (`role-run-engine.ts:228-231`); `screening_review` and `scorecard_review` stay a
  recruiter's escalation, not a gate.
- **ADR 0011 amendments of 2026-10-06.** Gates and a candidate's own acts are not human
  steps for the goal; the stand-in follows a stated policy and only `--approve-gates`
  readings count; the simulated interview runs a short agenda on seed entries only.
- **ADR 0011 §5, the PII rule** at the write door (`role-run-stages.ts:401-451`). Any
  delivery above writes codes and refs, never names or prose.
- **The hold rule.** An automated screen never auto-rejects (`role-run-engine.ts:155-160`);
  the automation pass's fairness backstop stays in the S2 producer (`screen.ts:68`).
- **ADR 0004, keyless degradation.** Every producer falls back to the floor
  (`role-run-producers/index.ts:64-73`); the clock stays off by default.
- **ADR 0017, a human adverse decision is sealed before it commits.** Delivery 3 must seal
  first; a ledger-only rejection today is safe only because it changes nothing.
- **ADR 0019, the knockout decline** is the one automatic decline and is outside the run.
- **ADR 0015, an AI agent on the board is not a person**, and ADR 0030, the shortlist is
  set by people: no run stage writes the shortlist.
- **The named approver** (`operator-approver.ts:36-39`): do not let a placeholder approve.
- **Deferred by the operator:** a council of LLMs as a product evaluator, and KPI verdict
  review. Neither appears above, and neither should be proposed to close H11.
