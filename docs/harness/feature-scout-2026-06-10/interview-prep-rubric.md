# Feature Scout — Interview Prep & Rubric (2026-06-10, re-scan of mined context)

> Total: 4 (1H/2M/1L)
> Prior scan 2026-06-08: 6 findings, Highs shipped, PREP4/PREP6 retired. This re-scan reports only net-new gaps.

## 1. Merge human-only scorecards into the interview compare grid
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/api/interview/compare/route.ts:23` (+ `app/_lib/db.ts:1843` `interviewedForJob`, `app/features/sub_jobs/CompareInterviews.tsx:145`, `app/_lib/interview-prep.ts:121` `getHumanScorecard`)
- **Gap**: This is the documented unshipped deferral from W10/W14 ("merge human scorecards into … CompareInterviews grid — a 2nd-source merge"), explicitly left to this re-scan. The compare route's candidate list comes ONLY from `interviewedForJob`, which reads `interview_sessions WHERE status='completed'` — voice screens. A candidate whose round was human-led (PREP1 scorecard filled, no voice session) is invisible in the side-by-side grid, the exact surface where the hire decision is weighed; `getHumanScorecard` enrichment only fires for candidates who ALSO voice-interviewed.
- **Proposal**: In the compare route, union the voice cohort with the job's pipeline entries (`pipeline_entries WHERE job_id = ?` exists at `db.ts:2002`) that carry a `humanScorecard` on their prep artifact, synthesizing an `InterviewedCandidate` row (scoringModel from the entry archetype via `rubricForArchetype`'s split, null AI fields). `CohortTable` already renders human verdict badges and per-competency ratings, so the client change is mostly "render rows whose AI scorecard is absent". Keep the Decisions `scorecard_review` gate wiring OUT of scope (decision-workflow scout's seam).
- **Why users need it**: A recruiter comparing finalists currently concludes a human-interviewed candidate "wasn't interviewed" — the strongest human signal in the product silently drops out at the decision moment.

## 2. Generate the interview-prep pack in the recruiter's locale
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: M
- **Where**: `pipeline/jobfit/automation.py:366` (`interview_prep` — English prompt, English deterministic fallback) + `pipeline/jobfit/automation_cli.py:75` (no `--lang`); `app/_lib/run-of-show.ts:73-119` and `app/_lib/student-interview.ts:94-110` (hardcoded English topics/goals/scenario/signals); `app/_lib/interview-prep-run.ts:32`
- **Gap**: Opened by i18n (commit 7922fbe). The UI chrome of `InterviewPrepModal` is fully bilingual, but every word of the prep CONTENT — LLM questions, deterministic fallback, run-of-show block titles/goals, scenario line, signals — is generated in English only. Meanwhile the voice agent already detects cs/en (`interview-run.ts:59`), and the sibling CLIs (`cli.py:33`, `market_salary_cli.py:73`, `profile_draft_cli.py:229`) all take `--lang` backed by the shared `pipeline/jobfit/i18n.py`; `automation_cli.py` is the locale-blind outlier.
- **Proposal**: Follow the established analyze pattern (`app/api/analyze/route.ts:80-97`): capture `getServerLocale()` when the `interview_prep` task starts, ride `lang` through the task params into `runAutomationTask` → `automation_cli --lang`, and have `interview_prep`'s prompt request the user's language via `language_name()`. Localize the deterministic templates (run-of-show/student-script strings) via a small lang-keyed string table; persist `lang` in the payload so the modal can disclose mismatches. Scope to the `prep` command only — outreach/rejection comm-template localization is the sim-channels scout's territory.
- **Why users need it**: A Czech recruiter interviewing a Czech candidate gets an English script to read aloud inside an otherwise Czech UI — the one artifact meant to be spoken verbatim is the one that ignores the locale.

## 3. Localize rubric competencies, descriptions and BARS anchors with key-stable labels
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: M
- **Where**: `pipeline/jobfit/interview-rubrics.json` via `app/_lib/interview-rubric.ts:15-47`; rendered raw in `app/features/sub_schedule/HumanScorecardPanel.tsx:114-133` and `CompareInterviews` / `InterviewTranscriptModal` rating rows
- **Gap**: Opened by i18n. Competency names, descriptions and the per-level BARS anchors come from the shared TS+Python JSON and render verbatim on the cs locale — a Czech recruiter fills "Ownership & Initiative" against English behavioral anchors while every surrounding label is Czech. The catch: the competency string is also the JOIN KEY (stored in `ScorecardRating.competency` by both the Python scorer and the human panel, matched across surfaces), so naive translation would corrupt the contract the drift tests (`interview-rubric.test.ts` / `test_interview_rubrics.py`) pin.
- **Proposal**: Keep the canonical competency string as the storage/scoring key and add per-locale DISPLAY fields to the JSON (`label_cs`, `description_cs`, `anchors_cs`; same for `ratingAnchors`), exposed via a `localizedRubric(locale)` helper in `interview-rubric.ts` that falls back to canonical. Render localized labels in HumanScorecardPanel / compare grid / transcript modal while POSTing canonical keys; Python scorer untouched. Extend the drift tests to assert every cs label maps to a canonical key.
- **Why users need it**: The rubric anchors exist precisely to calibrate the human rater ("what a 4 looks like"); anchors the rater half-skims in a second language calibrate worse and make the bilingual rollout feel skin-deep on the scoring surface.

## 4. Stamp author and saved-at on the human scorecard
- **Value**: Low
- **Category**: functionality
- **Effort**: S
- **Where**: `app/_lib/interview-prep.ts:104-117` (`saveHumanScorecard`), `app/api/interview-prep/scorecard` POST; display in `InterviewTranscriptModal.tsx:72-105` (`HumanScorecardSection`) and `CompareInterviews.tsx:221`
- **Gap**: Net-new seam from PREP1 (W10) + PREP5 (W16) shipping separately: the prep artifact knows the assigned `interviewer`, and the scorecard sits one key away in the same payload, yet the saved scorecard records neither who filled it nor when — surfaces show the generic "Recorded by a recruiter from the interview prep rubric", and a re-save silently overwrites with no trace. (Multi-panelist scorecards are a larger follow-on, explicitly not proposed here.)
- **Proposal**: In `saveHumanScorecard`, stamp `{ author: payload.interviewer ?? null, savedAt: new Date().toISOString() }` onto the stored scorecard (the `Scorecard` type already tolerates additive optional fields); render "by {author} · {date}" in `HumanScorecardSection`, the compare-grid human block, and the drawer.
- **Why users need it**: A hire/reject artifact without attribution or a date is weak in any debrief or audit — and the data needed to fix it is already on the same DB row.

---
## Cross-checks performed
- Read prior report `feature-scout-2026-06-08/interview-prep-rubric.md` (PREP1–PREP6) + `INDEX.md` (backlog-retired banner) + `harness-learnings.md` W3/W5/W10/W14/W16 entries before scanning; confirmed PREP1/2/3/5 shipped and PREP4/PREP6 retired — none re-proposed.
- Finding 1: read `app/api/interview/compare/route.ts` + `db.ts:1843-1880` (`interviewedForJob` reads `interview_sessions` only) + `CompareInterviews.tsx` (renders `data.candidates` as-is) — human-only candidates verifiably absent; W14 note confirms this exact deferral. The Decisions `scorecard_review` gate half was explicitly EXCLUDED (decision-workflow scout's seam).
- Finding 2: grepped `lang|locale` across `app/_lib` + `pipeline/jobfit`; `automation_cli.py:75-85` has no `--lang` while `cli.py`/`market_salary_cli.py`/`profile_draft_cli.py` do; `automation.py:366-426` prompt + deterministic fallback are English; `run-of-show.ts`/`student-interview.ts` template strings hardcoded English; analyze's locale-forwarding precedent at `app/api/analyze/route.ts:80-97`. Comm-template localization (outreach/rejection) deliberately left to the sim-channels scout.
- Finding 3: grepped `messages/{en,cs}.json` for rubric content — only chrome (headings/aria) is translated; `interview-rubric.ts` imports the shared JSON raw; confirmed competency strings are storage keys in `ScorecardRating` (interview-scorecard.ts) and CI-pinned by the TS/Python drift tests. Distinct from retired PREP6 (anchor DISPLAY in the prep modal — anchors now show in HumanScorecardPanel anyway).
- Finding 4: read `saveHumanScorecard` + the scorecard POST route + `HumanScorecardSection`/compare-grid render paths — no author/savedAt anywhere; `interviewer` confirmed adjacent on the same payload. Checked it against shipped PREP5 (schedule-card assignment only) — the scorecard linkage was never built or deferred-tracked.
- Also checked and NOT reported: copy-prep (PREP3) omitting notes/scorecard (extension of a shipped item, weak standalone value); notes→evidence seeding (a sketch line inside shipped PREP2 — re-warming); VOX2 (retired); question bank (retired PREP4).
