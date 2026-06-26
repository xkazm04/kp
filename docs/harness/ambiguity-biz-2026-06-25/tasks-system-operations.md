# Tasks & System Operations — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H2/M3/L0

## 1. The System dashboard shows volatile, restart-resettable ops counters while the durable record on disk is never read
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark-capability / observability
- **File**: app/_lib/logger.ts:103
- **Observation**: `scheduleReconcileCount` (logger.ts:103) and `scheduleNoSlotsCount` (logger.ts:131) are module-level `let` counters incremented in-process. `/api/ops` reads them directly (ops/route.ts:42-43) and `SystemCard` renders them as the "schedule reconcile failures" / "fully-booked stalls" KPIs, styling `0` as calm steel and `>0` as red/amber (SystemCard.tsx:135-140). But every occurrence is ALSO durably appended to `schedule-reconcile.log` / `schedule-no-slots.log` (logger.ts:115,144) — and `ops-telemetry.ts` reads only `analyze.log` / `pipeline.log` / `comms.log`, never these two. So after any `next dev` HMR, deploy, or crash, the counters reset to `0` and the operator sees a green "all clear" while the on-disk truth says otherwise. The code comments even admit this: "A real deployment would ship schedule-reconcile.log to an alerting sink" (logger.ts:95).
- **Why it matters**: These two counters specifically track *silent* candidate-facing failures — a confirmed interview whose pipeline advance threw (recruiter board shows the candidate still waiting) and a candidate who hit a fully-booked horizon. They are the highest-stakes signals on the panel, and they are exactly the ones an operator cannot trust. "Reliability you can see" is a stated upsell lever for kp; a KPI that lies after every restart is worse than no KPI.
- **Recommendation**: Make `commsTelemetry`'s pattern do double duty — add `scheduleTelemetry()` to ops-telemetry.ts that tails `schedule-reconcile.log` / `schedule-no-slots.log` over the same 7-day window, and have `/api/ops` report those counts instead of the in-process getters. The durable file already exists; this is a one-reader change.
- **Effort**: S

## 2. The `tasks` table grows unbounded — there is retention for the prompt cache but none for tasks
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: retention / silent reliability decay
- **File**: app/_lib/tasks.ts:39
- **Observation**: `RECENT_TASK_WINDOW_DAYS = 7` (tasks.ts:39) is purely a *display* window — `listRecentTasks` shows ≤7d, `listTaskHistory` pages in everything older (db/tasks.ts:150,190). No code ever deletes a task row: `grep -rni "DELETE FROM tasks|pruneTask|retention|vacuum"` over `app/_lib` returns nothing. Contrast the prompt cache, which is explicitly bounded by `prunePromptCache` on boot (core.ts:806) AND opportunistically on write (analyses.ts:285). The db comment is explicit that finished `analyze`/`group_eval` rows carry "multi-MB result_json/params_json" (db/tasks.ts:78-85) — so every analysis ever run is retained in full, forever, in the single SQLite file.
- **Why it matters**: This is an undocumented assumption ("someone will clean this up") that silently degrades a long-lived install: DB file bloat, slower `COALESCE(finished_at, created_at)` history scans, and a larger blast radius for the single-file backup. BackupCard's copy even says task-runner state is *excluded* from backups (BackupCard.tsx:111) — so the bloat is pure liability with no recovery value. There is no recorded reasoning for why tasks are exempt from the retention discipline applied everywhere else.
- **Recommendation**: Add a `pruneTasks(olderThanDays, keepMax)` that deletes terminal rows past a documented horizon (e.g. 90d), wired into the same boot + opportunistic hooks as `prunePromptCache`, and make the horizon an env knob via `positiveNumericEnv`. Document the chosen retention period.
- **Effort**: S

## 3. `MAX_CONCURRENT = 2` is hardcoded — the single most throughput-critical knob is the only one not env-configurable
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic number / configurability
- **File**: app/_lib/tasks.ts:33
- **Observation**: `const MAX_CONCURRENT = 2; // respect the Claude CLI subscription rate ceiling` (tasks.ts:33) caps all background work. Every *other* operational tunable in this context routes through the purpose-built `positiveNumericEnv` helper (env.ts:23) — `PYTHON_MAX_BUFFER_MB` (python-runner.ts:102), and the helper's own docstring lists "cache TTL, the spawn buffer ceiling, future knobs". `PYTHON_CMD`, `KP_LOG_DIR`, and `DEV_GUARD_MAX_NODE` are all env-overridable too. The one constant that directly trades throughput against rate-limit risk is not.
- **Why it matters**: The "2" encodes tribal knowledge (a specific Claude subscription's ceiling) in a one-line comment. A deployment on a higher tier, or one routing some kinds through Gemini instead, must edit source and redeploy to scale — and a reader has no documented basis to know whether bumping it is safe. This is throughput left on the table plus a hidden coupling between a hardcoded constant and an external account's limits.
- **Recommendation**: `const MAX_CONCURRENT = positiveNumericEnv("KP_TASK_CONCURRENCY", 2);` and expand the comment to name the assumption (which provider/tier the 2 reflects) so the trade-off is recorded, not folklore.
- **Effort**: S

## 4. No stuck / long-running task detection — a hung `running` row holds a slot forever and still reports "Healthy"
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: unhandled edge case / observability
- **File**: app/_lib/tasks.ts:153
- **Observation**: `interruptStaleTasks()` only reclaims orphaned `running` rows once, at process boot via the `booted`-guarded `ensureRecovered()` (tasks.ts:153-168, db/tasks.ts:269). There is no in-flight watchdog. A handler that hangs *without* crashing the process — e.g. a non-Python handler with no timeout, or a Python child still inside the 10-min `DEFAULT_TIMEOUT_MS` (python-runner.ts:87) that none of the task handlers override (they call `spawnPython(args, { signal })` with no `timeoutMs` — analyze-run.ts:121, automation-run.ts:183, devcase-run.ts:44) — permanently occupies one of the two `MAX_CONCURRENT` slots. Meanwhile `/api/health` reports only queue *depth*, never task *age* (health/route.ts:24, db/tasks.ts:4-9), so the readiness probe stays green while throughput is silently halved.
- **Why it matters**: With only 2 slots, one stuck task halves capacity and two wedge the whole queue, yet every monitor says healthy. This is the classic happy-path gap: crash recovery is handled, slow-death is not. An uptime monitor gating on `/api/health` cannot catch it.
- **Recommendation**: Add a `running AND started_at < now-N min` count to `coreTableCounts`/`countActiveTasks`, surface it as a `degradedReasons` entry in `/api/health` and a red stat in SystemCard, and document the intended max task runtime so "stuck" has a defined threshold.
- **Effort**: M

## 5. 7-day token spend is surfaced but never converted to cost or gated by a budget
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: value-left-on-table / monetization
- **File**: app/_lib/ops-telemetry.ts:77
- **Observation**: `engineTelemetry` already aggregates `totalTokens7d` and `cachedTokens7d` from `pipeline.log` (ops-telemetry.ts:77-102), and SystemCard renders them as raw token counts (SystemCard.tsx:99-102). There is no translation to currency and no threshold — the panel will read "1,240,000 tokens · 7d" with no indication of whether that is $5 or $500, and no alert when spend spikes. The richest billing-relevant datapoint in the whole ops payload stops one transform short of being actionable.
- **Why it matters**: kp is a billing-aware hiring SaaS where AI-candidate units are debited per run (see tasks.ts:94-96). An operator/owner cannot answer "what is this costing me this week?" or "alert me past €X" from the data the app already collects — a textbook dark capability and a natural enterprise cost-control feature. The cached-vs-total split is also a ready-made efficiency story (cache savings in money) that is currently invisible.
- **Recommendation**: Add a per-1k-token price (env-configured per model) to engineTelemetry, emit `cost7d` + `cacheSavings7d`, and render currency in SystemCard with an optional `KP_TOKEN_BUDGET_7D` threshold that flags red when crossed — reusing the existing red/amber styling already in the card.
- **Effort**: M
