# Context Scan Report

**Date**: 2026-06-01
**Project**: kp
**Project ID**: 5928226b-548c-40e3-97fe-a9cecc59712a
**Project Type**: Next.js 16 (App Router) + Python `jobfit` pipeline

## Execution Summary

| Metric | Value |
|--------|-------|
| Context Groups Created | 9 |
| Contexts Created | 22 |
| Group Relationships Created | 13 |
| Source Files (ts/tsx/py/mjs/css, excl. vendor) | 383 |
| Files Mapped to Contexts (distinct) | 336 |
| Duplicate File Assignments | 0 |
| Coverage of Source Universe | 87.7% |
| Coverage Excluding Test/Eval Harness | 98.8% |

The project models an **AI recruiting / job-fit platform**: candidates are analyzed
(CV → job-fit, salary, interview, extraction), roles are catalogued from job
descriptions, candidates are matched and decided on, walked through a pipeline with
voice interviews / scheduling / offers, with an automated developer take-home
("dev case") track and a scripted demo simulation. A Python `pipeline/jobfit`
package is the scoring/LLM engine, bridged from the Next.js app via a Python runner.

## Context Groups

| # | Group | Color | Contexts |
|---|-------|-------|----------|
| 1 | Candidate Analysis & Scoring | `#3B82F6` | 4 |
| 2 | Jobs & Job Descriptions | `#06B6D4` | 2 |
| 3 | Matching & Decisions | `#8B5CF6` | 2 |
| 4 | Interviews | `#EC4899` | 2 |
| 5 | Recruitment Pipeline & Scheduling | `#F59E0B` | 2 |
| 6 | Dev Case Automation | `#10B981` | 3 |
| 7 | Automation & Simulation | `#EF4444` | 2 |
| 8 | Candidate-Facing Experiences | `#7C3AED` | 2 |
| 9 | Platform & Shared Infrastructure | `#6366F1` | 3 |

## Created Contexts

| # | Context | Group | Files | Context ID |
|---|---------|-------|-------|------------|
| 1 | CV Analysis Workspace | Candidate Analysis & Scoring | 21 | ctx_1780321513512_op07yqa |
| 2 | Analysis Results & Reporting | Candidate Analysis & Scoring | 22 | ctx_1780321513544_je8woys |
| 3 | Scoring & Extraction Engine (Python) | Candidate Analysis & Scoring | 22 | ctx_1780321513563_ujrno9h |
| 4 | Candidate Profile Builder | Candidate Analysis & Scoring | 10 | ctx_1780321513583_btewh7b |
| 5 | JD Library & Builder | Jobs & Job Descriptions | 18 | ctx_1780321513601_tzuoszz |
| 6 | Job Catalog, Ingestion & Sourcing | Jobs & Job Descriptions | 24 | ctx_1780321513619_rp2us4c |
| 7 | Candidate-Job Matching & Fit Matrix | Matching & Decisions | 18 | ctx_1780321513631_mhdrs9a |
| 8 | Decision Workflow & Group Eval | Matching & Decisions | 15 | ctx_1780321513641_6rt3ia4 |
| 9 | Voice Interview Runtime | Interviews | 17 | ctx_1780321513659_zsgw6ec |
| 10 | Interview Prep & Rubric | Interviews | 6 | ctx_1780321513681_13vx3f8 |
| 11 | Pipeline Board & Scheduler | Recruitment Pipeline & Scheduling | 14 | ctx_1780321513699_vp666hx |
| 12 | Scheduling & Offers | Recruitment Pipeline & Scheduling | 14 | ctx_1780321513709_yr1hfry |
| 13 | Dev Case Studio (UI) | Dev Case Automation | 18 | ctx_1780321513727_er84y5s |
| 14 | Dev Case Orchestration & API | Dev Case Automation | 16 | ctx_1780321513736_k8grjwp |
| 15 | Dev Case Python Engine | Dev Case Automation | 13 | ctx_1780321513757_n62ur2k |
| 16 | Automation Orchestration | Automation & Simulation | 7 | ctx_1780321513766_31r1bdx |
| 17 | Demo Simulation & Channels | Automation & Simulation | 19 | ctx_1780321513778_mrjrllw |
| 18 | Conversational Apply | Candidate-Facing Experiences | 4 | ctx_1780321513788_cso9ncf |
| 19 | GitHub Code Analysis | Candidate-Facing Experiences | 4 | ctx_1780321513799_9ajd7xb |
| 20 | Data Layer, Schemas & Python Bridge | Platform & Shared Infrastructure | 21 | ctx_1780321513820_crdczuo |
| 21 | Workspace Shell & Shared UI | Platform & Shared Infrastructure | 22 | ctx_1780321513831_7b9o1lf |
| 22 | Analytics & Diagrams | Platform & Shared Infrastructure | 11 | ctx_1780321513840_jwyirhw |

## Group Relationships

| Source → Target | Type | Why |
|-----------------|------|-----|
| Candidate Analysis → Jobs & JDs | depends-on | Analysis scores a CV against a catalogued role/JD |
| Jobs & JDs → Matching & Decisions | triggers | Open roles feed candidate↔role matching |
| Matching & Decisions ↔ Candidate Analysis | uses | Matching reuses the job-fit scoring engine |
| Matching & Decisions → Pipeline | triggers | Advance/reject decisions create pipeline entries |
| Pipeline ↔ Interviews | triggers | Pipeline stages schedule and launch interviews |
| Automation & Simulation → Pipeline | calls | Automation passes advance pipeline entries |
| Automation & Simulation → Matching | calls | Automation runs matching / screening waves |
| Candidate-Facing → Pipeline | triggers | A submitted application creates a pipeline entry |
| Dev Case Automation → Candidate-Facing | uses | Dev-case postings issue apply-token links |
| Dev Case Automation → Platform | uses | Persists via shared data layer / Python bridge |
| Candidate Analysis → Platform | uses | Persistence, Gemini cache, Python engine |
| Pipeline → Platform | uses | Board & scheduler read/write SQLite |
| Matching & Decisions → Platform | uses | Reads jobs/profiles, runs Python via bridge |

> Note: the relationship API treats each group pair as unique/undirected. A 14th
> intended edge (Interviews → Pipeline `uses`) was rejected because the
> Pipeline↔Interviews pair already existed (`triggers`). 13 persisted.

## Coverage

- **336 distinct files** mapped across 22 contexts with **no duplicate assignments**.
- Every non-test application and pipeline source file is covered (verified by diffing
  the mapped set against `git ls-files`).

### Files Not Included in Any Context (47, all intentional)

| Category | Count | Rationale |
|----------|-------|-----------|
| Unit tests (`pipeline/jobfit/tests/**`) | 35 | Test harness, not a user capability |
| Eval harness & fixtures (`pipeline/jobfit/eval/**`) | 8 | Offline quality-eval harness |
| Build/tooling config (`eslint.config.mjs`, `postcss.config.mjs`, `playwright.config.ts`, `next-env.d.ts`) | 4 | Tooling config, not feature code |

Also excluded from the universe by design: `node_modules/`, `public/`, `data/`,
`samples/`, `tmp/`, docs, `.puml` diagrams, and non-source assets.

## Design Decisions

- **Grouped by business domain**, not architecture layer. Each context is a
  full-stack vertical slice (UI + API route + `_lib` logic + Python module + DB table).
- **Python pipeline distributed by domain**: extraction/scoring → Candidate Analysis;
  matching → Matching; jobs/recruiter → Jobs; devcase → Dev Case; automation →
  Automation; shared LLM/codegen bridges (`claude_cli.py`, `codegen.py`) → Platform.
- **Matrix merged into Matching** (a thin 5-file slice) rather than left as its own
  undersized context.
- **Tasks runner placed in Platform** (cross-cutting async infra); **Channels/comms
  merged into Demo Simulation** since the simulation drives inbound comms.
- A few intentionally small but distinct candidate-facing slices were kept separate
  for navigability: Conversational Apply (4), GitHub Code Analysis (4),
  Interview Prep & Rubric (6).

## AI Navigation Metadata

Every context was created with: `entry_points`, `db_tables`, `keywords`,
`api_surface`, `cross_refs`, `tech_stack` (stored as `entryPoints`, `dbTables`,
`keywords`, `apiSurface`, `crossRefs`, `techStack`).

## Verification

```bash
PID=5928226b-548c-40e3-97fe-a9cecc59712a
curl -s "http://localhost:3000/api/context-groups?projectId=$PID"               # 9 groups
curl -s "http://localhost:3000/api/contexts?projectId=$PID"                     # 22 contexts
curl -s "http://localhost:3000/api/context-group-relationships?projectId=$PID"  # 13 relationships
```

All three endpoints confirmed the persisted counts (9 / 22 / 13).

## Issues and Warnings

- ✓ All groups represent a business domain; every group has ≥ 2 contexts and ≥ 1 relationship.
- ✓ No duplicate files across contexts.
- ✓ Full coverage of capability code (98.8% excluding test/eval harness).
- ⚠️ 3 contexts are below the 10-file target (Conversational Apply 4, GitHub Code
  Analysis 4, Interview Prep & Rubric 6) — kept separate deliberately because they
  are distinct user-facing surfaces.
- ⚠️ One context slightly exceeds the 20-file ideal (Job Catalog 24) — cohesive
  (catalog + ingestion + recruiter sourcing share the `jobs` table).
