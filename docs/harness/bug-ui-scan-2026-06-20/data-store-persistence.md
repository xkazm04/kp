# Data Store & Persistence — Bug Hunter scan

> Context: The SQLite persistence foundation — core DB handle/connection, generated and hand-written schemas, the null contract, and DB path/portability helpers shared by every feature store.
> Files reviewed: 8 of 10 (read core.ts, db.ts, db/tasks.ts, db-path.ts, schemas.ts, schemas.generated.ts, schemas-null-contract.test.ts, next.config.ts, global.d.ts, requirements.txt; sampled offers-store.ts + scheduler-store.ts as representative isolated-connection writers)
> Total: 7 findings — Critical: 1, High: 3, Medium: 2, Low: 1

## 1. `ensureDb()` first-boot initializer is not guarded against concurrent re-entry — duplicate seeding / migration races
- **Severity**: Critical
- **Category**: race-condition
- **File**: `app/_lib/db/core.ts:97` (assignment of `_db` at `:792`, after the entire CREATE/ALTER/seed/backfill block)
- **Scenario**: Cold process (first request after deploy/restart). Two HTTP route handlers call `ensureDb()` in the same tick before either finishes. `if (_db) return _db` is false for both because `_db` is assigned only at the very END (line 792), so BOTH run the full `db.exec(CREATE…)`, both ALTER loops, `seedJobs/seedCandidates/seedAnalyses/seedPipeline`, `migratePipelineStages`, `backfillDeclinedStatus`, the workspace backfills, `prunePromptCache`, and `wal_checkpoint(TRUNCATE)`.
- **Root cause**: The memoization flag is set after a long, side-effectful, multi-statement boot sequence instead of being a synchronous guard taken before it. Node is single-threaded, but `ensureDb` itself is synchronous so two *interleaved* calls can't actually overlap within one process — the real exposure is (a) the SAME `kp.sqlite` file is opened by 17 other modules' connections that run their own CREATE/ALTER concurrently, and (b) Next dev HMR reloads this module, resetting `_db` to null while sibling connections stay live, so the boot block re-runs against a DB other connections are mid-writing. `wal_checkpoint(TRUNCATE)` racing a concurrent reader/writer is explicitly caught-and-ignored, so a failed checkpoint silently lets the WAL grow.
- **Impact**: Redundant full reseed on every cold module reload; under multi-connection contention the boot ALTER/seed statements can throw SQLITE_BUSY (5s timeout) and, in the second ALTER loop, be silently swallowed (see finding #2), booting a structurally-incomplete schema. Wasted multi-second boots and a real "why did a column not get added" class of bug.
- **Fix sketch**: Hoist a synchronous guard: set a module-level `_initializing`/`_db` sentinel BEFORE running DDL, or wrap the whole CREATE+migrate+seed in a single `db.transaction(() => …)()` so it's atomic and idempotent. Store `_db` on `globalThis` (like the codebase does elsewhere for HMR-surviving singletons) so a dev reload reuses the existing connection instead of opening a new one and re-seeding.

## 2. Second migration loop swallows ALL errors with bare `catch {}`, defeating the deliberate "surface unexpected failures" design of the first loop
- **Severity**: High
- **Category**: silent-failure
- **File**: `app/_lib/db/core.ts:733-739` (and the `dev_submissions`/`interview`/`jobs`/`analyses` ALTER block), vs. the correct `migrateExec` at `:571-580`
- **Scenario**: A migration in the second loop (e.g. `ALTER TABLE jobs ADD COLUMN status TEXT`, `ALTER TABLE analyses ADD COLUMN workspace_id TEXT`) fails for a NON-benign reason — disk full, I/O error, a lock that outlasts busy_timeout, or DB corruption.
- **Root cause**: The first ALTER loop was deliberately routed through `migrateExec`, which re-throws anything that is not `duplicate column name`/`already exists` precisely because the comment at `:565-570` says a bare `catch {}` here "was the exact 'why is everything empty' hunt." The second loop (and the `dev_submissions` block, and the unique-index `try/catch` at `:744-764`) reintroduces the bare `catch {}` one screen down — swallowing genuine failures identically to "column already exists."
- **Impact**: A real migration failure boots a DB missing `jobs.status`, `analyses.workspace_id`, `dev_cases.scenario_json`, etc. Downstream code then reads a column that doesn't exist (throws at query time) or, worse, tenant scoping silently degrades (`workspace_id` never added → the cross-tenant board-match bug those columns were added to FIX silently returns). No log, no signal.
- **Fix sketch**: Route every ALTER in this file through the existing `migrateExec` helper so only `duplicate column name`/`already exists` is swallowed and everything else is logged + re-thrown. The unique-index creates legitimately need a softer catch, but should still `console.warn` the skip with the error message.

## 3. FK enforcement is enabled per-connection but ZERO `REFERENCES` are declared — referential integrity is unenforced across all relational tables
- **Severity**: High
- **Category**: schema-integrity / data-loss
- **File**: `app/_lib/db-path.ts:75` (`foreign_keys = ON`) vs. `app/_lib/db/core.ts` (no table declares `REFERENCES`; e.g. `pipeline_events.entry_id`, `dev_submissions.posting_id`, `dev_session_events.session_id`, `skill_profiles.submission_id`, `offers.entry_id` are all bare TEXT)
- **Scenario**: A pipeline_entry is deleted/anonymized; its `pipeline_events`, `consent_events`, `offers`, `interview_sessions`, and `dev_*` children keep pointing at a vanished parent. A child row can also be inserted with a `job_id`/`posting_id` that never existed.
- **Root cause**: `foreign_keys = ON` is necessary but not sufficient — SQLite only enforces relations that are actually DECLARED. The code comment (`db-path.ts:50-59`) acknowledges this is "a no-op behavioral change today." The mitigation cited is "the GDPR path anonymizes-in-place rather than deleting," but that's a single code path, not a structural guarantee — any future hard-delete (or a manual `DELETE`, or `scripts/db-load`) strands orphans with no DB-level objection.
- **Impact**: Orphaned events/offers/submissions accumulate silently; analytics that join on these produce phantom or missing rows; a candidate-facing token (offer/skill-profile) can resolve to a dead parent. The integrity guarantee everyone assumes is on is structurally absent.
- **Fix sketch**: Declare `REFERENCES … ON DELETE CASCADE`/`SET NULL` on the new tables now (cheap — they're `CREATE TABLE IF NOT EXISTS`), and for legacy tables do the SQLite 12-step rebuild migration table-by-table. Until then, add an integrity-sweep that flags orphans, and never hard-delete a parent.

## 4. `INSERT OR REPLACE` reseed of candidates/analyses silently destroys any recruiter edits that collided with a seed id
- **Severity**: Medium
- **Category**: data-loss
- **File**: `app/_lib/db/core.ts:1032-1051` (candidates) and `:1074-1094` (analyses)
- **Scenario**: `seedCandidates`/`seedAnalyses` run `INSERT OR REPLACE` on EVERY boot (no empty-table guard, by design). The guard against clobbering real data is purely the `cand-`/`seed-` id prefix convention. If a recruiter-built profile or a migrated/imported row ever lands on a `cand-*` or `seed-*` id (import, manual fixup, a future id scheme change, `scripts/db-load`), the next boot silently REPLACES it with the committed seed payload — including `created_at` reset to the 2024 sentinel.
- **Root cause**: Idempotent reseed correctness rests on an unenforced naming convention rather than a column/flag distinguishing seed rows from user rows. `INSERT OR REPLACE` deletes-then-inserts, so any extra columns or human edits on the row are wiped, not merged.
- **Impact**: Silent loss of a candidate profile or analysis disposition on restart, with no event/log. Hard to diagnose because it only triggers on the next boot, far from the edit.
- **Fix sketch**: Add an `is_seed INTEGER DEFAULT 0` column (or a `source='seed'` marker) and reseed with `INSERT … ON CONFLICT(id) DO UPDATE … WHERE is_seed = 1`, so a boot reseed can never overwrite a user-owned row even on an id collision.

## 5. Multi-connection write model can exceed `busy_timeout` under a long transaction, silently dropping a scheduler tick
- **Severity**: Medium
- **Category**: race-condition / silent-failure
- **File**: `app/_lib/db-path.ts:74` (`busy_timeout = 5000`); contended by `app/_lib/db/core.ts:990` (seed tx), `scheduler-store.ts:203` (`claimDueRun`), `offers-store.ts`
- **Scenario**: The policy pass holds db.ts's write transaction (bulk `pipeline_entries`/`pipeline_events` writes) for >5s — plausible during seeding, a large screen-wave, or a slow disk. Concurrently `claimDueRun()` on the scheduler connection tries to `UPDATE scheduler …`. WAL permits only one writer; the scheduler waits up to 5s then throws SQLITE_BUSY.
- **Root cause**: WAL gives one writer at a time across all 18 connections to the single file; `busy_timeout` only papers over SHORT contention. `claimDueRun` already advanced `next_due_at` is NOT the failure here (it's a single atomic UPDATE), but if it throws SQLITE_BUSY *before* committing, the heartbeat catches the throw and the window is skipped — the scheduler-store comment at `:22-27` documents exactly this risk but the 5s timeout is the only mitigation.
- **Impact**: A heavy write window can silently skip an automation/reminders tick (no run row recorded), delaying candidate-visible reminders. Under sustained load, repeated SQLITE_BUSY 500s on valid offer accept/decline (`offers-store.ts:18-22`).
- **Fix sketch**: Keep write transactions short (batch + commit in chunks rather than one giant tx); raise `busy_timeout` for the scheduler/offer connections specifically; wrap `claimDueRun`/`recordRun` in a bounded retry on SQLITE_BUSY so a transient lock retries instead of skipping the window.

## 6. `synchronous = NORMAL` + WAL can lose the last committed transactions on OS crash / power loss
- **Severity**: Low
- **Category**: latent-failure / data-loss
- **File**: `app/_lib/db-path.ts:73` (`synchronous = NORMAL`)
- **Scenario**: An OS crash or power loss occurs between a WAL commit and the next checkpoint. NORMAL does not fsync on every commit, so the last few committed transactions in the WAL can be lost (the code comment at `:68-72` states this explicitly).
- **Root cause**: NORMAL is the correct SQLite recommendation for WAL and a deliberate durability/throughput trade-off, but for a billing ledger (`billing_credits`, `billing_usage`) and consent audit trail (`consent_events`) the lost-transaction window has compliance/money implications.
- **Impact**: A prepaid credit grant or a GDPR consent/erasure audit row committed seconds before a power loss could vanish, leaving the ledger/audit trail inconsistent with what the user was told.
- **Fix sketch**: Acceptable as a default, but consider `synchronous = FULL` (or an explicit `wal_checkpoint` immediately after) for the billing/consent write paths specifically, or document the accepted RPO. At minimum, make the billing webhook idempotency replay-safe so a lost-then-redelivered event reconstructs the ledger.

## 7. Dynamic table name interpolation in `coreTableCounts` / `coreTableCounts`-style probes relies on an allow-list with no defense-in-depth
- **Severity**: Low
- **Category**: injection (defense-in-depth)
- **File**: `app/_lib/db/tasks.ts:16` (`SELECT COUNT(*) … FROM ${t}`)
- **Scenario**: `coreTableCounts` interpolates `t` directly into SQL. Today `t` comes from a hard-coded literal array (`["jobs","profiles",…]`), so it is safe. The risk is purely future-proofing: if anyone ever sources that list from config/request, this becomes SQL injection because table names cannot be bound as parameters.
- **Root cause**: Table identifiers are interpolated rather than validated against a centralized allow-list at the interpolation site, so the safety is "the caller passes only literals" rather than enforced.
- **Impact**: None today; a latent injection landmine if the input source ever changes.
- **Fix sketch**: Validate `t` against an exported `const CORE_TABLES = [...] as const` set right before interpolation (`if (!CORE_TABLES.includes(t)) throw`), so the guarantee lives at the query, not the caller.

---
Note on the task's "known parse error at lines 503-504": those lines are a plain SQL `--` comment inside the `db.exec` template literal (`-- model is nullable …`) and contain no backticks; the template literal is well-formed and the file parses. The `%%` at line 203 is a literal double-percent inside a JS template string and is also benign. No build-breaking syntax error was found in this context.
