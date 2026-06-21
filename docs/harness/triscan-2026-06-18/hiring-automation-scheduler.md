# Hiring Automation & Scheduler — Tri-Lens Scan
> Total: 5
> Severity: 0 Critical / 3 High / 2 Medium / 0 Low
> Lens: 3 bug / 0 ui / 2 biz

## 1. ROI ledger credits human recruiter work as automation savings (and ignores the real automated advances)
- **Lens**: 🐛 Bug Hunter (primary) · 🚀 Business Visionary
- **Severity**: High
- **Category**: Metric correctness / trust
- **File**: `app/_lib/automation-roi.ts:24` · `app/_lib/db/analytics.ts:303,485`
- **Scenario**: A recruiter manually advances 50 candidates through the board this week and the clock auto-advances 30. The Automation panel reports hours/CZK "saved by automation". The 50 manual advances are counted as automation savings; the 30 genuine auto-advances contribute nothing.
- **Root cause**: `MINUTES_SAVED_PER_KIND` lists `advanced` (3 min) but NOT `auto_advanced`. `actOnPipelineEntry` writes `auto_advanced` for `actor:"system"` and `advanced` for human clicks (`pipeline.ts:1247,1256`). The ROI input is a raw `SELECT kind, COUNT(*) … GROUP BY kind` with no actor filter (`analytics.ts:303`), so the map's `advanced` row sums human moves while real automated advances (`auto_advanced`) are dropped. The attribution is inverted for the single most-frequent automated action.
- **Impact**: The headline value/trust number a buyer evaluates is systematically wrong — inflated by manual labor, blind to actual automation. Erodes the "ROI transparency" the ledger exists to provide.
- **Fix sketch**: Replace the `advanced` key with `auto_advanced` in `MINUTES_SAVED_PER_KIND`; audit every key against the actor-split kinds the system actually writes (auto_* family). Optionally pass an actor-filtered kindCounts so only system-attributed events feed ROI.

## 2. `rejection_sent` minutes-saved double-counts manual rejections as automated
- **Lens**: 🐛 Bug Hunter (primary) · 🚀 Business Visionary
- **Severity**: Medium
- **Category**: Metric correctness
- **File**: `app/_lib/automation-roi.ts:23` · `app/_lib/comms-dispatch.ts:175`
- **Scenario**: A recruiter manually rejects a candidate from the Decisions tab; the rejection email goes out and records a `rejection_sent` event. The ROI ledger adds 4 minutes "saved by automation" for a message a human composed and triggered.
- **Root cause**: `dispatchRejection` records the same `rejection_sent` kind for both paths, distinguishing them only in the free-text detail (`"policy auto-reject"` vs `"manual reject"`), never in the kind. `automationRoi` keys on the kind alone, so it cannot tell the automated send from the human one. (`auto_rejected` is correctly system-only, but the *email* kind is shared.)
- **Impact**: Smaller than #1 (rejection volume is lower and supervised-mode rejects route through the human path by default), but it inflates the same trust metric and compounds with #1.
- **Fix sketch**: Either emit a distinct kind for automated rejection sends (e.g. `auto_rejection_sent`) and credit only that in the map, or drop `rejection_sent` from the ROI map and rely on `auto_rejected` (already system-only) as the rejection savings proxy.

## 3. Auto-score sweep failure for one job downgrades to a silent hold with no per-entry trace
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Silent failure / partial recovery
- **File**: `app/_lib/automation-pass.ts:187-193`
- **Scenario**: The pre-policy scoring sweep spawns `recruiter_cli` per job. If the spawn fails for one job (Python fault, transient resource limit), every unscored candidate for that job stays `matchScore == null`, the policy pass holds them "awaiting match score", and the only record is a `console.error` on the server. Next tick the same job fails again — the candidates are wedged at the funnel's front door indefinitely with nothing on the board or in `scheduler_runs` explaining why.
- **Root cause**: The catch logs to console only; it records no `pipeline_event` and does not increment `summary.errors`. AUTO1 added the scoring sweep precisely to stop the "held forever" deadlock, but a sweep *failure* silently reintroduces it. The run summary still reads as a clean pass (held entries look like normal holds).
- **Impact**: Candidates can sit un-triaged for days with no visible signal; the success-theater the `evaluated`/`errors` counters were added to prevent re-emerges one layer up (scoring), since scoring failures never reach those counters.
- **Fix sketch**: In the catch, `recordAutomationEvent(e.id, "scoring_failed", msg)` for affected entries (dedup via `hasEventToday`) and bump `summary.errors`, so a persistent scoring outage surfaces on the board and in the run log instead of looking like routine holds.

## 4. No dry-run / kill-switch reachable from the scheduler control surface
- **Lens**: 🚀 Business Visionary (primary) · 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Operator trust / auditability
- **File**: `app/features/sub_pipeline/SchedulerControl.tsx:340-349` · `app/api/automation/run/route.ts:13`
- **Scenario**: An operator about to enable autonomous rejections (`rejectMode: "auto"`) wants to preview exactly which candidates this pass *would* reject before committing. The backend fully supports it — `POST /api/automation/run {"dryRun":true}` returns the identical decisions with the fairness backstop consulted and nothing written (`automation-pass.ts:228-244`) — but `SchedulerControl` only exposes "Run now" (a committing tick). The look-before-commit gate exists in code and on the API but has no control on the clock surface.
- **Root cause**: The dry-run capability was built (and `PassPreviewModal.tsx` exists) but is not wired into the scheduler bar next to the autonomy toggle, where the decision to go autonomous is actually made — a "built-but-unwired" gap on the highest-stakes control.
- **Impact**: The autonomy opt-in is a leap of faith rather than a previewed decision; weakens the auditability/kill-switch story that differentiates trustworthy hiring automation. (A true emergency stop also requires only the per-job Off toggle today.)
- **Fix sketch**: Add a "Preview pass" button beside "Run now" that POSTs `{dryRun:true}` and opens `PassPreviewModal` with the returned decisions; surface it prominently when `rejectMode === "auto"`.

## 5. `setIntervalMinutes` recomputes `next_due_at` off `last_run_at`, but `claimDueRun`/`advanceAfterForcedRun` already advanced it — a tightened cadence can stall a full interval
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Clock / interval drift
- **File**: `app/_lib/scheduler-store.ts:180-184`
- **Scenario**: Schedule runs every 60 min; a pass just ran at 10:00, so `last_run_at=10:00` and `next_due_at` was advanced to 11:00. At 10:05 the operator tightens the cadence to 5 min, expecting the next pass within ~5 min. `setIntervalMinutes` anchors on `last_run_at` (10:00) + 5 min = 10:05, clamped to `now` → fires almost immediately. So far so good. But if `last_run_at` is *stale* relative to the real clock advancement (e.g. a forced tick advanced `next_due_at` without the operator's mental model of when "last run" was), the recompute can land further out than the user expects — and conversely, anchoring on `last_run_at` rather than the *current* `next_due_at` means a LOOSENED cadence is also recomputed from the old anchor, occasionally re-firing sooner than the new interval implies.
- **Root cause**: The pending-run recompute uses `last_run_at` as the sole anchor and ignores the already-advanced `next_due_at` the claim path maintains, so the two writers of `next_due_at` (claim/forced-advance vs interval-change) don't share an anchor. The clamp to `now` masks the common case (tightening) but not the general drift between anchors.
- **Impact**: Cadence changes don't take effect as predictably as the inline comment claims ("fires at most one new-interval away"); operationally confusing for an operator tuning how aggressively automation acts on candidates. Bounded (≤ one interval), not data loss — hence High-not-Critical.
- **Fix sketch**: Anchor the recompute on `min(existing next_due_at − oldInterval, lastRunAt)` or simply on the current `next_due_at` adjusted by the interval delta, clamped to `now`, so all three writers of `next_due_at` agree on the schedule's true anchor.
