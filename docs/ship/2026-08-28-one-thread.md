# Ship milestone design record: one-thread

Personas milestone id: `a8d7bdd8-1f86-4136-8650-b49fc3bced44` (project `kp`). Created 2026-08-28 from the operator's brief through the management API; this file is the impact analysis the cut was derived from. Goals, buckets and ratings live in the Personas Ship tab; this record travels with the code.

# KP (CandiDate) — core-path impact analysis (read-only, 2026-08-28)

Repo: `C:\Users\kazda\kiro\kp`, branch `main` @ `1d53a62c` (2026-08-27). Working tree: 2 generated files dirty, one untracked `.kp-gate-results.db`.
Brief under test: "JD -> Assignment creation -> Assignment evaluation -> AI interview -> Candidate scoring should be seamless, consistent in UI and data, battle-tested."

---

## 1. CORE PATH MAP

### Step 1 — Job description (JD -> Job)
- Routes: workspace `/?tab=library` ("Job descriptions", `app/features/shell/tabs.ts:31`) and `/?tab=jobs` ("Jobs", `tabs.ts:30`); public `/jds/[slug]`. Role intake dialog is a sub-tab of the same console (`docs/features/intake/README.md:11-14`).
- Components: `app/features/library/jds/JdsBuilder.tsx` (+41 files), `app/features/library/jobs/JobsTab.tsx` (+65 files).
- API: `POST /api/jds/save` (saves `jds` row, then best-effort `ingestStructuredJob` -> `jobs` row `jd-<slug>`; `docs/features/jobs/README.md:59-85`), `POST /api/jobs/[id]/publish` ("Source into Pipeline", sets `jobs.status='published'` and sources candidates, `jobs/README.md:15-26,110-124`), `/api/intake` (RoleBrief).
- Pipeline: `app/_lib/jd-build-run.ts`, `pipeline/jobfit/rolebrief.py`, `pipeline/jobfit/intake.py`; LLM use cases `jd_ingest`, `role_intake` (`app/_lib/llm-config.ts:34,51`).
- Data: `jds` (`app/_lib/db/core.ts:222`, slug PK, later `analysis_json`/`build_input_json` at `:1267-1282`), `jd_revisions` (`:235`), `jobs` (`:309`, id `jd-<slug>`, structured fields + `payload_json`), `role_intakes` (`:819`, carries `jd_slug`, `job_id`).
- Vocabulary already splits three ways in one step: **JD** (`jds`), **Job / posting** (`jobs`, `JobsPostingModal.tsx`), **Role / RoleBrief** (`role_intakes`). Status: `jobs.status` draft|published|closed (`jobs/README.md:15-20`) — "published" means internal go-live, not job boards (`:119-124`).

### Step 2 — Assignment (dev case) creation
- Route: `/?tab=assignments` (UI label "Assignments", legacy `?tab=dev`; `tabs.ts:40`; `docs/features/dev-case/README.md:17-23`). Code, API, DB and docs all say **devcase / dev case / Dev Case**; the UI says **Assignments**; the lifecycle row says **case**. Three names for one entity.
- Components: `app/features/tools/devcases/DevTab.tsx` -> `DevTabDefineView.tsx` (`DevNeedForm.tsx`) -> `DevTabCasesView.tsx` -> `DevCaseDetail.tsx` (60 files).
- API: `POST /api/devcase` (approve role+case, `app/api/devcase/route.ts:29-48`), `/api/devcase/lifecycle` + `[id]/approve|close|redesign`, `/api/devcase/publish`, `/api/devcase/postings`; orchestrator `app/_lib/devcase-orchestrator.ts` (10 lifecycle stages at `:66`: intake, analyzed, designed, awaiting_approval, approved, published, collecting, ranked, promoted, closed).
- Pipeline: `pipeline/jobfit/devcase/analyze.py`, `design.py` (prompts `case-design-v6`, `role-design-v4`), `seed_materializer.py`, `baseline.py`; LLM use cases `devcase_analyze|role_design|case_design|seed` (`llm-config.ts:37-46`). Engine: Claude CLI default with deterministic fallback (`docs/architecture/README.md:96-103`).
- Data: `dev_cases` (`core.ts:449-460`: `need_json`, `analysis_json`, `role_json`, `case_json`, later `scenario_json`/`seed_json`/`baseline_json` at `:1169-1317`), `dev_postings` (`:464`: `case_id`, `channel`, `token`), `dev_lifecycle` (`:574`).
- **HANDOFF 1->2 (JD -> case): user re-selects.** `DevNeedForm.tsx:68-74` forces the recruiter to pick a saved JD from a dropdown; the pick is stored only as `DevNeed.jdSlug` inside `dev_cases.need_json` (`app/_lib/devcase-run.ts:55-59`). **No `jd_slug`/`job_id` column exists on `dev_cases` or `dev_postings`** (schema `core.ts:449-473`; all ALTERs at `:1161-1317` add none), and `app/_lib/db/devcase.ts` never reads a JD or job id (grep: 0 hits). The link is one-way, unindexed, invisible to the Jobs tab.

### Step 3 — Assignment evaluation
- Route: same Assignments tab, `DevCaseDetail.tsx` -> `DevEvalPanel.tsx` / `DevEvalPanelScores|Checks|Integrity|ProcessTrace.tsx`, `DevCompareSubmissions.tsx`. Candidate side: `/devcase/apply/[token]` (`LiveWorkSurface.tsx`).
- API: `POST /api/devcase/session/[id]/submit`, `/api/devcase/submit`, `/api/devcase/inbound`, `/api/devcase/promote` (`dev-case/README.md:102-119`).
- Pipeline: `evaluate.py` (+`reflect.py`, `submission_eval.py`, `artifact_checks.py`, `process_events.py`); prompts `followups-v2`, `transfer-v1`; use cases `devcase_reflect|tooling|evaluate|transfer|judge`. Judge independence: `devcase_judge` seat exists but **falls back to the generator when the seat is unconfigured** (`pipeline/jobfit/devcase/calibrate.py:384`, `lifecycle_eval.py:300`).
- Data: `dev_submissions` (`core.ts:475-486`: `candidate_ref` free text, `eval_json`, `transfer_score` 0-100), `dev_sessions`, `dev_session_events` (hash chain), `dev_session_chat`, `skill_profiles` (`:544`).
- **HANDOFF 3->pipeline (promote): identity is minted, not joined.** `promoteSubmission` creates a pipeline entry with `candidateId: "ds-<submissionId>"`, `jobId: "dc-<caseId>"`, `archetype: "bau"` and `roleFamily: "software_engineering"` hardcoded, `stage: "Screened"` (`app/_lib/devcase-run.ts:840-851`). Case sourcing does the same with `jobId: dc-<caseId>` (`:757`). So a candidate who came in through the JD's real job (`jd-<slug>`) and then did the assignment exists **twice** on the board under two job ids, and the assignment's entry never points at the JD.
- **Score conflation:** the promote writes the **transfer score** into `pipeline_entries.match_score` (`matchScore: score` at `:848`, where `score = sub.transferScore ?? Number(transfer.transferScore ?? 0)` at ~`:810`) — a `?? 0` fabrication the repo banned for match scores (`app/_lib/match-score.ts:1-17`). The board then renders it through `canonicalScoreOf` with provenance `snapshot` (`match-score.ts:144-147`, `PipelineCandidateRow.tsx:94-95`) as a plain "match" number.
- **Observed-skill bridge still gated.** `mintObservedFromCaseInterview` returns early unless `isEarlyCareer(entry.archetype)` (`devcase-run.ts:326`) — the UAT 2026-07-20 wiring item #5 (`uat/runs/2026-07-20-cases-scoring/SUMMARY.md:143`) is unfixed; promoted `ds-` entries are hardcoded `bau`, so they can never take that branch. `mintObservedFromSubmission` (`:403`) exists but requires a `candidateRef` that resolves to a saved profile (`:398-401`), which a `ds-` identity does not.

### Step 4 — AI (voice) interview
- Routes: recruiter `/?tab=interview` ("Interview sim", `tabs.ts:18`) + pipeline drawer `PipelineVoiceScreenPanel.tsx`; candidate `/interview/[token]`; lab `/interview-lab`.
- API: `POST /api/interview/create` (**requires a pipeline `entryId`**, `app/api/interview/create/route.ts:37-39`, brief via `buildGroundedInterview(entryId)` `:66`), `/api/interview/connect`, `/api/interview/complete` (scorecard only when `session.entryId && status === "completed"`, `complete/route.ts:276-278`), `/api/interview/by-entry`, `/api/interview-prep/scorecard` (human scorecard).
- Pipeline: `app/_lib/interview-run.ts` (Task 5 `scorecard` -> `runAutomationTask`, `:515-534`), `pipeline/jobfit/automation.py:865 interview_scorecard` (prompt `scorecard-v6`, Claude CLI default), voice transport ElevenLabs / OpenAI Realtime (`docs/features/interviews/README.md:42-48`). Case-grounded scenario `interview-scenario-v2` keyed off `dc-` job ids (`app/_lib/student-interview.ts:261-263`).
- Data: `interview_sessions` (`core.ts:597-621`: `entry_id`, `job_id`, `transcript_json`, `scorecard_json`, status created|in_progress|completed|failed|revoked), approval `scorecard_review` on the entry (`app/_lib/approval-kinds.ts:12`).
- **HANDOFF 3->4: automatic only via the pipeline entry.** A voice screen can only be minted for an entry, so an assignment candidate is interviewable only after promote created the `ds-`/`dc-` entry. The same-day-screen flow lands the transcript on the entry (`by-entry`), not on the submission; `DevInterviewKit.tsx` reads the eval, the interview reads the entry — two evidence bundles, no shared id beyond the `ds-` prefix parsing in `student-interview.ts:265-267`.

### Step 5 — Candidate scoring / decision
- Routes: `/?tab=pipeline` ("Overview", Kanban), `/?tab=decisions` (`DecisionsTab.tsx`, `DecisionsScreenWaveModal.tsx`, `GroupEvalModal.tsx`), `/?tab=matrix` (candidate x role grid), `/?tab=analyze` (CV analysis).
- API: `/api/match`, `/api/match/reasoning` (`match-reasoning-v4`), `/api/decisions/screen-wave` (dry-run + signed approval token), `/api/decisions/records`, `/api/analyze`, `/api/pipeline`.
- Pipeline: `pipeline/jobfit/matching.py` (`score_job`), `taxonomy.py` (provenance weights, default `self_declared` 0.4 since 2026-07-20, `docs/features/matching/README.md:95-120`), `gemini.py` (CV analysis, Gemini engine), `automation.py` (Claude CLI).
- Data: `analyses.score` (`core.ts:199-206`), `pipeline_entries.match_score` + `approval_kind` (`:361-371`), `pipeline_events` (`:394`), `decision_records` (via `decision-record-store.ts`), `profiles` (`:334`).
- **Four score kinds share one 0-100 look:** (A) `analyses.score`, (B) `pipeline_entries.match_score` snapshot, (C) fresh `score_job` recompute (`match-score.ts:52-80` documents the three), plus (D) devcase transfer score written into (B), plus interview scorecard ratings 1..5 projected to percent (`app/_lib/format.ts:607`, `interview-scorecard.ts:14-19`). Verdict vocabularies: interview `advance|hold|reject` (`interview-recommendation.ts:32`), devcase promote `advance|hold` (`devcase-run.ts:~795`), screen wave reasonCodes, decisions approval kinds `decision|screening_review|scorecard_review|rejection_review|offer_review` (`approval-kinds.ts:10-15`).
- **HANDOFF 4->5: automatic but fan-out.** Completion seals an `ai_scorecard` decision and sets `scorecard_review` (`complete/route.ts:153-155,181-185`) which the Decisions queue, Today rail and Schedule tab each render (`grep scorecard_review app/features` -> 10 files). The Interview->Offer gate is thus real; the devcase transfer score has no gate consumer other than the `screening_review` card promote writes.

### Handoff summary
| Seam | Automatic? | Shared id | Notes |
|---|---|---|---|
| JD -> Job | yes, best-effort | `jd-<slug>` | ingest can silently fail (`jobs/README.md:79-85`) |
| Job -> Assignment | **no** — re-pick JD in `DevNeedForm` | none (JSON blob only) | no DB link either way |
| Assignment -> Candidate | token apply; `candidate_ref` free text | none | not a `profiles` row |
| Assignment eval -> Pipeline | on promote | `ds-`/`dc-` synthetic | transfer score becomes "match"; `bau`+`software_engineering` hardcoded |
| Pipeline entry -> Voice interview | yes (`entryId`) | entry id | requires promote first |
| Interview -> Decision | yes (`scorecard_review`) | entry id | good seam |
| Decision -> Scoring/Matrix | partial | `candidate_id` | `ds-` ids have no profile, so Matrix/Match cannot rank them |

UI-pattern inconsistency along the path: JD ledger = sortable table (`JdsLedgerTable.tsx`), Jobs = table + posting modal, Assignments = table + detail view with its own 10-stage strip, Decisions = review cards, Pipeline = Kanban, Matrix = grid. Status chips resolve through three separate catalogs (`DevLabels.ts` for devcase enums, `pipelineEventCatalog.ts`, `channels.comms` for outbox).

---

## 2. USE-CASE MAPPING (12 Personas use cases)

`context-map.json` `use_cases[]` still reference **old 285-map context ids**: every one of the 12 has `primary_context` absent and 100% dangling `contexts[]` (checked programmatically, e.g. "AI Voice Screening" -> `voice-interview` not in the 143 ids; `context-map.json` `provenance.prior_contexts: 285`). The mapping below is by code, not by that field.

| Use case | Position | Evidence |
|---|---|---|
| AI-Assisted JD Authoring | **CORE step 1** | `JdsBuilder.tsx`, `/api/jds/save` |
| Developer Case Assessment | **CORE steps 2-3** | `DevTab.tsx`, `pipeline/jobfit/devcase/*` |
| AI Voice Screening | **CORE step 4** | `/api/interview/create`, `interview_sessions` |
| Candidate–Job Matching | **CORE step 5** (scoring engine) | `matching.py`, `/api/match` |
| Compliant Hiring Decision | **CORE step 5** (decision/seal) | `screen-wave.ts`, `decision-record-store.ts` |
| CV Analysis Pipeline | adjacent (feeds `analyses.score`, producer A) | `analyze-run.ts` |
| Candidate Pipeline Board | adjacent (the surface every handoff lands on) | `PipelineTab.tsx` |
| Candidate Application Intake | adjacent (alternative entry to step 2 candidates) | `app/apply/[id]` |
| Candidate Self-Scheduling | adjacent (human interview, not the AI one) | `/schedule/[token]` |
| Recruitment Funnel Analytics | adjacent (reads the path) | `analytics.ts` |
| Offer Lifecycle Management | after the path | `/offer/[token]` |
| ATS Candidate Egress | unrelated to the path | `ats-egress.ts` |

Order on the path: JD Authoring -> Developer Case Assessment -> AI Voice Screening -> Candidate–Job Matching + Compliant Hiring Decision.

---

## 3. PROOF STATE

### Unit tests (node:test, 601 TS files + 124 Python files)
- JD/jobs: `app/_lib/db/jds-store.test.ts`, `jd-staleness.test.ts`, `jobs-store.test.ts`, `app/features/library/jds/jdsLintWiring.test.ts`, `jobMarkdown.test.ts` (17 TS files matching jd|jds).
- Dev case: 36 TS (`app/_lib/devcase-promote.test.ts`, `devcase-source-promote-tenancy.test.ts`, `db/devcase-publish-dedup.test.ts`, `db/dev-session-integrity.test.ts`, `features/tools/devcases/devcase-vocabulary.test.ts`, …) + 15 Python (`pipeline/jobfit/tests/test_devcase_*.py` incl. `test_devcase_judge_independence.py`, `test_devcase_locale_signals.py`).
- Interview: 28 TS (`app/_lib/interview-run.test.ts`, `voice/candidate-brief.test.ts`, `db/interview-link-lifecycle.test.ts`, …) + 4 Python.
- Scoring/decisions: `app/_lib/match-score.test.ts`, `screen-wave*.test.ts` (6 files), `useAddToPipeline.test.ts`; Python `test_matching.py`, eval harness `npm run test:eval:ci`.
- **No test covers the JD->case->promote->interview chain as one flow.** `devcase-promote.test.ts` pins the suspect-hold parity only.

### Playwright e2e (`e2e/`, 11 specs)
- Keyless CI subset: `journey-role-to-schedule.spec.ts` (wizard -> JD in Library -> self-schedule invite -> candidate books -> withdraws; header `:1-27`), `modal-escape`, `profile-builder` (`.github/workflows/ci.yml:313-314`).
- Key-gated: `analyze-smoke.spec.ts:24` (Gemini). `app-master-hire.spec.ts` (Personas bridge).
- **Nothing drives an assignment, a voice interview, a screen wave or a match run.** The only "journey" spec stops at scheduling; it never touches `?tab=assignments` or `/interview/[token]`.
- **Red on main:** CI run 33060127164 (2026-08-27) -> `E2E deterministic: failure`, 1 failed / 5 passed; the failure is `journey-role-to-schedule.spec.ts:130` (`Name of step 1` textbox never gets a value — the wizard's Pipeline step). Previous main run 32898696925 (2026-08-25) also failed. `scan-sweep.jsonl` batch 13 note: "5 hollow guards IN the release-gating e2e suite incl. the flagship journey".

### UAT (`uat/`, 17 journeys, 9 run dirs)
| Core step | Journey | L1 | L2 | Latest verdict |
|---|---|---|---|---|
| JD -> shortlist | `jd-to-shortlist.md` | 07-02, 07-20 | **never** | 07-20 grounding 2/8 (Jana), 3/9 (Petra) — "L1 only" (`07-02/SUMMARY.md:72`) |
| JD authoring | `role-intake-dialog.md` | 08-07, 08-10 | 08-07 recertify | L1-pass / L1-conditional (`08-10/SUMMARY.md:5-9`) |
| Assignment | `dev-case-hire.md` | 07-02, 07-20 | **never** (token fixture open, `07-20/SUMMARY.md:3-5`) | 4/9 of evidence reaches Eva's screen (`:157`) |
| Voice interview | `voice-interview.md` | 07-02, 07-20 | one targeted probe only (TP-L2-VOICE-01, brief leak) | 6/16, 8/15 (`:165-166`) |
| Scoring / CV | `cv-analysis-jobfit.md` | 07-02, 07-20 | **never** | Petra 8 min saved, "adoption-level finding" (`:169`) |
| Decisions | `screening-decisions.md` | 07-02, 07-20 | 07-02 (Marek, Lucie) | "conditioned on 3 findings Lucie won't sign" (`07-02/SUMMARY.md:71`) |
| Analytics | `analytics-calibration.md` | 08-17 | 08-17 targeted | all three L1-fail (`08-17/SUMMARY.md:9-13`) |

- **Operator's claim confirmed.** No journey walks JD -> assignment -> eval -> interview -> scoring with one job and one candidate. `full-onboarding-lifecycle.md` was the only end-to-end thread and is `promotion: retired` (2026-08-17, `:2-4`); its own text says the legs are "covered by" five separate journeys (`:14-16`). `guided-simulation.md` is keyless synthetic and its phases skip assignments and voice (`app/features/shell/simulation/constants.ts:113-122`: design, source, match, screen, interview->schedule tab, offer, hired). `dev-case-hire.md:54` explicitly scopes cohort/outcomes as "adjacent"; `jd-to-shortlist.md:60` pushes sourcing out; `cv-analysis-jobfit.md:60` pushes add-to-pipeline out.
- Four core journeys cite **paths that no longer exist**: `app/features/sub_match/MatchTab.tsx`, `sub_analyze/AnalyzeForm.tsx`, `sub_decisions/DecisionsTab.tsx`, `sub_history/HistoryTab.tsx` (verified GONE; journeys dated 2026-06-20). An L1 re-run would ground on stale surfaces.
- History: 553 finding ids, 16 live-open (all from role-intake and analytics runs), the 07-20 run's 100 rows are "unstamped-at-archive" (`uat/runs/INDEX.md`).

### Gate commands and last known result
- Ordered gate (`.claude/ship-loop/config.md:14-22`): `npx tsc --noEmit` -> `npm run lint` -> `npm run test:unit` -> `npm run test:python:gate` -> `npm run build` -> deterministic Playwright. AGENTS.md short form: `npm run typecheck` (runs `schemas:gen` first) / `test:unit` / `lint`.
- CI (`ci.yml`): Node quality (typecheck, lint, design:check, i18n:check, docs:check, release:check, test:docs, test:review, test:bench-driver, test:unit, build) · doc-sync · python-gate (+ `test:eval:ci`) · E2E deterministic.
- Pre-push to main (`.githooks/pre-push`): constitution check, typecheck, lint, design, build.
- **Last known: main is RED at the E2E job (2026-08-25 and 2026-08-27 runs); Node quality / Python / doc-sync green.** Branch `fix/gate-lint-20260828` (lint cold-run timeout) also failing as of 2026-08-28 10:00Z. Ship-loop state (`state.md`) last recorded "FULL GREEN" at M9/M10 on 2026-07-27 and has not been updated since.

---

## 4. MARKETING PAGES

Inventory (there is no `app/features` marketing route; `app/features/` is the workspace. Marketing = `/`, `/about`, `/market`, `/trust`, plus `/privacy`, `/terms`):
- `/` — `app/page.tsx:27-35` server-gates landing vs workspace; renders `app/landing/spark/SparkHome.tsx` -> `SparkLanding.tsx:69-90` composing `Topbar · Hero · Marquee · Proof · FeatureGrid · VoiceTeaser · TrustPillars · PricingSection · Cta · Footer` + `SectionRail` + `FeatureSpotlight`. 9 previews under `spark/previews/`, 4 trust demos under `spark/trust-art/`.
- `/about` — `app/about/page.tsx` -> `AboutHome.tsx` -> `AboutCurve.tsx` (7-phase scroll-drawn timeline, `:25-34`), art in `spark/about-art/`.
- `/market` — `app/market/page.tsx` -> `MarketPulseApp.tsx` / `MarketPulseAtlas.tsx` / `CzMap.tsx`, data from committed `data/market_pulse.json` via `market/data.ts`.
- `/trust` — `app/trust/TrustContent.tsx` (server component, English-only by decision `:1-12`, posture from `app/_lib/trust-posture.ts`).
- 69 files, 6,435 lines; largest `market/parts.tsx` 379, `HumanLoopArt.tsx` 261, `Hero.tsx` 241; median well under 150.

### Claims vs code
| Section | Claim (`messages/en.json` `landing.*`) | Verdict |
|---|---|---|
| hero.badge/title | "Automated hiring, human-approved", "on autopilot" | FRESH (automation-run + gates exist) |
| hero.subtitle | "…offers drafted, onboarding started" | **STALE** — onboarding module removed (`docs/features/marketing/README.md:358-364`, `tabs.ts:276-278`) |
| hero.proof | "Open source, AGPL-3.0… full product, free" | FRESH (LICENSE, ADR) |
| marquee.1 | "candidate or model? we can tell" | **UNPROVEN** — watermark is "a mild note, never decisive" (`dev-case/README.md:228-231`); authorship is held for interview, not detected |
| marquee.6 | "Czech + English" | STALE-ish — 4 locales shipped (`i18n/locales.ts:6`) |
| proof.cards.samples | planted flaws, captured prompts, one-shot baseline | FRESH (`dev-case/README.md:155-162`, controls #1-#6) |
| proof.cards.defend | voice interview picks "the two decisions" from the sample | PARTIAL — case-grounded scenario exists (`interview-scenario-v2`) but only reachable through a `dc-` entry; not for JD-job entries |
| proof.cards.sealed / trust.audit | tamper-evident chain naming the human | FRESH mechanism; **UNPROVEN attribution** — `operatorApprover()` returns a placeholder unless `KP_OPERATOR_NAME` set (AI-Act G5, `ai-act-conformity.md:86`); 08-17 UAT: 66 records with `key_id=''` (`08-17/SUMMARY.md:73`) |
| trust.audit.body | "confidence is measured against real outcomes… calibrated" | **UNPROVEN** — calibration label leakage (`07-20/SUMMARY.md:76-80`; 08-17 blocker rank 6) |
| trust.human.body | "No candidate is advanced, offered… by the machine alone… not a setting" | **STALE** — `screeningGate: "auto"` / `offerGate: "auto"` exist (`marketing/README.md:344-357`; AI-Act G16) |
| trust.oversight / trust.gdpr | AI-Act ready, Art. 22 human review | PARTIAL — `/trust` itself lists Art. 9, 11 "Not yet built", Art. 10/13/15/26 "Partial" (`trust-posture.ts:47-114`); "can ask for human review" has no route (RECON-04, `07-20/SUMMARY.md:114-116`) |
| features.score/voice/schedule/inbox/salary/rediscover/gates | | FRESH (each maps to a shipped module) |
| features.offer.body | "accepting fires the onboarding checklist" | **STALE** (same as hero) |
| pricing.tiers.* | 0/240/480 Kč, limits | FRESH — pinned to `plans.ts:60-84` by `PricingSection.test.ts` |
| pricing.enterprise.blurb | "Everything above is in the repository, including SSO" | **UNPROVEN** — no SAML/OIDC/SCIM code (grep: only two comments), backlog #41 E1 SSO open (`backlog.md:45`) |
| /about 7 phases | design→source→intake→screen→interview→offer→hired | FRESH vs `SimPhaseId`, but omits the assignment step entirely |
| /market figures | ISPV/RSCP earnings, validated | FRESH (`marketing/README.md:194-260`, build validators) |

### Technique (what makes it the bar)
- **Copy is data.** 281 `landing.*` keys + `aboutPage`/`jobMarket` namespaces; components hold only structure (`Hero.tsx:31-46`, `FeatureGrid.tsx:26-36`); metadata via `getTranslations` (`about/page.tsx:20-29`). `i18next/no-literal-string` at error for these dirs + attribute grep in `i18n:check` (`marketing/README.md:213-224`).
- **Claims are pinned by tests.** `PricingSection.test.ts` asserts the public price list equals `plans.ts` across 4 catalogs; `AboutCurve.test.ts` walks the whole tree forbidding framer's `useReducedMotion` and ungated `repeat: Infinity`.
- **SSR-safe motion.** `useStillMotion.ts` (`useSyncExternalStore`, server snapshot false) instead of framer's hook; animation gated on `animate`, not markup (`Hero.tsx:97-104`).
- **Fixed art direction with a token file** (`tokens.ts`: STICKER, BTN, palette; `.spark-type` scale in `globals.css`) — literal hexes allowed only under `app/landing/` and enforced by `design:check`. Single theme (0 `dark:` usages) by design; `/trust` uses workspace recipes and both themes.
- **Demonstrate, don't assert**: trust band is four live demonstrations with WAI-ARIA tabs + roving tabindex (`TrustPillars.tsx:36-52`); `erase` is a real button, `review` deliberately is not (`marketing/README.md:105`).
- **a11y**: 109 `aria-*`, 13 `role=`, `focus-ring`, `aria-pressed` on the stampable CVs; axe runs in e2e for schedule pages.
- **Band composition rules documented** (no two adjacent bands share a hue; rail positioned against the content column; `replaceState` scrubber) — `marketing/README.md:50-64,142-168`.
- **Lazy quantitative chart** (`CalibrationChart.tsx` behind `next/dynamic`), previews split one-module-per-card (615/640/416-line files retired, `:40-44`).
- Patterns worth porting: (1) copy-as-catalog + literal-string lint at error, (2) price/claim parity tests against the enforcing module, (3) `useStillMotion`-style external-store reduced-motion, (4) a `Known gaps` section in the marketing doc that names false copy explicitly, (5) `/trust` as a checkable posture page with "Not yet built" rows.

---

## 5. STABILIZATION COVERAGE (scan-sweep)

`.claude/scan-history/scan-sweep.jsonl`: 15 entries.
- 2026-08-05: one context (`ai-analysis-ux`, old map) with 22 lenses (code-optimizer, security-auditor, ux-reviewer, accessibility-checker, …) — 14 findings / 7 fixed.
- 2026-08-20: repo-wide pattern sweep, lenses bounty-hunter/security-auditor/error-handler/tech-debt-tracker/risk-assessor, "not per-context depth" — 7 findings.
- 2026-08-21 → 08-25: 13 batches, **lens_keys `["bug-hunter"]` only**, "one agent per context", 143/143 contexts ("SWEEP COMPLETE"); totals 817 findings / 484 fixed / 120 escalations; 161 commits in the window.
- **No per-context lens ledger exists** (no coverage file under `.claude/`; batch scopes are "contexts N-M by risk" without names). Coverage per context must be inferred from commit subjects.

Core-path contexts (current 143-map names) and inferred lens coverage:
| Group | Contexts (count) | bug-hunter | ui-perfectionist | security | performance | ambiguity |
|---|---|---|---|---|---|---|
| Job & JD Management | 13 (api-jd-library, api-jobs, api-role-intake, jd-library-1/2, jobs-workspace-1/2/3, jobs-and-jobs-workspace, lib-rediscovery, py-jobs-intake, role-intake, role-intake-and-shared-utils) | yes (e.g. `fe2fda51`, `f836c48a`, `652b9dd2`) | none | pattern-only (08-20) | none | none |
| Developer Assessment | 9 (api-devcase-1/2, devcase-candidate-and-devcase, devcase-workspace-1/2/3, lib-devcase-11/12, py-devcase-1) | yes (`b68a883e`, `aaa1c857`, `094207bd`, `c0338453`) | none | pattern-only | none | none |
| Voice Interviews | 8 (api-voice-interview, eval-voice-and-voice-runtime, interview-ui-…, lib-voice-interview-11/12, py-interview-signals, voice-runtime-1, voice-ui-components) | yes (`7f8506a4`, `3adde834`, `cbcfa939`) | none | pattern-only | none | none |
| Candidate Matching & Scoring | 7 (lib-matching, matrix-ui-1/2, py-match-reasoning, py-scoring-core, salary-and-matching-and-analyses, salary-market-and-taxonomy) | yes (`da80f915`, `ad4897d7`) | none | pattern-only | none | none |
| Hiring Decisions & Automation | 8 (decisions-ui-1/2, group-eval-ui, lib-automation, lib-decisions-1/2, lib-group-eval, py-automation) | yes (`f9730d3c`, `0e4dc7e2`) | none | pattern-only | none | none |
| Hiring Pipeline (landing surface) | 10 | yes (`74c65dd8`, `5e86aae1`; `pipeline-composer` deferred 4x then done) | none | pattern-only | none | none |

Counts: **55 of 143 contexts sit on or directly under the core path; 55/55 bug-hunter-swept once; 0/55 ui-perfectionist, performance or ambiguity; security only via the 08-20 repo-wide pattern pass.** Never-swept by any lens: 0 (per the "143/143" claim), but 143/143 have descriptions still reading "[auto-seeded — pending sweep enrichment]" (`context-map.json`), i.e. the sweep did not write back. `tiger/Tiger.md` (LLM call-site lens) last updated 2026-07-15 with devcase judge/eval findings still listed open.

---

## 6. GAP LIST (ranked)

### Product gaps
| # | Gap | Evidence | Size | Use case |
|---|---|---|---|---|
| 1 | Assignment has no DB link to the JD/job; the candidate entry it mints uses synthetic `dc-<caseId>` / `ds-<subId>` ids, so the same person/role exists twice on the board and the JD's own pipeline never sees the assignment | `core.ts:449-486` (no job column), `devcase-run.ts:55-59,757,840-851` | L | Developer Case Assessment / Pipeline Board |
| 2 | Transfer score is written into `match_score` (with `?? 0`) and rendered as "match" with `snapshot` provenance; four 0-100 scores plus a 1-5 rubric look identical | `devcase-run.ts:~810,848`; `match-score.ts:52-80,144-147`; `format.ts:607` | M | Candidate–Job Matching |
| 3 | Observed-skill bridge from case/interview into scoring still gated on `isEarlyCareer`; promoted entries hardcoded `bau` so it never fires | `devcase-run.ts:326,842`; UAT item `07-20/SUMMARY.md:143` | S | Developer Case Assessment |
| 4 | Voice screen is only mintable for a pipeline entry; an assignment candidate must be promoted first, and the transcript/scorecard land on the entry while the eval kit lives on the submission | `create/route.ts:37-39`; `complete/route.ts:276-278`; `student-interview.ts:265-267` | M | AI Voice Screening |
| 5 | Dev-case judge falls back to the generator ("NOT independent") when no `devcase_judge` model is pinned — default installs self-grade | `calibrate.py:384`, `lifecycle_eval.py:300` | S | Developer Case Assessment |
| 6 | Reviewer cannot open the candidate's chat transcript or submitted tree (POST-only session route) | `dev-case/README.md:528-533` | M | Developer Case Assessment |

### Consistency gaps
| # | Gap | Evidence | Size | Use case |
|---|---|---|---|---|
| 7 | Vocabulary: JD / job / posting / role (RoleBrief) for step 1; Assignments (UI) vs devcase (API, DB, docs) vs case (lifecycle) for step 2 | `tabs.ts:30-31,40`; `nav.tabs` in `en.json`; `dev_postings`, `role_intakes` | S (copy) | JD Authoring / Dev Case |
| 8 | Three independent status axes: `jobs.status` (3), dev lifecycle (10, `devcase-orchestrator.ts:66`), pipeline stages (5, per-workspace), interview status (5), submission status (`received`/`evaluated`), each with its own label catalog | `DevLabels.ts`, `pipelineEventCatalog.ts`, `interview-recommendation.ts` | M | Pipeline Board |
| 9 | Engines differ per step with different degrade behaviour: Gemini (CV analysis), Claude CLI (JD ingest, case design/eval, scorecard, match reasoning), ElevenLabs/OpenAI (voice); prompt versions v1–v6 uncoordinated | `docs/architecture/README.md:96-103`; `llm-config.ts:29-53`; prompt ids `case-design-v6`, `scorecard-v6`, `match-reasoning-v4`, `transfer-v1` | M | all core |
| 10 | Hardcoded `archetype: "bau"`, `roleFamily: "software_engineering"`, `stage: "Screened"` on promote (stage literal also listed as deliberately name-coupled) | `devcase-run.ts:842-846`; `pipeline/README.md:96-102` | S | Dev Case / Pipeline |

### Proof gaps
| # | Gap | Evidence | Size | Use case |
|---|---|---|---|---|
| 11 | No test, spec or UAT journey walks JD -> assignment -> eval -> interview -> scoring with one job + one candidate; the only e2e journey ends at scheduling, and it is red on main | `e2e/journey-role-to-schedule.spec.ts:1-27,130`; CI run 33060127164; `full-onboarding-lifecycle.md:2-16` retired | L | all core |
| 12 | Four core journeys never reached L2 (dev-case-hire, voice-interview, jd-to-shortlist, cv-analysis-jobfit) — candidate-token fixture question still open in `env.md` | `07-20/SUMMARY.md:3-5`; `07-02/SUMMARY.md:72`; `uat/env.md` "Open question" | M | Dev Case / Voice / Matching |
| 13 | UAT journeys cite dead file paths (`sub_match`, `sub_analyze`, `sub_decisions`, `sub_history`); `context-map.json.use_cases` point at 12/12 non-existent contexts; scan-sweep has no per-context lens ledger and only the bug-hunter lens ever ran per context | journey files dated 2026-06-20; `context-map.json` provenance; `scan-sweep.jsonl` | S–M | all |

### Copy gaps
| # | Gap | Evidence | Size | Use case |
|---|---|---|---|---|
| 14 | Landing promises onboarding (removed), "a human signs every call… not a setting" (auto gates exist), "candidate or model? we can tell", SSO "in the repository" (not built), "calibrated against real outcomes" (label leakage) | `marketing/README.md:344-364`; `ai-act-conformity.md:96`; `backlog.md:45`; `07-20/SUMMARY.md:76-80` | S (4-catalog copy) + M (SSO) | marketing |
| 15 | `/about` seven phases omit the assignment step the product leads with in `#proof`; assignment appears only as a feature card | `AboutCurve.tsx:25-34`; `SparkLanding.tsx:74-81` | S | marketing |

### What I could not determine
- Whether the 07-20 findings marked "metabolized in code" (`docs/product/uat-insights/HISTORY.md`) include the `dc-`/`ds-` identity design — no fix site cites it; the code above is current.
- Which specific contexts were in which sweep batch (ledger stores only "contexts N-M by risk"); coverage is inferred from commit subjects.
- Live behaviour of any step (no server was run; read-only).
- Whether `.kp-gate-results.db` (untracked) holds a newer local gate result than CI.
