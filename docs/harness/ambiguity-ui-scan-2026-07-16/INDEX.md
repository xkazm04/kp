# Ambiguity-Guardian + UI-Perfectionist Scan -- kp, 2026-07-16

> Dual-lens audit (Ambiguity Guardian + UI Perfectionist), 5 findings/context target.
> **COMPLETE -- all 46 contexts scanned.** (Scan spanned two sessions across a usage-limit reset; all reports reconciled.)

---

## Totals (46 contexts)

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Count | 2 | 63 | 147 | 43 | **255** |
| Share | 1% | 25% | 58% | 17% | 100% |

Lens split: **172 ambiguity / 83 ui**. Verified: header-sum == severity-bullet-count == 255.

---

## Per-group rollup

| Group | C | H | M | L | Total |
|---|---:|---:|---:|---:|---:|
| Dev Hiring | 1 | 8 | 12 | 2 | 23 |
| Offers/Automation | 1 | 5 | 10 | 1 | 17 |
| Pipeline/Decisions | 0 | 11 | 18 | 7 | 36 |
| Platform/Shell | 0 | 5 | 20 | 6 | 31 |
| AI Engine | 0 | 6 | 14 | 6 | 26 |
| Candidate Analysis | 0 | 5 | 14 | 5 | 24 |
| Insights/Analytics | 0 | 4 | 14 | 4 | 22 |
| Identity/Privacy | 0 | 5 | 12 | 3 | 20 |
| Interviews | 0 | 5 | 11 | 2 | 18 |
| Jobs/JD/Sourcing | 0 | 5 | 10 | 3 | 18 |
| Billing | 0 | 2 | 6 | 2 | 10 |
| LLM Provider | 0 | 2 | 6 | 2 | 10 |

---

## Per-context breakdown (sorted by criticals, then total)

| # | Context | Group | C | H | M | L | Total | Report |
|---:|---|---|---:|---:|---:|---:|---:|---|
| 1 | candidate-onboarding-hand-off | Offers/Automation | 1 | 2 | 3 | 0 | 6 | `candidate-onboarding-hand-off.md` |
| 2 | dev-submissions-live-work-surface | Dev Hiring | 1 | 2 | 2 | 0 | 5 | `dev-submissions-live-work-surface.md` |
| 3 | screening-decisions-records | Pipeline/Decisions | 0 | 3 | 2 | 1 | 6 | `screening-decisions-records.md` |
| 4 | application-intake-apply-flows | Pipeline/Decisions | 0 | 2 | 3 | 1 | 6 | `application-intake-apply-flows.md` |
| 5 | candidate-profile-job-matching | Candidate Analysis | 0 | 2 | 3 | 1 | 6 | `candidate-profile-job-matching.md` |
| 6 | communications-inbound-channels | Pipeline/Decisions | 0 | 2 | 2 | 2 | 6 | `communications-inbound-channels.md` |
| 7 | cv-extraction-pipeline-services | AI Engine | 0 | 2 | 3 | 1 | 6 | `cv-extraction-pipeline-services.md` |
| 8 | dev-case-authoring-publishing | Dev Hiring | 0 | 2 | 3 | 1 | 6 | `dev-case-authoring-publishing.md` |
| 9 | dev-case-pipeline-python | Dev Hiring | 0 | 2 | 3 | 1 | 6 | `dev-case-pipeline-python.md` |
| 10 | dev-lifecycle-cohort-outcomes | Dev Hiring | 0 | 2 | 4 | 0 | 6 | `dev-lifecycle-cohort-outcomes.md` |
| 11 | hiring-automation-scheduler | Offers/Automation | 0 | 2 | 4 | 0 | 6 | `hiring-automation-scheduler.md` |
| 12 | interview-scheduling-prep-rubric | Interviews | 0 | 2 | 4 | 0 | 6 | `interview-scheduling-prep-rubric.md` |
| 13 | interview-simulation-comparison | Interviews | 0 | 2 | 3 | 1 | 6 | `interview-simulation-comparison.md` |
| 14 | job-postings-lifecycle | Jobs/JD/Sourcing | 0 | 2 | 3 | 1 | 6 | `job-postings-lifecycle.md` |
| 15 | pipeline-board-candidate-drawer | Pipeline/Decisions | 0 | 2 | 3 | 1 | 6 | `pipeline-board-candidate-drawer.md` |
| 16 | pipeline-clis-script-bridges | AI Engine | 0 | 2 | 3 | 1 | 6 | `pipeline-clis-script-bridges.md` |
| 17 | sourcing-campaigns-rediscovery | Jobs/JD/Sourcing | 0 | 2 | 3 | 1 | 6 | `sourcing-campaigns-rediscovery.md` |
| 18 | analytics-calibration-dashboards | Insights/Analytics | 0 | 2 | 3 | 0 | 5 | `analytics-calibration-dashboards.md` |
| 19 | organizations-members-invites | Identity/Privacy | 0 | 2 | 3 | 0 | 5 | `organizations-members-invites.md` |
| 20 | analysis-result-panels | Candidate Analysis | 0 | 1 | 3 | 2 | 6 | `analysis-result-panels.md` |
| 21 | ats-integration-egress | Pipeline/Decisions | 0 | 1 | 4 | 1 | 6 | `ats-integration-egress.md` |
| 22 | cv-analysis-workspace | Candidate Analysis | 0 | 1 | 4 | 1 | 6 | `cv-analysis-workspace.md` |
| 23 | github-evidence-cv-utilities | Candidate Analysis | 0 | 1 | 4 | 1 | 6 | `github-evidence-cv-utilities.md` |
| 24 | group-evaluation-fairness | Pipeline/Decisions | 0 | 1 | 4 | 1 | 6 | `group-evaluation-fairness.md` |
| 25 | guided-pipeline-simulation | Insights/Analytics | 0 | 1 | 4 | 1 | 6 | `guided-pipeline-simulation.md` |
| 26 | jd-authoring-library-templates | Jobs/JD/Sourcing | 0 | 1 | 4 | 1 | 6 | `jd-authoring-library-templates.md` |
| 27 | landing-marketing | Platform/Shell | 0 | 1 | 4 | 1 | 6 | `landing-marketing.md` |
| 28 | skill-matrix-coverage | Insights/Analytics | 0 | 1 | 4 | 1 | 6 | `skill-matrix-coverage.md` |
| 29 | voice-interview | Interviews | 0 | 1 | 4 | 1 | 6 | `voice-interview.md` |
| 30 | app-shell-navigation | Platform/Shell | 0 | 1 | 3 | 1 | 5 | `app-shell-navigation.md` |
| 31 | auth-sessions-workspace-tenancy | Identity/Privacy | 0 | 1 | 3 | 1 | 5 | `auth-sessions-workspace-tenancy.md` |
| 32 | billing-engine-webhooks | Billing | 0 | 1 | 3 | 1 | 5 | `billing-engine-webhooks.md` |
| 33 | data-store-persistence | Identity/Privacy | 0 | 1 | 3 | 1 | 5 | `data-store-persistence.md` |
| 34 | evaluation-fairness-seed-data | AI Engine | 0 | 1 | 3 | 1 | 5 | `evaluation-fairness-seed-data.md` |
| 35 | llm-provider-layer-python | LLM Provider | 0 | 1 | 2 | 2 | 5 | `llm-provider-layer-python.md` |
| 36 | matching-transformation-engine | AI Engine | 0 | 1 | 3 | 1 | 5 | `matching-transformation-engine.md` |
| 37 | model-api-key-management | LLM Provider | 0 | 1 | 4 | 0 | 5 | `model-api-key-management.md` |
| 38 | offers-onboarding | Offers/Automation | 0 | 1 | 3 | 1 | 5 | `offers-onboarding.md` |
| 39 | plans-checkout-billing-ui | Billing | 0 | 1 | 3 | 1 | 5 | `plans-checkout-billing-ui.md` |
| 40 | privacy-consent-provenance | Identity/Privacy | 0 | 1 | 3 | 1 | 5 | `privacy-consent-provenance.md` |
| 41 | shared-ui-design-system | Platform/Shell | 0 | 1 | 3 | 1 | 5 | `shared-ui-design-system.md` |
| 42 | shared-utility-libraries | Platform/Shell | 0 | 1 | 3 | 1 | 5 | `shared-utility-libraries.md` |
| 43 | tasks-system-operations | Platform/Shell | 0 | 1 | 3 | 1 | 5 | `tasks-system-operations.md` |
| 44 | architecture-diagrams | Insights/Analytics | 0 | 0 | 3 | 2 | 5 | `architecture-diagrams.md` |
| 45 | branding-white-label | Platform/Shell | 0 | 0 | 4 | 1 | 5 | `branding-white-label.md` |
| 46 | pipeline-test-suite-python | AI Engine | 0 | 0 | 2 | 2 | 4 | `pipeline-test-suite-python.md` |

---

## All Critical + High findings (themed for triage)

### A. Workspace/tenancy scoping bypass (10)
1. [HIGH] **app-shell-navigation** -- Sidebar attention badges ignore the current workspace `app/_lib/attention.ts:36` [ambiguity]
2. [HIGH] **billing-engine-webhooks** -- Per-workspace billing read contradicts the "single shared ledger" design — a non-default team is silently gated to Free `app/_lib/db/billing.ts:25` [ambiguity]
3. [HIGH] **candidate-onboarding-hand-off** -- Onboarding API routes ignore the caller's workspace — tenancy scoping exists in the store but is never wired `app/api/onboarding/route.ts:12` [ambiguity]
4. [HIGH] **guided-pipeline-simulation** -- Public demo isolation rests on a "half-built" tenancy assumption stated only in a comment `app/api/demo/route.ts:29-44` [ambiguity]
5. [HIGH] **jd-authoring-library-templates** -- Generate/retry resolve the chosen template without the caller's workspace — silent format loss for non-default teams, cross-tenant read of default-team private templates `app/api/jds/generate/route.ts:68` [ambiguity]
6. [HIGH] **job-postings-lifecycle** -- Close route is the only lifecycle transition with zero workspace scoping `app/api/jobs/[id]/close/route.ts:10` [ambiguity]
7. [HIGH] **offers-onboarding** -- Offer terminal transitions hard-code the default workspace, so a non-default-team candidate's response silently never lands `app/_lib/offer-finalize.ts:67` [ambiguity]
8. [HIGH] **pipeline-board-candidate-drawer** -- Ungated `?entry=` branch of the events route leaks the full per-candidate history the sibling routes were gated to protect `app/api/pipeline/events/route.ts:29` [ambiguity]
9. [HIGH] **screening-decisions-records** -- Screen wave reads the screening config from the DEFAULT workspace, not the caller's team `app/_lib/screen-wave.ts:184` [ambiguity]
10. [HIGH] **sourcing-campaigns-rediscovery** -- Feed "Refresh" sweeps the DEFAULT tenant's roles, then reports its counts against the session tenant's feed `app/api/rediscovery/alerts/route.ts:67` [ambiguity]

### B. Broken access / capability / injection boundaries (5)
11. [CRIT] **dev-submissions-live-work-surface** -- Live-session write route is gated only by a guessable `randomId` — anyone can overwrite a candidate's work or forge authenticity-tanking events `app/api/devcase/session/[id]/route.ts:18` [ambiguity]
12. [HIGH] **github-evidence-cv-utilities** -- Full-analysis `href`s skip the scheme vetting the summary path documents as mandatory `app/_components/GithubAnalysisPanel.tsx:106` [ambiguity]
13. [HIGH] **interview-scheduling-prep-rubric** -- The candidate's own token can set the interview "Join" link recruiters click `app/api/schedule/route.ts:332` [ambiguity]
14. [HIGH] **organizations-members-invites** -- Editing a member's permissions silently strips capabilities the actor can't delegate `app/api/org/members/[userId]/route.ts:63` [ambiguity]
15. [HIGH] **shared-utility-libraries** -- Integer / hex / short-form IP encodings bypass the SSRF host guard `app/_lib/safe-url.ts:65` [ambiguity]

### C. Silent data loss / swallowed failures (7)
16. [CRIT] **candidate-onboarding-hand-off** -- Recruiter questionnaire blur-autosave wholesale-overwrites (and can blank) the candidate's submitted intake `app/features/sub_onboarding/OnboardingTab.tsx:475` [ambiguity]
17. [HIGH] **candidate-onboarding-hand-off** -- A revoked (cancelled) run is silently resurrected by any checklist toggle `app/_lib/onboarding-store.ts:438` [ambiguity]
18. [HIGH] **data-store-persistence** -- `seedCandidates` still uses `INSERT OR REPLACE` — the exact reboot data-loss the sibling `seedAnalyses` fix removed `app/_lib/db/core.ts:1437` [ambiguity]
19. [HIGH] **dev-case-authoring-publishing** -- Manual approve in DevTab silently swallows failures — a probe-gate block looks like a dead button `app/features/sub_dev/DevTab.tsx:323` [ui]
20. [HIGH] **dev-lifecycle-cohort-outcomes** -- Approve route reports success and silently drops reviewer edits when the lifecycle is not at the gate `app/api/devcase/lifecycle/[id]/approve/route.ts:43` [ambiguity]
21. [HIGH] **dev-submissions-live-work-surface** -- Final flush failure is swallowed — the submission finalizes and shows "submitted" while grading stale or pristine-seed files `app/devcase/apply/[token]/LiveWorkSurface.tsx:130` [ambiguity]
22. [HIGH] **landing-marketing** -- Every pricing-tier CTA drops the selected plan on the floor `app/landing/spark/PricingSection.tsx:97` [ambiguity]

### D. UI/label claims contradict server/actual (9)
23. [HIGH] **analytics-calibration-dashboards** -- Time-to-hire is a mean but the leadership readout labels it "median" `app/features/sub_analytics/AnalyticsTab.tsx:585` [ambiguity]
24. [HIGH] **dev-lifecycle-cohort-outcomes** -- Public verify API has no freshness dimension — a stale credential is `valid: true` with nothing to distinguish it `app/api/skill-profile/[token]/verify/route.ts:33` [ambiguity]
25. [HIGH] **dev-submissions-live-work-surface** -- Session-start failures (429 throttle, closed posting, network) are invisible — the candidate works unrecorded and the server's honest error messages are discarded `app/devcase/apply/[token]/LiveWorkSurface.tsx:47` [ui]
26. [HIGH] **group-evaluation-fairness** -- Comparison table crowns column 1 "Lead" even when the server crowned no lead `app/features/sub_decisions/group-eval/ComparisonTable.tsx:181` [ui]
27. [HIGH] **hiring-automation-scheduler** -- Dry-run preview summary contradicts what a commit actually does: previewed "rejected" become committed "held/queued", and alert counts ignore the per-day dedup `app/_lib/automation-pass.ts:238` [ambiguity]
28. [HIGH] **interview-simulation-comparison** -- Attach-to-candidate is offered from the first second of a sim, but the server only accepts completed sessions `app/features/sub_interview/InterviewSimTab.tsx:275` [ambiguity]
29. [HIGH] **organizations-members-invites** -- "Preview onboarding flow" persists real, hard-to-undo changes on finish `app/features/sub_organization/OrganizationTab.tsx:48` [ambiguity]
30. [HIGH] **pipeline-board-candidate-drawer** -- `reject below N%` confirm silently caps execution at the 50-row preview while the UI says "affects 120" `app/api/pipeline/command/route.ts:11` [ambiguity]
31. [HIGH] **plans-checkout-billing-ui** -- "Choose plan" checkout button is a dead-end for a lapsed-but-lingering subscription `app/features/sub_billing/BillingTab.tsx:510` [ambiguity]

### E. Missing/inconsistent destructive-action guards (4)
32. [HIGH] **application-intake-apply-flows** -- Restored localStorage draft trusts a stale script shape — resumed chat can desynchronize from the current script `app/apply/[id]/ConversationalApply.tsx:144` [ambiguity]
33. [HIGH] **interview-scheduling-prep-rubric** -- Single re-invite mails a scheduling link to terminal (rejected/hired) candidates that bulk refuses `app/api/schedule/invite/route.ts:25` [ambiguity]
34. [HIGH] **privacy-consent-provenance** -- Erasure/data-rights link 404s after anonymization — candidate sees a generic error, never confirmation `app/data/[token]/DataClient.tsx:99` [ambiguity]
35. [HIGH] **screening-decisions-records** -- Single-card Reject fires the irreversible, emailed rejection on one unconfirmed click — batch reject is confirm-gated `app/features/sub_decisions/AiReviewCard.tsx:298-304` [ui]

### F. Missing error/empty/dead states & dead-ends (4)
36. [HIGH] **auth-sessions-workspace-tenancy** -- e2e auth helper seeds a dead localStorage key — every gated journey lands on the public landing `e2e/dev-auth.ts:11` [ambiguity]
37. [HIGH] **communications-inbound-channels** -- Email intake wizard hands out a forwarding address nothing serves `app/features/sub_channels/EmailIntakeWizard.tsx:22` [ambiguity]
38. [HIGH] **communications-inbound-channels** -- `received_count` has two contradictory contracts — misconfigured integrations look dead `app/_lib/db/channels.ts:126` [ambiguity]
39. [HIGH] **job-postings-lifecycle** -- The abort machinery is unreachable: Cancel is disabled exactly while there is something to cancel `app/features/sub_jobs/IngestAdPanel.tsx:240` [ui]

### G. Ambiguous semantics / silent misclassification (14)
40. [HIGH] **analysis-result-panels** -- Comparison drivers and merged recommendation key by non-unique variant label `app/_lib/comparison.ts:124` [ambiguity]
41. [HIGH] **application-intake-apply-flows** -- Webhook lead extraction's last-resort email scan can adopt a third party's address as the candidate's identity `app/_lib/lead-payload.ts:126` [ambiguity]
42. [HIGH] **candidate-profile-job-matching** -- Built-in archetypes' fairness shield is one unguarded PUT away `app/_lib/archetype-registry.ts:151` [ambiguity]
43. [HIGH] **candidate-profile-job-matching** -- Hand-built profiles silently default to `software_engineering`, which is scored `app/features/sub_profile/ProfileForm.ts:99` [ambiguity]
44. [HIGH] **cv-analysis-workspace** -- Consent read-gate enforced only on the API detail route — the SSR saved-report page and the History list serve unmasked PII `app/history/[slug]/page.tsx:159` [ambiguity]
45. [HIGH] **cv-extraction-pipeline-services** -- Blind screening fails OPEN when the name isn't detected — model sees the real name while the pipeline claims "identity redacted" `pipeline/jobfit/redact.py:129` [ambiguity]
46. [HIGH] **dev-case-authoring-publishing** -- Manual publish route bypasses the freeze-at-publish contract (no seed/scenario materialization, no dedup, no audit) `app/api/devcase/publish/route.ts:13` [ambiguity]
47. [HIGH] **dev-case-pipeline-python** -- Seed coerce guarantees DECISIONS.md but not README.md — a candidate can receive starter files with no assignment in them `pipeline/jobfit/devcase/seed_materializer.py:167` [ambiguity]
48. [HIGH] **dev-case-pipeline-python** -- LLM-path probe coercion collapses "not assessed" into a graded failure — the exact None/False conflation the observed path was fixed for `pipeline/jobfit/devcase/reflect.py:266` [ambiguity]
49. [HIGH] **evaluation-fairness-seed-data** -- `align_candidates_csas` silently re-skins every NON-TECH candidate into a Java engineer `pipeline/jobfit/align_candidates_csas.py:108` [ambiguity]
50. [HIGH] **hiring-automation-scheduler** -- screen/scorecard prompts are localized but their cache keys ignore the locale — two "which tasks key on lang" authorities have drifted `app/_lib/automation-cache-key.ts:25` [ambiguity]
51. [HIGH] **interview-simulation-comparison** -- The "Not assessed (auto-synthesis unavailable)." placeholder leaks into the evidence list as real evidence `app/features/sub_jobs/CompareInterviews.tsx:269` [ambiguity]
52. [HIGH] **llm-provider-layer-python** -- Capability matrix advertises `file_input` for adapters that are text-only `pipeline/jobfit/llm/capabilities.py:17` [ambiguity]
53. [HIGH] **matching-transformation-engine** -- Live-case "observed" credit is minted from naive substring skill matching `pipeline/jobfit/live_case.py:84` [ambiguity]

### H. Other correctness/clarity (12)
54. [HIGH] **analytics-calibration-dashboards** -- Prior-window `bySource` is not upper-bounded, so period-over-period source deltas are wrong `app/_lib/db/analytics.ts:670` [ambiguity]
55. [HIGH] **ats-integration-egress** -- candidate.hired can ship the WRONG offer's comp — fallback picks the oldest offer, not the accepted one `app/_lib/ats-egress.ts:32` [ambiguity]
56. [HIGH] **cv-extraction-pipeline-services** -- Grounded runs are told to fetch "Prague/Czech tech salary signals" — directly contradicting the own-market salary rules in the same prompt `pipeline/jobfit/gemini.py:517` [ambiguity]
57. [HIGH] **model-api-key-management** -- A rotated/removed KP_SECRET fails every keyed LLM call with an un-actionable crypto error `app/_lib/llm-secret.ts:48` [ambiguity]
58. [HIGH] **pipeline-clis-script-bridges** -- Malformed `--weights` JSON aborts the whole match run, contradicting the flag's own contract `pipeline/jobfit/match_cli.py:58` [ambiguity]
59. [HIGH] **pipeline-clis-script-bridges** -- Split-brain error taxonomy: half the CLI fleet reports user-fixable bad input as a 500 engine outage `pipeline/jobfit/jobs_cli.py:51` [ambiguity]
60. [HIGH] **screening-decisions-records** -- The wave modal seeds its sliders from code defaults, ignoring the saved decision rules `app/features/sub_decisions/ScreenWaveModal.tsx:86-87` [ambiguity]
61. [HIGH] **shared-ui-design-system** -- ScoreDial empty-track is a hardcoded light-grey hex that ignores Spark Dark `app/_components/ScoreDial.tsx:108` [ui]
62. [HIGH] **skill-matrix-coverage** -- The matrix silently caps the candidate pool at 200 — contradicting its own "never quietly omit a row" contract `app/api/matrix/route.ts:42` [ambiguity]
63. [HIGH] **sourcing-campaigns-rediscovery** -- Feed row state is keyed by candidateId, so one candidate alerted for two roles shows "Added ✓" on both `app/features/sub_jobs/RediscoveryFeed.tsx:219` [ui]
64. [HIGH] **tasks-system-operations** -- `opts.env` override of `KP_LLM_USAGE_LOG` silently loses metering and leaks the sidecar `app/_lib/python-runner.ts:129` [ambiguity]
65. [HIGH] **voice-interview** -- "Completed" only requires one turn of ANY role — an interviewer-only call is terminal, billed, and scored `app/_lib/voice/finalize-status.ts:53` [ambiguity]

---

## Triage themes (why each is a wave, not scattered fixes)

| Theme | ~C+H count | Shared mental model |
|---|---:|---|
| A. Workspace/tenancy scoping bypass | 10 | one fix shape across all instances |
| B. Broken access / capability / injection boundaries | 5 | one fix shape across all instances |
| C. Silent data loss / swallowed failures | 7 | one fix shape across all instances |
| D. UI/label claims contradict server/actual | 9 | one fix shape across all instances |
| E. Missing/inconsistent destructive-action guards | 4 | one fix shape across all instances |
| F. Missing error/empty/dead states & dead-ends | 4 | one fix shape across all instances |
| G. Ambiguous semantics / silent misclassification | 14 | one fix shape across all instances |
| H. Other correctness/clarity | 12 | one fix shape across all instances |

---

## Suggested fix-wave split (Critical+High first)

Each wave shares one mental model so fixes compound. Ordered by risk.

- **Wave 1 -- Access / capability / injection boundaries (Critical-led):** the 2 Criticals (onboarding blur-autosave data-loss; guessable dev-session write route) + ungated `?entry=` events leak + candidate-token Join-link injection + unvetted href scheme + `safe-url` SSRF IP-encoding bypass + partial-delegate permission strip + public `/api/demo` PII exposure.
- **Wave 2 -- Workspace/tenancy scoping bypass:** thread `workspaceId` through close route, screen-wave config, rediscovery sweep, offer terminal transitions, JD template resolve, onboarding routes, billing state, attention badges. One shared fix shape; the auth layer itself is sound (cookie-based) -- the bug is unthreaded store/route calls.
- **Wave 3 -- Silent data loss / swallowed failures:** dev live-work final-flush, session-start error states, manual approve swallow, onboarding revoke resurrection, `seedCandidates` INSERT-OR-REPLACE reboot wipe, lifecycle approve drop.
- **Wave 4 -- UI/label claims vs server truth:** reject-below-N preview cap, dry-run preview/commit divergence, false 'Lead' crown, sim attach contract mismatch, 'Not assessed' sentinel leak, comparison label-collision, ROI mean-labeled-median, skill-matrix 200 cap, landing plan-discarded CTA, pricing dead-end checkout.
- **Wave 5 -- Semantics / fairness / misclassification:** `software_engineering` default-family bias (appears in 4+ places: ProfileForm, align_candidates, matching engine, scoring), built-in archetype fairness-flag edit, python None/False conflations, credited-skill substring matching, blind-screening fail-open, README-missing seed invariant.
- **Wave 6 -- Destructive-action guards + Medium/Low papercuts + design-token/i18n polish** (147 M / 43 L), by group.

---

## Provenance

- **Scanners:** `ambiguity_guardian` + `ui_perfectionist` (Vibeman registry), run as one dual-lens brief per context.
- **Method:** one general-purpose subagent per context, read-only, structured report, 4-6 findings each; dispatched in rolling waves (max ~8 concurrent).
- **Scope:** full-stack (TS App Router frontend + Python `pipeline/jobfit` backend).
- **Verification:** header-sum == severity-bullet-count == 255 across 46 reports.
- **Baseline (kp, pre-fix):** tsc clean after `schemas:gen`; node unit suite **2315 pass / 0 fail**; branch `main`.