# Interview Simulation & Comparison — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H2/M2/L1

## 1. Simulator mints real paid voice sessions but skips the billing gate /create enforces
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: revenue leak / metering asymmetry
- **File**: app/api/interview/simulate/route.ts:28
- **Observation**: `/api/interview/create` opens with a hard billing gate — `meterGate("interview_minutes")` returns 402 when the tenant is out of allowance, documented as "voice minutes are the one meter with real per-unit cost" (app/api/interview/create/route.ts:23-25). `/api/interview/simulate` mints an identical real voice session (same provider, same per-minute cost) with **no `meterGate` call at all**, yet `/complete` then debits the meter for *any* completed session regardless of `entryId` (app/api/interview/complete/route.ts:143-147). The simulate route header documents the "no-pipeline-side-effects / no scorecard" contract but says nothing about billing, so a reader cannot tell if skipping the gate is intentional or an oversight.
- **Why it matters**: On the Free plan `interview_minutes` is 0 (app/_lib/billing/plans.ts:34) — a tenant blocked from real candidate interviews can open the Simulator, run unlimited full voice calls, and silently burn the most expensive paid resource (debited past a zero allowance at completion). It is both a direct cost leak and a cannibalised upsell: the one feature that should require minutes hands them out ungated, and pack credits a recruiter bought for real candidates get drained by practice runs.
- **Recommendation**: Add the same `meterGate("interview_minutes")` 402 check at the top of the simulate POST (or a dedicated, possibly-smaller `simulate_minutes` meter), and record the billing decision in the route header so the asymmetry with /create is deliberate and documented.
- **Effort**: S

## 2. The compare grid is a viewer, not a decision tool — no ranking, no aggregate, no cross-cohort bridge
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: decision-support gap / value left on the table
- **File**: app/features/sub_jobs/CompareInterviews.tsx:184
- **Observation**: This is the surface where the hire decision is weighed, yet it does zero synthesis. Candidates render in interview-recency order (`interviewedForJob` … `ORDER BY ended_at DESC`, app/_lib/db/interviews.ts:39-41) — never sorted by strength. There is no average/weighted rating, no "strongest on X", no top-candidate signal (grep for `sort|score|rank|average|aggregate` in this file returns nothing). The grid also splits into per-cohort tables and *explicitly* declines to compare across them — "comparable WITHIN a cohort, not across" (lines 33-36) — so a role with one early-career and one experienced finalist gets two disconnected tables and no bridge, which is exactly the decision the recruiter actually faces.
- **Why it matters**: Every datum needed to rank (per-competency `ratings`, `recommendation`, `confidence`) is already in the payload; leaving the synthesis to the recruiter's eyeballs is the core promise (compare candidates → decide) only half-delivered. A simple per-candidate readiness score + sort, plus a normalized cross-cohort "role-fit" summary band above the rubric tables, is high-leverage differentiation that the data already supports.
- **Recommendation**: Compute a per-candidate aggregate (e.g. mean rating, weighted by rubric) and sort each cohort strongest-first; add a thin cross-cohort summary band (verdict + confidence + a 0–100 normalized readiness) above the per-cohort rubric tables so the actual "who do I advance?" question is answered while detail stays cohort-correct.
- **Effort**: M

## 3. Simulator captures a full practice transcript but it is annotation-only — a dark capability
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark capability / unmet recruiter & candidate need
- **File**: app/api/interview/simulate/attach/route.ts:8
- **Observation**: A simulator run stores a real transcript (mode `candidate`, completion persists it), and the agent can run three substantive lenses including a case-grounded interview. But "attach to candidate" only writes a `sim_attached` event whose payload is a one-line text `detail` (`recordSimTranscriptAttached`, app/_lib/db/pipeline.ts:620; UI at app/features/sub_interview/InterviewSimTab.tsx:274-278) — it never links the session, never surfaces the transcript from the drawer, and the sim deliberately synthesizes no scorecard. The recruiter ran a complete AI interview and gets back a breadcrumb, not the content.
- **Why it matters**: kp has a known pattern of features built but never surfaced. Two products are sitting one wire away: (a) make the attached practice transcript viewable in the drawer (recruiter calibration / interviewer training), and (b) expose "student mode" as a candidate-facing self-practice lane — a natural freemium/viral growth and employer-brand lever for a recruiting SaaS that currently buries the simulator inside the recruiter Workspace tab.
- **Recommendation**: Persist the session id on the `sim_attached` event and render a "view practice transcript" link in the drawer; scope a candidate-facing practice entry point (gated by the meter from finding 1) as a growth experiment.
- **Effort**: M

## 4. An unknown `scoringModel` cohort silently renders an empty rubric with a raw machine-string header
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: unhandled edge case / happy-path-only
- **File**: app/features/sub_jobs/CompareInterviews.tsx:191
- **Observation**: Cohort grouping assumes `scoringModel ∈ {experienced, early_career}`. Any third value (a future rubric, a typo'd/back-filled scorecard) flows through `present` → is appended after the known order → `rubric: data.rubrics[model] ?? []`. With an empty rubric, `CohortTable` renders the candidate's verdict/confidence badges but **zero competency rows**, and `cohortLabel` falls back to printing the raw machine string (e.g. `early_career_v4`) as the section header (lines 165-168, 191-193). No warning, no rationale recorded for what should happen.
- **Why it matters**: A candidate scored on an unrecognised rubric appears in the hire-decision grid as a near-blank column under a developer-looking heading — the recruiter can't tell "no axes apply" from "synthesis failed," the same silent-default failure mode the `interview-recommendation.ts` header warns about. It is a latent trap the moment a new cohort/rubric is introduced.
- **Recommendation**: When `data.rubrics[model]` is missing, render an explicit "unrecognised cohort — N candidates, rubric unavailable" notice (and/or fall back to a union of competencies actually present in those candidates' ratings) instead of an empty table under a raw key.
- **Effort**: S

## 5. The candidate-facing run-of-show sidebar is English-only, even for Czech simulations
- **Lens**: 🌀 Ambiguity
- **Severity**: Low
- **Category**: undocumented localization trade-off
- **File**: app/_lib/student-interview.ts:39
- **Observation**: `studentRunOfShow()` and `REGULAR_DEMO_RUN_OF_SHOW` return hardcoded English phase titles (lines 39-45), and `InterviewSimTab` feeds them straight into the visible `InterviewSidebar` regardless of locale (app/features/sub_interview/InterviewSimTab.tsx:155-156, 246). The module's only recorded reasoning for keeping prose English — the PREP2 note (lines 77-79) — justifies it because "the voice agent … delivers" the script and detects cs/en. That rationale covers *spoken* delivery but is silent on the agenda the candidate *reads* on screen.
- **Why it matters**: kp's default company is `Česká spořitelna` (student-interview.ts:178) — a Czech-market product — so a Czech candidate watching the simulator sees an English-titled agenda while being interviewed in Czech. The mismatch is a small but real polish/trust gap, and because the documented trade-off doesn't mention the sidebar, the next maintainer can't tell whether English-on-screen is intended or just unhandled.
- **Recommendation**: Either localize the sidebar phase titles (a `phase_cs` field on interview-script.json, mirroring the cs branch already in `studentPrepRunOfShow`) or extend the PREP2 note to explicitly state the visible run-of-show is intentionally English and why.
- **Effort**: S
