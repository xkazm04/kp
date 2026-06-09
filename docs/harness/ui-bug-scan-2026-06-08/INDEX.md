# UI Perfectionist + Bug Hunter Scan — kp, 2026-06-08

> Combined **Bug Hunter (🐛) + UI Perfectionist (🎨)** audit of the kp recruiting platform.
> 21 parallel subagent runs (one per context), batched in 3 waves of ≤8. TS/React + API only (Python pipeline excluded). 4 findings per context (1 thin context = 3).
> Findings verified two ways: `> Total:` headers sum = 83; `**Severity**` bullets count = 83. ✓

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 21 contexts | 3 | 27 | 41 | 12 | **83** |
| Share | 4% | 33% | 49% | 14% | 100% |

Lens mix: **53 bug-hunter / 30 ui-perfectionist**. Baseline at scan time: tsc 0 errors, 638/638 unit tests.

---

## Per-context breakdown

Sorted by criticals desc, then total.

| # | Context | Group | C | H | M | L | Total | bug/ui | Report |
|---|---|---|--:|--:|--:|--:|--:|--:|---|
| 1 | dev-case-orchestration-api | Dev Case | 1 | 1 | 2 | 0 | 4 | 4/0 | [↗](dev-case-orchestration-api.md) |
| 2 | github-code-analysis | Candidate-Facing | 1 | 1 | 1 | 1 | 4 | 3/1 | [↗](github-code-analysis.md) |
| 3 | interview-prep-rubric | Interviews | 1 | 2 | 0 | 1 | 4 | 3/1 | [↗](interview-prep-rubric.md) |
| 4 | analysis-results-reporting | Candidate Analysis | 0 | 1 | 2 | 1 | 4 | 2/2 | [↗](analysis-results-reporting.md) |
| 5 | analytics-diagrams | Platform & Shared | 0 | 1 | 2 | 1 | 4 | 0/4 | [↗](analytics-diagrams.md) |
| 6 | automation-orchestration | Automation & Sim | 0 | 2 | 2 | 0 | 4 | 4/0 | [↗](automation-orchestration.md) |
| 7 | candidate-job-matching-fit-matrix | Matching & Decisions | 0 | 2 | 1 | 1 | 4 | 2/2 | [↗](candidate-job-matching-fit-matrix.md) |
| 8 | candidate-profile-builder | Candidate Analysis | 0 | 1 | 3 | 0 | 4 | 3/1 | [↗](candidate-profile-builder.md) |
| 9 | conversational-apply | Candidate-Facing | 0 | 1 | 3 | 0 | 4 | 2/2 | [↗](conversational-apply.md) |
| 10 | cv-analysis-workspace | Candidate Analysis | 0 | 2 | 2 | 0 | 4 | 3/1 | [↗](cv-analysis-workspace.md) |
| 11 | data-layer-schemas-python-bridge | Platform & Shared | 0 | 1 | 2 | 1 | 4 | 3/1 | [↗](data-layer-schemas-python-bridge.md) |
| 12 | decision-workflow-group-eval | Matching & Decisions | 0 | 2 | 1 | 1 | 4 | 3/1 | [↗](decision-workflow-group-eval.md) |
| 13 | dev-case-studio-ui | Dev Case | 0 | 1 | 3 | 0 | 4 | 2/2 | [↗](dev-case-studio-ui.md) |
| 14 | jd-library-builder | Jobs & JD | 0 | 1 | 1 | 2 | 4 | 2/2 | [↗](jd-library-builder.md) |
| 15 | job-catalog-ingestion-sourcing | Jobs & JD | 0 | 2 | 2 | 0 | 4 | 3/1 | [↗](job-catalog-ingestion-sourcing.md) |
| 16 | pipeline-board-scheduler | Pipeline & Scheduling | 0 | 1 | 2 | 1 | 4 | 2/2 | [↗](pipeline-board-scheduler.md) |
| 17 | scheduling-offers | Pipeline & Scheduling | 0 | 1 | 3 | 0 | 4 | 2/2 | [↗](scheduling-offers.md) |
| 18 | voice-interview-runtime | Interviews | 0 | 2 | 1 | 1 | 4 | 2/2 | [↗](voice-interview-runtime.md) |
| 19 | workspace-shell-shared-ui | Platform & Shared | 0 | 1 | 2 | 1 | 4 | 2/2 | [↗](workspace-shell-shared-ui.md) |
| 20 | demo-simulation-channels | Automation & Sim | 0 | 0 | 4 | 0 | 4 | 3/1 | [↗](demo-simulation-channels.md) |
| 21 | scoring-extraction-engine-python | Candidate Analysis | 0 | 1 | 2 | 0 | 3 | 3/0 | [↗](scoring-extraction-engine-python.md) |

---

## The 3 critical findings

1. **dev-case-orchestration-api — Inbound webhook bypasses the apply-token gate via a guessable `postingId`.** The public `/api/devcase/inbound` route accepts a `Math.random()`-derived `postingId` as its auth path, bypassing the 128-bit apply token its own comment claims gates it. An unauthenticated party can inject submissions and drive the auto-promote pipeline. `app/api/devcase/inbound/route.ts`
2. **github-code-analysis — `parseRepoRef` confused-deputy via traversal segments.** A user-supplied ref like `x/../../user/repos` normalizes (Node URL) to a *different* GitHub endpoint, hit with the server's `GITHUB_TOKEN`. The route encodes/validates, but the snapshot module interpolates the ref unencoded. `app/_lib/repo-snapshot.ts:33`
3. **interview-prep-rubric — "Regenerate" destroys the saved human scorecard / user progress.** Regenerate calls a full-payload upsert with no merge and no confirm, silently wiping a previously-saved `humanScorecard` and `userProgress` under the same `payload_json`. Irreversible data loss. `app/_lib/interview-prep.ts` + `InterviewPrepModal.tsx`

---

## Triage themes

Clustered across the 83 findings (a finding can touch two themes; primary theme listed).

| Theme | ~Count | Why it's a wave, not one-offs |
|---|---:|---|
| **T1 · Trust-boundary & input validation** | ~8 | Public/automated endpoints accept guessable, unvalidated, or non-finite input. Both criticals live here. One mental model: *validate at the boundary, fail closed.* |
| **T2 · Data integrity: lost-updates & dropped writes** | ~7 | Read-modify-write on shared payloads/task rows isn't atomic; failed POSTs clear state as if they succeeded. Includes the interview-prep critical. *Atomic RMW; check `r.ok` before clearing.* |
| **T3 · Identity-by-label / wrong-record** | ~5 | Decisions, bulk-add, compare-crown, and list rows resolve entities by display label or array index, not stable id — wrong-person actions on collisions. *Resolve & key by id.* |
| **T4 · Concurrency & idempotency (double-action)** | ~6 | Double-send outreach, dup posting on resume, double clock-tick, terminal-state mishandling in voice. *Exactly-once guards; correct terminal states.* |
| **T5 · Stale UI after background mutation / fetch-state** | ~8 | Boards & dashboards don't refresh after clock/automation mutations; `useJsonFetch` mishandles 204/error; re-weight blanks results. *Keep views fresh; surface errors with retry.* |
| **T6 · Silent failures & opaque errors** | ~6 | Swallowed non-OK responses, missing try/catch → opaque 500s, success-theater "ok" runs, un-retried onboarding dispatch. *No swallowing; reconcile flags; degrade visibly.* |
| **T7 · Score / number / label consistency** | ~8 | Same number renders different tones/values across dial vs badge vs history; salary currency/rounding/trim/unit drift. *Single source of truth for derived numbers.* |
| **T8 · Accessibility (shared primitives + forms)** | ~12 | Modal focus-trap/reduced-motion, matrix table semantics, aria-live on streamed/async surfaces, unlabeled controls. *aria + focus + reduced-motion pass.* |
| **T9 · UI states & polish (empty/loading/error, layout, copy)** | ~13 | Missing empty/loading states, z-index occlusion, non-wrapping headers, blank screens, misleading copy, no-confirm destructive actions. *Complete the state matrix.* |

---

## Suggested next-phase split (wave plan)

Each wave shares one mental model so fixes compound. Recommended order front-loads correctness/security; a11y + polish trail.

- **Wave 1 — Trust-boundary & validation (security).** Both criticals + validation gaps. ~8 fixes: devcase inbound auth, repo-ref traversal, profile→CLI validation, KO-question server enforcement, `setFloor`/`intervalMinutes` finite guards, auto-approve fail-closed, voice provider-picker lockdown. **Start here.**
- **Wave 2 — Data integrity (lost-updates & dropped writes).** Interview-prep critical + 6: merge-on-regenerate, atomic prep RMW, autosave flush-on-close, `runOne` task-state leak, submission-lost-on-failed-POST, stale-JD-body save, CV dedupe race.
- **Wave 3 — Identity-by-label / wrong-record.** ~5: group-eval decide-by-id, count-drift, bulk-add target, compare crown/key, profile rows keyed by id.
- **Wave 4 — Concurrency & idempotency.** ~6: outreach double-send, devcase resume dup-posting, voice hang-up terminal status, voice `reachedLiveRef`, promote double-guard, forced-tick double-advance.
- **Wave 5 — Stale UI / fetch-state.** ~8: board refresh on clock pass, scheduler-poll reload, recruiter-candidates job-switch, analytics retry, re-weight loading state, `useJsonFetch` 204, sim `getEntries` non-OK, stage "+N more" reset.
- **Wave 6 — Silent failures & opaque errors.** ~6: onboarding-dispatch reconcile, deep-review evidence on partial failure, policy-pass empty "ok", sim offer-link try/catch, diagram failure UX, salaryBandPosition NaN, sim reset re-orphan.
- **Wave 7 — Score/number/label consistency.** ~8: ScoreDial↔scoreTone, history↔dial score, currency fallback, coerceString trim, salary unit drift, completeness meter tiers, SalaryGauge target, median band.
- **Wave 8 — Accessibility pass.** ~12 (shared Modal primitive fixes multiply across the app).
- **Wave 9 — UI states & polish.** ~13 (the medium/low long tail; can be split or cherry-picked).

Waves 1–4 (the correctness/security core) are ~26 fixes including all 3 criticals and ~20 highs. Waves 5–9 are the reliability-UX and polish tail.

---

## How this scan was run

- **Scanners**: combined `bug_hunter` + `ui_perfectionist` persona (from `vibeman/src/lib/prompts/registry/agents/`), one subagent per context.
- **Date**: 2026-06-08. **Scope**: all 21 scannable contexts (the all-Python "Dev Case Python Engine" context was dropped — 0 TS files after the TS/React+API-only filter). **Side filter**: `*.py` excluded.
- **Method**: 21 read-only `general-purpose` subagents in 3 waves of ≤8; each read its context's files and wrote one report; orchestrator read only the terse replies (Pipeline B discipline). 4 findings/context target (1 thin context = 3).
- **Verification**: `> Total:` header sum (83) == `**Severity**` bullet count (83). ✓
- **Plan + raw findings**: `_scan-plan.json`, `_findings.json` in this directory.
