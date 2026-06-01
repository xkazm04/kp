# Context Scan Report

**Date**: 2026-05-31
**Project**: kp
**Project ID**: 5afc2006-01a0-4f50-86ad-d62b1a485caf
**Project Type**: Next.js 15 App Router + Python (jobfit) pipeline

## Execution Summary

| Metric | Value |
|--------|-------|
| Context Groups | 9 |
| Contexts | 23 |
| Group Relationships | 11 |
| Source files inventoried (ts/tsx/py/mjs) | 361 |
| Source files covered | 359 (99.4%) |
| Total file references (incl. data/docs/config) | 375 |
| Duplicate file references | 1 (`distribution.ts`) |

This was a fresh scan — no pre-existing groups or contexts.

## Created Groups

| # | Group | Color | Contexts |
|---|-------|-------|----------|
| 1 | Candidate Analysis | #6366f1 | 3 |
| 2 | Jobs & JD Library | #0ea5e9 | 2 |
| 3 | Pipeline & Decisions | #f59e0b | 2 |
| 4 | Interviews & Scheduling | #10b981 | 2 |
| 5 | Offers & Automation | #ec4899 | 2 |
| 6 | Dev Hiring Extension | #8b5cf6 | 3 |
| 7 | AI Pipeline Core | #ef4444 | 4 |
| 8 | Insights & Simulation | #14b8a6 | 2 |
| 9 | Platform Foundation | #64748b | 3 |

## Created Contexts

| # | Context | Group | Files | DB tables |
|---|---------|-------|-------|-----------|
| 1 | CV Analysis Workspace | Candidate Analysis | 24 | analyses, gemini_cache |
| 2 | Analysis Result Panels | Candidate Analysis | 18 | — |
| 3 | Candidate Profile & Job Matching | Candidate Analysis | 15 | profiles, gemini_cache |
| 4 | Job Postings & Recruiter Candidates | Jobs & JD Library | 19 | jobs, job_ingests |
| 5 | JD Authoring Library & Templates | Jobs & JD Library | 18 | jds, jd_templates |
| 6 | Pipeline Board & Inbound Channels | Pipeline & Decisions | 16 | pipeline_entries, pipeline_events |
| 7 | Screening Decisions & Group Eval | Pipeline & Decisions | 15 | decision_config, group_evals |
| 8 | Voice Interview | Interviews & Scheduling | 15 | interview_sessions |
| 9 | Interview Scheduling, Prep & Rubric | Interviews & Scheduling | 16 | schedule_invites, interview_preps |
| 10 | Offers & Communications | Offers & Automation | 6 | offers |
| 11 | Hiring Automation & Scheduler | Offers & Automation | 15 | scheduler, scheduler_runs |
| 12 | Dev Case Authoring & Publishing | Dev Hiring Extension | 16 | dev_cases, dev_postings, dev_control, dev_audit |
| 13 | Dev Submissions, Lifecycle & Outcomes | Dev Hiring Extension | 18 | dev_submissions, dev_outbox, dev_lifecycle, dev_outcomes |
| 14 | Dev Case Pipeline (Python) | Dev Hiring Extension | 25 | — |
| 15 | Matching & Transformation Engine | AI Pipeline Core | 14 | — |
| 16 | CV Extraction, LLM & Pipeline CLIs | AI Pipeline Core | 24 | — |
| 17 | Evaluation, Fairness & Seed Data | AI Pipeline Core | 15 | — |
| 18 | Pipeline Test Suite | AI Pipeline Core | 19 | — |
| 19 | Analytics, Matrix & Architecture Diagrams | Insights & Simulation | 15 | — |
| 20 | Guided Pipeline Simulation | Insights & Simulation | 16 | — |
| 21 | Workspace Shell & Navigation | Platform Foundation | 15 | tasks |
| 22 | Data Store & Shared Libs | Platform Foundation | 11 | (all core tables) |
| 23 | Shared UI Components | Platform Foundation | 10 | — |

## Group Relationships (domain flow)

1. Candidate Analysis → AI Pipeline Core
2. Jobs & JD Library → AI Pipeline Core
3. Pipeline & Decisions → Jobs & JD Library
4. Pipeline & Decisions → Candidate Analysis
5. Interviews & Scheduling → Pipeline & Decisions
6. Offers & Automation → Pipeline & Decisions
7. Offers & Automation → Interviews & Scheduling
8. Dev Hiring Extension → AI Pipeline Core
9. Insights & Simulation → Pipeline & Decisions
10. AI Pipeline Core → Platform Foundation
11. Pipeline & Decisions → Platform Foundation

## Design Notes

- **Grouped by business domain**, with each context as a full-stack vertical slice
  (feature UI + API route + store/lib), per the context-map guidance.
- The **AI Pipeline Core** (Python `pipeline/jobfit`) is split into engine / LLM+CLIs /
  eval+seeds / tests because it is the product's heart and too large for one context.
- The **Dev Hiring Extension** is sliced authoring vs. submissions/lifecycle (UI+API+store
  together) plus its own Python pipeline.
- Context sizes land at 6–25 files (target ~20). The two large ones (Dev Case Pipeline 25,
  CV Analysis Workspace / CV Extraction 24) are cohesive and intentionally kept whole.

## Issues & Warnings

- ⚠️ **Duplicate file**: `app/_lib/distribution.ts` appears in both *CV Analysis Workspace*
  and *Dev Submissions, Lifecycle & Outcomes*. It belongs only in the latter (it is the
  Dev-extension distribution seam over `dev_postings`/`dev_submissions`). It was created in
  the first context before disambiguation, and the platform's `PUT /api/contexts` update
  endpoint returned `Failed to update context` (server-side error) on every retry, so the
  stale reference could not be removed without delete+recreate (disallowed by the task rules).
- ⚠️ **Uncovered source file (1)**: `app/_lib/useJsonFetch.ts` — a shared client fetch hook
  that belongs in *Data Store & Shared Libs*. It could not be appended for the same
  update-endpoint reason. Everything else (359/361 source files) is covered.
- ✓ No empty contexts; every context has entry points, keywords, db tables (where relevant),
  api surface, cross-refs and tech stack populated.
- ✓ Coverage spans all 14 workspace tabs, the candidate-facing flows (apply / interview /
  schedule / offer), and the full Python pipeline.

## Verification

```bash
curl -s "http://localhost:3000/api/context-groups?projectId=5afc2006-01a0-4f50-86ad-d62b1a485caf"
curl -s "http://localhost:3000/api/contexts?projectId=5afc2006-01a0-4f50-86ad-d62b1a485caf"
curl -s "http://localhost:3000/api/context-group-relationships?projectId=5afc2006-01a0-4f50-86ad-d62b1a485caf"
```

All entities verified present: 9 groups, 23 contexts, 11 relationships.
