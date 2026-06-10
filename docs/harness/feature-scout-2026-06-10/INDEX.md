# Feature Scout Scan #2 — kp, 2026-06-10

> **CAMPAIGN COMPLETE (2026-06-10).** All 10 waves + the Med/Low sweep shipped and
> pushed (origin/main `44d3932`). ~80 of 110 findings closed; per-wave detail in
> FIXES-WAVE-1..10.md, FIXES-SWEEP.md, and FIXES-WAVE-3/4.md (i18n). Remaining: the
> RES2 deep per-tab body labels (scoped follow-up — see FIXES-WAVE-4.md) + the
> residual Med/Low tail FIXES-SWEEP.md lists as not-pursued.

> Opportunity audit (NOT a defect hunt — bug-hunt 2026-06-07 + ui-bug-scan 2026-06-08 already ran).
> 22 parallel subagent runs over ALL 22 contexts — the 12 never-scouted contexts got the full scout;
> the 10 contexts mined by the retired 2026-06-08 campaign got a hard-dedup re-scan
> (prior report + INDEX + harness-learnings read first; only net-new gaps reported).
> Run with the app freshly bilingual (en + cs via next-intl, commit `7922fbe`) — i18n seams were
> explicitly in scope and became the largest cross-cutting theme.

---

## Totals

| | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|
| 12 fresh contexts | 36 | 24 | 12 | **72** |
| 10 mined re-scans | 12 | 20 | 6 | **38** |
| **Across 22 contexts** | **48** | **44** | **18** | **110** |
| Share | 44% | 40% | 16% | 100% |

Counts verified two ways: `> Total:` headers sum to 110; `**Value**:` bullets count 110 (48H/44M/18L). ✓
Known near-duplicate pairs (independent scouts converging — see "Duplicate pairs" below): 4 → ~106 distinct work items.

---

## Per-context breakdown

(Fresh contexts first, then mined re-scans; each sorted by Highs.)

| # | Context | H | M | L | Total | Report |
|---|---|---:|---:|---:|---:|---|
| 1 | Candidate Profile Builder | 3 | 2 | 1 | 6 | `candidate-profile-builder.md` |
| 2 | Scoring & Extraction Engine (Python) | 3 | 2 | 1 | 6 | `scoring-extraction-engine.md` |
| 3 | JD Library & Builder | 3 | 2 | 1 | 6 | `jd-library-builder.md` |
| 4 | Dev Case Python Engine | 3 | 2 | 1 | 6 | `dev-case-python-engine.md` |
| 5 | Dev Case Orchestration & API | 3 | 2 | 1 | 6 | `dev-case-orchestration-api.md` |
| 6 | Dev Case Studio (UI) | 3 | 2 | 1 | 6 | `dev-case-studio-ui.md` |
| 7 | Demo Simulation & Channels | 3 | 2 | 1 | 6 | `demo-simulation-channels.md` |
| 8 | Automation Orchestration | 3 | 2 | 1 | 6 | `automation-orchestration.md` |
| 9 | GitHub Code Analysis | 3 | 2 | 1 | 6 | `github-code-analysis.md` |
| 10 | Analytics & Diagrams | 3 | 2 | 1 | 6 | `analytics-diagrams.md` |
| 11 | Workspace Shell & Shared UI | 3 | 2 | 1 | 6 | `workspace-shell-shared-ui.md` |
| 12 | Data Layer, Schemas & Python Bridge | 3 | 2 | 1 | 6 | `data-layer-python-bridge.md` |
| 13 | Analysis Results & Reporting *(re-scan)* | 2 | 1 | 1 | 4 | `analysis-results-reporting.md` |
| 14 | Job Catalog, Ingestion & Sourcing *(re-scan)* | 2 | 1 | 1 | 4 | `job-catalog-sourcing.md` |
| 15 | CV Analysis Workspace *(re-scan)* | 1 | 2 | 0 | 3 | `cv-analysis-workspace.md` |
| 16 | Candidate-Job Matching & Fit Matrix *(re-scan)* | 1 | 2 | 1 | 4 | `matching-fit-matrix.md` |
| 17 | Decision Workflow & Group Eval *(re-scan)* | 1 | 2 | 1 | 4 | `decision-workflow-group-eval.md` |
| 18 | Interview Prep & Rubric *(re-scan)* | 1 | 2 | 1 | 4 | `interview-prep-rubric.md` |
| 19 | Voice Interview Runtime *(re-scan)* | 1 | 2 | 0 | 3 | `voice-interview-runtime.md` |
| 20 | Pipeline Board & Scheduler *(re-scan)* | 1 | 3 | 0 | 4 | `pipeline-board-scheduler.md` |
| 21 | Scheduling & Offers *(re-scan)* | 1 | 3 | 0 | 4 | `scheduling-offers.md` |
| 22 | Conversational Apply *(re-scan)* | 1 | 2 | 1 | 4 | `conversational-apply.md` |

ID scheme below: short context tag + in-report number, e.g. `SCOR1` = scoring-extraction-engine.md #1.
Tags: PROF SCOR JDL DEVP DEVO DEVS SIM AUTO GH ANA SHELL DATA RES JOB CV MAT DEC PREP VOX PIPE SCH APP.

---

## All 48 High-value opportunities — one-line summaries, by theme

### A. Dormant intelligence — the engine computes it, nobody sees it (the standout theme)
Working, tested engine output with zero UI surface. The "build" is mostly threading + a panel.
1. **SCOR1 — Surface the soft-signal panel** — `soft_signals.py` (overclaim risk, tenure instability, hidden strengths, each with a suggested interview probe) is built + tested with **zero production callers**. `scoring-extraction-engine.md`
2. **SCOR2 — Show the analysis quality flags** — `sanityChecks` (the engine's "manual review" trust ledger) ships in every payload + zod schema; no component renders it. `scoring-extraction-engine.md`
3. **SCOR3 — Explain the potential score** — learning signals, transferable meta-skills, domain distance: computed, never shown. `scoring-extraction-engine.md`
4. **DEVP2 — Close the CV→probe loop** — `soft_signals.panel_to_probe_briefs` → `design_case(focus_probes=…)` is fully built (LLM + deterministic paths), zero callers; the engine's headline differentiator is dark. `dev-case-python-engine.md` *(pairs with SCOR5-M)*
5. **DEVP3 — Read the DECISIONS log** — v4 cases force candidates to keep a decision log the evaluator never reads. `dev-case-python-engine.md`
6. **PROF1 — Give saved profiles a home** — list/edit/duplicate/delete backends all exist (`GET` list, `DELETE`, EditorMode "duplicate") with no UI; an un-pipelined profile can never be reopened. `candidate-profile-builder.md`
7. **DEVS3 — Surface autonomy state + pending gates in the Dev tab** — `/control` has zero inbound links app-wide. `dev-case-studio-ui.md`
8. **DATA2 — Ops/System panel for LLM cost + cache telemetry** — token usage, `cost_usd`, cache hit-rate are written and never read; `/api/health` is curl-only. `data-layer-python-bridge.md`

### B. GitHub analysis — persisted nowhere, integrated with nothing (3 scouts converged)
9. **GH1 — Persist the GitHub analysis with the saved run** — the paid Gemini deep-dive lives only in Analyze-tab client state; history/shared reports silently lose it. `github-code-analysis.md` *(duplicate pair with RES1)*
10. **RES1 — Persist GitHub deep-dive into saved analyses** — same gap found independently from the history side; persist via the existing RES5 PATCH route. `analysis-results-reporting.md`
11. **GH2 — Attach the GitHub assessment to the pipeline entry** — `analyze-run.ts` hardcodes `github_present: false`; decision surfaces never see code evidence. `github-code-analysis.md`
12. **GH3 — Allow a GitHub-only deep-dive** — submit hard-requires a CV the route never needs. Effort S. `github-code-analysis.md`

### C. i18n completion — the bilingual release stopped at the recruiter chrome
13. **SIM3 — Localize candidate-facing comms + persist applicant locale** — all 8 comm templates are hardcoded English; no locale on entries. `demo-simulation-channels.md`
14. **RES2 — Extend the bilingual catalog to the report surface** — results tabs + history detail skipped by `7922fbe`; Czech LLM narrative inside English chrome. `analysis-results-reporting.md`
15. **MAT1 — Generate "Explain fit" reasoning in the recruiter's locale** — `match_reasoning.generate(lang=)` exists server-side; `reasoning_cli` lacks `--lang`, TS never threads locale, cache lacks a lang axis. Effort S. `matching-fit-matrix.md`

### D. Dev-case deliverability — the take-home pipeline can't reach a candidate
16. **DEVS1 / DEVO1 — Build the candidate-facing apply page behind the apply token** — the "apply link" is a POST-only JSON webhook (405s in a browser); found independently by BOTH dev-case scouts. The orphaned seed route + probe-free `caseToMarkdown` are ready. *(duplicate pair = one work item)*
17. **DEVO3 — Close the case** — the `closed` stage has no writer; non-promoted submitters are ghosted, late submissions never evaluated. `dev-case-orchestration-api.md`
18. **DEVO2 — Auto-feed the outcome calibration loop from pipeline terminal events** — today calibration is manual double-entry. `dev-case-orchestration-api.md` *(complementary with DEVS2)*
19. **DEVS2 — One-click outcome recording from promoted submissions** — hand-typed candidateRef/score today. `dev-case-studio-ui.md`
20. **DEVP1 — Make the human approval gate a real review** — one-click Approve with no view/edit/regenerate of the designed case (the plan promised it). `dev-case-python-engine.md`

### E. Comms Center & delivery lifecycle — sends exist, operations don't
21. **SIM1 — Promote the Outbox into a recruiter-facing Comms Center on Channels** — 8 comm kinds recorded with entry refs; only UI is a display-only 50-row table in the Dev tab. `demo-simulation-channels.md`
22. **SIM2 — Make dead-lettered comms recoverable (resend)** — failed is terminal; event-gated automation will never re-send. Effort S. `demo-simulation-channels.md` *(overlaps DEVO5-M/DEVS4-M — one store, coordinate)*
23. **SCH1 — Surface the invite lifecycle to the recruiter** — schedule-store has no list function; `needs_more_slots`/`needs_reconcile` operator flags die in console.error. `scheduling-offers.md`
24. **VOX1 — Give the delivered interview link a lifecycle** — tokens never expire, can't be revoked; reissue mints a parallel live session + second email; `/connect` ignores terminal entries. `voice-interview-runtime.md`
25. **PROF2 — Capture candidate contact (email) in the profile builder** — recruiter-sourced entries dead-letter (documented in comms-dispatch's own comment). `candidate-profile-builder.md`

### F. Automation trust — the autopilot has no front door, no log, no preview
26. **AUTO1 — Auto-score unscored inbound applicants** — every conversational-apply entry lands with `matchScore: null` and the policy pass holds it "awaiting match score" forever; `match_score` is INSERT-only. The funnel's front door never automates. `automation-orchestration.md`
27. **AUTO2 — Persist + surface what each pass decided** — per-pass `decisions[]` computed and discarded on every path; holds record no event. `automation-orchestration.md`
28. **AUTO3 — Dry-run preview before the policy pass commits** — mirror the shipped screening-wave DEC2 pattern on the email-sending pass. `automation-orchestration.md`
29. **DEC1 — Wire human scorecards into the `scorecard_review` approval gate** — the W14 documented-unshipped seam; the scorecard route never calls `setApproval`, so human-only interviews never reach Decisions. `decision-workflow-group-eval.md`
30. **PREP1 — Merge human-only scorecards into the interview compare grid** — `interviewedForJob` reads `interview_sessions` only; human-led rounds vanish at the comparison moment. `interview-prep-rubric.md`

### G. Recruiter productivity shell — the studio has no global layer
31. **SHELL1 — Global command palette / cross-entity search (Ctrl+K)** — no `/api/search` or palette anywhere (verified across all 71 API routes); every deep-link target already exists in `tabs.ts`. `workspace-shell-shared-ui.md`
32. **SHELL2 — "What needs my attention" sidebar count badges** — decisions pending, scorecards to review, reminders due: derived per-tab only, never aggregated. `workspace-shell-shared-ui.md`
33. **SHELL3 — Recents + resume-last-context** — the shell deliberately wipes selection on every tab switch; nothing remembers it. Effort S. `workspace-shell-shared-ui.md`
34. **PIPE1 — Bulk multi-select board actions** — PIPE2 filters isolate cohorts ("7 aging") but acting is one-drawer-at-a-time; `set_stage` CAS + MatrixTab selectMode precedent make batch moves pure wiring. `pipeline-board-scheduler.md`

### H. Lifecycle & CRUD gaps — records are born, never managed
35. **JOB1 — Give roles a terminal lifecycle** — status machine is draft→published only; no close/filled; the apply link accepts applications forever (even for drafts). `job-catalog-sourcing.md`
36. **JOB2 — Persist sourcing state on the candidate ranking** — reach-out/pipeline state is session-only in-memory Sets despite durable `outreach_sent` events. `job-catalog-sourcing.md`
37. **JDL1 — Add edit + archive to saved JDs** — the `jds` table is fully append-only (slug route is GET-only); every revision forks a permanent near-duplicate. `jd-library-builder.md`
38. **JDL2 — Apply CTA on the public JD page** — candidate dead-end today; JD → apply bridge. Effort S. `jd-library-builder.md`
39. **JDL3 — "Ingest as job" from the library** — pasted JDs are un-matchable; the existing `ingestJobAd` is the bridge. `jd-library-builder.md`
40. **APP1 — Let a re-apply update the original entry** — fresh email/CV discarded on duplicate detection; a no-email→email re-apply mints a duplicate row. `conversational-apply.md`
41. **PROF3 — Draft the profile from an uploaded CV file** — reuse `/api/extract-text`; today the builder is type-everything. Effort S. `candidate-profile-builder.md`
42. **CV1 — Finish the CV1 deferral: thread `saved_slug` into the live result** — `analyze-run.ts` attaches `persistence.slug` but the zod schema strips it client-side; the feared schema boundary is already solved by the `comparison` `.extend` precedent. Effort S. `cv-analysis-workspace.md`

### I. Analytics actionability — a dashboard you can't act from
43. **ANA1 — Make every analytics chart click through to the candidates behind it** — deep-link funnel bars/role rows into the board's existing filter via the `?tab=` convention. `analytics-diagrams.md`
44. **ANA2 — Time windows + weekly trend** — analytics is all-time-only; `pipeline_events.created_at` is indexed but never aggregated. `analytics-diagrams.md`
45. **ANA3 — "Automation impact" rollup** — automation-vs-human attribution exists per-row (DECISION_META), never aggregated. `analytics-diagrams.md`

### J. Ops resilience
46. **DATA1 — One-click retry of failed/interrupted background tasks** — `params_json` is the exact replay payload; every failed/interrupted row (routine on each restart) dead-ends. Effort S. `data-layer-python-bridge.md`
47. **DATA3 — Workspace backup/restore from the UI** — db-dump/db-load exist CLI-only. `data-layer-python-bridge.md`
48. **GH1-companion / DEVS-GH4 cross-link** *(counted under B)* — see GH4-M one-click submitter assessment for the dev-case bridge.

*(#48 in the count is RES1 — listed under Theme B as the duplicate pair of GH1.)*

---

## Medium & Low opportunities (62) — by theme

**i18n completion (the long tail of Theme C):** JDL5 JD generation in Czech (M) · PREP2 prep pack locale (M) · PREP3 rubric/BARS key-stable localization (M) · JOB3 posting markdown l10n (M) · SCH4 slot times + money locale on token pages (M) · CV3 per-run report language override (M) · SHELL5 locale-aware metadata + latin-ext fonts + OG (M) · SIM4 localize the demo simulation (M) · DEVP5 case artifacts in candidate's language (M) · APP4 lang pin + apply-page switcher (L) · DEC4 screening-wave reason codes (L) · SCOR6 market-salary `--lang` (L) · ANA6 diagrams/coverage l10n (L)
**Dormant data, smaller cuts:** MAT2 name the KO blocker on blocked matrix cells (M) · JOB4 disclose not-eligible cohort + koReasons (L) · DEVP6 render the process trace (L) · DEVP4 fairness-gate health card (M) · SCOR4 real per-stage analyze progress (M) — *also closes the bug-hunt CV#7 deferral* · SCOR5 probe briefs → dev-case designer (M, the DEVP2 pair) · DEVS6 starter seed in CaseDetail (L)
**Comms/outbox:** DEVO5 outbox resend (M, = SIM2's store) · DEVS4 outbox body/filter/triage (M) · VOX2 invite funnel state + deliberate resend (M) · VOX3 rehearse without burning the candidate link (M)
**Automation config & control:** AUTO4 POLICY config surface (M) · AUTO5 per-candidate automation pause (M) · AUTO6 register reminder sweep as scheduler job (L) · DEVO4 DEV_POLICY live knobs (M) · DEVO6 autonomy audit export (L)
**Decisions/human record:** DEC2 advance-lead-reject-rest batch (M, W9 deferral whose blocker is gone) · DEC3 decision-note parity on AiReviewCard + group-eval (M) · PREP4 author+savedAt stamp on human scorecard (L)
**Board & shell productivity:** PIPE2 drag-and-drop stage moves (M) · PIPE3 shareable view URLs (M) · PIPE4 per-candidate owner + Mine filter (M) · SHELL4 keyboard shortcuts + "?" overlay (M) · SHELL6 BroadcastChannel live-refresh (L)
**Scheduling lifecycle:** SCH2 cancel/withdraw a booking (M) · SCH3 no-show vs happened capture (M)
**Profile/intake ergonomics:** PROF4 find-matching-roles post-save (M) · PROF5 profiles in archetype matrix (M) · PROF6 actionable completeness nudges (L) · CV2 candidate-name analysis labels (M) · APP2 KO-decline telemetry (M) · APP3 role posting on apply page (M)
**Results/history:** RES3 disposition filter in history (M) · RES4 archetype into pipelineRef (L) · MAT3 honor matrix→match deep-link job half (L) · MAT4 persist weight overrides + matrix weight parity (M)
**Analytics:** ANA4 source effectiveness (M) · ANA5 decision-log filter + export (M)
**Ops:** DATA4 engine preflight surfacing (M) · DATA5 task outcome view (M) · DATA6 task list filter (L) · GH4 dev-case submitter assessment (M) · GH5 deep-dive cache + re-run (M) · GH6 evidence link verification (L)
**Demo:** SIM5 chapter replay (M) · SIM6 presenter speed control (L)

---

## Duplicate pairs (independent convergence — merge at wave planning)

| Pair | Same work item |
|---|---|
| DEVS1 + DEVO1 | Candidate-facing apply page behind the dev-case token |
| GH1 + RES1 | Persist GitHub deep-dive with the saved analysis |
| SIM2 + DEVO5 (+DEVS4 partially) | Outbox dead-letter resend/triage (one `dev_outbox` store) |
| DEVO2 + DEVS2 | Outcome calibration feed (auto-feed + one-click are complementary halves) |

Effective distinct High items: **~44**.

---

## Triage themes

| Theme | Count (H + M/L) | Why this is a wave, not just individual fixes |
|---|---|---|
| **A. Dormant intelligence** | 8 H + 7 M/L | One mental model: find the computed-but-dropped engine output, thread it to a panel. Same payload-plumbing pattern everywhere (zod schema → run wrapper → results component). Highest insight-per-effort in the scan. |
| **B. GitHub integration** | 4 H + 3 M/L | One storage decision (persist the assessment) unlocks history, pipeline attach, dev-case bridge and caching together. |
| **C. i18n completion** | 3 H + 13 M/L | The `--lang` threading pattern is identical across CLIs (analyze path is the proven template); comm templates + token pages share the locale-persistence decision. Born from `7922fbe`, touches every candidate-facing artifact. |
| **D. Dev-case deliverability** | 5 H + 4 M/L | The take-home subsystem is one apply-page + close-out + calibration-feed away from being a real product loop. Both dev-case scouts converged on the same front door. |
| **E. Comms Center & link lifecycle** | 5 H + 4 M/L | One store (`dev_outbox`), one surface (Channels), one lifecycle model (expiry/revoke/resend) across schedule invites, interview links and outreach. |
| **F. Automation trust** | 5 H + 5 M/L | Front door (auto-score), black box (decisions log), safety (dry-run), human override (scorecard gates) — together they make the autopilot adoptable. |
| **G. Productivity shell** | 4 H + 5 M/L | Palette/badges/recents/bulk share the `tabs.ts` deep-link substrate the analytics theme also wants. |
| **H. Lifecycle & CRUD** | 8 H + 12 M/L | Roles, JDs, applications, bookings, profiles — same "born but never managed" shape; mostly small routes + existing-pattern UI. |
| **I. Analytics actionability** | 3 H + 2 M/L | Deep-links + time windows + attribution on data already indexed. |
| **J. Ops resilience** | 2 H + 5 M/L | Task retry / ops panel / backup — operator confidence for a single-process app. |

---

## Suggested next-phase split (fix waves)

Each wave is one focused session (~5–7 items) sharing a mental model. Ordered by leverage.

- **Wave 1 — "Light up the dormant engine" (Theme A core).** SCOR1, SCOR2, SCOR3, MAT2, JOB4, DEVP6 (+ SCOR4 if room). Pure surfacing of computed data; no schema changes. *Recommended first — same character as the wildly successful Wave 1 of the prior campaign.*
- **Wave 2 — GitHub becomes a first-class signal (Theme B).** GH1+RES1 (merged), GH2, GH3, GH4, GH5. One persistence decision, then wiring.
- **Wave 3 — Candidate-facing i18n (Theme C, candidate half).** SIM3 (comms + locale persistence), SCH4, JOB3, APP4, DEVP5, JDL5. The candidate never sees English they didn't choose.
- **Wave 4 — Recruiter-facing i18n (Theme C, recruiter half).** RES2, MAT1, PREP2, PREP3, CV3, SHELL5, DEC4, SCOR6. The `--lang` threading template applied across CLIs + report chrome.
- **Wave 5 — Dev-case closes its loop (Theme D).** DEVS1+DEVO1 (merged apply page), DEVO3, DEVO2+DEVS2 (merged outcomes), DEVP1, DEVS5.
- **Wave 6 — Comms Center + link lifecycle (Theme E).** SIM1, SIM2+DEVO5+DEVS4 (merged), SCH1, VOX1, VOX2, PROF2.
- **Wave 7 — Automation you can trust (Theme F).** AUTO1, AUTO2, AUTO3, DEC1, PREP1 (+ AUTO4/AUTO5 if room).
- **Wave 8 — Lifecycle & CRUD sweep (Theme H).** JOB1, JOB2, JDL1, JDL2, JDL3, APP1 (+ CV1, PROF1, PROF3 — or split into 8a/8b).
- **Wave 9 — Shell productivity + analytics actionability (Themes G+I).** SHELL1, SHELL2, SHELL3, PIPE1, ANA1, ANA2, ANA3 (the `tabs.ts` deep-link substrate unifies them).
- **Wave 10 — Ops (Theme J).** DATA1, DATA2, DATA3, DATA4, DATA5 (+ AUTO6).
- *(Remaining M/L — PIPE2-4, SHELL4/6, SCH2/3, PROF4-6, CV2, APP2/3, RES3/4, MAT3/4, ANA4/5, DEC2/3, VOX3, SIM4-6, DEVO4/6, DEVP4, GH6, DATA6, PREP4 — fold into whichever wave touches their surface, or run a Med/Low sweep at the end like the prior campaign's W15/W16.)*

---

## How this scan was run

- **Scanner:** Feature Scout (`agent_feature_scout`) — role/focus/quality-bar from `src/lib/prompts/registry/agents/feature-scout.ts` in the Vibeman repo.
- **Pipeline:** Vibeman Pipeline B (Scan + Triage + Implementation), opportunity lens.
- **Date:** 2026-06-10. **Scope:** ALL 22 contexts, full-stack (TS/React + Python `pipeline/jobfit/**`).
- **Method:** 22 `general-purpose` subagents, rolling dispatch capped at 8 concurrent. The 12 never-scouted contexts got the standard 4–6-finding scout; the 10 contexts mined by the retired `feature-scout-2026-06-08` campaign got a **hard-dedup re-scan brief**: read the prior per-context report + the retired-backlog INDEX banner + `harness-learnings.md` first, report only net-new gaps (0–4, padding forbidden), with sibling-scout claims listed in each brief to prevent cross-context double-claiming.
- **Files read:** ~480 across all subagents (with overlap; each scout also read the 2 prior-campaign docs).
- **Verification:** header-sum (110) == bullet-count (110) == 48H/44M/18L by both methods. ✓
- **Dedup discipline honored:** every report ends with a "Cross-checks performed" section listing the prior findings checked and the collisions dropped. The mined re-scans dropped ~15 candidate findings as already-shipped/retired/claimed-by-sibling; 4 independent-convergence duplicate pairs are flagged above instead of being silently merged.
- **Baseline at scan time:** `tsc --noEmit` = 0 errors; `npm run test:unit` = 638/638; `npm run test:python` = 500 OK (4 skipped). (`vitest` reports a false baseline here — use the npm scripts, per `harness-learnings.md`.)
- **Tree state:** `main` == `origin/main` == `7922fbe`, clean. Uncommitted prior-session WIP preserved on branch `wip/results-panel-refactor` (results-tab Panel/SectionCard chrome extraction — pre-i18n base, expect conflicts if taken).
