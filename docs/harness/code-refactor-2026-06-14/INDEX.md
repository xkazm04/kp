# Code Refactor Scan — kp, 2026-06-14

> Code-cleanliness audit (dead code, duplication, structure, cleanup) over the **full codebase**, full-stack (TS/React + Python).
> 25 parallel subagent runs (one per context), batched in 3 dispatch waves of ≤8, each with the `code_refactor` role and a hard certainty bias (grep-verify zero references before flagging dead; never propose unsafe removals).
> Baseline at scan: **tsc 0 · unit 842/842 · python 596 OK (4 skip)** · branch `main` (clean, 54 ahead of origin) · HEAD `883d902`.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 25 contexts | 0 | 7 | 60 | 37 | **104** |
| Share | 0% | 7% | 58% | 36% | 100% |

By category: **duplication 73 · dead-code 13 · cleanup 11 · structure 9** (a few findings tag two categories). Verified two ways: `> Total:` header sum (104) == `**Severity**` bullet count (104). No criticals — expected for a cleanliness scan; the 7 "High" are large genuinely-dead modules or drift-risk duplication of contract types/spawn scaffolds.

---

## Per-context breakdown

(Sorted by High desc, then total)

| # | Context | High | Med | Low | Total | Report |
|---|---|---:|---:|---:|---:|---|
| 1 | Data Layer, Schemas & Python Bridge | 2 | 2 | 0 | 4 | `data-layer-schemas-python-bridge.md` |
| 2 | Dev Case Orchestration & API | 1 | 2 | 2 | 5 | `dev-case-orchestration-api.md` |
| 3 | CV Analysis Workspace | 1 | 3 | 0 | 4 | `cv-analysis-workspace.md` |
| 4 | Demo Simulation & Channels | 1 | 2 | 1 | 4 | `demo-simulation-channels.md` |
| 5 | GitHub Code Analysis | 1 | 2 | 1 | 4 | `github-code-analysis.md` |
| 6 | Job Catalog, Ingestion & Sourcing | 1 | 2 | 1 | 4 | `job-catalog-ingestion-sourcing.md` |
| 7 | Candidate Profile Builder | 0 | 3 | 2 | 5 | `candidate-profile-builder.md` |
| 8 | Conversational Apply | 0 | 4 | 1 | 5 | `conversational-apply.md` |
| 9 | Dev Case Studio (UI) | 0 | 3 | 2 | 5 | `dev-case-studio-ui.md` |
| 10 | Analysis Results & Reporting | 0 | 3 | 1 | 4 | `analysis-results-reporting.md` |
| 11 | Analytics & Diagrams | 0 | 1 | 3 | 4 | `analytics-diagrams.md` |
| 12 | Automation Orchestration | 0 | 2 | 2 | 4 | `automation-orchestration.md` |
| 13 | Billing & Entitlements | 0 | 2 | 2 | 4 | `billing-entitlements.md` |
| 14 | Candidate-Job Matching & Fit Matrix | 0 | 3 | 1 | 4 | `candidate-job-matching-fit-matrix.md` |
| 15 | Decision Workflow & Group Eval | 0 | 3 | 1 | 4 | `decision-workflow-group-eval.md` |
| 16 | Dev Case Python Engine | 0 | 3 | 1 | 4 | `dev-case-python-engine.md` |
| 17 | Interview Prep & Rubric | 0 | 2 | 2 | 4 | `interview-prep-rubric.md` |
| 18 | JD Library & Builder | 0 | 3 | 1 | 4 | `jd-library-builder.md` |
| 19 | LLM Provider Layer (Python) | 0 | 1 | 3 | 4 | `llm-provider-layer-python.md` |
| 20 | LLM Settings & Model Config | 0 | 2 | 2 | 4 | `llm-settings-model-config.md` |
| 21 | Pipeline Board & Scheduler | 0 | 2 | 2 | 4 | `pipeline-board-scheduler.md` |
| 22 | Scheduling & Offers | 0 | 3 | 1 | 4 | `scheduling-offers.md` |
| 23 | Scoring & Extraction Engine (Python) | 0 | 2 | 2 | 4 | `scoring-extraction-engine-python.md` |
| 24 | Voice Interview Runtime | 0 | 3 | 1 | 4 | `voice-interview-runtime.md` |
| 25 | Workspace Shell & Shared UI | 0 | 2 | 2 | 4 | `workspace-shell-shared-ui.md` |

---

## The 7 High findings — one-line summary

1. **Data Layer — dead `buildCliArgs` + `AnalyzeOptions`** in `python-runner.ts` (live path uses `analyze-run.ts`'s own `cliArgs`). Grep-verified zero callers. → `data-layer-schemas-python-bridge.md` #1
2. **Data Layer — dead `insertLlmUsage` + unread `llm_usage` table/indexes** (an unwired "Phase 4" metering ledger: no writers wired, no SELECT readers). → `data-layer-schemas-python-bridge.md` #2
3. **Dev Case Orchestration — 9 hand-copies of the devcase-CLI spawn/parse/cleanup scaffold** in `devcase-run.ts` (extract one `runDevcaseCli<T>()`; also fixes inconsistent `signal` forwarding). → `dev-case-orchestration-api.md` #1
4. **CV Analysis — dead `ScanAnimationWide`** (+ private `Pulse`/`Chip`), ~140 of 365 lines in `ScanAnimation.tsx`; only `ScanAnimationCompact` is live. → `cv-analysis-workspace.md` #1
5. **Demo Sim — `WaveDecision` is a drifted local copy of canonical `ScreenDecision`** (drops DEC4 `reasonCode`/`reasonParams`, so sim shows English-only rationales). 3rd hand-typed copy of one wire shape. → `demo-simulation-channels.md` #1
6. **GitHub — dead exported `fetchCommitTrace`** in `repo-snapshot.ts` (zero callers; safe ~14-line deletion, return type stays alive via `fetchRepoSignals`). → `github-code-analysis.md` #1
7. **Job Catalog — `recruiter_cli` ranking-spawn boilerplate copied across 4 call sites** (createWorkdir→write json→spawnPython→parse→cleanup), differing only in flags/mapping. Extract `rankPoolForJob()`. → `job-catalog-ingestion-sourcing.md` #1

---

## Triage themes

Clustered from the 104 findings by category + title similarity. Each is a sessionable wave (one mental model, ~5–12 fixes).

| Theme | Approx count | Why it's a wave, not just scattered fixes |
|---|---:|---|
| **A. Dead code (pure deletions)** | ~11 | Highest confidence — each is grep-verified zero-reference. Removing them shrinks surface with zero behavior change; do first to de-risk later waves. |
| **B. Python CLI stdio boilerplate** | ~10 CLIs | The existing `_cli.configure_stdio()` helper is ignored by ~10 CLIs that hand-roll UTF-8 stdio (with live drift — some omit `errors="replace"`), re-risking the Czech-diacritic bug it exists to prevent. One Python-only fix; py tests guard. |
| **C. Duplicated wire/contract types → import the canonical one** | ~11 | Types hand-copied across server/client or sibling modules (`Comparison`/`Fairness`, `WaveDecision`, `RoleSpec`, `Position`, `Invite`, `KeyMeta`, `Rediscovered`, `ScoreDimension`/`Confidence`, `UserProgress`). Mostly type-only imports; each removes a silent drift channel. |
| **D. Spawn/CLI & store-bootstrap envelope extraction** | ~4 | The biggest structural wins: `runDevcaseCli` (×9), `rankPoolForJob` (×4), `openStore()` isolated-connection bootstrap (×~12), self-contained `db()` bootstrap. Extract shared helpers — medium effort, high payoff. |
| **E. Error-envelope + threshold/magic-number constants** | ~6 | `jsonError()` ignored by 5 sim routes; band edges `45/60/72/85` ×3; `MIN_AD_CHARS=30` ×3; `entry.length>120` ×2; automation version maps. Single-source each constant/envelope. |
| **F. i18n label-resolution helpers** | ~5 | The `t.has(key)?t(key):english` has-fallback idiom copy-pasted across shells/analytics; `kinds.<kind>` resolved 3 ways. One shared `navLabel`/`enumLabel`-style helper. |
| **G. UI component / markup extraction** | ~12 | Repeated JSX: covert-probe row (×3), scorecard rating-row, follow-up rendering, inline save-input (`SpendInput`/`TargetInput`), segmented toggles, confidence band, slot-label, persona-contract prose (compliance copy!). Extract shared components. |
| **H. Fetch/persist wiring dedup** | ~9 | Repeated client transport: `/api/pipeline/[id]` action POST (×4), ingest fetch (submit/submitBulk), progress-PUT (debounce vs flush), JD save+retry, analyze success/abort tail, consecutive-error bail. Reuse the existing hook patterns. |
| **I. Cleanup tail (stale comments/docstrings)** | ~6 | Stale `404` comment on the LLM Test button, `--bucket` docstring, doc-only `useSlotLabel` path, over-`export`ed single-use consts, etc. Cosmetic, batch last. |

---

## Suggested next-phase split (wave plan)

Refactor-appropriate ordering: **delete dead code first** (de-risks everything downstream), then single-source constants/types, then the structural extractions, then UI/wiring, then cleanup.

- **Wave 1 — Dead code removal** (Theme A, ~11): `ScanAnimationWide`, `buildCliArgs`+`AnalyzeOptions`, `insertLlmUsage`+`llm_usage` table, `fetchCommitTrace`, `relativeTime`, `NextStage`+`Reasoning`+`DAYS`/`TIMES`, `KO_STEP_IDS`, `/api/apply/[id]` GET, `isMeter`, `ProfileRow`, dev-studio legacy fallback. *Pure deletions; tsc+tests confirm.*
- **Wave 2 — Python stdio consolidation** (Theme B): route ~10 CLIs through `configure_stdio()`. *Python-only; py tests guard.*
- **Wave 3 — Contract-type single-sourcing** (Theme C): import the canonical types; delete the hand-copies. *Type-only; tsc confirms.*
- **Wave 4 — Spawn/store envelope extraction** (Theme D): `runDevcaseCli`, `rankPoolForJob`, `openStore`, `db()` bootstrap. *Highest structural value; verify carefully.*
- **Wave 5 — Constants & error envelopes** (Theme E): `jsonError` in sim routes, `MATRIX_BANDS`, `MIN_AD_CHARS`, `entry`-length cap.
- **Wave 6 — i18n label helpers** (Theme F).
- **Wave 7 — UI component extraction** (Theme G) — note: includes the compliance-relevant persona-contract prose (`voice` #1), worth doing for drift-safety.
- **Wave 8 — Fetch/persist wiring** (Theme H).
- **Wave 9 — Cleanup tail** (Theme I).

---

## How this scan was run

- **Scanner**: `code_refactor` role prompt (`src/lib/prompts/registry/agents/code-refactor.ts`) — cleanliness expert, certainty-biased (grep-verify zero refs before flagging dead; never propose unsafe removals).
- **Scope**: all 25 contexts / 605 file entries, full-stack (TS/React + Python). Side filter: both.
- **Method**: one `general-purpose` subagent per context; each read its file list from `_scan-plan.json`, analyzed read-only, wrote one report, replied terse. 3 dispatch waves (8+8+9). Orchestrator never read per-context reports during scanning — only the terse replies (kept context manageable across 25 scans). ~3.3M subagent tokens total.
- **Target**: 3–5 findings/context (certainty over quantity).
- **kp convention guards baked into every subagent prompt** (so they were not misflagged): `app/_lib/*.ts` pure helpers are intentionally import-free for bare `node --test`; colocated `*.test.ts` use relative imports (repo runs `node --test`, NOT vitest — vitest gives a false "no tests" baseline); routes use hand-rolled coercers not zod; expectedStage-CAS guards are intentional per-caller concurrency protection; "dark capability" backends (built, no UI caller) are intentional → classified Low "no caller" not dead unless clearly abandoned; codegen'd zod schemas drift-tested against Pydantic.
- **Verification**: findings counted two ways (header sum == severity-bullet count == 104).
