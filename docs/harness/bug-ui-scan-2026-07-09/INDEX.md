# Bug-Hunter + UI-Perfectionist Scan — kp, 2026-07-09

> Combined reliability + UI/UX audit of the **kp** recruiting/hiring SaaS (Next.js 16 App Router +
> TypeScript/React, Python `pipeline/jobfit` AI matching engine, SQLite/better-sqlite3, Polar billing,
> next-intl en/cs/de/fr).
> **46 parallel subagent runs across all 46 contexts**, batched in 6 waves of <=8. Exactly 5 findings per context.
> Lens per context: **both** on 30 UI-bearing contexts, **bug-hunter** on 16 backend/Python contexts.
>
> **Context map was refreshed immediately before this scan** (9 phantom file refs dropped, ~150 orphaned
> files folded in, 3 new contexts created). Coverage 910 -> 1099 of 1184 source files.
>
> This is kp's **fourth** scan. Subagents were given their 2026-06-20 report and required to produce
> *new* findings, or mark a verified-still-present one `[STILL-OPEN]` (<=1 of 5). 27 findings are
> `[STILL-OPEN]` re-reports; the other 203 are new.

> Findings verified two ways: sum of `> Total:` headers = 230; `**Severity**:` bullets = 230. OK

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 46 contexts | 9 | 66 | 125 | 30 | **230** |
| Share | 4% | 29% | 54% | 13% | 100% |

Lens split: **bug-hunter 161** / **ui-perfectionist 70**.

### Never-scanned contexts (created during this run's context-map refresh)

| Context | C | H | M | L | Note |
|---|---:|---:|---:|---:|---|
| Organizations, Members & Invites | 1 | 1 | 2 | 1 | privilege escalation + account takeover |
| ATS Integration & Egress | 1 | 3 | 1 | 0 | SSRF + plaintext signing secret |
| Branding & White-label | 0 | 1 | 3 | 1 | CSS-injection surface probed and found airtight |

**2 of the 3 never-scanned contexts produced a Critical.** They account for 15 findings.

---

## Per-context breakdown

| # | Context | Group | C | H | M | L | Report |
|---:|---|---|---:|---:|---:|---:|---|
| 1 | Auth, Sessions & Workspace Tenancy | Identity, Data & Privacy | 2 | 2 | 1 | 0 | [`auth-sessions-workspace-tenancy.md`](auth-sessions-workspace-tenancy.md) |
| 2 | ATS Integration & Egress | Pipeline, Decisions & Channels | 1 | 3 | 1 | 0 | [`ats-integration-egress.md`](ats-integration-egress.md) |
| 3 | Billing Engine & Webhooks | Billing & Monetization | 1 | 2 | 1 | 1 | [`billing-engine-webhooks.md`](billing-engine-webhooks.md) |
| 4 | LLM Provider Layer (Python) | LLM Provider Layer & Models | 1 | 1 | 3 | 0 | [`llm-provider-layer-python.md`](llm-provider-layer-python.md) |
| 5 | Organizations, Members & Invites | Identity, Data & Privacy | 1 | 1 | 2 | 1 | [`organizations-members-invites.md`](organizations-members-invites.md) |
| 6 | Privacy, Consent & Provenance | Identity, Data & Privacy | 1 | 1 | 2 | 1 | [`privacy-consent-provenance.md`](privacy-consent-provenance.md) |
| 7 | Shared Utility Libraries | Platform, Shell & Shared UI | 1 | 1 | 2 | 1 | [`shared-utility-libraries.md`](shared-utility-libraries.md) |
| 8 | Interview Scheduling, Prep & Rubric | Interviews & Scheduling | 1 | 0 | 3 | 1 | [`interview-scheduling-prep-rubric.md`](interview-scheduling-prep-rubric.md) |
| 9 | CV Extraction & Pipeline Services | AI Matching & Extraction Engine | 0 | 4 | 1 | 0 | [`cv-extraction-pipeline-services.md`](cv-extraction-pipeline-services.md) |
| 10 | Dev Case Pipeline (Python) | Dev Hiring Extension | 0 | 3 | 2 | 0 | [`dev-case-pipeline-python.md`](dev-case-pipeline-python.md) |
| 11 | Matching & Transformation Engine | AI Matching & Extraction Engine | 0 | 3 | 2 | 0 | [`matching-transformation-engine.md`](matching-transformation-engine.md) |
| 12 | Candidate Profile & Job Matching | Candidate Analysis | 0 | 2 | 3 | 0 | [`candidate-profile-job-matching.md`](candidate-profile-job-matching.md) |
| 13 | CV Analysis Workspace | Candidate Analysis | 0 | 2 | 3 | 0 | [`cv-analysis-workspace.md`](cv-analysis-workspace.md) |
| 14 | Evaluation, Fairness & Seed Data | AI Matching & Extraction Engine | 0 | 2 | 3 | 0 | [`evaluation-fairness-seed-data.md`](evaluation-fairness-seed-data.md) |
| 15 | Job Postings & Lifecycle | Jobs, JD Library & Sourcing | 0 | 2 | 3 | 0 | [`job-postings-lifecycle.md`](job-postings-lifecycle.md) |
| 16 | Plans, Checkout & Billing UI | Billing & Monetization | 0 | 2 | 3 | 0 | [`plans-checkout-billing-ui.md`](plans-checkout-billing-ui.md) |
| 17 | Analytics & Calibration Dashboards | Insights, Analytics & Simulation | 0 | 2 | 2 | 1 | [`analytics-calibration-dashboards.md`](analytics-calibration-dashboards.md) |
| 18 | Candidate Onboarding Hand-off | Offers & Automation | 0 | 2 | 2 | 1 | [`candidate-onboarding-hand-off.md`](candidate-onboarding-hand-off.md) |
| 19 | Dev Case Authoring & Publishing | Dev Hiring Extension | 0 | 2 | 2 | 1 | [`dev-case-authoring-publishing.md`](dev-case-authoring-publishing.md) |
| 20 | GitHub Evidence & CV Utilities | Candidate Analysis | 0 | 2 | 2 | 1 | [`github-evidence-cv-utilities.md`](github-evidence-cv-utilities.md) |
| 21 | Group Evaluation & Fairness | Pipeline, Decisions & Channels | 0 | 2 | 2 | 1 | [`group-evaluation-fairness.md`](group-evaluation-fairness.md) |
| 22 | Landing & Marketing | Platform, Shell & Shared UI | 0 | 2 | 2 | 1 | [`landing-marketing.md`](landing-marketing.md) |
| 23 | Sourcing, Campaigns & Rediscovery | Jobs, JD Library & Sourcing | 0 | 2 | 2 | 1 | [`sourcing-campaigns-rediscovery.md`](sourcing-campaigns-rediscovery.md) |
| 24 | Analysis Result Panels | Candidate Analysis | 0 | 1 | 4 | 0 | [`analysis-result-panels.md`](analysis-result-panels.md) |
| 25 | Application Intake & Apply Flows | Pipeline, Decisions & Channels | 0 | 1 | 4 | 0 | [`application-intake-apply-flows.md`](application-intake-apply-flows.md) |
| 26 | Dev Lifecycle, Cohort & Outcomes | Dev Hiring Extension | 0 | 1 | 4 | 0 | [`dev-lifecycle-cohort-outcomes.md`](dev-lifecycle-cohort-outcomes.md) |
| 27 | Screening Decisions & Records | Pipeline, Decisions & Channels | 0 | 1 | 4 | 0 | [`screening-decisions-records.md`](screening-decisions-records.md) |
| 28 | Shared UI & Design System | Platform, Shell & Shared UI | 0 | 1 | 4 | 0 | [`shared-ui-design-system.md`](shared-ui-design-system.md) |
| 29 | Skill Matrix & Coverage | Insights, Analytics & Simulation | 0 | 1 | 4 | 0 | [`skill-matrix-coverage.md`](skill-matrix-coverage.md) |
| 30 | Tasks & System Operations | Platform, Shell & Shared UI | 0 | 1 | 4 | 0 | [`tasks-system-operations.md`](tasks-system-operations.md) |
| 31 | Voice Interview | Interviews & Scheduling | 0 | 1 | 4 | 0 | [`voice-interview.md`](voice-interview.md) |
| 32 | App Shell & Navigation | Platform, Shell & Shared UI | 0 | 1 | 3 | 1 | [`app-shell-navigation.md`](app-shell-navigation.md) |
| 33 | Architecture Diagrams | Insights, Analytics & Simulation | 0 | 1 | 3 | 1 | [`architecture-diagrams.md`](architecture-diagrams.md) |
| 34 | Branding & White-label | Platform, Shell & Shared UI | 0 | 1 | 3 | 1 | [`branding-white-label.md`](branding-white-label.md) |
| 35 | Dev Submissions & Live Work Surface | Dev Hiring Extension | 0 | 1 | 3 | 1 | [`dev-submissions-live-work-surface.md`](dev-submissions-live-work-surface.md) |
| 36 | Guided Pipeline Simulation | Insights, Analytics & Simulation | 0 | 1 | 3 | 1 | [`guided-pipeline-simulation.md`](guided-pipeline-simulation.md) |
| 37 | Hiring Automation & Scheduler | Offers & Automation | 0 | 1 | 3 | 1 | [`hiring-automation-scheduler.md`](hiring-automation-scheduler.md) |
| 38 | JD Authoring Library & Templates | Jobs, JD Library & Sourcing | 0 | 1 | 3 | 1 | [`jd-authoring-library-templates.md`](jd-authoring-library-templates.md) |
| 39 | Model & API Key Management | LLM Provider Layer & Models | 0 | 1 | 3 | 1 | [`model-api-key-management.md`](model-api-key-management.md) |
| 40 | Offers & Onboarding | Offers & Automation | 0 | 1 | 3 | 1 | [`offers-onboarding.md`](offers-onboarding.md) |
| 41 | Pipeline Board & Candidate Drawer | Pipeline, Decisions & Channels | 0 | 1 | 3 | 1 | [`pipeline-board-candidate-drawer.md`](pipeline-board-candidate-drawer.md) |
| 42 | Pipeline CLIs & Script Bridges | AI Matching & Extraction Engine | 0 | 1 | 3 | 1 | [`pipeline-clis-script-bridges.md`](pipeline-clis-script-bridges.md) |
| 43 | Data Store & Persistence | Identity, Data & Privacy | 0 | 1 | 2 | 2 | [`data-store-persistence.md`](data-store-persistence.md) |
| 44 | Pipeline Test Suite (Python) | AI Matching & Extraction Engine | 0 | 1 | 2 | 2 | [`pipeline-test-suite-python.md`](pipeline-test-suite-python.md) |
| 45 | Communications & Inbound Channels | Pipeline, Decisions & Channels | 0 | 0 | 4 | 1 | [`communications-inbound-channels.md`](communications-inbound-channels.md) |
| 46 | Interview Simulation & Comparison | Interviews & Scheduling | 0 | 0 | 3 | 2 | [`interview-simulation-comparison.md`](interview-simulation-comparison.md) |

---

## All 9 Critical findings

1. **Auth, Sessions & Workspace Tenancy** — `/api/channels/` public prefix exposes the recruiter webhook console to anonymous callers
   `proxy.ts:18`

2. **Auth, Sessions & Workspace Tenancy** — `switch-workspace` re-mints without identity claims → any member escalates to owner
   `app/api/auth/switch-workspace/route.ts:35`

3. **ATS Integration & Egress** — Server-side SSRF: webhook URL has no private-IP/metadata guard, `http:` allowed, and `/api/ats/test` is an authenticated probe
   `app/_lib/ats-config-store.ts:76-89`

4. **Billing Engine & Webhooks** — A refunded/disputed minute pack is never clawed back — credits survive the refund
   `app/_lib/billing/reduce.ts:104-123`

5. **Interview Scheduling, Prep & Rubric** — Auth gate serves the bulk-invite route as a public candidate endpoint
   `proxy.ts:33`

6. **LLM Provider Layer (Python)** — KP_OFFLINE no-egress guarantee is defeated by a cloud `OPENAI_BASE_URL`
   `pipeline/jobfit/llm/adapters/openai_api.py:47-53`

7. **Organizations, Members & Invites** — Cap the assignable role to the actor's privilege — an admin can self-promote to owner
   `app/api/org/members/[userId]/route.ts:37-41`

8. **Privacy, Consent & Provenance** — Erasure never reaches interview transcripts or comms — the most sensitive PII survives Art. 17
   `app/_lib/db/pipeline.ts:1070-1123`

9. **Shared Utility Libraries** — Public skill-profile credential token is minted with the NON-crypto `randomId`
   `app/_lib/random-id.ts:21`

---

## Triage themes

| Theme | ~Count | Why this is a wave, not scattered fixes |
|---|---:|---|
| A. Auth gate & authorization model | 12 | 4 of 6 Criticals. `proxy.ts` classifies public routes by **prefix vs exact string**, and the session/role model trusts claim-less cookies. One mental model; the fixes are adjacent lines. |
| B. Gates that cannot fail (success theater) | 11 | A strict eval that skips what it can't score; a health check that never checks liveness; a tautological assert; a robustness panel that asserts from a no-op; a webhook that counts 5xx as delivered. Same shape, same fix discipline: make the gate fail closed. |
| C. GDPR / consent / PII retention | 9 | 1 Critical (erasure misses transcripts+comms). Consent is stored per-entry so any new entry resets it. Fixes must be designed together or they reintroduce each other. |
| D. Money | 9 | Refunds never clawed back; `unpaid`/`past_due` keep entitlement; checkout double-charge guarded only client-side; the voice meter under-reserves. All in the reduce/apply/gate seam. |
| E. Hiring correctness & fairness | 12 | Wrong-default roleFamily, phantom `work_mode` KO, org-handle attribution, no min-sample on the four-fifths test, blind-mode redaction defects, CV prompt injection. These change who gets hired. |
| F. Races, TOCTOU & idempotency | 8 | Close-case double-rejects every candidate; preview->confirm recomputes the set; auto-advance CAS ignores `approvalKind`; offer re-extend diverges from the letter. |
| G. Data integrity & environment leakage | 7 | `seedAnalyses` wipes dispositions every boot; sim CVs land unmarked in a real workspace; benchmark team contaminates the real org benchmark. |
| H. UI states & accessibility | 33 | 14 a11y + 14 missing-ui-state + 5 visual-consistency. The largest bucket by count and the lowest risk per fix; batch by component family. |
| I. Ops & deploy correctness | 5 | Diagrams never shipped into the standalone image; no reaper on hung tasks; unbounded `tasks` growth. |

---

## Suggested wave plan

Ordered by severity x blast-radius, each wave one mental model:

| Wave | Theme | Scope | Risk of the fix |
|---|---|---|---|
| **1** | Auth gate & authz | 4 Criticals + `/jds/` + `/api/ats/*` capability + login throttle | **Changes auth behavior — needs sign-off** |
| **2** | GDPR / erasure | Critical erasure gap + consent-reset on rediscovery + onboarding revoke | Touches deletion paths; needs care |
| **3** | Money | refund clawback, `unpaid`/`past_due`, checkout guard, voice reserve | Billing state machine |
| **4** | Gates that cannot fail | eval `--strict`, scheduler liveness, tautological assert, paste-event wiring | Low risk, high assurance value |
| **5** | Hiring correctness | roleFamily default, `work_mode` phantom, org handles, four-fifths floor | Changes scores — needs eval run |
| **6** | Races & idempotency | close-case, preview->confirm, auto-advance CAS, offer re-extend | Moderate |
| **7** | Data integrity | `seedAnalyses`, sim leak, benchmark contamination | Moderate |
| **8+** | UI states & a11y | 33 findings, batch by component family | Low |

---

## How this scan was run

- **Scanners**: `bug-hunter` + `ui-perfectionist` role prompts from Vibeman's registry
  (`src/lib/prompts/registry/agents/`), copied verbatim into `_role-*.md`.
- **Scope**: all 46 contexts, full-stack (TS/React + Python), 1099 mapped source files.
- **Method**: one `general-purpose` subagent per context, 6 waves of <=8 parallel. Each subagent read
  the shared `_scan-instructions.md`, its role file(s), its manifest entry, and its prior 2026-06-20
  report, then read source and wrote exactly 5 findings. The orchestrator read only the <150-word replies.
- **De-duplication**: known-hardened facts were listed in the shared instructions; each subagent was
  capped at one `[STILL-OPEN]` re-report and had to verify it still reproduces in current code.
- **Cross-pollination**: findings from earlier waves were injected into later briefs as *leads*
  (e.g. the `proxy.ts` prefix-vs-exact class), with an explicit do-not-re-report instruction. This is how
  the second and third `proxy.ts` instances were found.
- **Falsification**: subagents were asked to report probes that came back clean. Several did, and
  those negative results are recorded in the reports (e.g. Branding's CSS-injection surface is airtight;
  `site-url.ts` is not Host-spoofable; offer tokens are CSPRNG; no await-inside-transaction exists).
- **Verification**: `> Total:` header sum (230) == `**Severity**:` bullet count (230) across 46 reports.
- **Baseline at scan time**: `tsc` 0 errors - node unit 1355/1355 - python 781 OK (4 skipped) - clean tree on `main`.
