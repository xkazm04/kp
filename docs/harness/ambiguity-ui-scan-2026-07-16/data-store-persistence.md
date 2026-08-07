# Data Store & Persistence — ambiguity-guardian + ui-perfectionist scan

> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. `seedCandidates` still uses `INSERT OR REPLACE` — the exact reboot data-loss the sibling `seedAnalyses` fix removed
- **Severity**: High
- **Lens**: ambiguity
- **Category**: silent-data-loss
- **File**: `app/_lib/db/core.ts:1437`
- **Scenario**: A recruiter hand-edits (or the divergence/lineage machinery stamps) one of the shipped `cand-*` seed profiles. On the next server boot `seedCandidates` re-runs with no empty-table guard and re-`INSERT OR REPLACE`s every `cand-*` row.
- **Root cause**: `INSERT OR REPLACE` is delete-then-insert, and the column list here is only `(id, label, archetype, role_family, completeness, payload_json, created_at)`. It predates `updated_at`, `lineage_stamped_at`, `source_analysis_slug`, `source_cv_hash`, `source_analyzed_at` — so a replace resets `payload_json` to the committed seed and NULLs every later-added column. This is precisely the bug that was fixed for `seedAnalyses` right below (lines 1472-1519, "NON-DESTRUCTIVE upsert … `ON CONFLICT(slug) DO UPDATE SET`"), but the candidate seeder was never given the same treatment.
- **Impact**: Silent, timer-driven data loss: any edit to a seeded candidate profile is reverted on reboot, and lineage/divergence columns silently reset (unlike `workspace_id`, only that one column is re-healed by the post-seed backfill on line 1093). Reproduces the multi-hour "why did my edit disappear?" class the analyses fix was written to kill.
- **Fix sketch**: Mirror the `seedAnalyses` fix: switch to `INSERT INTO profiles (…) VALUES (…) ON CONFLICT(id) DO UPDATE SET` that refreshes ONLY the seed-owned columns (`label`, `archetype`, `role_family`, `completeness`, `payload_json`, `created_at`) and never touches `updated_at`/`lineage_stamped_at`/`source_*`. A genuinely new seed row still plain-INSERTs and is backfilled by the existing post-seed heal.

## 2. `finishTask` omits the terminal-status guard its sibling mutators carry, so a straggler can resurrect a canceled task
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: inconsistent-invariant
- **File**: `app/_lib/db/tasks.ts:287`
- **Scenario**: A task is canceled (status `canceled`/`interrupted`) while its handler is still executing. The handler later completes and calls `finishTask(id, 'succeeded', …)`.
- **Root cause**: `markTaskRunning` (line 256) and `setTaskProgress` (line 263) both guard with `AND status IN ('queued','running')` and carry comments explaining that "a straggler … after cancel must not write to the terminal row." `finishTask` writes unconditionally with `WHERE id=?`, with no comment saying whether last-writer-wins is intentional here.
- **Impact**: A terminal `canceled`/`interrupted` row can be flipped to `succeeded`/`failed` (and re-timestamped) by a late handler, contradicting the "terminal is final" invariant the neighbours enforce. A recruiter sees a task they canceled report success. The inconsistency is undocumented, so a future maintainer can't tell if it's deliberate.
- **Fix sketch**: If terminal state is meant to be final, add `AND status IN ('queued','running')` to the `finishTask` UPDATE to match its siblings. If last-writer-wins is intentional (the handler's real outcome should overwrite a cancel), add a one-line comment stating that and why, so the divergence from the guarded mutators is a documented decision.

## 3. Stale dedupe-index comment in `createTask` contradicts the actual schema
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: doc-drift
- **File**: `app/_lib/db/tasks.ts:141`
- **Scenario**: A developer debugging a `SQLITE_CONSTRAINT_UNIQUE` on task creation (or reasoning about multi-workspace readiness) reads the `NOTE:` in the catch block.
- **Root cause**: The comment states "the unique index is on `dedupe_key` alone … but the index must widen to `(workspace_id, dedupe_key)` before KP_MULTI_WORKSPACE." But `core.ts:1043-1047` already `DROP`s `uq_tasks_active_dedupe` and creates `uq_tasks_active_dedupe_ws ON tasks (workspace_id, dedupe_key) WHERE status IN ('queued','running')`. The widening the note says still "must" happen has already shipped, and the note names the dropped index.
- **Impact**: A developer trusts a comment that describes a schema state that no longer exists — either believing tenant dedup is unsafe when it's already fixed, or hunting for an index (`uq_tasks_active_dedupe`) that has been dropped. The kind of "code future developers will struggle to understand" trap the audit targets.
- **Fix sketch**: Update the note to reference `uq_tasks_active_dedupe_ws` and state that dedup uniqueness is already scoped to `(workspace_id, dedupe_key)`, matching `getActiveTaskByDedupe`. Drop the "must widen before KP_MULTI_WORKSPACE" clause since it's done.

## 4. Demo benchmark team is seeded on any non-production `NODE_ENV`, risking fabricated data blended into a real self-host's org benchmark
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-assumption
- **File**: `app/_lib/db/seed-benchmark-team.ts:15`
- **Scenario**: An operator self-hosts KP via a custom launcher (PM2/systemd/cron running `node server.js`) — exactly the deployment shape `db-path.ts` warns about at length — without setting `NODE_ENV=production`. On boot, `seedBenchmarkTeam` seeds 24 fabricated pipeline entries under the real `org-default`.
- **Root cause**: `benchmarkDemoSeedEnabled` returns `true` whenever `NODE_ENV !== "production"` (absent/empty included). `orgHiringBenchmark` (the one reader that crosses the workspace boundary via the `org_id` join) then aggregates those fake rows into the real org's interview/hire rates and satisfies the k-anon floor with a phantom team. The gate treats `NODE_ENV` as an infallible production signal, which this product's own deployment docs show is fragile.
- **Impact**: A misconfigured self-host silently reports a contaminated org-wide benchmark (fabricated ~50% of a single-team org's cohort) instead of the honest "unavailable" a genuinely single-team org should read. This is a data-correctness risk hidden behind an environment-variable assumption.
- **Fix sketch**: Make the demo opt-in explicit for anything shippable — require `KP_SEED_DEMO` truthy to seed, rather than defaulting to "seed unless NODE_ENV=production". At minimum, treat unset/empty `NODE_ENV` as production for this gate and document that a real deployment must never seed demo benchmark data.

## 5. Undocumented magic aging constants in `seedPipeline`
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: magic-numbers
- **File**: `app/_lib/db/core.ts:1682`
- **Scenario**: A developer regenerating or tuning the demo pipeline seed reads `const daysInStage = (i * 37) % 18;` and `const enteredDaysAgo = daysInStage + ((i * 13) % 21);`.
- **Root cause**: The four constants (37, 18, 13, 21) are unexplained beyond "Deterministic aging spread so SLA/aging signals vary across the demo set." Why those specific coprime-ish multipliers/moduli, and what SLA/aging bands they're meant to exercise, is undocumented.
- **Impact**: Low — seed-only, and the arithmetic can't invert `created_at`/`stage_changed_at` (the offset is always ≥ 0). But anyone adjusting the demo distribution is tuning blind. Papercut for maintainers, no runtime risk.
- **Fix sketch**: Name the intent — e.g. extract `const AGING_STAGE_SPREAD_DAYS = 18; const AGING_ENTRY_JITTER_DAYS = 21;` with a one-line comment on the target aging range the demo should cover, so the numbers read as chosen rather than arbitrary.
