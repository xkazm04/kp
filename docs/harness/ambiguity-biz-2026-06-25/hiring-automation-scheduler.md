# Hiring Automation & Scheduler — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H3/M2/L0

## 1. Core automation gates are hard-coded in Python, not per-org / per-recruiter tunable
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: monetization / configurability / magic numbers
- **File**: pipeline/jobfit/automation.py:35
- **Observation**: The whole policy pass branches on a fixed `POLICY` dict — `bau_advance_score:70, bau_reject_score:40, screening_auto_days:2, stale_days:21, aging_days:30, rematch_floor:55, screen_advance_conf:80`. The comment calls them "tunable per market/season (the only place rules live)", but there is NO runtime/per-org override mechanism — changing any value is a Python code deploy. Meanwhile a *sibling* rule, the screen-wave bottom-percentile reject, IS recruiter-tunable in the UI (`app/features/sub_decisions/DecisionRulesModal.tsx:98`), so the product already establishes the expectation that recruiters set their own gates — just not for the gates that actually drive the scheduler. None of the seven constants carries recorded reasoning for *why* 70/40/55/80 (vs 65/45/…).
- **Why it matters**: `app/_lib/auth/session.ts:7` states multi-tenancy is coming ("a single default today; real multi-tenancy will mint per-tenant sessions"). A single global advance/reject threshold for every customer is both a differentiation gap (enterprise recruiting buyers expect to set their own bar per role-family/market/season) and a support burden (every "can we be stricter on juniors?" becomes an engineering ticket). It is also an audit risk: an unexplained "40" is hard to defend to a candidate or regulator.
- **Recommendation**: Promote `POLICY` to a persisted, per-org (and ideally per-role-family) config row with the current values as documented defaults; surface it in the same Decisions rules surface that already edits `rejectBottomPercent`; record the rationale for each default inline. Keep the TS fairness backstop (`BAU_REJECT_SCORE`) reading the same source so they can't drift.
- **Effort**: M

## 2. The concurrency design silently assumes a single Node process
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: hidden architectural assumption / double-run edge case
- **File**: app/_lib/automation-pass.ts:92
- **Observation**: `inFlightPass` single-flight and the per-entry `outreachInFlight` set (`app/_lib/automation-run.ts:57`) are *in-process* guards. Their own comments concede the boundary: "the manual surfaces run in the same Next server process as the heartbeat." Only the CLOCK path is cross-process safe (`claimDueRun` DB CAS, `scheduler-store.ts:183`); the "Run pass" button and any external cron call `runAutomationPass` directly, bypassing `claimDueRun`. So with two app replicas, a manual click on replica A + the clock on replica B (or two clicks on two replicas) each snapshot ALL active entries, both apply, and both can re-fire `dispatchOutreach` — duplicate candidate-facing emails and every per-entry race amplified board-wide, which is exactly the failure the single-flight comment claims to have closed.
- **Why it matters**: This single-process assumption is undocumented at the deployment boundary, yet the codebase is explicitly moving toward horizontal/multi-tenant scaling. The first time ops adds a second replica for availability, automation starts double-sending — a silent, candidate-visible correctness regression with no warning.
- **Recommendation**: Either document a hard "single app instance" constraint where the scheduler is wired, OR make the manual/cron pass and outreach send acquire the same DB-level lock the clock uses (a `claimDueRun`-style CAS / advisory row), so single-flight survives multiple processes.
- **Effort**: M

## 3. No liveness/health alerting for the clock — automation can silently stop
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: observability / operational happy-path
- **File**: instrumentation.ts:7
- **Observation**: The clock is an in-process heartbeat; the file itself notes "An external cron hitting /api/automation/run remains an alternative for deployments that don't keep a long-lived Node process." On a serverless/no-long-lived-process deploy where nobody wires that cron, the policy pass simply never runs and the *only* signal is `last_run_at` going stale (`scheduler-store.ts:222`) — which nothing watches or alerts on. Likewise, repeated pass *errors* are written to `scheduler_runs` with `status:"error"` but there is no escalation when N passes fail in a row.
- **Why it matters**: "Advances the pipeline on a schedule" is the context's core promise. If it silently stalls, candidates sit un-triaged for days (the aging/stale alerts at 30/21 days never fire) and the failure is invisible until someone notices the board isn't moving — the exact "success-theater" the `evaluated`-counter comment (`automation-pass.ts:80`) was added to prevent, but one level up.
- **Recommendation**: Add a liveness check (e.g. surface "last successful pass was N min ago / overdue" prominently in `SchedulerControl`, and/or an alert when `now - last_run_at` exceeds k×interval or when the last M runs are all `error`). Cheap given `scheduler_runs` already holds the data.
- **Effort**: S

## 4. Auto-reject fully retired → automation can't close the loop; "auto" infra left dead
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: automation depth / value left on the table / dark capability
- **File**: app/_lib/automation-pass.ts:244
- **Observation**: Per "AUTO1 RETIRED (UAT M6 / GDPR Art. 22)", every fairness-cleared reject is now QUEUED for an individual human click rather than applied; advances/holds stay autonomous. The former `auto` mode's column is kept as an explicit dead no-op (`scheduler-store.ts:62`, "never written or read"). So the deepest, most labor-saving step the engine could automate is gated behind one human click *per candidate, per pass* — and there is no bulk path.
- **Why it matters**: Automation depth is a headline selling point, and the ROI ledger (`automation-roi.ts`) only credits `auto_rejected` at 5 min each — labor the product now declines to save. For a high-volume recruiter clearing dozens of weak BAU rejects per pass, "queue one at a time" is real friction and undercuts the "we run your pipeline for you" pitch. The GDPR constraint is legitimate, but the response left value on the table rather than productizing it.
- **Recommendation**: Surface a "bulk-approve all fairness-cleared rejects" action on the Decisions gate (one click, full audit trail), and/or offer a premium per-org *audited* auto-reject tier with a candidate appeal window — reusing the dead `reject_mode` scaffold — so Art. 22's "human review" obligation is met without per-candidate clicking.
- **Effort**: M

## 5. No quiet-hours / timezone gating on automated candidate-facing sends
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: undocumented assumption / candidate experience
- **File**: instrumentation-node.ts:47
- **Observation**: The heartbeat fires every 60s and the interview-reminder sweep is claimed at a 1-minute cadence (`scheduler-store.ts:17`), dispatching candidate-facing messages whenever something is due — as do the offer-expiry reminders (`instrumentation-node.ts:84`). Nothing gates these to working/quiet hours. The assumption that 3 a.m. automated sends are acceptable is nowhere recorded. Notably the codebase already has a `BUSINESS_TZ` ("Europe/Prague", env-configurable) used for alert-dedup bucketing (`app/_lib/db/pipeline.ts:1208`) — it just isn't applied to outbound timing.
- **Why it matters**: A reminder or offer-nudge landing in a candidate's inbox at 3 a.m. reads as spammy/automated and dents employer brand — a concrete recruiter pain point and a differentiation lever competitors (e.g. polished ATS suites) get right. It's a small, undocumented edge that quietly degrades the candidate experience the rest of the pipeline works hard to protect.
- **Recommendation**: Add a quiet-hours window (e.g. suppress candidate-facing sends outside 08:00–20:00 `BUSINESS_TZ`, deferring to the next allowed slot), reusing the existing `BUSINESS_TZ`; document the policy where the sweeps are wired. Low effort since the timezone primitive already exists.
- **Effort**: M
