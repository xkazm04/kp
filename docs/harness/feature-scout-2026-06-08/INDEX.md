# Feature Scout Scan — kp, 2026-06-08

> Opportunity audit (NOT a defect hunt — a Bug Hunter scan already ran 2026-06-07).
> 10 parallel subagent runs, batched in two waves of 5, over an opportunity-focused
> subset of the candidate→hire journey. Each subagent scouted one context for
> feature gaps, half-built capabilities, automation and integration opportunities.

> **⛔ BACKLOG RETIRED — 2026-06-08.** This scan drove Waves 1–16 (see FIXES-WAVE-*.md);
> all 7 themes were covered, every High shipped, plus a Med/Low sweep. The remaining
> Medium/Low items below (VOX2, VOX4, VOX5, JOB5, DEC5, DEC6, PREP4, SCH4, all-tabs PDF,
> + minor follow-ups) are **NOT being pursued** — development moved to a different
> technique. This file is kept as the historical record of the scan; treat the
> unshipped rows as archived, not as a to-do list.

---

## Totals

| | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|
| Across 10 contexts | 30 | 20 | 10 | **60** |
| Share | 50% | 33% | 17% | 100% |

Every context returned exactly 6 (3 High / 2 Medium / 1 Low) — the per-context cap.
Counts verified two ways: `Total:` headers sum to 60; `**Value**:` bullets count 60. ✓

---

## Per-context breakdown

(All contexts tie at 3H/6T; listed in candidate-journey order.)

| # | Context | High | Med | Low | Total | Report |
|---|---|---:|---:|---:|---:|---|
| 1 | CV Analysis Workspace | 3 | 2 | 1 | 6 | `cv-analysis-workspace.md` |
| 2 | Analysis Results & Reporting | 3 | 2 | 1 | 6 | `analysis-results-reporting.md` |
| 3 | Job Catalog, Ingestion & Sourcing | 3 | 2 | 1 | 6 | `job-catalog-sourcing.md` |
| 4 | Candidate-Job Matching & Fit Matrix | 3 | 2 | 1 | 6 | `matching-fit-matrix.md` |
| 5 | Decision Workflow & Group Eval | 3 | 2 | 1 | 6 | `decision-workflow-group-eval.md` |
| 6 | Interview Prep & Rubric | 3 | 2 | 1 | 6 | `interview-prep-rubric.md` |
| 7 | Voice Interview Runtime | 3 | 2 | 1 | 6 | `voice-interview-runtime.md` |
| 8 | Pipeline Board & Scheduler | 3 | 2 | 1 | 6 | `pipeline-board-scheduler.md` |
| 9 | Scheduling & Offers | 3 | 2 | 1 | 6 | `scheduling-offers.md` |
| 10 | Conversational Apply | 3 | 2 | 1 | 6 | `conversational-apply.md` |

ID scheme used below: `CV` `RES` `JOB` `MAT` `DEC` `PREP` `VOX` `PIPE` `SCH` `APP` + the in-report number.

---

## All 30 High-value opportunities — one-line summary

Grouped into themes for triage. Each links to its full entry in the per-context report.

### A. Dark / half-built capability — backend exists, no UI to invoke it (highest leverage)
These are the standout finding of the scan: working, hardened server code with **zero UI caller**. The "build" is mostly a button + wiring.
1. **JOB1 — Surface the prose-ad ingest in the Jobs UI** — `/api/jobs/ingest` (LLM parse, dedup, content-hash guard) is fully built but has no UI caller; the catalog is read-only for recruiters. `job-catalog-sourcing.md` · Effort S
2. **DEC1 — Run the screening auto-reject wave from the Decisions tab** — `runScreenWave` + fairness gate + comms is built and hardened but only the demo (`SimDecisionWave`) ever calls it. `decision-workflow-group-eval.md` · Effort M
3. **VOX1 — Deliver the tokenized interview link to the candidate** — `startInterview` only `window.open`s the link in the recruiter's own tab; the feature is undeliverable end-to-end despite comms infra existing. `voice-interview-runtime.md` · Effort S
4. **CV1 — "Add to pipeline" from the analysis result** — `/api/pipeline` already accepts exactly the fields a finished `Analysis` carries, but `ResultPanel` offers no button; the recruiter's journey dead-ends at the report. `cv-analysis-workspace.md` · Effort M
5. **RES2 — Push candidate from the history report into the pipeline** — same `addToPipeline` flow exists in Match but not on the report/history surface. `analysis-results-reporting.md` · Effort S
6. **MAT3 — Bulk shortlist → pipeline from the Matrix / Match results** — no multi-select add; recruiters add candidates one at a time. `matching-fit-matrix.md` · Effort M
7. **PIPE1 — Manual stage move from the board** — `PipelineAction` only allows accept/reject/approve; no way to move back, skip, or fix a miscategorized entry. `pipeline-board-scheduler.md` · Effort M
8. **DEC3 — Advance / reject directly from the Group Evaluation modal** — the modal is read-only at the moment of highest context. `decision-workflow-group-eval.md` · Effort M
9. **CV3 — Save the typed JD to the library inline** — the form reads `/api/jds` but can't write; recruiters re-type JDs. `cv-analysis-workspace.md` · Effort S

### B. Close the candidate loop — contact, comms & reachability
10. **APP2 — Capture an email/contact so applicants are reachable** — apply captures name-only; comms dead-letter (documented at `db.ts:1895`). `conversational-apply.md`
11. **APP1 — CV/résumé upload during apply** — reuse `/api/extract-text` to turn thin typed answers into a matchable profile. `conversational-apply.md`
12. **APP3 — Application-received confirmation comm** — applicants get no acknowledgement. `conversational-apply.md`
13. **SCH2 — Candidate self-reschedule from the booked-confirmation page** — the email promises "just reply" but there's no path. `scheduling-offers.md` · Effort M
14. **JOB3 — "Reach out" directly from a sourcing result** — `dispatchOutreach` exists but never fires from sourcing views. `job-catalog-sourcing.md` · Effort M

### C. Export / share / portability
15. **RES1 — Shareable / printable candidate report (PDF + share link)** — no export of any kind exists on any results surface. `analysis-results-reporting.md` · Effort M
16. **SCH1 — Attach a calendar invite (.ics) to interview confirmations** — `slotAt`+`durationMin` are captured but emails are plain text (top no-show cause). `scheduling-offers.md` · Effort M
17. **PREP3 — Export / copy / print the prep guide** — no export anywhere on the schedule surface. `interview-prep-rubric.md` · Effort S

### D. Search / filter / saved views (data has outgrown browsing)
18. **RES3 — Searchable / filterable history with tagging** — history is an un-queryable flat table; `listAnalyses` takes no params. `analysis-results-reporting.md` · Effort M
19. **PIPE2 — Board search + quick filters** — none exist; the aging/awaiting StatChips aren't even clickable. `pipeline-board-scheduler.md` · Effort M

### E. Human decision record (notes, dispositions, history)
20. **PREP1 — Human interviewer scorecard** — let a human fill the archetype-correct rubric live and save it; today the only scorecard is AI-synthesized. `interview-prep-rubric.md` · Effort M
21. **PREP2 — Persist the prep checklist + interviewer notes** — checklist state is in-memory, lost on close; no notes field. `interview-prep-rubric.md` · Effort M
22. **PIPE3 — Per-candidate activity timeline in the drawer** — the event taxonomy + global feed exist, but the drawer shows no per-candidate history. `pipeline-board-scheduler.md` · Effort M

### F. Recruiter configuration (replace hardcoded constants)
23. **MAT1 — Recruiter-adjustable match weighting** — `score_job` takes a bounded `weights` vector (`matching.py:568`) but no route/UI exposes it. `matching-fit-matrix.md` · Effort M

### G. AI-assist enrichments
24. **VOX2 — Recruiter live co-pilot (watch the in-flight transcript)** — the 6s poll plumbing already exists. `voice-interview-runtime.md` · Effort M
25. **VOX3 — Link scorecard evidence quotes to the transcript turns they came from** — clickable evidence→turn anchoring. `voice-interview-runtime.md` · Effort M
26. **MAT2 — Per-role score distribution + summary stats in the Fit Matrix** — no column stats today. `matching-fit-matrix.md` · Effort M

### H. Workflow guardrails / lifecycle
27. **DEC2 — Dry-run preview before the irreversible, email-sending screening wave** — no preview before commit. `decision-workflow-group-eval.md` · Effort M
28. **SCH3 — Offer expiry / response deadline** — code comments flag "tokens never expire" as a hazard. `scheduling-offers.md` · Effort S
29. **CV2 — Paste CV text directly (no file required)** — CV is the only input lacking the paste path JD/Company already have. `cv-analysis-workspace.md` · Effort M
30. **JOB2 — Ingest a role from a posting URL (+ bulk-paste several)** — only inline `adText` is supported today. `job-catalog-sourcing.md` · Effort M

---

## Medium & Low opportunities (30) — by theme

**Configuration & policy:** PIPE4 per-stage SLA (M) · SCH4 recruiter availability windows (M) · DEC5 per-role rule overrides + auto-advance (M) · VOX5 per-role multi-language (M) · INTERVIEW: PREP4 editable questions + role question bank (M).
**Export & quick-copy:** MAT4 export matches/matrix CSV (M) · RES6 copy talking-points (L) · PREP6 rubric anchors in prep modal (L).
**Search / saved views:** PIPE5 saved board views (M) · JOB5 saved searches/segments (M) · MAT6 dimension-sort + min-fit filter (L).
**Human record / calibration:** DEC4 decision note on advance/reject (M) · RES5 report disposition + note (M) · DEC6 reviewer calibration / second-opinion (L).
**AI-assist:** VOX4 auto-summary transcript digest (M) · JOB4 per-role sourcing analytics (M).
**Candidate experience:** APP4 application-status page (M) · APP5 recruiter-authored screening questions (M) · APP6 save & resume application (L) · SCH5 counter-offer message (M) · VOX6 candidate accommodations (L).
**Intake ergonomics:** CV4 re-analyze a saved run (M) · CV5 time-aware progress (M) · CV6 remember last JD/company (L) · JOB6 cross-role rediscovery digest (L).
**Matching/compare:** MAT5 compare-jobs-for-one-candidate (M).
**Offer/Interviewer logistics:** SCH6 structured offer letter from job+comp (L) · PREP5 interviewer assignment on schedule card (M) · PIPE6 scheduler run-history panel (L).

---

## Triage themes

| Theme | Approx count | Why this is a wave, not just individual fixes |
|---|---:|---|
| **A. Dark/half-built → wire to UI** | 9 High | One mental model: find the built-but-uncalled API, add the CTA. Fixes compound (shared `addToPipeline`/action patterns). Highest value-per-effort in the whole scan. |
| **B. Candidate loop: contact + comms** | 5 High + 4 M/L | All touch the apply→notify path (`comms`, `apply-intake`, schedule pages). Sharing the comms/contact model makes them one coherent session. |
| **C. Export / share / portability** | 3 High + 3 M/L | Print stylesheet + clipboard + ICS are one toolkit reused across report/prep/matrix/offer surfaces. |
| **D. Search / filter / saved views** | 2 High + 3 M/L | Same query-param + filter-bar pattern across history/board/sourcing/matrix. |
| **E. Human decision record** | 3 High + 3 M/L | Notes/dispositions/timelines share a small schema + `actOnPipelineEntry` detail plumbing that already exists end-to-end but is ignored. |
| **F. Recruiter configuration** | 1 High + 5 M | Replace hardcoded constants (weights, SLAs, availability, language, rules) with a config store — one store, many surfaces. |
| **G. AI-assist enrichments** | 3 High + 2 M | Transcript/co-pilot/distribution/analytics — each adds an AI/stat layer over existing data. |
| **H. Workflow guardrails / lifecycle** | 2 High + offer items | Dry-run/expiry/counter — safety + lifecycle around the irreversible, money/comms-sending actions. |
| I. Intake ergonomics | 2 High + 3 M/L | Analyze-tab + job-ingest polish; small, independent quick wins. |

---

## Suggested next-phase split (fix waves)

Each wave is one focused session (~5–7 opportunities) sharing a mental model so the work compounds.

- **Wave 1 — "Light up the dark capabilities" (Theme A).** JOB1, DEC1, VOX1, CV1, RES2, MAT3, PIPE1 — the built-but-uninvokable backends. Highest leverage; mostly wiring + a button. *Recommended first.*
- **Wave 2 — Close the candidate loop (Theme B).** APP2, APP1, APP3, SCH2, JOB3 (+ APP4 confirmation/status). The apply→contact→notify spine.
- **Wave 3 — Export & share (Theme C).** RES1 (PDF/share report), SCH1 (.ics), PREP3, MAT4, RES6. One portability toolkit.
- **Wave 4 — Search, filter & saved views (Theme D).** RES3, PIPE2, PIPE5, JOB5, MAT6. Shared query/filter pattern.
- **Wave 5 — Human decision record (Theme E).** PREP1, PREP2, PIPE3, DEC4, RES5. Notes/dispositions/timeline schema.
- **Wave 6 — Recruiter configuration (Theme F).** MAT1, PIPE4, SCH4, DEC5, VOX5, PREP4. Config store → many surfaces.
- **Wave 7 — AI-assist + guardrails (Themes G + H).** VOX2, VOX3, MAT2, VOX4, DEC2, SCH3. Enrichment + lifecycle safety.
- *(Intake-ergonomics quick wins (Theme I: CV2/CV4/CV5/JOB2) can be folded into any wave that touches those surfaces.)*

---

## How this scan was run

- **Scanner:** Feature Scout (`agent_feature_scout`, `scanType: feature_scout`) — role/focus/quality-bar from `src/lib/prompts/registry/agents/feature-scout.ts` in the Vibeman repo.
- **Pipeline:** Vibeman Pipeline B (Scan + Triage + Implementation), adapted to an opportunity lens (findings = feature gaps, not defects).
- **Date:** 2026-06-08. **Scope:** opportunity-focused subset of 10 contexts spanning the candidate→hire journey; full-stack (TS/React + Python `pipeline/jobfit/**`).
- **Method:** 10 `general-purpose` subagents, 2 waves of 5, each read the context's files (grepping to confirm a capability was genuinely absent before calling it a gap), wrote one report, replied with terse stats. Orchestrator read only the replies during scanning. ~145 files read across all subagents.
- **Cap:** 4–6 opportunities per context (Feature Scout's own guidance is 3–5); each returned exactly 6 (3H/2M/1L).
- **Verification:** header-sum (60) == bullet-count (60). ✓
- **Guardrails honored:** subagents were told to avoid defect-fixes (covered by `bug-hunt-2026-06-07/`) and to avoid re-proposing existing features; each report ends with the cross-checks it performed. One subagent (analysis-results-reporting) was blocked from writing its file and returned the report inline; the orchestrator wrote it.
- **Baseline at scan time:** `tsc --noEmit` = 0 errors. (Tests to be re-measured via `npm run test:unit` + `npm run test:python` before any implementation wave — `vitest` reports a false baseline here, per `harness-learnings.md`.)
