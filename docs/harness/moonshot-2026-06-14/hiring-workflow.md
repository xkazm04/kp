> Moonshots: 5 (Tier1/2/3: 3/2/0)

# Hiring Workflow & Decisions — Moonshots

**Cluster question**: *how well do we run the funnel from match → decision → interview → offer, and how good (and defensible) is the human/AI decision quality inside it.*

## What genuinely exists today (grounding read)

This cluster is already unusually disciplined about *correctness of a single decision*, which is exactly why the moonshots must aim past "more workflow polish":

- **A fail-closed, tie-safe, CAS-guarded auto-reject.** `app/_lib/screen-wave.ts` + `decision-config-schema.ts`: the screening wave rejects only the bottom-% *below* a match threshold, never an early-career or unknown archetype (`isFairnessProtected`, fail-closed), never splits a tied score (`tieSafeBottomCount`), commits via optimistic `expectedStage` CAS (`actOnPipelineEntry`), and writes a byte-stable English audit rationale plus a localized structured mirror. Dry-run preview computes the full verdict and commits nothing.
- **A comparative group evaluation with a cross-scheme fairness matrix.** `group-eval-run.ts` → `pipeline/jobfit/group_compare.py`: ranks a capped field, re-scores every candidate under *every other candidate's* bounded dynamic weights (`fairness`), derives role-relevant differentiators (`computeDifferentiators` — matched requirement skills no rival has), risks, and an LLM "compare all" narrative with a deterministic fallback. Persisted per role.
- **A durable, clock-driven policy automation layer.** `scheduler.ts`/`scheduler-store.ts`/`automation-pass.ts`: single-flight, `claimDueRun` CAS so a restart can't double-fire, dry-run parity, per-run decision audit (`scheduler_runs.decisions_json`), per-day alert dedup in business-TZ.
- **A three-tier grounded interview + dual scorecard.** Voice runtime (`interview-run.ts`, OpenAI Realtime / ElevenLabs adapters) grounds the brief in submission-debrief > case-designed > student-script > prep; server-enforced consent at `/connect` *and* `/complete`; transcript→scorecard synthesis with archetype rubric, **every rating must quote near-verbatim candidate words**, and an honest confidence band (`_scorecard_confidence`). A human scorecard (`HumanScorecardPanel`) sits beside the AI one on the same rubric.
- **A token-gated scheduling + offer flow.** Collision-safe slot claim, RSVP, expiry-as-forcing-function, bounded reminder retry; offer accept→Hired→onboarding with idempotent CAS.
- **One attribution map + paged audit log.** `decision-attribution.ts` folds every event kind into auto/human/unknown (unknown never defaults to auto — accountability is never misattributed); `DecisionLog.tsx` pages + filters + CSV-exports the full trail.

**The structural gap every moonshot attacks:** the system is *correct per decision* but has **no memory that a decision was right, no standard a human interviewer is held to, no portable proof of why a person was rejected, and no orchestration above the single candidate.** It is a beautifully-audited *opinion*, never *measured, standardized, defended, or planned*. That is the category-defining opening — and it is distinct from the sibling "Candidate Intelligence" calibration play, which measures *scores*; this cluster measures and governs *decisions and the humans making them*.

---

## 1. **The Hiring Decision System of Record — every consequential decision becomes a signed, replayable, defensible artifact**
- **Tier**: 1 (10x category-defining)
- **Category**: decision-system-of-record
- **Impact**: Today a rejection is a `recordAutomationEvent("auto_rejected", rationale)` row and a wide `interview_preps`/`offers` row — state, not *proof*. There is no actor identity, no input snapshot, no signature, no "show me, under oath, exactly why this person was passed over and on what facts." The 10x change: every consequential decision (auto-reject, group-eval lead, scorecard verdict, offer terms) is sealed into an immutable, hash-chained **Decision Record** capturing the inputs it saw, the policy version, the rationale, the actor (human vs which model/prompt version), and a tamper-evident signature — and the whole chain is one-click exportable as a defensibility dossier per candidate or per role. This is the thing an employer's lawyer, an EU AI Act auditor, or a rejected candidate's "right to explanation" request actually needs, and no ATS or AI-screener can produce it.
- **Feasibility**: high — the rationales, structured reason codes, `promptVersion`s, fairness gates, and event stream already exist and are *deliberately* stable; the missing piece is sealing them into a chained, signed, queryable record instead of scattered rows.
- **Time-horizon**: months
- **Why it's a moonshot**: it reframes the product from "a recruiting tool that logs things" into "the legal system of record for who got hired and why" — the layer everything else must write through. Audacious because it makes the company *liable for and proud of* its decisions: falsifiable, exportable, court-grade. That liability-as-feature is the moat; incumbents whose decisions live in mutable rows can't follow without admitting theirs were never provable.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: `screen-wave.ts` already builds a fully-structured verdict per candidate (`ScreenDecision`: action, `rationale`, `reasonCode`, `reasonParams`, matchScore, archetype) and `decision-attribution.ts` already classifies every kind as auto/human. Add a `sealDecisionRecord()` writer (a sibling isolated-connection store like `group-eval.ts`/`decision-config-store.ts`) that, at the existing `recordAutomationEvent` call sites, persists a row carrying `{prevHash, contentHash, kind, actor, policyVersion, inputsSnapshotRef, rationale, reasonCode}` — the hash chain bootstrapped from data that already flows through that exact line.
  2. Backfill the other writers: group-eval lead (`group-eval-run.ts`), human + AI scorecard (`interview-prep/scorecard/route.ts`, `attachInterviewScorecard`), offer terms (`offer-finalize.ts`) all seal a record at their decision point.
  3. Stamp actor provenance: human (recruiter action) vs auto (which model + `promptVersion`, already emitted by the Python scorecard/`group_compare` as `scorecard-v3`/`group-compare-v2`).
  4. Build the dossier export beside `DecisionLog.tsx`'s existing CSV path: a per-candidate / per-role "Decision Dossier" PDF/JSON with the chain, the inputs each decision saw, and a verify-chain button.
  5. Expose a candidate-facing "why" endpoint (token-gated, mirrors `offer/[token]`) that renders the sealed rationale for that candidate only.
- **Dependencies**: the existing event stream + structured reason codes (have them); a stable hash of the inputs snapshot (analysis/profile rows already content-addressable by candidate).
- **Risks**: scope creep into a full append-only ledger DB (mitigate: hash-chain in SQLite, don't build a blockchain); rationale strings must stay stable (they already are, by test).
- **What changes if we ship it**: every "no" the platform produces is provable and portable. The product can sell "EU AI Act / Title VII defensibility out of the box," and a candidate's right-to-explanation request is a one-click export instead of a legal panic.

## 2. **Structured-Interview-as-a-Service — interviewer calibration with measured inter-rater reliability**
- **Tier**: 1 (10x category-defining)
- **Category**: trust-layer
- **Impact**: The single largest source of bad hires is unstructured, uncalibrated human interviewing — and this cluster has *all the primitives and uses none of them as a system*. Rubrics are single-sourced and archetype-driven (`interview-rubric.ts`), the AI scorecard already grounds every rating in a verbatim quote with a confidence band, and the run-of-show (`run-of-show.ts`) already defines a timed, checkable protocol. But each human interviewer fills `HumanScorecardPanel` *in isolation* — no calibration, no inter-rater agreement, no drift detection, no enforcement that the run-of-show was followed. The 10x change: turn the human side into a *measured instrument*. The AI scorecard becomes a calibration anchor; the system computes per-interviewer agreement vs the AI and vs peers on the same candidate, flags raters who systematically inflate/deflate a competency, runs blind re-scoring of past transcripts, and certifies an interviewer as "calibrated on competency X." Structured interviewing stops being advice and becomes a guarantee with a number on it.
- **Feasibility**: medium — both scorecards already share one rubric and one 1–5 scale with the same competency keys; the AI scorecard is the ground-truth-ish second rater; what's missing is the agreement math and the per-interviewer rollup.
- **Time-horizon**: months
- **Why it's a moonshot**: it attacks the part of hiring everyone *knows* is broken (the human in the loop) with something nobody ships — a falsifiable reliability score per interviewer. Audacious because it tells customers their own interviewers are inconsistent and then proves it; that honesty, backed by the verbatim-evidence requirement already in the scorecard, is the trust moat.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: `app/api/interview/compare/route.ts` already unions AI scorecards and human-only scorecards for one job, keyed by the SAME rubric and `scoringModel`. Add a pure `interrater.ts` that, given the AI + human ratings already returned there, computes per-competency delta and a simple agreement statistic (exact-match rate / weighted kappa) — zero new data, just math over what `compare` already assembles.
  2. Persist per-rater rollups: extend the scorecard save (`interview-prep/scorecard/route.ts`) to stamp interviewer identity + a timestamp per rating (today only `source:"human"` is stored), so drift can be tracked over time.
  3. Add a "calibration round": serve a past transcript (the voice runtime already stores transcripts) and ask the interviewer to re-score blind; compare to their original and to the AI anchor.
  4. Surface an "Interviewer Calibration" panel: per-rater bias-by-competency, agreement trend, and a "certified-calibrated" badge gating who can score which competency.
  5. Feed disagreement back into the run-of-show: when human and AI diverge on a competency, the next prep auto-injects a sharper probe for it.
- **Dependencies**: interviewer identity on scorecards (small add); enough completed dual-scored interviews (AI scorecard already auto-generates one per voice interview).
- **Risks**: AI-as-anchor is imperfect (mitigate: treat as a second rater, surface disagreement, never auto-override the human); interviewers resenting being measured (frame as certification, not surveillance).
- **What changes if we ship it**: the platform can promise "every interview on kp is structured, and every interviewer is measurably calibrated" — and prove it per role. Interview quality becomes a SKU.

## 3. **The Outcome-Closed Decision Loop — every reject/advance/offer is scored against what actually happened, and the policy tunes itself**
- **Tier**: 1 (10x category-defining)
- **Category**: foundational-primitive
- **Impact**: The funnel emits thousands of decisions (`auto_rejected`, `advanced`, `held`, group-eval lead, offer terms) and *never learns whether any of them was right*. The `expectedStage` CAS, the fairness backstop, the bottom-% threshold, the offer salary — all are configured by a human and frozen. The 10x change: close the loop. Join every decision to its downstream outcome (the advanced candidate's eventual scorecard verdict, the offer's accept/decline, the auto-rejected cohort's would-have-been signal via the reconsider queue) and continuously answer: *was the bottom-20%/45-threshold cutoff right? Did the group-eval lead actually win? Are we auto-rejecting people who'd have aced the work sample?* The policy stops being a guess and becomes a self-tuning, outcome-validated instrument with proposed (human-approved) threshold changes.
- **Feasibility**: medium — outcome labels (offer accept/decline, scorecard verdicts, hires) and the original decisions both already persist; dev-case already has a calibration store (`dev-outcomes.ts`, `recordPipelineOutcome` fires on reject/accept). The pattern exists; it just isn't applied to the screening/group-eval policy.
- **Time-horizon**: months
- **Why it's a moonshot**: it turns the auto-reject from the product's scariest feature (an irreversible "no" on a frozen heuristic) into its most-trusted (a "no" the system can show has been right N% of the time and adjusts when it isn't). Audacious because most screeners would rather not know their false-reject rate; publishing and acting on it is the differentiator.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: `dev-outcomes.ts` already records pipeline outcomes for `ds-` entries and is consumed by a calibration loop. Generalize its `recordPipelineOutcome` to fire for *every* terminal transition in `actOnPipelineEntry` (reject/decline/hired), writing `(decisionKind, score, threshold, outcome)` — the first decision→outcome dataset, from columns that already exist.
  2. Add a `pipeline/jobfit/eval/decision_eval.py` beside the existing golden-set harness (`automation_eval.py`, `thresholds.py`) that computes false-reject / lead-hit / offer-accept rates per role-family.
  3. Wire the **reconsider queue** (already proposed/exists) as the false-reject probe: periodically re-surface a sample of auto-rejected candidates for a cheap re-look and treat overturns as ground-truth misses.
  4. Surface a "Decision Accuracy" panel in `sub_analytics` (sits beside `analytics/decisions`): cutoff accuracy, lead-hit rate, offer-accept rate, with confidence intervals.
  5. Propose (never auto-apply) threshold adjustments into `DecisionRulesModal` — "your 45 threshold has a 12% false-reject rate; suggest 40," human-approved.
- **Dependencies**: a trickle of real outcomes (already logged); the reconsider queue as the false-reject sampler.
- **Risks**: thin outcome volume on demo corpora (mitigate with the eval golden set as synthetic ground truth + honest "uncalibrated" labels); the loop must propose, not auto-tune irreversible rejections.
- **What changes if we ship it**: the auto-reject earns its trust with a measured track record, and the platform's policy improves itself instead of aging. "Our screening has a published false-reject rate and it's falling" is a claim no incumbent can make.

## 4. **Requisition Orchestrator — plan, predict, and auto-remediate the funnel above the single candidate**
- **Tier**: 2 (3-5x)
- **Category**: books-become-action
- **Impact**: Every primitive in this cluster operates on one candidate-entry. The scheduler runs a per-entry policy pass; there is no *role-level* plan, no target hire date, no time-to-fill prediction, no capacity model, no bottleneck auto-remediation (interviews queue on a default "Tue 14:00" slot with no interviewer-conflict check or load balancing). The 3-5x change: a requisition-level orchestrator that, per open role, sets a target hire date, predicts time-to-fill from current stage velocity (the pipeline already tracks `stage_changed_at`/`daysInStage`), detects the binding bottleneck (interview scheduling is the obvious one given the hard-coded slots), and *acts* — proposing screening-wave runs to refill a thin Screened stage, expanding slot horizons when `needs_more_slots` fires, escalating aging entries, and balancing interview load across interviewers.
- **Feasibility**: medium — `daysInStage`, the events feed, `scheduler-store`, the `needs_more_slots`/`needs_reconcile` operator flags, and the automation pass all exist; the orchestrator is a new policy layer *over* them, not new plumbing.
- **Time-horizon**: months
- **Why it's a moonshot**: it lifts the product from "an excellent per-candidate decision engine" to "a hiring operations system that runs the plan," which is the buyer the per-candidate tool can't reach (the head of talent, not the recruiter). Audacious because it commits to a *predicted* hire date and is accountable to it.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: `automation-pass.ts`'s `listActiveEntriesForAutomation()` already returns every active entry with `daysInStage`. Add a pure `requisition-health.ts` that groups those by job and computes per-role stage counts, median time-in-stage, and a naive time-to-fill projection — a read-only rollup over data the pass already gathers, surfaced first as a panel.
  2. Add per-role targets (target hire date, headcount) to the job record (`db/jobs.ts`) and compute on-track / at-risk.
  3. Detect the binding bottleneck (stage with the worst velocity-vs-inflow) and emit a structured remediation suggestion per role.
  4. Turn suggestions into one-click actions reusing existing endpoints: run screening wave, widen slot horizon (`schedule-slots.ts` `SLOT_HORIZON_DAYS`), escalate aging entries.
  5. Add interviewer capacity + conflict checking to slot proposal so two candidates can't be booked into the same interviewer-hour.
- **Dependencies**: per-role targets on the job record; interviewer identity for capacity (overlaps with #2).
- **Risks**: time-to-fill prediction is noisy on small pools (label honestly, widen bands); over-automation of remediation (keep human-in-the-loop, propose not execute for anything candidate-facing).
- **What changes if we ship it**: a hiring manager opens kp and sees "Senior Backend: on track, fills in ~11 days; bottleneck is interview scheduling, here's the fix" — the product runs the funnel, not just the decisions in it.

## 5. **Adaptive, Fact-Checking Voice Interviewer — the brief stops being frozen and starts probing what the answers reveal**
- **Tier**: 2 (3-5x)
- **Category**: interface-expansion
- **Impact**: The voice runtime is excellent but its brief is *frozen at mint time* — the agent reads a pre-composed run-of-show and never adapts to the candidate's actual answers, never verifies a claim against the CV, never re-allocates depth. Telemetry (`interview-telemetry.ts`) already measures hint uptake, talk ratio, and response gaps *after the fact*, but nothing acts on them live. The 3-5x change: a brief that adapts mid-call — when a candidate's answer is thin on a must-have, the agent probes deeper instead of moving on; when they assert a CV claim ("3 years Kubernetes"), the agent grounds the next question in it and the scorecard later checks whether the answer actually substantiated the claim (claim → observed-evidence verification, feeding the existing `mintObservedFromCaseInterview` provenance upgrade).
- **Feasibility**: medium — the grounded-brief composition (`interview-run.ts`), the case-grounded phase model, the verbatim-evidence scorecard, and observed-skill minting all exist; adaptivity means making the brief a live state machine rather than a static string, which the OpenAI Realtime data-channel already supports per-turn.
- **Time-horizon**: months
- **Why it's a moonshot**: it turns a scripted screen into something closer to a great human interviewer — pursuing the thread that matters — while *increasing* comparability via the fixed case-grounded phases that stay immutable. Audacious because adaptive + fair is the tension everyone avoids; the existing case-grounded/personal-phase split is exactly the structure that lets adaptivity live only in the personal phases.
- **Path to implementation**:
  1. **STEP 1 (in scaffold)**: `interview-telemetry.ts`'s `extractTelemetry` already classifies hint uptake and computes coverage signals over a transcript. Add a pure `interview-coverage.ts` that, given the live partial transcript + the brief's target competencies, returns which must-haves remain unprobed or thinly-answered — a deterministic "what to dig into next" signal computed from data the runtime already has mid-call.
  2. Feed that signal into the OpenAI adapter's per-turn instruction (`voice/openai.ts` already sends server-side instructions) to nudge a deeper follow-up — only within personal/adaptive phases, never the immutable case-grounded ones.
  3. At completion, add claim-verification to the scorecard synthesis: cross-check CV skill claims against whether the transcript substantiated them, emitting a `verified / asserted-but-unsubstantiated` per claim.
  4. Route a substantiated claim into the existing observed-provenance upgrade (`mintObservedFromCaseInterview` pattern) so a proven skill compounds into the candidate's match.
  5. Surface coverage + verification in the transcript modal so the recruiter sees what was and wasn't probed.
- **Dependencies**: per-competency targets on the brief (the prep already carries focus areas + competencies); the case-grounded/personal phase split (exists) to bound where adaptivity is allowed.
- **Risks**: adaptivity eroding comparability (mitigate: confine to personal phases, keep case-grounded phases byte-identical); LLM over-probing/derailing (cap follow-up budget per competency).
- **What changes if we ship it**: the AI screen pursues the right thread and *checks* the candidate's claims, so the scorecard reflects what was demonstrated rather than asserted — and proven skills flow back into the match as observed evidence.

---

### Cross-cutting note
Moonshots **1 (sealed Decision Records)** and **3 (outcome loop)** are mutually reinforcing: the sealed record is the substrate the outcome loop joins against, and the outcome loop is what makes the record *worth* sealing. **2 (interviewer calibration)** and **5 (adaptive interviewer)** both write through the scorecard, so a shared "interviewer identity + per-rating timestamp" extension to `interview-prep/scorecard/route.ts` unblocks both. All five deliberately avoid the sibling Candidate-Intelligence calibration play: that one measures *scores*; this cluster measures and governs *decisions, the humans making them, and the funnel running them*.
