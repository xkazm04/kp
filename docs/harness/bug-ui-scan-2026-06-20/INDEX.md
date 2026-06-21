# Bug-Hunter + UI-Perfectionist Scan — kp, 2026-06-20

> Combined reliability + UI/UX audit of the **kp** recruiting/hiring SaaS (Next.js App Router +
> TypeScript/React, Python `pipeline/jobfit` AI matching engine, SQLite/better-sqlite3, Polar billing, i18n).
> 43 parallel subagent runs across all 43 contexts, batched in 6 waves of ≤8.
> Smart lens per context: **bug-hunter** on 16 logic/data/security/pipeline contexts, **ui-perfectionist** on 27 UI contexts.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 43 contexts | 10 | 107 | 126 | 57 | **300** |
| Share | 3.3% | 35.7% | 42.0% | 19.0% | 100% |

Counts verified three ways (sum of per-report `> Total:` headers = sum of `## N.` headings = count of `**Severity**` bullets = **300**).

Baseline health (pre-fix): **2 tsc errors** (both in `app/_lib/db/core.ts:503-504`), **990/993 unit tests pass** (3 pre-existing failures: `billing-gate`, `pipeline-github-handle`, `rematch-source`).

---

## Per-context breakdown

Sorted by criticals desc, then total. Lens: 🐛 = bug-hunter, 🎨 = ui-perfectionist.

| # | Lens | Context | C | H | M | L | Total | Report |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 🐛 | Auth, Sessions & Workspace Tenancy | 2 | 2 | 2 | 1 | 7 | `auth-sessions-workspace-tenancy.md` |
| 2 | 🎨 | App Shell & Navigation | 1 | 2 | 3 | 1 | 7 | `app-shell-navigation.md` |
| 3 | 🎨 | Candidate Onboarding Hand-off | 1 | 3 | 2 | 1 | 7 | `candidate-onboarding-hand-off.md` |
| 4 | 🐛 | CV Extraction & Pipeline Services | 1 | 3 | 2 | 1 | 7 | `cv-extraction-pipeline-services.md` |
| 5 | 🐛 | Data Store & Persistence | 1 | 3 | 2 | 1 | 7 | `data-store-persistence.md` |
| 6 | 🎨 | Guided Pipeline Simulation | 1 | 3 | 2 | 1 | 7 | `guided-pipeline-simulation.md` |
| 7 | 🐛 | Hiring Automation & Scheduler | 1 | 3 | 2 | 1 | 7 | `hiring-automation-scheduler.md` |
| 8 | 🐛 | Matching & Transformation Engine | 1 | 3 | 2 | 1 | 7 | `matching-transformation-engine.md` |
| 9 | 🐛 | Privacy, Consent & Provenance | 1 | 2 | 3 | 1 | 7 | `privacy-consent-provenance.md` |
| 10 | 🎨 | Analysis Result Panels | 0 | 3 | 3 | 1 | 7 | `analysis-result-panels.md` |
| 11 | 🎨 | Analytics & Calibration Dashboards | 0 | 3 | 3 | 1 | 7 | `analytics-calibration-dashboards.md` |
| 12 | 🎨 | Application Intake & Apply Flows | 0 | 3 | 3 | 1 | 7 | `application-intake-apply-flows.md` |
| 13 | 🎨 | Architecture Diagrams | 0 | 3 | 3 | 1 | 7 | `architecture-diagrams.md` |
| 14 | 🐛 | Billing Engine & Webhooks | 0 | 2 | 3 | 2 | 7 | `billing-engine-webhooks.md` |
| 15 | 🎨 | Candidate Profile & Job Matching | 0 | 3 | 3 | 1 | 7 | `candidate-profile-job-matching.md` |
| 16 | 🐛 | Communications & Inbound Channels | 0 | 3 | 3 | 1 | 7 | `communications-inbound-channels.md` |
| 17 | 🎨 | CV Analysis Workspace | 0 | 3 | 3 | 1 | 7 | `cv-analysis-workspace.md` |
| 18 | 🎨 | Dev Case Authoring & Publishing | 0 | 3 | 3 | 1 | 7 | `dev-case-authoring-publishing.md` |
| 19 | 🐛 | Dev Case Pipeline (Python) | 0 | 3 | 3 | 1 | 7 | `dev-case-pipeline-python.md` |
| 20 | 🎨 | Dev Lifecycle, Cohort & Outcomes | 0 | 3 | 3 | 1 | 7 | `dev-lifecycle-cohort-outcomes.md` |
| 21 | 🎨 | Dev Submissions & Live Work Surface | 0 | 3 | 3 | 1 | 7 | `dev-submissions-live-work-surface.md` |
| 22 | 🐛 | Evaluation, Fairness & Seed Data | 0 | 3 | 3 | 1 | 7 | `evaluation-fairness-seed-data.md` |
| 23 | 🐛 | GitHub Evidence & CV Utilities | 0 | 3 | 2 | 2 | 7 | `github-evidence-cv-utilities.md` |
| 24 | 🎨 | Group Evaluation & Fairness | 0 | 3 | 3 | 1 | 7 | `group-evaluation-fairness.md` |
| 25 | 🎨 | Interview Scheduling, Prep & Rubric | 0 | 2 | 3 | 2 | 7 | `interview-scheduling-prep-rubric.md` |
| 26 | 🎨 | Interview Simulation & Comparison | 0 | 2 | 3 | 2 | 7 | `interview-simulation-comparison.md` |
| 27 | 🎨 | JD Authoring Library & Templates | 0 | 2 | 4 | 1 | 7 | `jd-authoring-library-templates.md` |
| 28 | 🎨 | Job Postings & Lifecycle | 0 | 3 | 3 | 1 | 7 | `job-postings-lifecycle.md` |
| 29 | 🎨 | Landing & Marketing | 0 | 3 | 3 | 1 | 7 | `landing-marketing.md` |
| 30 | 🐛 | LLM Provider Layer (Python) | 0 | 4 | 2 | 1 | 7 | `llm-provider-layer-python.md` |
| 31 | 🐛 | Model & API Key Management | 0 | 3 | 2 | 2 | 7 | `model-api-key-management.md` |
| 32 | 🎨 | Offers & Onboarding | 0 | 2 | 3 | 2 | 7 | `offers-onboarding.md` |
| 33 | 🎨 | Pipeline Board & Candidate Drawer | 0 | 3 | 3 | 1 | 7 | `pipeline-board-candidate-drawer.md` |
| 34 | 🐛 | Pipeline CLIs & Script Bridges | 0 | 3 | 3 | 1 | 7 | `pipeline-clis-script-bridges.md` |
| 35 | 🎨 | Plans, Checkout & Billing UI | 0 | 2 | 3 | 2 | 7 | `plans-checkout-billing-ui.md` |
| 36 | 🎨 | Screening Decisions & Records | 0 | 2 | 3 | 2 | 7 | `screening-decisions-records.md` |
| 37 | 🎨 | Shared UI & Design System | 0 | 3 | 3 | 1 | 7 | `shared-ui-design-system.md` |
| 38 | 🐛 | Shared Utility Libraries | 0 | 3 | 3 | 1 | 7 | `shared-utility-libraries.md` |
| 39 | 🎨 | Skill Matrix & Coverage | 0 | 2 | 4 | 1 | 7 | `skill-matrix-coverage.md` |
| 40 | 🎨 | Sourcing, Campaigns & Rediscovery | 0 | 3 | 3 | 1 | 7 | `sourcing-campaigns-rediscovery.md` |
| 41 | 🎨 | Tasks & System Operations | 0 | 3 | 3 | 1 | 7 | `tasks-system-operations.md` |
| 42 | 🎨 | Voice Interview | 0 | 3 | 3 | 1 | 7 | `voice-interview.md` |
| 43 | 🐛 | Pipeline Test Suite (Python) | 0 | 2 | 3 | 1 | 6 | `pipeline-test-suite-python.md` |

---

## All 10 critical findings — grouped for triage

### A. Auth / multi-tenancy / privacy (security) — 4 criticals
1. **Auth — anonymous `/api/demo` session reaches the unscoped recruiter surface → cross-tenant PII read.** `GET /api/demo` mints a valid signed session; only `analyses`+`profiles` are workspace-scoped while ~28 tables (incl. `listPipeline()`) ignore workspace, so a demo session reads the real tenant's candidate PII. `app/api/demo/route.ts:31`, `app/_lib/db/pipeline.ts:286`, `app/_lib/workspace-lock.ts`.
2. **Auth — `/api/workspace/export` dumps the ENTIRE database to any session-holder** (incl. the demo session above). `dumpWorkspace()` streams every table with no `requireOperator()` gate. `app/api/workspace/export/route.ts:22`, `app/_lib/db-portability.ts:53`.
3. **Hiring Automation — every automation route is unauthenticated/unauthorized.** No `middleware.ts` exists; anyone can spend LLM budget, email candidates via `dispatchOutreach`, arm the autonomous 1-min clock, and mutate the whole pipeline board. `app/api/automation/run|schedule|[task]/route.ts`.
4. **Privacy/GDPR — erasure/anonymization leaves saved `analyses` fully un-scrubbed.** `anonymizeEntry` scrubs profile/entry columns but never the `analyses` rows (full CV `rawText`, name, email, phone), which have no FK back to the entry — a right-to-erasure breach; PII stays readable via History / `/api/analyses/[slug]`. `app/_lib/db/pipeline.ts:1005`, `app/_lib/db/analyses.ts:46`.

### B. Availability / data-integrity infrastructure — 3 criticals
5. **CV Extraction — letter-spacing/text-repair regexes run uncapped on the full 2 MB buffer → CPU-pinning DoS.** A crafted single-letter-spaced CV pins a worker on the public extraction path. `pipeline/jobfit/extractors.py:131-184`.
6. **Data Store — `ensureDb()` first-boot init is not guarded against concurrent re-entry.** `_db` is assigned only after the whole CREATE/ALTER/seed/backfill block (not on `globalThis`); HMR reloads + 17 sibling connections re-run seeding/migrations mid-write, and a bare `catch {}` swallows migration failures. `app/_lib/db/core.ts:97,792`.
7. **Matching — archetype weight vectors are trusted to sum to 1.0 but validated nowhere.** A one-digit typo in `archetypes.json` silently rescales every match score, fit band and shortlist for that archetype, each individual score still looking plausible. `pipeline/jobfit/matching.py:608`, `pipeline/jobfit/archetypes.json`.

### C. Functional UI crash / blocker — 3 criticals
8. **Candidate Onboarding — recruiter `patch()` writes an error envelope into `detail` with no `r.ok` guard.** On a 404/500 it stores `{error,code}` as a `RunDetail`; next render crashes on `detail.run`/`detail.tasks.map`, blanking the whole tab with no recovery. `app/features/sub_onboarding/OnboardingTab.tsx:374`.
9. **App Shell — mobile/narrow viewport dumps all 6 nav groups (~16 tabs) above content with no hamburger/disclosure.** Every page's content is pushed a full screen below the fold; the studio is near-unusable on a phone. Affects every page. `app/features/Workspace.tsx:107,114`.
10. **Guided Simulation — `SimOfferFrame` mounts a full-screen dimmed iframe overlay that is inert-by-design while running**, with no `role="dialog"`/focus management and only a tiny X/Escape — on the marketing auto-run a prospect is trapped behind a dim layer. `app/features/simulation/SimOfferFrame.tsx:44`.

---

## Triage themes (cross-cutting patterns)

| Theme | ~Count | Why it's a wave, not one-offs |
|---|---:|---|
| **Unauthenticated / unauthorized API surface** | ~8 | No `middleware.ts`; automation, github-analysis, erasure, demo, export, login all lack auth/rate-limit. One mental model (add an auth+rate-limit boundary) fixes many. |
| **Cross-tenant workspace-scoping gaps** | ~6 | ~28 tables ignore workspace; `listPipeline()` + export + `anonymizeProfile` (default-tenant pinned). Single isolation model. |
| **GDPR / PII / redaction** | ~6 | Analyses not scrubbed, blind-screen name leak, redaction misses prefixless keys, unthrottled public erasure. |
| **Silent failure / no `r.ok` guard / success-theater** | ~30 | Error envelopes stored as data, writes with no `.ok` check, optimistic UI claims success on a no-op, swallowed `fetch`→`[]`, copy buttons fail silently. The single largest theme. |
| **Resource leak / DoS / process hygiene** | ~10 | Regex DoS, orphaned Python children on timeout, uncapped `Promise.all` fan-out, missing `request.signal`/timeouts, retry storms. |
| **Money / entitlement integrity** | ~6 | Stale `clear_subscription`→free, `past_due` indefinite grace, post-checkout "now Free" display, `salary:0` truthiness. |
| **Scoring / fairness correctness** | ~12 | Unvalidated weights, divide-by-zero, score overflow/saturation, "green-theater" fairness probes that can't fail. |
| **Concurrency / races / idempotency** | ~12 | DB-init re-entry, `received_count` retry corruption, double-submit (publish/add-CV), per-process dedup across instances, missing CAS. |
| **i18n drift in a bilingual app** | ~6 | Compare tab, AnalysisProgress, FactorChart, dev forms hardcoded English under localized headings. |
| **a11y — hand-rolled dialogs / focus** | ~10 | 5+ `role="dialog"` bypass the shared `Modal` (no focus trap/scroll-lock/Escape-stack), dangling `aria-controls`, broken tab semantics. |
| **a11y — labels / keyboard / contrast / color-only** | ~25 | Title-only selects, drag-only kanban with no keyboard path, inaccessible charts, color-only status, contrast risks. |
| **Missing UI states (loading / empty / error) + CLS** | ~30 | Bare "Loading…" text, no skeletons, no empty states, error-without-retry, layout shift — pervasive across panels. |
| **Mobile / responsive breakage** | ~6 | App-shell nav, week-grid calendar, fixed-col matrices/grids overflow on phones. |
| **Destructive ops without confirmation** | ~4 | Full-DB restore on one click, DB import, screen-wave commit — only passive warnings. |
| **Component duplication / missing primitives** | ~6 | No shared Select/Input/CopyButton; 32 raw `<select>`; re-rolled dialogs — root cause of much of the a11y debt. |

---

## Suggested next-phase fix-wave split

Each wave ≈ one coherent mental model, ~5–8 fixes, atomic commits, verified vs baseline (2 tsc / 990-of-993).

- **Wave 0 — Foundation (tiny):** fix the 2 tsc syntax errors in `app/_lib/db/core.ts:503-504` (backticks inside the schema template literal) → tsc baseline to 0, so the regression gate is crisp.
- **Wave 1 — Security: auth + tenancy + privacy criticals (highest stakes):** add an auth/rate-limit boundary to the automation/export/erasure surfaces; gate `/api/workspace/export` behind `requireOperator()`; constrain the demo session; scope `listPipeline()`/key reads to workspace; scrub `analyses` on erasure. (criticals 1–4 + supporting Highs)
- **Wave 2 — Availability & data-init:** regex DoS cap + worker timeout, kill orphaned Python on timeout, `globalThis`-guarded `ensureDb()` single-flight, cap the GitHub fan-out. (criticals 5–6 + Highs)
- **Wave 3 — Money & scoring integrity:** validate archetype weights sum, stale-`clear_subscription` guard, `past_due` grace bound, post-checkout entitlement-settled display, fairness green-theater probes. (critical 7 + billing/eval Highs)
- **Wave 4 — Silent-failure / success-theater (functional):** onboarding error-envelope crash, DevTab/Dev write `r.ok`+error UI, group-eval optimistic-success-on-no-op, board optimistic-revert feedback, comms `received_count` retry. (critical 8 + the big silent-failure theme)
- **Wave 5 — i18n + shared primitives:** Compare/AnalysisProgress/FactorChart localization; introduce shared `Select`/`Input`/`CopyButton`; route the 5 hand-rolled dialogs through `Modal`.
- **Wave 6 — a11y sweep:** dialog focus-traps, dangling `aria-controls`, keyboard nav (kanban, tabs, radiogroups), chart/select labels, color-only state, contrast.
- **Wave 7 — UI states + responsive + destructive-op confirms:** loading/empty/error states + CLS, mobile app-shell nav (critical 9) + guided-sim overlay (critical 10), typed-confirm gates on full-DB restore/import.

---

## How this scan was run

- **Scanners:** Vibeman registry prompts `bug_hunter` (🐛) and `ui_perfectionist` (🎨), role text in `_role-bug-hunter.md` / `_role-ui-perfectionist.md` (this dir).
- **Date:** 2026-06-20. **Project:** kp (`a3f8c2d1-7b4e-4f9a-9c6d-2e8b5a1f0d47`), `C:/Users/kazda/kiro/kp`.
- **Scope:** all 43 contexts from the committed `context-map.json` (12 groups, 919 file refs). Lens assigned per context: bug-hunter on `lib`/`data`/`test`/`integration` + the API-key context; ui-perfectionist on `ui` contexts.
- **Method:** 43 isolated `general-purpose` subagents, batched in 6 waves of ≤8, each reading its context's files and writing one structured report; orchestrator read only terse replies.
- **Findings target:** 5–8 per context (43 reports, mostly 7 each).
- **Verification:** counts agree three ways (header sum = heading count = severity-bullet count = 300).
- **Vibeman API:** running on `http://localhost:3003` (port 3000 was occupied).
