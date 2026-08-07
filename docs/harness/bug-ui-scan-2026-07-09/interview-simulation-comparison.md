# Interview Simulation & Comparison — bug-hunter + ui-perfectionist scan

> Context: Simulate an interview round, attach simulated outcomes to a candidate, compare interviews, and produce interview recommendations (incl. student mode).
> Files reviewed: 7 of 9 (both *.test.ts sampled) + 4 dependency files (db/interviews, db/pipeline, interview-prep, proxy)
> Total: 5

Sim-leak probe result (grounded): every `interview_sessions` reader keys on `entry_id` / `job_id` / `id` / `token` (grep-confirmed), and a sim session is minted with both `entryId` and `jobId` null, so it is correctly excluded from `interviewedForJob` (compare) and from the entry-status readers. There is **no** global aggregate reader, so unlike the `/api/sim/apply-cv` sibling leak there is no analytics double-count here. But the sim is distinguished only by that null-key convention — no explicit flag — which is the root of finding 3. Charging the sim to the real minute meter is deliberate (documented in `simulate/route.ts:59-63`), so not reported. All three routes are recruiter-gated (`proxy.ts` exposes only `connect`/`complete`), so no anonymous meter-burn.

## 1. Off-taxonomy `scoringModel` renders a candidate with a silent, ratingless cohort table

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/features/sub_jobs/CompareInterviews.tsx:184-206`, `app/_lib/db/interviews.ts:70`
- **Scenario**: A stored/synthesized voice scorecard carries a `scoringModel` that is not a rubric key — LLM drift, a hyphen variant (`"early-career"`), a legacy value, or a future cohort — for one candidate on the job.
- **Root cause**: The grid groups by `c.scoringModel` and looks up its rubric with `data.rubrics[model] ?? []`. `scoringModel` is trusted verbatim from stored JSON (`sc.scoringModel ?? "experienced"`) with no validation against the rubric catalog; the `?? []` swallows any mismatch, so `CohortTable` iterates zero competency rows.
- **Impact**: The candidate appears in compare with their name/verdict header but **no ratings at all** and no "unrecognized rubric" notice — indistinguishable from a genuinely un-scored candidate, at the hire-decision surface.
- **Fix sketch**: Coerce `scoringModel` to a known cohort (or an explicit `unknown` bucket) at the DB boundary; when `rubrics[model]` is empty, render an "scored on an unrecognized rubric — not comparable" banner instead of an empty `<tbody>`.

## 2. Ratings join the rubric by exact competency name, so rubric-version drift silently blanks real scores

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/features/sub_jobs/CompareInterviews.tsx:57-58,131-146`; `app/api/interview/compare/route.ts:53-56`
- **Scenario**: Two candidates in the same cohort were scored months apart; the rubric competencies were renamed/revised between them (the code itself references "pre-v3 scorecards", so axis evolution has happened).
- **Root cause**: `ratingOf` matches `r.competency` case-insensitively against the **current** `INTERVIEW_RUBRICS[model]` names. The scorecard carries `scoringModel` but **no rubric version**, so a rating stored under an old axis name matches nothing and the cell shows `—`. Two sessions scored under different rubric versions are placed in one table as if commensurable.
- **Impact**: A fully-assessed older candidate renders mostly `—` beside a newer peer, reading as "not interviewed" — a silently wrong side-by-side at the exact point a hire is weighed. (The evidence list below the grid still shows the old ratings, partially masking the bug.)
- **Fix sketch**: Stamp a rubric version onto each scorecard; render each candidate against the rubric they were scored on, or flag "scored on rubric vX (different axes)" when versions differ rather than forcing them onto one axis set.

## 3. Sim sessions have no explicit flag; `/attach` treats any entry-unlinked session as a "practice run"

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: `app/api/interview/simulate/attach/route.ts:28-33`; `app/_lib/db/interviews.ts:160-209` (no `is_sim` column, grep-confirmed)
- **Scenario**: A recruiter (or a direct POST) passes the token of an interview-lab `mode:"test"` session, or a `created` session that was never actually run, to `/api/interview/simulate/attach`.
- **Root cause**: The sim/real boundary is the overloaded condition `entryId == null` — there is no stored sim flag. The guard `if (!session || session.entryId)` therefore accepts lab/test sessions and never-started sessions as "practice runs", and builds the audit detail from `session.status` (which may be `"created"`).
- **Impact**: A candidate's drawer gets a `sim_attached` event referencing an interview that was never conducted (or a throwaway lab session) — misleading hiring-audit history. The implicit convention is fragile: any future global reader of `interview_sessions` will also miscount sims as real.
- **Fix sketch**: Add an explicit `is_sim` (or `origin`) column set by `/api/interview/simulate`; gate `/attach` on that flag plus `endedAt != null` (a real completed practice run), not on `entryId == null`.

## 4. `interviewedForJob` dedup drops a real completed interview when two candidates share a label and lack an entry id

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/_lib/db/interviews.ts:51-56`
- **Scenario**: Two sessions are filed under the same `job_id` with `entry_id` null (a session created with a job but not entry-linked) and an identical `candidate_label` (e.g. two "Alex Novak" or the default demo label).
- **Root cause**: The per-candidate dedup key is `entry_id ?? candidate_label ?? index`. With null entry ids it collapses to the label, so the second-seen session is treated as the same candidate and skipped ("latest interview per candidate").
- **Impact**: A genuinely completed interview silently disappears from the compare grid. Narrow (requires job-filed, entry-less, same-label sessions), hence Low.
- **Fix sketch**: Fall back to the globally-unique session id, not `candidate_label`, when `entry_id` is null; only dedup on a key that actually identifies one candidate.

## 5. `/attach` has no idempotency — duplicate `sim_attached` events spam the drawer

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/api/interview/simulate/attach/route.ts:25-34`; `app/_lib/db/pipeline.ts:676-682`
- **Scenario**: The same sim token is attached to the same candidate more than once (a retried/duplicated POST, or reopening the flow after "Start over").
- **Root cause**: `recordSimTranscriptAttached` unconditionally appends an event with no uniqueness check on (entryId, token); nothing dedups the annotation.
- **Impact**: The candidate's timeline accumulates identical "practice interview attached" entries, degrading the audit trail's signal. Low (the UI busy-guard makes accidental double-click unlikely; direct/retried POSTs are the realistic path).
- **Fix sketch**: Include the session token in the event and no-op (or upsert) when an identical `sim_attached` for that (entryId, token) already exists.
