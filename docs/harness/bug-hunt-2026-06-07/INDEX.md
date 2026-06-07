# Bug Hunter Scan — kp, 2026-06-07

> Elite-failure-analyst reliability audit of kp's 8 highest-risk contexts (concurrency, async lifecycles, live updates, external/LLM parsing, persistence & the Python bridge).
> 8 parallel Bug Hunter subagents, one wave. Each subagent was given the relevant "already-hardened" exclusions from `harness-learnings.md` so prior-run fixes were not re-flagged.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 8 contexts | 3 | 17 | 21 | 10 | **51** |
| Share | 6% | 33% | 41% | 20% | 100% |

Verified two ways: header `> Total:` sum = 51; `- **Severity**:` bullet count = 51. ✓

---

## Per-context breakdown

(Sorted by criticals desc, then total)

| # | Context | Critical | High | Medium | Low | Total | Report |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | CV Analysis Workspace | 1 | 2 | 3 | 1 | 7 | `cv-analysis-workspace.md` |
| 2 | Automation Orchestration | 1 | 3 | 2 | 0 | 6 | `automation-orchestration.md` |
| 3 | Scoring & Extraction Engine (Python) | 1 | 0 | 4 | 1 | 6 | `scoring-extraction-engine.md` |
| 4 | Dev Case Python Engine | 0 | 3 | 3 | 1 | 7 | `devcase-python-engine.md` |
| 5 | Pipeline Board & Scheduler | 0 | 2 | 2 | 3 | 7 | `pipeline-board-scheduler.md` |
| 6 | Voice Interview Runtime | 0 | 3 | 2 | 1 | 6 | `voice-interview-runtime.md` |
| 7 | Data Layer, Schemas & Python Bridge | 0 | 2 | 2 | 2 | 6 | `data-layer-bridge.md` |
| 8 | Scheduling & Offers | 0 | 2 | 3 | 1 | 6 | `scheduling-offers.md` |

---

## The 3 critical findings

1. **Automation — cached outreach re-sends a real candidate email on every invocation.** The side-effecting `dispatchOutreach` sits *after* the prompt-cache boundary, so idempotency guards only the computation, not the send. A re-run of the same automation task spams the candidate. `automation-run.ts:189-193`.
2. **Scoring (Python) — `Infinity` in a Gemini JSON response crashes the entire analysis.** `_optional_int` does `int(round(float('inf')))` → uncaught `OverflowError`, aborting *after* the expensive Gemini call already succeeded (`NaN` is handled; `Infinity` is fatal, and it bypasses the inf/nan-safe `salary_band.normalize_band`). `pipeline.py:626-632`.
3. **CV Analysis — `watchAnalysis` poll loop + interval never abort → leaked zombie pollers.** An unbounded `while(true)` poll plus a `setInterval` with no `AbortSignal` and no caller teardown: switching the workspace tab or navigating away mid-scan leaves pollers fetching forever and calling `setState` on an unmounted component. `AnalyzeApi.ts:37-71`.

## The 17 high findings, grouped by theme

**Duplicate side-effects / double-firing**
- Automation — forced manual tick after enabling the schedule double-fires the policy pass within ~60s (`schedule/route.ts:16-18`).
- Pipeline — manual "Run now" calls `tickScheduler({force:true})`, skips `claimDueRun()`, never advances `next_due_at`; the next heartbeat re-fires the same pass (`scheduler.ts:15`).
- Scheduling — reminder sweep ignores pipeline-entry status, emailing rejected/declined/hired candidates (`schedule-store.ts:205`).

**Silent failures / batch-abort recovery**
- Automation — an unguarded `dispatchRejection` throw mid-loop aborts the pass, orphaning already-applied rejects and skipping later entries (`automation-pass.ts:103`).
- Pipeline — `runPass` swallows non-OK automation responses (`PipelineTab.tsx:171-184`).
- Data — `runAnalyze` uses raw `JSON.parse(stdout)` instead of the hardened `parsePythonJson`, 502-ing a *successful* paid analysis on trailing interpreter chatter (`analyze-run.ts:104-110`).

**Async lifecycle / leaks**
- CV — reset during a running scan leaves a zombie run that clobbers the cleared state (`useAnalyzeForm.ts:120-135`).
- CV — poll loop has no terminal/timeout; a permanent 404 / lost task spins forever (`AnalyzeApi.ts:54-66`).
- Data — canceling a task aborts the JS controller but never signals the spawned Python child, so canceled analyze/group_eval/reasoning runs keep executing as leaked processes, burning LLM budget and overrunning `MAX_CONCURRENT` (`tasks.ts:232-247` + every `spawnPython` call site).

**Voice end-of-call / connection timing**
- Voice — ElevenLabs has no last-answer protection: `end()` latches `finalizedRef` and POSTs before the final `onMessage` arrives, silently dropping the candidate's closing answer (`VoiceInterview.tsx:409`).
- Voice — connect timeout latches `finalizedRef=true`, so a slightly-late `onConnect` yields a live-but-unsendable call (`VoiceInterview.tsx:351`).
- Voice — `finalize()` POST is fire-and-forget with a swallowed catch and no `res.ok`/retry: transcript loss on a failed network write is silent and unrecoverable (`VoiceInterview.tsx:193`).

**Dev Case LLM provenance / fallback honesty**
- DevCase — `lifecycle_eval`/`submission_eval` report `reliability: 100%` when every LLM call silently fell back to deterministic templates (`fallbackReason` never captured) (`submission_eval.py:201`).
- DevCase — malformed LLM dimension scores are silently replaced by the deterministic estimate, still tagged `source="llm"` (`evaluate.py:147`).
- DevCase — `mint_followups`/`evaluate` reward the deterministic fallback for handling probes it never actually assessed (`evaluate.py:115,119`).

**State / status guards**
- Automation — manual / single-task `screen` applies its stage move *without* the `expectedStage` CAS that hardened the policy pass (`automation-run.ts:158`).
- Scheduling — a still-valid scheduling token lets a candidate book an interview for an already-rejected/declined entry; `actOnPipelineEntry`/`approve_event` don't guard `status` (`schedule/[token]/route.ts:55`, `db.ts:3027`).

---

## Triage themes (clustered across all 51)

| Theme | Count | Why this is a wave, not just individual fixes |
|---|---:|---|
| Duplicate side-effects & double-firing | 6 | All share one root: a real-world side effect (email, policy pass, event) fires twice because the idempotency/`next_due_at`/status guard sits on the wrong side of the action. Fixing the cache-vs-send boundary once informs them all. |
| Python numeric & LLM-boundary safety | 6 | All in `pipeline.py` / salary CLIs / `gemini.py` / `insights.py`: `Infinity`/`NaN`/clamp/0÷0 and missing LLM retry. One coercion-hardening mental model. |
| Analyze run lifecycle & task cancellation | 5 | The analyze run's start→poll→cancel→child-kill story end-to-end: the missing UI cancel (CV#4) is wired to the DELETE that Data#1 makes actually kill the process. |
| Voice end-of-call & connection timing | 6 | A single `finalizedRef`/teardown state machine governs all six; fixing the latch + last-answer grace + persistent POST is one coherent edit. |
| Dev Case LLM provenance & fallback honesty | 7 | Self-contained in `pipeline/jobfit/devcase/`: degraded LLM runs masquerade as healthy or as full-LLM evaluations. One provenance-threading change. |
| Silent failures & batch-abort recovery | 4 | "An error is swallowed or aborts a batch, and the operator/candidate sees success or partial state." Same try/catch + per-item isolation pattern. |
| Status/uniqueness guards & persistence integrity | 6 | DB/task invariants: terminal-task resurrection, missing UNIQUE on `dedupe_key`, status-gated transitions, tooling crash. |
| Board/form UI state-desync & scheduling-format edges | 11 | Client state desync on identity change + display/counting edges + slot-format/timezone mismatches. Lowest severity; splits into 8a (board/form) + 8b (scheduling-format/offer). |

---

## Suggested next-phase split (8 waves)

Ordered so the 3 criticals land in the first three waves. Each wave shares one mental model so fixes compound. Waves are 4–7 fixes (W8 splits).

| Wave | Theme | Findings | Sev mix |
|---|---|---|---|
| **W1** | Duplicate side-effects & double-firing | Auto#1, Auto#3, Pipeline#1, Sched#1, Auto#5, Auto#6 | **C1** H3 M2 |
| **W2** | Python numeric & LLM-boundary safety | Scoring#1–#6 | **C1** M4 L1 |
| **W3** | Analyze run lifecycle & task cancellation | CV#1, CV#2, CV#3, CV#4, Data#1 | **C1** H3 M1 |
| **W4** | Voice end-of-call & connection timing | Voice#1, Voice#3, Voice#4, Voice#2, Voice#5, Voice#6 | H3 M2 L1 |
| **W5** | Dev Case LLM provenance & fallback honesty | DevCase#1, #2, #7, #4, #3, #5, #6 | H3 M3 L1 |
| **W6** | Silent failures & batch-abort recovery | Pipeline#2, Auto#4, Data#2, Sched#5 | H3 M1 |
| **W7** | Status/uniqueness guards & persistence integrity | Auto#2, Sched#2, Data#3, Data#4, Data#5, Data#6 | H2 M2 L2 |
| **W8** | Board/form UI state-desync & scheduling-format edges | Pipeline#3,#4,#5,#6,#7 · CV#5,#6,#7 · Sched#3,#4,#6 | M6 L5 |

> Note: W6's "silent failure" theme overlaps W4 (Voice#4) — Voice#4 is kept in W4 for mental-model coherence. W8 is intentionally large and low-severity; run it last or split it (8a board/form, 8b scheduling-format/offer).

---

## How this scan was run

- **Scanner**: `bug-hunter` (`agent_bug_hunter`, scanType `bug_hunter`) from the Vibeman prompt registry — elite systems-failure-analyst role (latent failures, race conditions, edge cases, silent failures).
- **Scope**: high-risk subset, 8 of 22 contexts, full-stack (TypeScript + Python, no filtering).
- **Method**: 8 parallel `general-purpose` subagents, one per context, each told the relevant already-hardened exclusions so prior-run fixes (stage-transition CAS, `parsePythonJson`, offer/slot/rate-limit hardening, voice credential minting, `safeJsonError`, the deferred app-wide auth decision) were not re-reported. Read-only; each wrote one structured report.
- **Files read by subagents**: ~147 across the 8 contexts (≈18 avg, including cross-referenced files outside the listed paths for verification).
- **Findings target**: 3–8 genuine findings per context, quality over quantity, no padding. Actual: 6–7 per context.
- **Baseline (for regression checks)**: `tsc --noEmit` = 0 errors · `npm run test:unit` (node --test) = 570/570 · `npm run test:python` = 472 (4 skipped), 0 fail. (Note: kp's unit runner is `node --test`, **not** vitest — `npx vitest run` reports a false "no test suite found".)
- **Verification**: header-sum (51) == severity-bullet-count (51). ✓
