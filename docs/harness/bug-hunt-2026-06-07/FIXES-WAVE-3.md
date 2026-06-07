# Bug Hunt Fix Wave 3 — Analyze run lifecycle & task cancellation

> 3 commits, 5 findings addressed (1 critical, 3 high, 1 medium) — Data#1 closed for the analyze path (the remaining handlers are a tracked follow-up).
> Baseline preserved: tsc 0→0 · `next build` passes · unit 585→585 · python 474→474. No regressions.

## Commits

| # | Commit | Findings | Severity | Files |
|---|---|---|---|---|
| 1 | `1a95d31` | cv #1 + #3 | **Critical** + High | `AnalyzeApi.ts`, `runAnalysis.ts`, `useAnalyzeForm.ts` |
| 2 | `b1d62e2` | cv #2 + #4 | High + Medium | `useAnalyzeForm.ts`, `AnalysisProgress.tsx`, `AnalyzeTab.tsx` |
| 3 | `f2ef1eb` | data-layer #1 (analyze) | High | `analyze-run.ts`, `tasks.ts` |

## What was fixed

1. **Zombie pollers on unmount (critical) + unbounded poll.** `watchAnalysis` was an `while(true)` poll plus a `setInterval` with no `AbortSignal` and no teardown — switching the workspace tab mid-scan left pollers fetching forever and `setState`-ing an unmounted component. It also treated a permanently-404'd/reaped task like a transient failure, spinning forever. Now: an `AbortSignal` is threaded through `executeAnalysis`/`resumeAnalysis`/`watchAnalysis` (and into every `fetch`); the hook holds an `abortRef` and aborts on unmount; the poll treats 404 as terminal and bails after 10 consecutive non-OK polls (a healthy slow run keeps returning 200 and resets the counter); an abort is swallowed, never shown as an error.

2. **Reset zombie clobber + no cancel affordance.** Reset cleared the form but never aborted the poll, reset the loading flags, or cancelled the server task — the orphaned poll later wrote the stale result back over the cleared form, and the only escape from a wrong/slow scan was a page reload. Added a shared `stopActiveRun()` (supersede via a monotonic `analysisRunIdRef`, abort, DELETE the task, reset flags), wired it into `reset()`, added a `cancel()` handler, and surfaced a **"Cancel scan"** button in `AnalysisProgress`. A run superseded before its task id returns is DELETEd from `onTaskStarted`.

3. **Cancel didn't kill the Python child (analyze).** `cancelTask` aborts the controller, but the analyze handler called `spawnPython(args)` with no signal — so the abort path `spawnPython` already implements (signal → SIGKILL) was dead code, and a canceled analyze ran a full billable Gemini call to completion. Threaded `ctx.signal` → `runAnalyze` → `spawnPython`, making the analyze Cancel button stop work end-to-end.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | passes | passes |
| `npm run test:unit` | 585 | 585 |
| `npm run test:python` | 474 (4 skipped) | 474 (4 skipped) |

## Patterns established (catalogue items 10–12)

10. **Thread an AbortSignal end-to-end, or cancellation is theater.** A poll / fetch / subprocess that accepts no signal can't be stopped; a "Cancel" button over it only hides a still-running, still-billing operation. Wire the signal user-action → client fetch → server task → child process.
11. **A poll must distinguish terminal from transient and bound its failures.** Treating "404 / row gone" identically to "still running" spins forever; count consecutive failures (real progress resets the counter) and treat resource-gone as terminal.
12. **Guard supersedable async callbacks with a monotonic run-id.** When a long op can be superseded (reset / cancel / resubmit), stamp each run and ignore callbacks whose id is stale — else a zombie completion overwrites fresh state.

## Data#1 — now FULLY closed (follow-up commit `4e819e0`)

W3 closed Data#1 for the `analyze` handler. A later follow-up forwarded `ctx.signal` to **every** remaining Python-spawning task handler — `reasoning`, `automation` (+ `batch_screen`), `group_eval` (`rankCandidates` + per-candidate `runReasoning` + `runGroupCompare`), `jd_build` (`runMarketSalary` + `runNeedAnalysis` + `runDesignArtifacts`), and the dev-case handlers (`need_analysis`/`design_artifacts`/`commit_reflection`/`evaluate_submission`). `runLifecycle` checks `signal.aborted` between stages and forwards to its analyze/design steps. So canceling any task now SIGKILLs its Python child instead of leaving a billable LLM call to finish. (The only un-threaded spawns are lifecycle's best-effort publish-stage sub-steps.)

## Cumulative status (waves 1–3)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Duplicate side-effects & double-firing | 6 |
| 2 | Python numeric & LLM-boundary safety | 6 |
| 3 | Analyze run lifecycle & task cancellation | 4 + Data#1 (analyze) |

Pattern catalogue: 12 items. **16 / 51 findings fully closed** (+ Data#1 partial). All 3 original criticals now closed.

## What remains

W4 voice end-of-call, W5 dev-case provenance (WIP overlap), W6 silent failures, W7 status/uniqueness guards, W8 board/form UI — 35 findings open per `INDEX.md`, plus the Data#1 signal-forward for the 5 non-analyze handlers. No criticals remain.
