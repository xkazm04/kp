# Hiring Automation & Scheduler — bug-hunter + ui-perfectionist scan

> Context: The clock-driven engine that advances the pipeline on a schedule — policy pass, fairness/ROI gating, cache keys, the persistent scheduler, and the Python automation CLI/eval.
> Files reviewed: 16 of 18
> Total: 5

## 1. The auto-advance CAS guards stage but not `approvalKind`, so a human-review gate set during the Python hop is silently cleared

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: `app/_lib/db/pipeline.ts:1342-1347` (CAS), `:1404-1413` + `:1414-1429` (advance branches); `app/_lib/automation-pass.ts:266-273`; `pipeline/jobfit/automation.py:240`
- **Scenario**: The pass snapshots a `Screened` entry with `approvalKind = null`, score 75, 3 days → `evaluate_entry` decides `advance`. The single `policy-pass` Python spawn takes seconds. During that window a same-process writer sets an approval on that entry without changing its stage — the per-entry `/api/automation/scorecard`|`screen`|`offer` route (`setApproval` → `scorecard_review`/`screening_review`/`offer_review`), or a recruiter queuing a decision. The pass then calls `actOnPipelineEntry(id,"accept",{expectedStage:"Screened",actor:"system"})`. Stage is still `Screened`, so the CAS passes; if the new kind is `screening_review` it takes the `:1404` branch (auto-advances **and** consumes the human review → calendar); any other kind hits `:1414`, which advances and sets `approval_kind=NULL`.
- **Root cause**: The "never touch an entry with a pending approval" invariant is evaluated only on the stale snapshot (`evaluate_entry`'s `if approval: hold`). The apply-time guard re-checks only `expectedStage`, and `approval_kind` is not a stage — so an approval that appears mid-hop is invisible to the CAS and gets cleared/auto-resolved.
- **Impact**: A freshly-queued human decision gate is silently destroyed and the candidate jumps a stage with no review — last-writer-wins, and automation wins. Defeats the pending-approval freeze the whole design leans on.
- **Fix sketch**: Thread the snapshot `approvalKind` into `opts` and make the CAS refuse the write when `row.approval_kind !== opts.expectedApprovalKind` (treat "approval appeared" exactly like "stage changed" → logged no-op). One predicate closes the class for every actor:"system" apply.

## 2. `[STILL-OPEN]` A manual "tick" runs a full applying pass even when the schedule is disabled

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: `app/_lib/scheduler.ts:15,28,32`; `app/api/automation/schedule/route.ts:56`; `app/_lib/scheduler-store.ts:207-220`
- **Scenario**: An operator toggles automation **off** for safety, then POSTs `/api/automation/schedule {"tick":true}` (the "Run now" affordance). The route always calls `tickScheduler({force:true})`. `force` skips `claimDueRun` (line 15), `advanceAfterForcedRun()` no-ops because disabled — but `runAutomationPass()` at line 32 runs **unconditionally**, applying every advance and queuing every reject on the board.
- **Root cause**: `force` was meant to bypass only the *due-gate*; it also bypasses the *enabled* check. Nothing between the force branch and `runAutomationPass()` consults `getSchedule().enabled`. (Prior 2026-06-20 report §5B; still present.)
- **Impact**: "Off" doesn't mean off. An operator who paused the clock as a kill-switch can still mutate the whole pipeline with one click, contradicting the safety posture instrumentation.ts advertises.
- **Fix sketch**: Gate the forced pass on `getSchedule().enabled` (return `{ran:false,reason:"disabled"}` when off), or make "Run now" a distinct, explicitly-unscheduled action that says so in its response.

## 3. ROI ledger credits `advanced` (human) but not `auto_advanced` (automation's own advances) — the value metric zeroes its biggest contribution

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/_lib/automation-roi.ts:14-29`; cross-ref `app/_lib/decision-attribution.ts:19-20`; `app/_lib/db/pipeline.ts:1413,1422`
- **Scenario**: The policy pass auto-advances entries (`Accepted→Screened`, `Screened→Interview`) via `actOnPipelineEntry(...,actor:"system")`, which writes the `auto_advanced` event kind (`:1413/1422`). `MINUTES_SAVED_PER_KIND` lists `advanced: 3` (the **human** kind, `auto:false`) but has **no** `auto_advanced` entry. So the ROI aggregation gives the automation's most frequent action **zero** saved-minutes credit, while crediting recruiter clicks (`advanced`) as if they were automation.
- **Root cause**: The map predates the `advanced`/`auto_advanced` actor split (DECISION_META) and was never reconciled; it keys on the wrong side of the split for the advance action.
- **Impact**: The "hours/CZK saved" figure — explicitly a buyer-facing value surface — is systematically wrong in both directions (omits real automated advances, counts human ones), with no visible error.
- **Fix sketch**: Add `auto_advanced: 3` and drop/relabel `advanced`; pin the map's keys against DECISION_META's `auto:true` set in `automation-roi.test.ts` so a future kind split can't silently mis-key again.

## 4. Policy-pass alert kinds are written but absent from `DECISION_META`, so they render UNKNOWN and fall out of the attribution rollup — and the guard test misses them

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `app/_lib/automation-pass.ts:23,314-318`; `pipeline/jobfit/automation.py:211-214`; `app/_lib/decision-attribution.ts:15-69`; `app/_lib/decision-attribution.test.ts:24-37`
- **Scenario**: The pass records `aging_alert`/`stale_alert` (from `evaluate_entry`, automation.py:211-214) and `fairness_gate_blocked_reject` (`FAIRNESS_BLOCKED_REJECT_ALERT`) through `recordAutomationEvent` at automation-pass.ts:314-318. None of the three exist in `DECISION_META`, so `decisionAttribution()` returns `"unknown"`: they render an UNKNOWN badge in the DecisionLog and are excluded from `summarizeAutomationImpact`'s auto/human counts.
- **Root cause**: The module exists specifically to stop this drift, but its coverage test (`decision-attribution.test.ts:24`) asserts a **hardcoded** `written` list — which omits these three alert kinds — instead of scanning actual writers. So the guard passes while the gap is live.
- **Impact**: The fairness-backstop signal and the aging/stale nudges — the most safety-relevant automation events — are invisible in the audit log and every rollup that folds through attribution.
- **Fix sketch**: Add the three kinds to `DECISION_META` (`auto:true`), and make the test derive `written` from a shared exported constant that the writers themselves consume, so a new alert kind can't be written without a mapping.

## 5. `automation_eval` `--judge --strict` passes on reliability alone when the judge scores nothing

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `pipeline/jobfit/eval/automation_eval.py:324-329`, `272-299`
- **Scenario**: With `--judge --strict`, if every judge call errors or returns an unparseable score, each row's `quality` stays `None`, so `agg["quality_mean"]` is `None`. `_passes` guards the quality gate with `if agg["quality_mean"] is not None`, so a fully-broken judge skips the gate and the run exits 0 on reliability alone — the banner even reads "quality N/A" while claiming PASS.
- **Root cause**: `None` (no valid judge output) is conflated with "judge not requested." A `--judge` run that produced zero scores should be a failure, not a skip.
- **Impact**: A CI quality gate that silently degrades to a reliability-only check when the LLM judge is down — success theater in the gate meant to catch quality regressions.
- **Fix sketch**: When `--judge` was requested but `quality_mean is None`, fail `_passes` (or surface a distinct "judge-unavailable" non-zero exit) rather than treating it as a clean pass.
