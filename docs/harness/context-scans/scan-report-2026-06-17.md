# Context Scan Report

**Date**: 2026-06-17  
**Project**: kp  
**Project ID**: a3f8c2d1-7b4e-4f9a-9c6d-2e8b5a1f0d47  
**Scanner**: scan-contexts (Next.js + Python monorepo)

## Execution Summary

| Metric | Value |
|--------|-------|
| Context Groups | 12 |
| Contexts | 42 |
| Group Relationships | 19 |
| File paths mapped (unique) | 879 |
| Meaningful source files | 876 |
| Coverage | 100.0% |
| Overlaps (file in >1 context) | 0 |
| New contexts created | 42 |
| Existing contexts updated | 0 |
| Contexts deleted | 0 |

> **Project-ID note.** The live Vibeman registry (`/api/projects`) maps **kp** to `a3f8c2d1-7b4e-4f9a-9c6d-2e8b5a1f0d47`, which had zero contexts. A stale earlier scan (2026-05-05 template) used the orphaned id `5afc2006-01a0-4f50-86ad-d62b1a485caf`; that map was used only as a structural reference and is left untouched for automatic cleanup.

## Groups & Contexts

### 1. Candidate Analysis  `#6366f1`  ·  domain: `feature`

4 contexts · 104 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| GitHub Evidence & CV Utilities | `lib` | 11 | `ctx_1781677988188_mjaqp9p` |
| Candidate Profile & Job Matching | `ui` | 36 | `ctx_1781677988182_gfc9sex` |
| Analysis Result Panels | `ui` | 25 | `ctx_1781677988172_wy2mvup` |
| CV Analysis Workspace | `ui` | 32 | `ctx_1781677988158_ddw5e6h` |

### 2. Jobs, JD Library & Sourcing  `#0ea5e9`  ·  domain: `feature`

3 contexts · 70 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Sourcing, Campaigns & Rediscovery | `ui` | 22 | `ctx_1781677988210_nmztmp0` |
| Job Postings & Lifecycle | `ui` | 21 | `ctx_1781677988203_78suhxw` |
| JD Authoring Library & Templates | `ui` | 27 | `ctx_1781677988197_wpdlyg9` |

### 3. Pipeline, Decisions & Channels  `#f59e0b`  ·  domain: `feature`

5 contexts · 101 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Communications & Inbound Channels | `lib` | 15 | `ctx_1781677988244_8ectu5o` |
| Group Evaluation & Fairness | `ui` | 20 | `ctx_1781677988237_qnnahiv` |
| Screening Decisions & Records | `ui` | 21 | `ctx_1781677988228_x4dnn3p` |
| Application Intake & Apply Flows | `ui` | 19 | `ctx_1781677988223_halzhgn` |
| Pipeline Board & Candidate Drawer | `ui` | 26 | `ctx_1781677988215_k0mjqh0` |

### 4. Interviews & Scheduling  `#10b981`  ·  domain: `feature`

3 contexts · 71 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Interview Simulation & Comparison | `ui` | 9 | `ctx_1781677988263_tebrlf1` |
| Voice Interview | `ui` | 30 | `ctx_1781677988258_372ymbt` |
| Interview Scheduling, Prep & Rubric | `ui` | 32 | `ctx_1781677988251_r0qq8og` |

### 5. Offers & Automation  `#ec4899`  ·  domain: `feature`

2 contexts · 25 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Hiring Automation & Scheduler | `lib` | 18 | `ctx_1781677988278_mrxbl2q` |
| Offers & Onboarding | `ui` | 7 | `ctx_1781677988272_4d6na1s` |

### 6. Dev Hiring Extension  `#8b5cf6`  ·  domain: `feature`

4 contexts · 100 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Dev Case Pipeline (Python) | `lib` | 20 | `ctx_1781677988309_dy2tx43` |
| Dev Lifecycle, Cohort & Outcomes | `ui` | 35 | `ctx_1781677988304_3yyryvk` |
| Dev Submissions & Live Work Surface | `ui` | 27 | `ctx_1781677988289_vuw46lz` |
| Dev Case Authoring & Publishing | `ui` | 18 | `ctx_1781677988284_ujb4qmg` |

### 7. AI Matching & Extraction Engine  `#ef4444`  ·  domain: `data`

5 contexts · 140 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Pipeline Test Suite (Python) | `test` | 65 | `ctx_1781677988338_hdner46` |
| Evaluation, Fairness & Seed Data | `lib` | 19 | `ctx_1781677988332_tk7pe02` |
| Pipeline CLIs & Script Bridges | `lib` | 21 | `ctx_1781677988325_h6vjpl1` |
| CV Extraction & Pipeline Services | `lib` | 15 | `ctx_1781677988319_9n1gl7m` |
| Matching & Transformation Engine | `lib` | 20 | `ctx_1781677988315_d2r2zh2` |

### 8. LLM Provider Layer & Models  `#7c3aed`  ·  domain: `integration`

2 contexts · 33 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Model & API Key Management | `ui` | 12 | `ctx_1781677988348_ujqien4` |
| LLM Provider Layer (Python) | `lib` | 21 | `ctx_1781677988342_64eid0x` |

### 9. Insights, Analytics & Simulation  `#14b8a6`  ·  domain: `feature`

4 contexts · 58 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Guided Pipeline Simulation | `ui` | 18 | `ctx_1781677988371_13976sz` |
| Architecture Diagrams | `ui` | 10 | `ctx_1781677988365_cly9i1d` |
| Skill Matrix & Coverage | `ui` | 8 | `ctx_1781677988360_ze53xrr` |
| Analytics & Calibration Dashboards | `ui` | 22 | `ctx_1781677988355_ojmjvyl` |

### 10. Billing & Monetization  `#f97316`  ·  domain: `integration`

2 contexts · 19 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Plans, Checkout & Billing UI | `ui` | 6 | `ctx_1781677988383_8q1tzcp` |
| Billing Engine & Webhooks | `lib` | 13 | `ctx_1781677988377_0b1g014` |

### 11. Platform, Shell & Shared UI  `#64748b`  ·  domain: `infrastructure`

5 contexts · 118 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Landing & Marketing | `ui` | 9 | `ctx_1781677988414_q8flnsl` |
| Shared Utility Libraries | `lib` | 20 | `ctx_1781677988403_jvgko7d` |
| Shared UI & Design System | `ui` | 44 | `ctx_1781677988398_0fse5ko` |
| Tasks & System Operations | `ui` | 16 | `ctx_1781677988392_hccm04x` |
| App Shell & Navigation | `ui` | 29 | `ctx_1781677988388_ijm3f74` |

### 12. Identity, Data & Privacy  `#475569`  ·  domain: `infrastructure`

3 contexts · 40 files

| Context | Category | Files | ID |
|---------|----------|-------|----|
| Privacy, Consent & Provenance | `lib` | 8 | `ctx_1781677988431_fi96rjy` |
| Data Store & Persistence | `data` | 10 | `ctx_1781677988426_lztb34g` |
| Auth, Sessions & Workspace Tenancy | `lib` | 22 | `ctx_1781677988421_zxm642a` |

## Group Relationships

| Source | Type | Target |
|--------|------|--------|
| Candidate Analysis | `uses` | AI Matching & Extraction Engine |
| Candidate Analysis | `uses` | Pipeline, Decisions & Channels |
| Candidate Analysis | `depends_on` | Platform, Shell & Shared UI |
| Jobs, JD Library & Sourcing | `uses` | AI Matching & Extraction Engine |
| Jobs, JD Library & Sourcing | `uses` | Pipeline, Decisions & Channels |
| Candidate Analysis | `uses` | Jobs, JD Library & Sourcing |
| Pipeline, Decisions & Channels | `uses` | Interviews & Scheduling |
| Pipeline, Decisions & Channels | `triggers` | Offers & Automation |
| Pipeline, Decisions & Channels | `uses` | Insights, Analytics & Simulation |
| Interviews & Scheduling | `uses` | Offers & Automation |
| Dev Hiring Extension | `uses` | AI Matching & Extraction Engine |
| Pipeline, Decisions & Channels | `uses` | Dev Hiring Extension |
| AI Matching & Extraction Engine | `uses` | LLM Provider Layer & Models |
| AI Matching & Extraction Engine | `depends_on` | Identity, Data & Privacy |
| LLM Provider Layer & Models | `uses` | Identity, Data & Privacy |
| Insights, Analytics & Simulation | `uses` | Identity, Data & Privacy |
| Billing & Monetization | `depends_on` | Identity, Data & Privacy |
| Platform, Shell & Shared UI | `depends_on` | Identity, Data & Privacy |
| Candidate Analysis | `calls` | LLM Provider Layer & Models |

_Note: one intended `Offers & Automation → Pipeline` edge was skipped — the API treats a group pair as a single undirected relationship and `Pipeline → Offers (triggers)` already covers it._

## Detailed Context Information

### 1. GitHub Evidence & CV Utilities (11 files)
- **ID**: `ctx_1781677988188_mjaqp9p`  · **Group**: Candidate Analysis  · **Category**: `lib`
- **Description**: Pull GitHub repo evidence into a candidate analysis and auto-fill / vary CV-derived profile fields. Backs the GitHub analysis panel and CV provenance helpers.
- **Files**:
  - app/_components/GithubAnalysisPanel.tsx
  - app/api/github-analysis/route.ts
  - app/_lib/github-evidence.ts
  - app/_lib/github-summary.ts
  - app/_lib/github-summary.test.ts
  - app/_lib/cv-autofill.ts
  - app/_lib/cv-autofill.test.ts
  - app/_lib/cv-variant.ts
  - app/_lib/cv-variant.test.ts
  - app/_lib/apply-profile-result.ts
  - app/_lib/apply-profile-result.test.ts

### 2. Candidate Profile & Job Matching (36 files)
- **ID**: `ctx_1781677988182_gfc9sex`  · **Group**: Candidate Analysis  · **Category**: `ui`
- **DB tables**: profiles, gemini_cache
- **Description**: Build a structured CandidateProfile from evidence and match one candidate against many jobs with deterministic scoring plus cached LLM reasoning. Covers Profile, Match, archetypes, and the candidate matrix.
- **Files**:
  - app/features/sub_profile/ProfileTab.tsx
  - app/features/sub_profile/ProfileFields.tsx
  - app/features/sub_profile/ProfileEvidenceColumn.tsx
  - app/features/sub_profile/ProfileResultPanel.tsx
  - app/features/sub_profile/ProfileEditor.tsx
  - app/features/sub_profile/ArchetypeManager.tsx
  - app/features/sub_profile/CandidateMatrix.tsx
  - app/features/sub_profile/ProfileTypes.ts
  - app/features/sub_profile/ProfileForm.ts
  - app/features/sub_profile/ProfileForm.test.ts
  - app/features/sub_profile/ProfileTaxonomy.test.ts
  - app/features/sub_match/MatchTab.tsx
  - app/features/sub_match/MatchCard.tsx
  - app/features/sub_match/MatchShared.tsx
  - app/features/sub_match/Results.tsx
  - app/features/sub_match/JobCompare.tsx
  - app/features/sub_match/WeightsPanel.tsx
  - app/features/sub_match/MatchTypes.ts
  - app/api/profile/route.ts
  - app/api/profile/candidates/route.ts
  - app/api/profile/draft/route.ts
  - app/api/match/route.ts
  - app/api/match/reasoning/route.ts
  - app/api/archetypes/route.ts
  - app/api/archetypes/[id]/route.ts
  - app/_lib/match-candidate.ts
  - app/_lib/match-input.ts
  - app/_lib/reasoning-run.ts
  - app/_lib/reasoning-cache-key.ts
  - app/_lib/reasoning-cache-policy.ts
  - app/_lib/archetypes.ts
  - app/_lib/archetype-registry.ts
  - app/_lib/db/profiles.ts
  - app/_lib/db/profiles-tenancy.test.ts
  - app/_lib/reasoning-cache-key.test.ts
  - app/_lib/reasoning-cache-policy.test.ts

### 3. Analysis Result Panels (25 files)
- **ID**: `ctx_1781677988172_wy2mvup`  · **Group**: Candidate Analysis  · **Category**: `ui`
- **DB tables**: analyses
- **Description**: The tabbed presentation of a completed analysis: extraction, salary gauge, job-fit skill chips + missing-skill tiers, interview kit, soft signals, and side-by-side comparison.
- **Files**:
  - app/_components/results/ResultPanel.tsx
  - app/_components/results/shared.tsx
  - app/_components/results/AddToPipelineButton.tsx
  - app/_components/results/ArchetypeBanner.tsx
  - app/_components/results/DispositionEditor.tsx
  - app/_components/results/QualityStrip.tsx
  - app/_components/results/ReportActions.tsx
  - app/_components/results/extraction/ExtractionTab.tsx
  - app/_components/results/salary/SalaryTab.tsx
  - app/_components/results/salary/SalaryGauge.tsx
  - app/_components/results/job-fit/JobFitTab.tsx
  - app/_components/results/job-fit/MissingSkillsTiers.tsx
  - app/_components/results/job-fit/SkillChips.tsx
  - app/_components/results/interview/InterviewTab.tsx
  - app/_components/results/interview/SoftSignalsSection.tsx
  - app/_components/results/interview/buckets.ts
  - app/_components/results/interview/buckets.test.ts
  - app/_components/results/compare/CompareTab.tsx
  - app/_components/AnalysisProgress.tsx
  - app/_components/ScanAnimation.tsx
  - app/_components/FactorChart.tsx
  - app/_lib/comparison.ts
  - app/_lib/comparison.test.ts
  - app/_lib/useAddToPipeline.ts
  - app/_lib/useAddToPipeline.test.ts

### 4. CV Analysis Workspace (32 files)
- **ID**: `ctx_1781677988158_ddw5e6h`  · **Group**: Candidate Analysis  · **Category**: `ui`
- **DB tables**: analyses
- **Description**: Drop, paste, or upload a CV and a target JD, then run a full AI analysis. Drives the Analyze tab intake, file routing, and the analysis run lifecycle.
- **Files**:
  - app/features/sub_analyze/AnalyzeTab.tsx
  - app/features/sub_analyze/AnalyzeWorkspace.tsx
  - app/features/sub_analyze/AnalyzeColumn.tsx
  - app/features/sub_analyze/AnalyzeForm.tsx
  - app/features/sub_analyze/AnalyzeFormCollapsed.tsx
  - app/features/sub_analyze/AnalyzeFileDropZone.tsx
  - app/features/sub_analyze/AnalyzePasteRow.tsx
  - app/features/sub_analyze/AnalyzeProfileInput.tsx
  - app/features/sub_analyze/AnalyzeSavedJdPicker.tsx
  - app/features/sub_analyze/AnalyzeApi.ts
  - app/features/sub_analyze/AnalyzeTypes.ts
  - app/features/sub_analyze/runAnalysis.ts
  - app/features/sub_analyze/useAnalyzeForm.ts
  - app/features/sub_analyze/useAnalyzeJdLibrary.ts
  - app/features/sub_analyze/useGlobalFileDrag.ts
  - app/features/sub_analyze/useDropZoneHighlight.ts
  - app/features/sub_analyze/useFileAccept.ts
  - app/features/sub_analyze/dropRouting.ts
  - app/features/sub_analyze/dropRouting.test.ts
  - app/features/sub_analyze/file-intake-gate.test.ts
  - app/api/analyze/route.ts
  - app/api/extract-text/route.ts
  - app/api/analyses/route.ts
  - app/api/analyses/[slug]/route.ts
  - app/_lib/analyze-run.ts
  - app/_lib/upload-constraints.ts
  - app/_lib/upload-constraints.test.ts
  - app/_lib/db/analyses.ts
  - app/_lib/db/analyses-tenancy.test.ts
  - app/features/sub_history/HistoryTab.tsx
  - app/history/[slug]/page.tsx
  - app/api/upload-size-contract.test.ts

### 5. Sourcing, Campaigns & Rediscovery (22 files)
- **ID**: `ctx_1781677988210_nmztmp0`  · **Group**: Jobs, JD Library & Sourcing  · **Category**: `ui`
- **DB tables**: jobs, candidate_pool
- **Description**: Surface matching candidates for a role, run outreach campaigns, rediscover past applicants, and assess role winnability. Covers recruiter candidate pools and rediscovery alerts.
- **Files**:
  - app/features/sub_jobs/RecruiterCandidates.tsx
  - app/features/sub_jobs/RediscoverPanel.tsx
  - app/features/sub_jobs/RediscoveryFeed.tsx
  - app/features/sub_jobs/CampaignTab.tsx
  - app/features/sub_jobs/CoachPanel.tsx
  - app/api/jobs/[id]/candidates/route.ts
  - app/api/jobs/[id]/candidates/outreach/route.ts
  - app/api/jobs/[id]/rediscover/route.ts
  - app/api/jobs/[id]/campaign/route.ts
  - app/api/jobs/[id]/winnability/route.ts
  - app/api/rediscovery/alerts/route.ts
  - app/_lib/candidate-pool.ts
  - app/_lib/rediscover.ts
  - app/_lib/rediscover.test.ts
  - app/_lib/rediscovery-relevance.ts
  - app/_lib/rediscovery-alert-store.ts
  - app/_lib/rematch-source.ts
  - app/_lib/rematch-source.test.ts
  - app/_lib/recruiter-run.ts
  - app/_lib/salary-band.ts
  - app/_lib/salary-band.test.ts
  - app/_lib/db/campaign.ts

### 6. Job Postings & Lifecycle (21 files)
- **ID**: `ctx_1781677988203_78suhxw`  · **Group**: Jobs, JD Library & Sourcing  · **Category**: `ui`
- **DB tables**: jobs
- **Description**: Create, ingest, publish and close job postings and track their lifecycle. Covers the Jobs tab table, posting modal, ad ingestion and draft splitting.
- **Files**:
  - app/features/sub_jobs/JobsTab.tsx
  - app/features/sub_jobs/JobsTable.tsx
  - app/features/sub_jobs/JobRow.tsx
  - app/features/sub_jobs/JobsShared.tsx
  - app/features/sub_jobs/JobPostingModal.tsx
  - app/features/sub_jobs/JobLifecycleStrip.tsx
  - app/features/sub_jobs/IngestAdPanel.tsx
  - app/features/sub_jobs/DraftsPanel.tsx
  - app/features/sub_jobs/useJobsList.ts
  - app/features/sub_jobs/JobsTypes.ts
  - app/features/sub_jobs/JobsTypes.test.ts
  - app/features/sub_jobs/jobMarkdown.ts
  - app/api/jobs/route.ts
  - app/api/jobs/ingest/route.ts
  - app/api/jobs/status/route.ts
  - app/api/jobs/[id]/publish/route.ts
  - app/api/jobs/[id]/close/route.ts
  - app/_lib/job-ingest.ts
  - app/_lib/split-ads.ts
  - app/_lib/split-ads.test.ts
  - app/_lib/db/jobs.ts

### 7. JD Authoring Library & Templates (27 files)
- **ID**: `ctx_1781677988197_wpdlyg9`  · **Group**: Jobs, JD Library & Sourcing  · **Category**: `ui`
- **DB tables**: jds, templates
- **Description**: Author, lint, version and render job descriptions from reusable templates. Covers the Library tab, JD builder, template manager, and the public JD detail pages.
- **Files**:
  - app/features/sub_library/LibraryTab.tsx
  - app/features/sub_library/LibraryJdForm.tsx
  - app/features/sub_library/JdBuilder.tsx
  - app/features/sub_library/JdBuilderResult.tsx
  - app/features/sub_library/JdTemplateManager.tsx
  - app/features/sub_library/render-template.ts
  - app/features/sub_library/render-template.test.ts
  - app/api/jds/route.ts
  - app/api/jds/[slug]/route.ts
  - app/api/jds/save/route.ts
  - app/api/jds/[slug]/revisions/route.ts
  - app/api/jds/[slug]/analyses/route.ts
  - app/api/jds/[slug]/ingest-job/route.ts
  - app/api/templates/route.ts
  - app/api/templates/[id]/route.ts
  - app/_lib/jd-build-run.ts
  - app/_lib/jd-limits.ts
  - app/_lib/jd-limits.test.ts
  - app/_lib/jd-lint.ts
  - app/_lib/jd-lint.test.ts
  - app/_lib/templates-store.ts
  - app/jds/[slug]/page.tsx
  - app/jds/[slug]/JdBody.tsx
  - app/jds/[slug]/JdActions.tsx
  - app/api/jds/save/ingest-job.ts
  - app/api/jds/save/save-ingest-contract.test.ts
  - app/api/jds/error-message-hygiene.test.ts

### 8. Communications & Inbound Channels (15 files)
- **ID**: `ctx_1781677988244_8ectu5o`  · **Group**: Pipeline, Decisions & Channels  · **Category**: `lib`
- **DB tables**: comms, channels
- **Description**: Outbound candidate communications (envelopes, dispatch, delivery status, resend) and inbound channel webhooks/tokens that feed applications into the pipeline.
- **Files**:
  - app/features/sub_channels/ChannelsTab.tsx
  - app/features/sub_channels/CommsCenter.tsx
  - app/api/channels/inbound/[token]/route.ts
  - app/api/channels/webhooks/route.ts
  - app/api/channels/webhooks/[token]/route.ts
  - app/api/comms/route.ts
  - app/api/comms/[id]/resend/route.ts
  - app/_lib/comms.ts
  - app/_lib/comms-dispatch.ts
  - app/_lib/comms-dispatch.test.ts
  - app/_lib/comms-envelope.ts
  - app/_lib/comms-envelope.test.ts
  - app/_lib/comms-status.ts
  - app/_lib/comms-status.test.ts
  - app/_lib/db/channels.ts

### 9. Group Evaluation & Fairness (20 files)
- **ID**: `ctx_1781677988237_qnnahiv`  · **Group**: Pipeline, Decisions & Channels  · **Category**: `ui`
- **Description**: Side-by-side group evaluation of shortlisted candidates with per-candidate tabs, comparison tables, differentiators, risks and a fairness panel.
- **Files**:
  - app/features/sub_decisions/GroupEvalModal.tsx
  - app/features/sub_decisions/group-eval/AiVerdict.tsx
  - app/features/sub_decisions/group-eval/ComparisonCells.tsx
  - app/features/sub_decisions/group-eval/ComparisonTable.tsx
  - app/features/sub_decisions/group-eval/FairnessPanel.tsx
  - app/features/sub_decisions/group-eval/LegacyView.tsx
  - app/features/sub_decisions/group-eval/Notices.tsx
  - app/features/sub_decisions/group-eval/PerCandidateTabs.tsx
  - app/features/sub_decisions/group-eval/Risks.tsx
  - app/features/sub_decisions/group-eval/primitives.tsx
  - app/features/sub_decisions/group-eval/helpers.ts
  - app/features/sub_decisions/group-eval/types.ts
  - app/features/sub_decisions/group-eval/useGroupEval.ts
  - app/api/decisions/group-eval/route.ts
  - app/_lib/group-eval.ts
  - app/_lib/group-eval-run.ts
  - app/_lib/group-eval-differentiators.ts
  - app/_lib/group-eval-differentiators.test.ts
  - app/_lib/sanity-checks.ts
  - app/_lib/sanity-checks.test.ts

### 10. Screening Decisions & Records (21 files)
- **ID**: `ctx_1781677988228_x4dnn3p`  · **Group**: Pipeline, Decisions & Channels  · **Category**: `ui`
- **DB tables**: decisions
- **Description**: Configure screening rules, run AI-assisted role decisions, reconsider candidates, and persist an auditable decision record. Covers the Decisions tab and decision config/attribution.
- **Files**:
  - app/features/sub_decisions/DecisionsTab.tsx
  - app/features/sub_decisions/DecisionsShared.tsx
  - app/features/sub_decisions/DecisionRulesModal.tsx
  - app/features/sub_decisions/RoleDecisionRow.tsx
  - app/features/sub_decisions/AiReviewCard.tsx
  - app/features/sub_decisions/AnalysisSummaryModal.tsx
  - app/features/sub_decisions/ScreenWaveModal.tsx
  - app/features/sub_decisions/DecisionsTypes.ts
  - app/api/decisions/config/route.ts
  - app/api/decisions/screen-wave/route.ts
  - app/api/decisions/reconsider/route.ts
  - app/api/decisions/records/route.ts
  - app/_lib/decision-config-store.ts
  - app/_lib/decision-config-schema.ts
  - app/_lib/decision-config-schema.test.ts
  - app/_lib/decision-record-store.ts
  - app/_lib/decision-hash.ts
  - app/_lib/decision-hash.test.ts
  - app/_lib/decision-attribution.ts
  - app/_lib/decision-attribution.test.ts
  - app/_lib/screen-wave.ts

### 11. Application Intake & Apply Flows (19 files)
- **ID**: `ctx_1781677988223_halzhgn`  · **Group**: Pipeline, Decisions & Channels  · **Category**: `ui`
- **DB tables**: pipeline
- **Description**: Public candidate-facing apply experience: conversational and quick-apply forms, lead intake, application-status tracking, and completeness follow-ups.
- **Files**:
  - app/apply/[id]/page.tsx
  - app/apply/[id]/ConversationalApply.tsx
  - app/apply/[id]/quick/page.tsx
  - app/apply/[id]/quick/QuickApplyForm.tsx
  - app/api/apply/[id]/route.ts
  - app/api/apply/[id]/quick/route.ts
  - app/api/status/[token]/route.ts
  - app/status/[token]/page.tsx
  - app/_lib/apply.ts
  - app/_lib/apply-intake.ts
  - app/_lib/apply-intake.test.ts
  - app/_lib/application-status.ts
  - app/_lib/application-status.test.ts
  - app/_lib/application-status-store.ts
  - app/_lib/lead-intake.ts
  - app/_lib/lead-payload.ts
  - app/_lib/lead-payload.test.ts
  - app/_lib/completeness-followup.ts
  - app/_lib/completeness-followup.test.ts

### 12. Pipeline Board & Candidate Drawer (26 files)
- **ID**: `ctx_1781677988215_k0mjqh0`  · **Group**: Pipeline, Decisions & Channels  · **Category**: `ui`
- **DB tables**: pipeline
- **Description**: The kanban-style hiring pipeline: drag candidates across stages, open a candidate drawer with their full timeline and result, and stream live updates.
- **Files**:
  - app/features/sub_pipeline/PipelineTab.tsx
  - app/features/sub_pipeline/PipelineBoard.tsx
  - app/features/sub_pipeline/PipelineShared.tsx
  - app/features/sub_pipeline/CandidateDrawer.tsx
  - app/features/sub_pipeline/CandidateDrawerTypes.ts
  - app/features/sub_pipeline/CandidateResultView.tsx
  - app/features/sub_pipeline/SchedulerControl.tsx
  - app/features/sub_pipeline/PassPreviewModal.tsx
  - app/features/sub_pipeline/TodayRail.tsx
  - app/features/sub_pipeline/TokenLink.tsx
  - app/features/sub_pipeline/PipelineTypes.ts
  - app/api/pipeline/route.ts
  - app/api/pipeline/[id]/route.ts
  - app/api/pipeline/[id]/timeline/route.ts
  - app/api/pipeline/events/route.ts
  - app/_lib/pipeline-stages.ts
  - app/_lib/pipeline-status.ts
  - app/_lib/pipeline-status.test.ts
  - app/_lib/pipeline-events-public.ts
  - app/_lib/candidate-timeline.ts
  - app/_lib/db/pipeline.ts
  - app/_lib/pipeline-events-public.test.ts
  - app/_lib/pipeline-fairness.test.ts
  - app/_lib/pipeline-github-handle.test.ts
  - app/_lib/pipeline-screening.test.ts
  - app/api/pipeline/error-message-hygiene.test.ts

### 13. Interview Simulation & Comparison (9 files)
- **ID**: `ctx_1781677988263_tebrlf1`  · **Group**: Interviews & Scheduling  · **Category**: `ui`
- **DB tables**: interviews
- **Description**: Simulate an interview round, attach simulated outcomes to a candidate, compare interviews, and produce interview recommendations (incl. student mode).
- **Files**:
  - app/features/sub_interview/InterviewSimTab.tsx
  - app/features/sub_jobs/CompareInterviews.tsx
  - app/api/interview/simulate/route.ts
  - app/api/interview/simulate/attach/route.ts
  - app/api/interview/compare/route.ts
  - app/_lib/interview-recommendation.ts
  - app/_lib/interview-recommendation.test.ts
  - app/_lib/student-interview.ts
  - app/_lib/student-interview.test.ts

### 14. Voice Interview (30 files)
- **ID**: `ctx_1781677988258_372ymbt`  · **Group**: Interviews & Scheduling  · **Category**: `ui`
- **DB tables**: interviews
- **Description**: In-browser voice first-round interview with an AI agent (OpenAI Realtime / ElevenLabs switcher): create, connect, run, transcribe, and complete the session.
- **Files**:
  - app/_components/voice/VoiceInterview.tsx
  - app/_components/voice/VoiceInterviewClient.tsx
  - app/_components/voice/InterviewSidebar.tsx
  - app/_lib/voice/index.ts
  - app/_lib/voice/openai.ts
  - app/_lib/voice/openai-events.test.ts
  - app/_lib/voice/elevenlabs.ts
  - app/_lib/voice/types.ts
  - app/_lib/voice/preflight.ts
  - app/_lib/voice/preflight.test.ts
  - app/_lib/voice/finalize-status.ts
  - app/_lib/voice/finalize-status.test.ts
  - app/_lib/voice/voice-env.test.ts
  - app/_lib/interview-run.ts
  - app/_lib/interview-telemetry.ts
  - app/_lib/interview-telemetry.test.ts
  - app/_lib/interview-transcript.ts
  - app/_lib/interview-transcript.test.ts
  - app/_lib/interview-duration.mjs
  - app/_lib/interview-duration.test.ts
  - app/_lib/interview-lab.ts
  - app/api/interview/create/route.ts
  - app/api/interview/connect/route.ts
  - app/api/interview/complete/route.ts
  - app/api/interview/by-entry/route.ts
  - app/api/interview/revoke/route.ts
  - app/interview/[token]/page.tsx
  - app/interview-lab/page.tsx
  - scripts/setup-eleven-agent.mjs
  - app/api/interview/error-message-hygiene.test.ts

### 15. Interview Scheduling, Prep & Rubric (32 files)
- **ID**: `ctx_1781677988251_r0qq8og`  · **Group**: Interviews & Scheduling  · **Category**: `ui`
- **DB tables**: interviews, schedule
- **Description**: Send self-scheduling invites, pick slots across timezones, generate interview prep packs and rubrics, and track invite lifecycle and reminders.
- **Files**:
  - app/features/sub_schedule/ScheduleTab.tsx
  - app/features/sub_schedule/ScheduleCalendar.tsx
  - app/features/sub_schedule/InterviewPrepModal.tsx
  - app/features/sub_schedule/InterviewTranscriptModal.tsx
  - app/features/sub_schedule/InviteLifecyclePanel.tsx
  - app/features/sub_schedule/HumanScorecardPanel.tsx
  - app/features/sub_schedule/ScheduleTypes.ts
  - app/schedule/[token]/page.tsx
  - app/schedule/[token]/SchedulePicker.tsx
  - app/api/schedule/route.ts
  - app/api/schedule/invite/route.ts
  - app/api/schedule/[token]/route.ts
  - app/api/interview-prep/route.ts
  - app/api/interview-prep/scorecard/route.ts
  - app/_lib/schedule-store.ts
  - app/_lib/schedule-slots.ts
  - app/_lib/schedule-slots.test.ts
  - app/_lib/interview-reminders.ts
  - app/_lib/interview-reminder-policy.ts
  - app/_lib/interview-reminder-policy.test.ts
  - app/_lib/interview-prep.ts
  - app/_lib/interview-prep-run.ts
  - app/_lib/interview-rubric.ts
  - app/_lib/interview-rubric.test.ts
  - app/_lib/interview-scorecard.ts
  - app/_lib/run-of-show.ts
  - app/_lib/run-of-show.test.ts
  - app/_lib/timezone.ts
  - app/_lib/timezone.test.ts
  - app/_lib/use-slot-label.ts
  - app/_lib/db/interviews.ts
  - app/_lib/schedule-store.test.ts

### 16. Hiring Automation & Scheduler (18 files)
- **ID**: `ctx_1781677988278_mrxbl2q`  · **Group**: Offers & Automation  · **Category**: `lib`
- **DB tables**: tasks, automation
- **Description**: The background automation engine that advances the pipeline on a schedule: automation passes, fairness/ROI gating, cache keys, and the persistent scheduler. Includes the Python automation CLI/eval.
- **Files**:
  - app/_lib/automation-pass.ts
  - app/_lib/automation-run.ts
  - app/_lib/automation-cache-key.ts
  - app/_lib/automation-cache-key.test.ts
  - app/_lib/automation-fairness.ts
  - app/_lib/automation-fairness.test.ts
  - app/_lib/automation-roi.ts
  - app/_lib/automation-roi.test.ts
  - app/_lib/scheduler.ts
  - app/_lib/scheduler-store.ts
  - app/_lib/approval-kinds.ts
  - app/api/automation/run/route.ts
  - app/api/automation/schedule/route.ts
  - app/api/automation/[task]/route.ts
  - instrumentation.ts
  - pipeline/jobfit/automation.py
  - pipeline/jobfit/automation_cli.py
  - pipeline/jobfit/eval/automation_eval.py

### 17. Offers & Onboarding (7 files)
- **ID**: `ctx_1781677988272_4d6na1s`  · **Group**: Offers & Automation  · **Category**: `ui`
- **DB tables**: offers
- **Description**: Generate, send, and finalize candidate offers via a tokenized public offer page, gated by offer policy.
- **Files**:
  - app/offer/[token]/page.tsx
  - app/api/offer/[token]/route.ts
  - app/_lib/offers-store.ts
  - app/_lib/offers-store.test.ts
  - app/_lib/offer-finalize.ts
  - app/_lib/offer-policy.ts
  - app/_lib/offer-policy.test.ts

### 18. Dev Case Pipeline (Python) (20 files)
- **ID**: `ctx_1781677988309_dy2tx43`  · **Group**: Dev Hiring Extension  · **Category**: `lib`
- **Description**: The Python engine behind dev cases: analyze a need, design a case, evaluate submissions, reflect, run lifecycle audits, and judge with an LLM. Backs the TS dev-hiring routes.
- **Files**:
  - pipeline/jobfit/devcase/__init__.py
  - pipeline/jobfit/devcase/models.py
  - pipeline/jobfit/devcase/analyze.py
  - pipeline/jobfit/devcase/design.py
  - pipeline/jobfit/devcase/evaluate.py
  - pipeline/jobfit/devcase/reflect.py
  - pipeline/jobfit/devcase/scenarios.py
  - pipeline/jobfit/devcase/source.py
  - pipeline/jobfit/devcase/devcase_cli.py
  - pipeline/jobfit/devcase/submission_scenarios.py
  - pipeline/jobfit/devcase/submission_eval.py
  - pipeline/jobfit/devcase/lifecycle_audits.py
  - pipeline/jobfit/devcase/lifecycle_eval.py
  - pipeline/jobfit/devcase/interview_scenario.py
  - pipeline/jobfit/devcase/llm_judge.py
  - pipeline/jobfit/devcase/process_events.py
  - pipeline/jobfit/devcase/provenance.py
  - pipeline/jobfit/devcase/seed_materializer.py
  - pipeline/jobfit/devcase/_synth.py
  - pipeline/jobfit/claude_cli.py

### 19. Dev Lifecycle, Cohort & Outcomes (35 files)
- **ID**: `ctx_1781677988304_3yyryvk`  · **Group**: Dev Hiring Extension  · **Category**: `ui`
- **DB tables**: devcase, skill_profiles
- **Description**: Manage dev case lifecycle (approve/close/redesign), cohort probe strength, interview kits, skill-profile verification, outbox comms and hiring outcomes.
- **Files**:
  - app/features/sub_dev/LifecycleRow.tsx
  - app/features/sub_dev/LifecycleSection.tsx
  - app/features/sub_dev/OutboxSection.tsx
  - app/features/sub_dev/CohortProbePanel.tsx
  - app/features/sub_dev/ProbeStrengthBanner.tsx
  - app/features/sub_dev/InterviewKit.tsx
  - app/api/devcase/lifecycle/route.ts
  - app/api/devcase/lifecycle/[id]/approve/route.ts
  - app/api/devcase/lifecycle/[id]/close/route.ts
  - app/api/devcase/lifecycle/[id]/redesign/route.ts
  - app/api/devcase/promote/route.ts
  - app/api/devcase/outcomes/route.ts
  - app/api/devcase/comms/route.ts
  - app/api/devcase/feedback/route.ts
  - app/api/devcase/skill-profile/route.ts
  - app/api/skill-profile/[token]/verify/route.ts
  - app/skill/[token]/page.tsx
  - app/_lib/dev-outcomes.ts
  - app/_lib/dev-outcomes.test.ts
  - app/_lib/devcase-cohort.ts
  - app/_lib/devcase-cohort.test.ts
  - app/_lib/devcase-feedback.ts
  - app/_lib/devcase-feedback.test.ts
  - app/_lib/devcase-interview-kit.ts
  - app/_lib/devcase-interview-kit.test.ts
  - app/_lib/devcase-probe-audit.ts
  - app/_lib/devcase-probe-audit.test.ts
  - app/_lib/devcase-sla.ts
  - app/_lib/devcase-sla.test.ts
  - app/_lib/devcase-seed-diff.ts
  - app/_lib/devcase-seed-diff.test.ts
  - app/_lib/skill-profile.ts
  - app/_lib/skill-profile.test.ts
  - app/_lib/db/devcase.ts
  - app/_lib/db/skill-profiles.ts

### 20. Dev Submissions & Live Work Surface (27 files)
- **ID**: `ctx_1781677988289_vuw46lz`  · **Group**: Dev Hiring Extension  · **Category**: `ui`
- **DB tables**: devcase
- **Description**: Candidate-facing dev case workspace (live coding surface, seed files) plus recruiter-side submission review, authenticity scoring, and side-by-side submission comparison.
- **Files**:
  - app/features/sub_dev/SubmissionForm.tsx
  - app/features/sub_dev/SubmissionRow.tsx
  - app/features/sub_dev/AnalysisView.tsx
  - app/features/sub_dev/EvalPanel.tsx
  - app/features/sub_dev/ScoreBar.tsx
  - app/features/sub_dev/CompareSubmissions.tsx
  - app/features/sub_dev/ProvenanceStrip.tsx
  - app/devcase/apply/[token]/page.tsx
  - app/devcase/apply/[token]/DevApplyForm.tsx
  - app/devcase/apply/[token]/LiveWorkSurface.tsx
  - app/devcase/apply/[token]/SeedFiles.tsx
  - app/api/devcase/submit/route.ts
  - app/api/devcase/inbound/route.ts
  - app/api/devcase/session/route.ts
  - app/api/devcase/session/[id]/route.ts
  - app/api/devcase/session/[id]/submit/route.ts
  - app/api/devcase/seed/[id]/route.ts
  - app/_lib/repo-snapshot.ts
  - app/_lib/repo-snapshot.test.ts
  - app/_lib/repo-activity.ts
  - app/_lib/repo-activity.test.ts
  - app/_lib/devcase-authenticity.ts
  - app/_lib/devcase-authenticity.test.ts
  - app/_lib/devcase-compare.ts
  - app/_lib/devcase-compare.test.ts
  - app/_lib/code-review-status.ts
  - app/_lib/code-review-status.test.ts

### 21. Dev Case Authoring & Publishing (18 files)
- **ID**: `ctx_1781677988284_ujb4qmg`  · **Group**: Dev Hiring Extension  · **Category**: `ui`
- **DB tables**: devcase
- **Description**: Author developer hiring cases from a role need, generate/orchestrate the case content, and publish postings with apply tokens. Covers the Dev tab and case orchestration.
- **Files**:
  - app/features/sub_dev/DevTab.tsx
  - app/features/sub_dev/DevShared.tsx
  - app/features/sub_dev/DevTypes.ts
  - app/features/sub_dev/DevHelpers.ts
  - app/features/sub_dev/DevHelpers.test.ts
  - app/features/sub_dev/NeedForm.tsx
  - app/features/sub_dev/CasesTable.tsx
  - app/features/sub_dev/CaseDetail.tsx
  - app/features/sub_dev/ApplyTokenPill.tsx
  - app/api/devcase/route.ts
  - app/api/devcase/publish/route.ts
  - app/api/devcase/postings/route.ts
  - app/api/devcase/source/route.ts
  - app/api/devcase/control/route.ts
  - app/_lib/devcase-orchestrator.ts
  - app/_lib/devcase-run.ts
  - app/_lib/dev-control.ts
  - app/_lib/devcase-constraints.ts

### 22. Pipeline Test Suite (Python) (65 files)
- **ID**: `ctx_1781677988338_hdner46`  · **Group**: AI Matching & Extraction Engine  · **Category**: `test`
- **Description**: The pytest suite that quality-gates the Python engine: matching, profiling, taxonomy contracts, fairness, devcase, LLM layer, salary/score sanity, and prompt-version sync.
- **Files**:
  - pipeline/jobfit/tests/__init__.py
  - pipeline/jobfit/tests/_helpers.py
  - pipeline/jobfit/tests/run_gated.py
  - pipeline/jobfit/tests/test_matching.py
  - pipeline/jobfit/tests/test_match_reasoning.py
  - pipeline/jobfit/tests/test_match_cli.py
  - pipeline/jobfit/tests/test_profile.py
  - pipeline/jobfit/tests/test_profile_cli.py
  - pipeline/jobfit/tests/test_profile_draft.py
  - pipeline/jobfit/tests/test_profiling.py
  - pipeline/jobfit/tests/test_profile_taxonomy_contract.py
  - pipeline/jobfit/tests/test_taxonomy_contract.py
  - pipeline/jobfit/tests/test_taxonomy_graph.py
  - pipeline/jobfit/tests/test_transform.py
  - pipeline/jobfit/tests/test_transferable.py
  - pipeline/jobfit/tests/test_jobs.py
  - pipeline/jobfit/tests/test_recruiter.py
  - pipeline/jobfit/tests/test_recruiter_cli.py
  - pipeline/jobfit/tests/test_insights.py
  - pipeline/jobfit/tests/test_soft_signals.py
  - pipeline/jobfit/tests/test_fairness.py
  - pipeline/jobfit/tests/test_authenticity.py
  - pipeline/jobfit/tests/test_ats.py
  - pipeline/jobfit/tests/test_archetype_sanity.py
  - pipeline/jobfit/tests/test_salary_band.py
  - pipeline/jobfit/tests/test_salary_sanity.py
  - pipeline/jobfit/tests/test_score_sanity.py
  - pipeline/jobfit/tests/test_scoring_contract.py
  - pipeline/jobfit/tests/test_winnability.py
  - pipeline/jobfit/tests/test_weight_proposal.py
  - pipeline/jobfit/tests/test_campaign.py
  - pipeline/jobfit/tests/test_group_compare.py
  - pipeline/jobfit/tests/test_i18n.py
  - pipeline/jobfit/tests/test_prompt_locale.py
  - pipeline/jobfit/tests/test_prompt_version_sync.py
  - pipeline/jobfit/tests/test_pdf_parsing_quality.py
  - pipeline/jobfit/tests/test_gemini_truncation.py
  - pipeline/jobfit/tests/test_pipeline_degrade.py
  - pipeline/jobfit/tests/test_pipeline_diagram_contract.py
  - pipeline/jobfit/tests/test_process_events.py
  - pipeline/jobfit/tests/test_redact.py
  - pipeline/jobfit/tests/test_registry.py
  - pipeline/jobfit/tests/test_embedding_bridge.py
  - pipeline/jobfit/tests/test_eval_runner.py
  - pipeline/jobfit/tests/test_automation.py
  - pipeline/jobfit/tests/test_automation_cli.py
  - pipeline/jobfit/tests/test_automation_eval.py
  - pipeline/jobfit/tests/test_seed_candidates.py
  - pipeline/jobfit/tests/test_seed_materializer.py
  - pipeline/jobfit/tests/test_early_career_single_source.py
  - pipeline/jobfit/tests/test_interview_rubrics.py
  - pipeline/jobfit/tests/test_interview_scenario.py
  - pipeline/jobfit/tests/test_live_case.py
  - pipeline/jobfit/tests/test_matrix_cli.py
  - pipeline/jobfit/tests/test_devcase_models.py
  - pipeline/jobfit/tests/test_devcase_analyze.py
  - pipeline/jobfit/tests/test_devcase_design.py
  - pipeline/jobfit/tests/test_devcase_evaluate.py
  - pipeline/jobfit/tests/test_devcase_eval.py
  - pipeline/jobfit/tests/test_devcase_reflect.py
  - pipeline/jobfit/tests/test_devcase_source.py
  - pipeline/jobfit/tests/test_devcase_cli.py
  - pipeline/jobfit/tests/test_devcase_lifecycle.py
  - pipeline/jobfit/tests/test_devcase_provenance.py
  - pipeline/jobfit/tests/test_claude_cli.py

### 23. Evaluation, Fairness & Seed Data (19 files)
- **ID**: `ctx_1781677988332_tk7pe02`  · **Group**: AI Matching & Extraction Engine  · **Category**: `lib`
- **Description**: Offline evaluation harness (thresholds, matching/automation eval, fixtures) and the deterministic seed datasets for jobs (Česká spořitelna), candidates, pipeline, analyses and salary benchmarks.
- **Files**:
  - pipeline/jobfit/eval/__init__.py
  - pipeline/jobfit/eval/__main__.py
  - pipeline/jobfit/eval/_style.py
  - pipeline/jobfit/eval/thresholds.py
  - pipeline/jobfit/eval/matching_eval.py
  - pipeline/jobfit/eval/runner.py
  - pipeline/jobfit/eval/seed_cv_fixtures.py
  - pipeline/jobfit/seed_jobs.py
  - pipeline/jobfit/seed_jobs_csas.py
  - pipeline/jobfit/seed_candidates.py
  - pipeline/jobfit/seed_pipeline.py
  - pipeline/jobfit/seed_analyses.py
  - pipeline/jobfit/seed_interview_calendar.py
  - pipeline/jobfit/align_candidates_csas.py
  - data/seed_jobs/jobs.json
  - data/seed_jobs/jobs.normalized.json
  - data/seed_candidates/candidates.json
  - data/seed_pipeline/pipeline.json
  - data/salary_benchmarks.json

### 24. Pipeline CLIs & Script Bridges (21 files)
- **ID**: `ctx_1781677988325_h6vjpl1`  · **Group**: AI Matching & Extraction Engine  · **Category**: `lib`
- **Description**: Command-line entry points that the Next.js API shells out to (analyze, profile, match, reasoning, jobs, recruiter, matrix, salary, campaign, winnability) plus the thin scripts/ wrappers.
- **Files**:
  - pipeline/jobfit/cli.py
  - pipeline/jobfit/profile_cli.py
  - pipeline/jobfit/profile_draft_cli.py
  - pipeline/jobfit/match_cli.py
  - pipeline/jobfit/reasoning_cli.py
  - pipeline/jobfit/jobs_cli.py
  - pipeline/jobfit/recruiter_cli.py
  - pipeline/jobfit/matrix_cli.py
  - pipeline/jobfit/market_salary_cli.py
  - pipeline/jobfit/campaign_cli.py
  - pipeline/jobfit/group_compare_cli.py
  - pipeline/jobfit/winnability_cli.py
  - pipeline/jobfit/extract_cli.py
  - pipeline/__init__.py
  - pipeline/jobfit/__init__.py
  - scripts/_common.py
  - scripts/analyze.py
  - scripts/compare.py
  - scripts/interview.py
  - scripts/jobfit.py
  - scripts/salary.py

### 25. CV Extraction & Pipeline Services (15 files)
- **ID**: `ctx_1781677988319_9n1gl7m`  · **Group**: AI Matching & Extraction Engine  · **Category**: `lib`
- **Description**: Parse and extract structure from CVs via Gemini, score soft signals, run the analysis pipeline orchestration and the long-running service, with redaction and i18n of prompts.
- **Files**:
  - pipeline/jobfit/gemini.py
  - pipeline/jobfit/pipeline.py
  - pipeline/jobfit/extractors.py
  - pipeline/jobfit/soft_signals.py
  - pipeline/jobfit/interview.py
  - pipeline/jobfit/service.py
  - pipeline/jobfit/codegen.py
  - pipeline/jobfit/logger.py
  - pipeline/jobfit/authenticity.py
  - pipeline/jobfit/redact.py
  - pipeline/jobfit/embedding_bridge.py
  - pipeline/jobfit/i18n.py
  - pipeline/jobfit/registry.py
  - pipeline/jobfit/_summary.py
  - pipeline/jobfit/_cli.py

### 26. Matching & Transformation Engine (20 files)
- **ID**: `ctx_1781677988315_d2r2zh2`  · **Group**: AI Matching & Extraction Engine  · **Category**: `lib`
- **DB tables**: taxonomy
- **Description**: The deterministic scoring core: taxonomy, archetypes, skill transformation/transferability, candidate↔job matching, reasoning prep, recruiter scoring, insights and winnability.
- **Files**:
  - pipeline/jobfit/models.py
  - pipeline/jobfit/taxonomy.py
  - pipeline/jobfit/archetype.py
  - pipeline/jobfit/transform.py
  - pipeline/jobfit/transferable.py
  - pipeline/jobfit/matching.py
  - pipeline/jobfit/match_reasoning.py
  - pipeline/jobfit/profile.py
  - pipeline/jobfit/profiling.py
  - pipeline/jobfit/recruiter.py
  - pipeline/jobfit/insights.py
  - pipeline/jobfit/jobs.py
  - pipeline/jobfit/ats.py
  - pipeline/jobfit/salary_band.py
  - pipeline/jobfit/winnability.py
  - pipeline/jobfit/weight_proposal.py
  - pipeline/jobfit/campaign.py
  - pipeline/jobfit/group_compare.py
  - pipeline/jobfit/live_case.py
  - data/taxonomy.json

### 27. Model & API Key Management (12 files)
- **ID**: `ctx_1781677988348_ujqien4`  · **Group**: LLM Provider Layer & Models  · **Category**: `ui`
- **DB tables**: llm_config, llm_keys
- **Description**: Configure which LLM models/providers power the app and securely store provider API keys, with a connectivity test and engine-availability preflight.
- **Files**:
  - app/features/sub_models/ModelsTab.tsx
  - app/features/sub_models/KeysPanel.tsx
  - app/features/sub_models/provider-names.ts
  - app/api/llm/config/route.ts
  - app/api/llm/keys/route.ts
  - app/api/llm/test/route.ts
  - app/_lib/llm-config.ts
  - app/_lib/llm-secret.ts
  - app/_lib/llm-secret.test.ts
  - app/_lib/engine-preflight.ts
  - app/features/useEngineAvailability.ts
  - app/_lib/db/llm.ts

### 28. LLM Provider Layer (Python) (21 files)
- **ID**: `ctx_1781677988342_64eid0x`  · **Group**: LLM Provider Layer & Models  · **Category**: `lib`
- **Description**: Provider-agnostic LLM abstraction: a registry + capabilities, per-provider adapters (Anthropic, OpenAI, Azure, Gemini), monitoring, and a benchmarking harness.
- **Files**:
  - pipeline/jobfit/llm/__init__.py
  - pipeline/jobfit/llm/base.py
  - pipeline/jobfit/llm/config.py
  - pipeline/jobfit/llm/registry.py
  - pipeline/jobfit/llm/capabilities.py
  - pipeline/jobfit/llm/monitor.py
  - pipeline/jobfit/llm/test_cli.py
  - pipeline/jobfit/llm/adapters/__init__.py
  - pipeline/jobfit/llm/adapters/anthropic_api.py
  - pipeline/jobfit/llm/adapters/openai_api.py
  - pipeline/jobfit/llm/adapters/azure_openai.py
  - pipeline/jobfit/llm/adapters/gemini_api.py
  - pipeline/jobfit/llm/bench/__init__.py
  - pipeline/jobfit/llm/bench/bench_cli.py
  - pipeline/jobfit/llm/bench/contracts.py
  - pipeline/jobfit/llm/bench/runner.py
  - pipeline/jobfit/llm/bench/scenarios.py
  - pipeline/jobfit/tests/test_llm_base.py
  - pipeline/jobfit/tests/test_llm_registry.py
  - pipeline/jobfit/tests/test_llm_monitor.py
  - pipeline/jobfit/tests/test_llm_bench.py

### 29. Guided Pipeline Simulation (18 files)
- **ID**: `ctx_1781677988371_13976sz`  · **Group**: Insights, Analytics & Simulation  · **Category**: `ui`
- **Description**: A keyless, guided JD→Hired demo that drives real clicks through the app with a bottom bar, spotlight, explain drawer, group-eval and offer frames.
- **Files**:
  - app/features/simulation/SimulationProvider.tsx
  - app/features/simulation/SimBar.tsx
  - app/features/simulation/SimSpotlight.tsx
  - app/features/simulation/SimExplainDrawer.tsx
  - app/features/simulation/SimGroupEval.tsx
  - app/features/simulation/SimOfferFrame.tsx
  - app/features/simulation/SimDecisionWave.tsx
  - app/features/simulation/constants.ts
  - app/features/simulation/constants.test.ts
  - app/features/simulation/criteria.ts
  - app/features/simulation/diagrams.ts
  - app/features/simulation/company-template.ts
  - app/api/sim/reset/route.ts
  - app/api/sim/offer-draft/route.ts
  - app/api/sim/offer-link/route.ts
  - app/api/sim/screen-draft/route.ts
  - app/api/sim/inbound/route.ts
  - app/_lib/sim-store.ts

### 30. Architecture Diagrams (10 files)
- **ID**: `ctx_1781677988365_cly9i1d`  · **Group**: Insights, Analytics & Simulation  · **Category**: `ui`
- **Description**: The interactive pipeline/architecture diagrams page and the custom PlantUML-style Markdown renderer (elkjs layout) that draws component diagrams as styled SVG.
- **Files**:
  - app/diagrams/page.tsx
  - app/diagrams/PipelineExplorer.tsx
  - app/diagrams/pipelineSteps.ts
  - app/diagrams/pipelineSteps.test.ts
  - app/_components/puml/PlantUml.tsx
  - app/_components/puml/constants.ts
  - app/_components/puml/layout.ts
  - app/_components/puml/measure.ts
  - app/_components/puml/parse.ts
  - app/_components/puml/parse.test.ts

### 31. Skill Matrix & Coverage (8 files)
- **ID**: `ctx_1781677988360_ze53xrr`  · **Group**: Insights, Analytics & Simulation  · **Category**: `ui`
- **Description**: The candidate↔skill matrix view and the About/coverage explainer that maps features to the pipeline (incl. student mode).
- **Files**:
  - app/features/sub_matrix/MatrixTab.tsx
  - app/features/sub_matrix/MatrixShared.tsx
  - app/features/sub_matrix/matrix-stats.ts
  - app/features/sub_matrix/matrix-stats.test.ts
  - app/api/matrix/route.ts
  - app/features/sub_about/AboutTab.tsx
  - app/features/sub_about/AboutCoverageData.ts
  - app/features/sub_about/StudentsAbout.tsx

### 32. Analytics & Calibration Dashboards (22 files)
- **ID**: `ctx_1781677988355_ojmjvyl`  · **Group**: Insights, Analytics & Simulation  · **Category**: `ui`
- **DB tables**: analytics
- **Description**: Funnel analytics, decision logs/records, spend and target tracking, calibration of scores, momentum/forecast/bottleneck deltas, and source analytics.
- **Files**:
  - app/features/sub_analytics/AnalyticsTab.tsx
  - app/features/sub_analytics/CalibrationPanel.tsx
  - app/features/sub_analytics/DecisionLog.tsx
  - app/features/sub_analytics/DecisionRecordsPanel.tsx
  - app/api/analytics/route.ts
  - app/api/analytics/calibration/route.ts
  - app/api/analytics/decisions/route.ts
  - app/api/analytics/spend/route.ts
  - app/api/analytics/targets/route.ts
  - app/_lib/analytics-bottleneck.ts
  - app/_lib/analytics-bottleneck.test.ts
  - app/_lib/analytics-deltas.ts
  - app/_lib/analytics-deltas.test.ts
  - app/_lib/analytics-forecast.ts
  - app/_lib/analytics-forecast.test.ts
  - app/_lib/analytics-momentum.ts
  - app/_lib/analytics-momentum.test.ts
  - app/_lib/calibration.ts
  - app/_lib/calibration.test.ts
  - app/_lib/source-analytics.ts
  - app/_lib/source-analytics.test.ts
  - app/_lib/db/analytics.ts

### 33. Plans, Checkout & Billing UI (6 files)
- **ID**: `ctx_1781677988383_8q1tzcp`  · **Group**: Billing & Monetization  · **Category**: `ui`
- **DB tables**: billing
- **Description**: The Billing tab where users view their plan, start checkout, and open the customer portal.
- **Files**:
  - app/features/sub_billing/BillingTab.tsx
  - app/_lib/billing/plans.ts
  - app/api/billing/route.ts
  - app/api/billing/checkout/route.ts
  - app/api/billing/portal/route.ts
  - scripts/polar-setup.mjs

### 34. Billing Engine & Webhooks (13 files)
- **ID**: `ctx_1781677988377_0b1g014`  · **Group**: Billing & Monetization  · **Category**: `lib`
- **DB tables**: billing, subscriptions
- **Description**: Entitlement enforcement and the billing gateway (Polar): plan reduction, entitlement checks, webhook verification/sync. Gates premium capabilities across the app.
- **Files**:
  - app/_lib/billing/enforce.ts
  - app/_lib/billing/entitlements.ts
  - app/_lib/billing/gateway.ts
  - app/_lib/billing/index.ts
  - app/_lib/billing/polar.ts
  - app/_lib/billing/reduce.ts
  - app/_lib/billing/reduce.test.ts
  - app/_lib/billing/sync.ts
  - app/_lib/billing/webhook-verify.ts
  - app/_lib/billing/webhook-verify.test.ts
  - app/_lib/billing-gate.test.ts
  - app/api/billing/webhook/route.ts
  - app/_lib/db/billing.ts

### 35. Landing & Marketing (9 files)
- **ID**: `ctx_1781677988414_q8flnsl`  · **Group**: Platform, Shell & Shared UI  · **Category**: `ui`
- **Description**: The public marketing landing pages (Studio + Spark art directions) and the login entry page.
- **Files**:
  - app/landing/layout.tsx
  - app/landing/page.tsx
  - app/landing/_components/KandidateMark.tsx
  - app/landing/spark/SparkLanding.tsx
  - app/landing/spark/FeaturePreviews.tsx
  - app/landing/spark/PricingSection.tsx
  - app/landing/spark/page.tsx
  - app/landing/spark/tokens.ts
  - app/login/page.tsx

### 36. Shared Utility Libraries (20 files)
- **ID**: `ctx_1781677988403_jvgko7d`  · **Group**: Platform, Shell & Shared UI  · **Category**: `lib`
- **Description**: Cross-cutting low-level utilities: caching, logging, env parsing, rate limiting, URL/ID safety, API response shaping, dedupe and distribution math.
- **Files**:
  - app/_lib/cache.ts
  - app/_lib/cache-key.ts
  - app/_lib/cache-key.test.ts
  - app/_lib/logger.ts
  - app/_lib/env.ts
  - app/_lib/env.test.ts
  - app/_lib/random-id.ts
  - app/_lib/random-id.test.ts
  - app/_lib/rate-limit.ts
  - app/_lib/rate-limit.test.ts
  - app/_lib/safe-url.ts
  - app/_lib/safe-url.test.ts
  - app/_lib/public-base-url.ts
  - app/_lib/public-base-url.test.ts
  - app/_lib/api-response.ts
  - app/_lib/entries-param.ts
  - app/_lib/entries-param.test.ts
  - app/_lib/dedupe.ts
  - app/_lib/distribution.ts
  - app/_lib/split-list.ts

### 37. Shared UI & Design System (44 files)
- **ID**: `ctx_1781677988398_0fse5ko`  · **Group**: Platform, Shell & Shared UI  · **Category**: `ui`
- **Description**: Reusable behavioral primitives and the dual-theme (Studio Light / Spark Dark) design system: Modal, Badge, SegmentedControl, recipes, theme tokens, icons and score visuals.
- **Files**:
  - app/_components/Badge.tsx
  - app/_components/Modal.tsx
  - app/_components/Markdown.tsx
  - app/_components/DisclosureRow.tsx
  - app/_components/SegmentedControl.tsx
  - app/_components/segmented-control-selection.ts
  - app/_components/segmented-control-selection.test.ts
  - app/_components/Skeleton.tsx
  - app/_components/ThemeToggle.tsx
  - app/_components/ChainEmptyState.tsx
  - app/_components/CompletionCta.tsx
  - app/_components/ErrorBoundary.tsx
  - app/_components/LoadStatus.tsx
  - app/_components/PotentialBadge.tsx
  - app/_components/Meter.tsx
  - app/_components/ScoreDial.tsx
  - app/_components/ScoreBadge.tsx
  - app/_components/icons/index.ts
  - app/_components/icons/CompareIcon.tsx
  - app/_components/icons/ExtractionIcon.tsx
  - app/_components/icons/InterviewIcon.tsx
  - app/_components/icons/JobFitIcon.tsx
  - app/_components/icons/SalaryIcon.tsx
  - app/_components/ui/SectionTitle.tsx
  - app/_components/ui/ThemeSplit.tsx
  - app/_components/ui/recipes.ts
  - app/_components/ui/useTheme.ts
  - app/globals.css
  - app/_lib/theme.ts
  - app/_lib/brand.ts
  - app/_lib/initials.ts
  - app/_lib/format.ts
  - app/_lib/format.test.ts
  - app/_lib/use-enum-label.ts
  - app/_lib/use-error-message.ts
  - app/_lib/useInfiniteScroll.ts
  - app/_lib/useJsonFetch.ts
  - app/_lib/useLoader.ts
  - app/_lib/useReachOut.ts
  - app/_lib/useReducedMotion.ts
  - app/apple-icon.tsx
  - app/opengraph-image.tsx
  - app/_lib/og-fonts.ts
  - app/_lib/og-fonts.test.ts

### 38. Tasks & System Operations (16 files)
- **ID**: `ctx_1781677988392_hccm04x`  · **Group**: Platform, Shell & Shared UI  · **Category**: `ui`
- **DB tables**: tasks
- **Description**: The background task tracker (provider, indicator, tasks tab), system/backup cards, health and ops telemetry, and the Python runner bridge.
- **Files**:
  - app/features/tasks/TasksProvider.tsx
  - app/features/tasks/TasksIndicator.tsx
  - app/features/tasks/TasksTab.tsx
  - app/features/tasks/BackupCard.tsx
  - app/features/tasks/SystemCard.tsx
  - app/api/tasks/route.ts
  - app/api/tasks/[id]/route.ts
  - app/api/tasks/[id]/retry/route.ts
  - app/api/tasks/history/route.ts
  - app/api/ops/route.ts
  - app/api/health/route.ts
  - app/_lib/tasks.ts
  - app/_lib/task-dedupe.ts
  - app/_lib/task-dedupe.test.ts
  - app/_lib/ops-telemetry.ts
  - app/_lib/python-runner.ts

### 39. App Shell & Navigation (29 files)
- **ID**: `ctx_1781677988388_ijm3f74`  · **Group**: Platform, Shell & Shared UI  · **Category**: `ui`
- **Description**: The authenticated workspace shell: tab navigation, command palette, keyboard shortcuts, recents, global search, attention badges, live refresh, and i18n.
- **Files**:
  - app/layout.tsx
  - app/page.tsx
  - app/features/Workspace.tsx
  - app/features/WorkspaceNav.tsx
  - app/features/CommandPalette.tsx
  - app/features/KeyboardShortcuts.tsx
  - app/features/RecentsNav.tsx
  - app/features/RecordRecent.tsx
  - app/features/tabs.ts
  - app/features/tabs.test.ts
  - app/features/recents.ts
  - app/features/live-refresh.ts
  - app/features/useAttention.ts
  - app/api/search/route.ts
  - app/api/attention/route.ts
  - app/control/page.tsx
  - app/_components/LanguageSwitcher.tsx
  - i18n/actions.ts
  - i18n/locales.ts
  - i18n/request.ts
  - i18n/server.ts
  - messages/en.json
  - messages/cs.json
  - app/_lib/attention.ts
  - scripts/i18n-check.mjs
  - e2e/analyze-smoke.spec.ts
  - e2e/modal-escape.spec.ts
  - e2e/profile-builder.spec.ts
  - e2e/fixtures/github-analysis.ts

### 40. Privacy, Consent & Provenance (8 files)
- **ID**: `ctx_1781677988431_fi96rjy`  · **Group**: Identity, Data & Privacy  · **Category**: `lib`
- **Description**: GDPR-oriented consent capture and gating, AI-usage disclosure to candidates, and the provenance dossier that records how each data point was derived.
- **Files**:
  - app/_lib/consent.ts
  - app/_lib/consent.test.ts
  - app/_lib/interview-consent.ts
  - app/_lib/interview-consent.test.ts
  - app/_lib/provenance-dossier.ts
  - app/_lib/provenance-dossier.test.ts
  - app/_components/AiDisclosure.tsx
  - docs/GDPR_AND_HIRING_EXTENSIONS.md

### 41. Data Store & Persistence (10 files)
- **ID**: `ctx_1781677988426_lztb34g`  · **Group**: Identity, Data & Privacy  · **Category**: `data`
- **DB tables**: *
- **Description**: The SQLite persistence foundation: the core DB handle/connection, generated and hand-written schemas, the null contract, and DB path/portability helpers shared by every feature store.
- **Files**:
  - app/_lib/db.ts
  - app/_lib/db/core.ts
  - app/_lib/db/tasks.ts
  - app/_lib/schemas.ts
  - app/_lib/schemas.generated.ts
  - app/_lib/schemas-null-contract.test.ts
  - app/_lib/taxonomy.generated.ts
  - next.config.ts
  - requirements.txt
  - global.d.ts

### 42. Auth, Sessions & Workspace Tenancy (22 files)
- **ID**: `ctx_1781677988421_zxm642a`  · **Group**: Identity, Data & Privacy  · **Category**: `lib`
- **DB tables**: workspaces, sessions
- **Description**: Login/logout sessions, edge token verification, multi-workspace switching/tenancy scoping, and workspace export/import (data portability).
- **Files**:
  - app/_lib/auth/session.ts
  - app/_lib/auth/session.test.ts
  - app/_lib/auth/edge-verify.ts
  - app/_lib/auth/edge-verify.test.ts
  - app/_lib/auth/current-workspace.ts
  - app/api/auth/login/route.ts
  - app/api/auth/logout/route.ts
  - app/api/auth/switch-workspace/route.ts
  - app/api/workspaces/route.ts
  - app/api/workspace/export/route.ts
  - app/api/workspace/import/route.ts
  - app/features/sub_workspace/WorkspaceTab.tsx
  - app/_lib/db/workspaces.ts
  - app/_lib/load-state.ts
  - app/_lib/load-state.test.ts
  - app/_lib/export-utils.ts
  - app/_lib/export-utils.test.ts
  - app/_lib/db-portability.ts
  - app/_lib/db-path.ts
  - proxy.ts
  - scripts/db-dump.mjs
  - scripts/db-load.mjs

## Files Not Included In Any Context

None — 100% of meaningful source files (app/, pipeline/, scripts/, i18n/, e2e/, key root + seed data) are covered. Intentionally excluded: `node_modules/`, `.next/`, `.git/`, `tmp/`, `test-results/`, build caches, `package-lock.json`, generated `.pyc`, and most `docs/*.md` (only `GDPR_AND_HIRING_EXTENSIONS.md` is referenced from the Privacy context).

## Issues & Warnings

- ⚠️ `Candidate Profile & Job Matching` has 36 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `CV Analysis Workspace` has 32 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `JD Authoring Library & Templates` has 27 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `Pipeline Board & Candidate Drawer` has 26 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `Voice Interview` has 30 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `Interview Scheduling, Prep & Rubric` has 32 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `Dev Lifecycle, Cohort & Outcomes` has 35 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `Dev Submissions & Live Work Surface` has 27 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `Pipeline Test Suite (Python)` has 65 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `Shared UI & Design System` has 44 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ⚠️ `App Shell & Navigation` has 29 files (guideline 10-20). Kept as one unit: it maps to a single cohesive boundary (a feature directory / the Python test suite / the design system).
- ✓ Every context has `category` + `business_feature`.
- ✓ Every group has a `domain` and ≥1 relationship.
- ✓ No file appears in more than one context.

## Verification

```bash
curl -s "http://localhost:3000/api/context-groups?projectId=a3f8c2d1-7b4e-4f9a-9c6d-2e8b5a1f0d47"
curl -s "http://localhost:3000/api/contexts?projectId=a3f8c2d1-7b4e-4f9a-9c6d-2e8b5a1f0d47"
curl -s "http://localhost:3000/api/context-group-relationships?projectId=a3f8c2d1-7b4e-4f9a-9c6d-2e8b5a1f0d47"
```
