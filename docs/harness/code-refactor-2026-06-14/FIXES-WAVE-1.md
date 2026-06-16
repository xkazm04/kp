# Code Refactor — Fix Wave 1: Dead code removal

> 10 atomic commits, 10 findings closed (Theme A — pure deletions).
> Baseline preserved: tsc 0 → 0 · unit 849 → 849 · python 596 → 596 OK (4 skip).
> ~429 lines deleted, 2 inserted, across 13 files. 0 false positives — every item re-verified zero-reference before removal.

> NOTE: a concurrent writer committed 3 commits ("dev-case orchestration/UI W24-27": `2bdaef5`, `3e4df63`, `74c4dd9`) onto `main` just before this wave; those added the +7 unit tests (842→849). This wave stacks cleanly on top; `git add` was scoped to each fix's own files, no foreign changes swept in.

## Commits

| # | Commit | Finding | Files |
|---|---|---|---|
| 1 | `7a2510e` | cv-analysis #1 | `ScanAnimation.tsx` (−272: `ScanAnimationWide`+`Pulse`/`Chip`+unused `LIMEWASH`) |
| 2 | `208f05b` | data-layer #1 | `python-runner.ts` (−29: `buildCliArgs`+`AnalyzeOptions`) |
| 3 | `b192956` | data-layer #2 | `db/llm.ts` (−31: `insertLlmUsage`), `db/core.ts` (−20: `llm_usage` table+indexes) — confirmed 0 writers AND 0 `SELECT … FROM llm_usage` readers |
| 4 | `bbdda7d` | github #1 | `repo-snapshot.ts` (−17: `fetchCommitTrace`; kept `CommitEntry`) |
| 5 | `e5deec0` | pipeline-board #1 | `PipelineTypes.ts` (−10: `relativeTime()`; kept `daysSince`) |
| 6 | `fedb4e8` | decisions #3 | `DecisionsShared.tsx` (−14: `NextStage`+`ChevronRight`), `DecisionsTypes.ts` (−4: `Reasoning`/`DAYS`/`TIMES`) — each verified independently dead; live `Reasoning` is in `MatchTypes` |
| 7 | `2f8fc78` | apply #1 | `apply.ts` (−3: `KO_STEP_IDS`) |
| 8 | `c46c9f6` | apply #2 | `api/apply/[id]/route.ts` (−17: GET handler) — CAUTION item; verified 0 in-repo callers, no e2e/test, no documented external contract; only POST hits the route |
| 9 | `3e03156` | billing #1 | `billing/plans.ts` (−4: `isMeter`), `billing/index.ts` (−1: barrel re-export); siblings `isPlanId`/`isPackId` kept |
| 10 | `5bc0f6a` | profile #1 | `sub_profile/ProfileTypes.ts` (−9: `ProfileRow`); two other same-named types are independent + live |

## What was fixed

All ten were grep-verified zero-reference exports/components/DDL that accreted across ~25 build waves. The largest single win was `ScanAnimationWide` (~140 lines of a 365-line file — a wide-variant scan animation orphaned when `ScanAnimationCompact` became the only caller). The most subtle was the `llm_usage` metering ledger: a fully-built "Phase 4" table + writer with no wired writers and no SELECT readers anywhere — removed the dead DDL and writer (orphan tables in existing DBs are harmless).

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| unit (node --test) | 849 pass | 849 pass / 0 fail |
| python (unittest) | 596 OK (4 skip) | 596 OK (4 skip) |

(tsc was also re-run after each individual deletion — all green throughout.)

## Patterns established (catalogue items 1–2)

1. **Dead exports accrete silently in a heavily-iterated repo** — a superseded helper (`relativeTime`→`useRelativeTime`), an orphaned variant (`ScanAnimationWide`), or an unwired forward-looking table (`llm_usage`) leaves a live-looking export with zero callers. A periodic grep-verified zero-reference sweep is cheap and pays compounding maintenance dividends.
2. **A route GET export is a deletion CAUTION** — it can be a deliberate public API even with no in-repo caller. Require: zero callers AND no e2e/test AND no documented external contract before removing.

## What remains

Waves 2–9 per INDEX.md: Python stdio consolidation, contract-type single-sourcing, spawn/store envelope extraction, constants/error-envelopes, i18n label helpers, UI component extraction, fetch/persist wiring, cleanup tail.
