# Feature Scout — Automation Orchestration (2026-06-10)

> Total: 6 (3H/2M/1L)

## 1. Auto-score unscored applicants so the funnel's front door actually automates
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `pipeline/jobfit/automation.py:159-167` (Accepted branch holds on "awaiting match score"), `app/api/apply/[id]/route.ts:265-285` (entry created with NO matchScore), `app/_lib/db.ts:1947-1961` (`match_score` is INSERT-only — no UPDATE path exists anywhere), `app/_lib/automation-pass.ts:67-70`
- **Gap**: Every inbound applicant (conversational apply, `sim/inbound`) lands in `Accepted` with `matchScore: null`. The policy pass deterministically holds them ("accepted; awaiting match score") and **no automated step ever computes that score** — `match_score` is written only at entry creation, batch-screen filters `stage === "Screened"`, and the Match tab scores profiles without writing back to pipeline entries. Inbound applicants are permanently deadlocked at the first automation gate unless a recruiter manually re-files them.
- **Proposal**: Add a `setEntryMatchScore(entryId, score)` UPDATE helper (+ a `scored` pipeline event) and an LLM-free scoring step: either best-effort at apply-acceptance (the route already has the built V2 profile and the job — one `score_job` hop via `match_cli`), or as a pre-policy sweep inside `executeAutomationPass` over unscored, non-degraded `Accepted` entries. Deterministic, sub-second, cache-free; intake-degraded stubs stay held for manual capture.
- **Why users need it**: The whole point of "post a job, let automation triage applicants" collapses today at step one — applicants pile up in Accepted and every pass reports them as held, forever.

## 2. Persist and surface what each pass decided (run history + per-entry decision log)
- **Value**: High
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/_lib/automation-pass.ts:85-157` (the `decisions[]` with per-entry action+reason is returned then dropped), `app/_lib/scheduler-store.ts:187-216` (`recordRun` stores summary only), `app/api/automation/schedule/route.ts:10` (`runs: listRuns(10)` already shipped to the client), `app/features/sub_pipeline/SchedulerControl.tsx:10-16` (Summary type drops `errors`/`evaluated`; the `runs` payload is never read), `app/features/sub_pipeline/PipelineTab.tsx:88-93,314-319`
- **Gap**: The pass computes a full per-entry decision log — action, target stage, alerts, and a human-readable `reason` — and throws it away on every path: the clock stores only the 6-count summary, SchedulerControl ignores the `runs` array its own GET already returns, and PipelineTab renders 4 of the 6 summary counts (`errors` and `evaluated` are invisible). Crucially, `hold` decisions record **no pipeline event at all**, so "why is this candidate held?" is answerable for one manual run only, then lost.
- **Proposal**: Persist `decisions` alongside the summary in `scheduler_runs` (fold into `summary_json` or an additive column), then add an expandable "Run history" panel under the Automation clock: last ~10 runs with trigger/status/SummaryBadges (extended with `errors` + `evaluated`), each expanding to its decision rows (candidate, action, reason, fairness-refusal alerts highlighted). Reuse `SummaryBadges`/`useRelativeTime`; en+cs strings via the existing `pipeline.scheduler` catalog.
- **Why users need it**: Recruiters are being asked to trust an automation that advances and rejects real candidates while offering no record of what it did or why — the audit trail exists in memory every pass and is discarded.

## 3. Dry-run preview before the policy pass commits (mirror the shipped screening-wave pattern)
- **Value**: High
- **Category**: feature
- **Effort**: M
- **Where**: `app/_lib/automation-pass.ts:59-65` (`runAutomationPass` has no preview mode), `app/features/sub_pipeline/PipelineTab.tsx:310-330` ("Run pass" fires immediately), precedent: `app/_lib/screen-wave.ts` `dryRun` + `app/features/sub_decisions/ScreenWaveModal.tsx` (DEC2, shipped W8)
- **Gap**: A policy pass auto-rejects BAU sub-40 entries and **sends the rejection email** in the same breath — yet unlike the screening wave (which got a mandatory dry-run preview in W8 because it's "irreversible and email-sending"), the pass commits on first click and the clock runs it sight-unseen. `evaluate_entry` is pure, so the preview is nearly free.
- **Proposal**: Add `runAutomationPass({ dryRun })` that runs the identical snapshot→Python→decisions flow but skips the apply/dispatch loop and returns annotated decisions; accept `{dryRun:true}` on `POST /api/automation/run`. In PipelineTab, make "Run pass" open a small preview modal (would-advance / would-reject / held with reasons, reject rows prominent) with an explicit "Apply N changes & notify" commit — same interaction grammar as ScreenWaveModal. Doubles as the "what will the clock do if I enable it?" answer.
- **Why users need it**: This is the only remaining irreversible, candidate-emailing automation without a preview gate; one click on a stale board mass-rejects with no look-before-commit.

## 4. Expose the POLICY thresholds as a validated config surface
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where**: `pipeline/jobfit/automation.py:35-45` (`POLICY` dict, "tunable per market" per spec — but hardcoded), `pipeline/jobfit/automation_cli.py:89-92` (policy-pass accepts no policy override), `app/_lib/decision-config-schema.ts:29` (`KNOWN_DECISION_PHASES = ["screening"]` — store + validate-and-clamp pattern ready to extend), `app/features/sub_pipeline/PipelineTypes.ts` (`STAGE_SLA_DEFAULTS`)
- **Gap**: All nine automation knobs (advance/reject score floors, settle days, stale/aging days, rematch floor/cap, confidence gate) are frozen in Python; the spec itself calls them "tunable per market" but no route, store, or UI can change them. Worse, W16's PIPE4 shipped *display-only* per-stage SLAs in localStorage, so the board's "aging" chips and the pass's `stale_alert`/`aging_alert` now run on two unrelated thresholds that silently disagree.
- **Proposal**: Add a `policy` phase to the decision-config store (bounded numeric fields, clamped server-side exactly like `ScreeningRule`; fairness invariants — early-career gate, reject-floor semantics — stay non-configurable). Thread overrides into the pass via a `--policy-json` arg merged over `POLICY` in `automation_cli`, and a compact editor popover beside SchedulerControl. Optionally source the pass's stale/aging from the same per-stage SLA values the board shows, healing the PIPE4 drift.
- **Why users need it**: A 40-point auto-reject floor tuned for one market/season is wrong for another; today the only "config" is editing Python. (Distinct from archived DEC5 — that was per-role rule keying; this is the global pass contract.)

## 5. Per-candidate automation pause ("I'm handling this one manually")
- **Value**: Medium
- **Category**: feature
- **Effort**: S
- **Where**: `app/_lib/db.ts:2060-2082` (`listActiveEntriesForAutomation` takes every active entry — no opt-out), `app/_lib/tasks.ts:59-77` (`batchScreen` likewise), `app/features/sub_pipeline/CandidateDrawer.tsx` (no pause control); in-repo precedent: `app/_lib/dev-control.ts:71-76` (the dev-case orchestrator's `autonomy: on|paused` kill switch)
- **Gap**: Automation granularity is all-or-nothing: the only ways to keep the pass's hands off one candidate are disabling the entire clock or hoping the 24h `recentScreening` guard happens to cover them. A recruiter mid-negotiation, or honoring a "please hold my application", can have the clock advance or aging-alert that entry underneath them.
- **Proposal**: Additive `automation_paused` column on `pipeline_entries` + a pin/pause toggle in the CandidateDrawer header (and the entry's History records `automation_paused`/`resumed` events). `listActiveEntriesForAutomation` and `batchScreen` filter paused entries; the pass reports them as a distinct "paused" decision so the run log (idea #2) shows they were deliberately skipped, not missed.
- **Why users need it**: Human-in-the-loop today means racing the clock; an explicit per-candidate pause is the standard ATS escape hatch and makes enabling the scheduler feel safe.

## 6. Register the interview-reminder sweep as a visible scheduler job
- **Value**: Low
- **Category**: user_benefit
- **Effort**: S
- **Where**: `instrumentation.ts:40-48` (reminders run every 60s tick, unconditionally, console-only), `app/_lib/interview-reminders.ts`, `app/_lib/scheduler-store.ts:10` (the `scheduler`/`scheduler_runs` tables are already name-keyed; only `POLICY_JOB` exists)
- **Gap**: The second automation the heartbeat drives — candidate-facing interview reminders — bypasses the entire orchestration surface: no enable toggle, no cadence, no durable run record, no UI trace. It "surfaces automation status across the funnel" nowhere; failures live only in server logs.
- **Proposal**: Create a `reminders` job row (default ON to preserve behavior), have the tick consult `claimDueRun("reminders")` and `recordRun({job:"reminders", summary:{sent,failed}})`, and show a second row/line in SchedulerControl (or the run-history panel from idea #2) for the reminders job.
- **Why users need it**: Recruiters can't currently confirm reminders are going out — the most candidate-visible automation in the app is the least observable one.

---
## Cross-checks performed
- Read `feature-scout-2026-06-08/INDEX.md` + `pipeline-board-scheduler.md`, `harness-learnings.md`, `AUTOMATION_SPEC.md`, `AUTOMATION_EVAL.md`, `ui-bug-scan-2026-06-08/automation-orchestration.md` (all 4 findings there are CLOSED — none re-proposed; per-decision error isolation, outreach idempotency, expectedStage CAS, clock fixes all confirmed shipped and avoided).
- **#1**: grepped `matchScore|match_score` across `app/` — `match_score` appears only in INSERTs (`db.ts:1531,1947`); no `SET match_score`/`updateMatchScore` anywhere; `app/api/apply/[id]/route.ts:265` passes no score; `batchScreen` (tasks.ts:60) filters `stage==="Screened"` so unscored Accepted entries are untouched by every automation path.
- **#2**: confirmed `SchedulerControl.tsx` fetches `/api/automation/schedule` but reads only `p.schedule` (line 110) — the `runs` array in the same payload is dead; `PipelineTab.passSummary` type (lines 88-93) omits `errors`/`evaluated`; `recordRun` (scheduler-store.ts:197-208) persists summary but never `decisions`; `hold` decisions record no event (automation-pass.ts:137-139 only counts). Partial overlap with **archived PIPE6** (run-history panel, Low, backlog retired 2026-06-08) — this subsumes it; the decision-log half is new. ui-bug-scan #4's fix added `evaluated` to the summary/run log (closed) — this is about *rendering* the history + decisions, not the counter.
- **#3**: grepped `dryRun` — exists only in `screen-wave.ts`/`ScreenWaveModal` (DEC2, shipped); `runAutomationPass` and `/api/automation/run` have no preview path; `PipelineTab.runPass` POSTs unconditionally.
- **#4**: `KNOWN_DECISION_PHASES = ["screening"]` is the store's only phase; `automation_cli.py` policy-pass takes only `--entries-json`; no TS reference to POLICY values besides `SCREENING_OVERRIDE_GUARD_HOURS` (db.ts:2048). DEC5 (per-role rules) is archived and distinct (per-role keying vs global thresholds); MAT1 (shipped) covers match weights only.
- **#5**: grepped `pause|paused|opt.?out|exclude` in `app/_lib` — only `dev-control.ts` (dev-case domain) has a pause concept; `listActiveEntriesForAutomation` filters solely `status='active'` + recentScreening.
- **#6**: `sendDueInterviewReminders` has exactly one caller (`instrumentation.ts:44`), outside `claimDueRun`/`recordRun`; only `POLICY_JOB` is ever ensured in the scheduler table.
- Dropped as dedup-collisions: scheduler run-history *alone* (archived PIPE6 — folded into #2 with the new decision-log core); offer expiry (archived SCH3, Scheduling context, not automation-task shaped); per-role decision rules (archived DEC5).
