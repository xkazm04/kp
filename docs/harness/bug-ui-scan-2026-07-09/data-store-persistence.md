# Data Store & Persistence — bug-hunter + ui-perfectionist scan

> Context: The SQLite persistence foundation — core DB handle, schemas, null contract, DB-path/portability helpers, and the new reference-tier + offline/testing modules shared by every feature store.
> Files reviewed: 14 of 16 (core.ts, db.ts, db-path.ts, tasks.ts, pg-portability.ts, salary-benchmark.ts, seed-benchmark-team.ts, org-benchmarks.ts, testing/unit-db.ts, offline.ts, schemas.ts, next.config.ts, tenancy.ts, analyses.ts; plus scheduler/brand/ats stores for the isolated-connection probe. Sampled schemas.generated.ts / taxonomy.generated.ts / requirements.txt / global.d.ts.)
> Total: 5

## 1. [STILL-OPEN] `seedAnalyses` INSERT OR REPLACE wipes recruiter dispositions on every boot (stale column list)

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption / data-loss
- **File**: `app/_lib/db/core.ts:1345-1373` (seed INSERT column list at `:1353`); columns added later at `:831-843`; writer `app/_lib/db/analyses.ts:90-96,210`
- **Scenario**: A recruiter opens a seeded candidate's report (`/history/seed-<id>`), sets a disposition (advance/hold/pass) + decision note via `setAnalysisDisposition`, and/or attaches a GitHub deep-dive (`setAnalysisGithub`). The server restarts (deploy, HMR, crash-restart). On boot `seedAnalyses` runs unconditionally (no empty-table guard, by design) and `INSERT OR REPLACE`s every `seed-<id>` row.
- **Root cause**: `INSERT OR REPLACE` = delete-then-insert, and the seeder's INSERT lists only 8 columns (`slug,candidate_label,jd_slug,score,role_family,seniority,payload_json,created_at`). The `analyses` table has since grown `disposition`, `decision_note`, `review_flags`, `github_json`, `workspace_id` (ALTERs at `:831-843`) — none listed, so REPLACE resets them to NULL. `workspace_id` is re-healed by the post-seed backfill (`:987`); the other four are not. Unlike prior scan finding #4 (an id-*collision* edge case), the seeded rows are the app's shipped working set and ARE editable in-product — so this is a normal-flow loss, and the newer columns make it strictly worse than before.
- **Impact**: Silent loss of human-in-the-loop hiring decisions (the very record `AiDisclosure` promises "a human decides") and GitHub evidence on the entire seeded candidate population, far in time from the edit — undiagnosable.
- **Fix sketch**: Reseed with `INSERT … ON CONFLICT(slug) DO UPDATE SET` that touches ONLY seed-owned columns (payload/label/score), never the recruiter columns; or add `is_seed INTEGER` and refuse to reseed a row a human has dispositioned. Kills the whole "reseed nulls a later-added column" class.

## 2. Synthetic benchmark team contaminates the REAL org's hiring benchmark

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / wrong-result
- **File**: `app/_lib/db/seed-benchmark-team.ts:15-55`; consumed by `app/_lib/db/org-benchmarks.ts:81-106`
- **Scenario**: On boot, `seedBenchmarkTeam` inserts 24 fabricated `pipeline_entries` (8 Accepted / 6 Screened / 5 Interview / 2 Offer / 3 Hired) into team `ws-benchmark-north`, a second team under `org-default`. A recruiter on the real team views the org/peer benchmark (`OrgBenchmarkPanel` → `/api/benchmarks`).
- **Root cause**: `orgHiringBenchmark` is explicitly the ONE reader that crosses the workspace boundary (`JOIN workspaces w … WHERE w.org_id = ?`), so it aggregates the real team's pipeline together with the 24 synthetic entries. `org-default` is not a demo org — every seed comment names it as the deployed Česká spořitelna tenant. The "INERT in single-tenant" claim holds only for per-team surfaces (which scope to `workspace`), NOT for the org benchmark, which is the one surface this seed exists to feed.
- **Impact**: The org-wide interview/hire rates and median time-to-hire a real customer sees are blended ~50/50 with fabricated data; the k-anon floor (`MIN_TEAMS=2`) is also satisfied by a phantom team, so a genuinely single-team org gets an "available" benchmark it should not.
- **Fix sketch**: Gate the seed behind a demo flag (e.g. only when `KP_SEED_DEMO`/non-production), or put the benchmark fixtures under a dedicated `org-benchmark-demo` org so a real org's aggregate never includes them.

## 3. Test DB isolation depends on unenforced import order — a mis-ordered import mutates the developer's real `data/kp.sqlite`

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: latent-failure / data-loss
- **File**: `app/_lib/testing/unit-db.ts:1-13,74-77`; `app/_lib/db-path.ts:22-24`
- **Scenario**: A unit/route test file imports any db-touching module (or a barrel that transitively pulls `db-path.ts`) BEFORE it imports `testing/unit-db.ts`. The test then runs seeders/writes/`INSERT OR REPLACE` reseeds against the wrong file.
- **Root cause**: `DB_PATH` is frozen at `db-path.ts` module-evaluation time from `process.env.KP_DB_PATH`; `unit-db.ts` sets that env var, but only at ITS module load. ESM evaluates imports in source order, so a single earlier import evaluates `db-path.ts` with `KP_DB_PATH` unset → `DB_PATH` resolves to `<cwd>/data/kp.sqlite`, the real dev database. Nothing fails loudly; the test just seeds/overwrites real data. The module documents this as "IMPORT ORDER IS LOAD-BEARING" but there is no runtime guard.
- **Impact**: A refactor that reorders imports (or a new test that forgets the first-import rule) silently corrupts or reseeds a developer's real DB, with `INSERT OR REPLACE` seeders overwriting hand-entered rows.
- **Fix sketch**: In `openStore()`/`DB_PATH`, when a test signal is present (`NODE_ENV==='test'`, `process.env.VITEST`, or a `--test` marker) and the resolved path is the default `data/kp.sqlite`, throw. Makes "test wrote the real DB" impossible instead of order-dependent.

## 4. `pg-portability` audit under-reports SQLite-isms and is wired to nothing — false migration confidence

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure / validation-gap
- **File**: `app/_lib/db/pg-portability.ts:24-61`; missed construct at `app/_lib/db/core.ts:1197`
- **Scenario**: The eventual Postgres migration trusts this "living checklist" (its own header says the audit "confirms the DIALECT surface is small") to know exactly what to touch.
- **Root cause**: `RULES` has only 6 patterns (AUTOINCREMENT, INSERT OR IGNORE/REPLACE, ON CONFLICT, PRAGMA, `.transaction(`). It has NO rule for `rowid` — yet `prunePromptCache` runs `WHERE rowid IN (SELECT rowid FROM gemini_cache …)`, which Postgres has no equivalent for — nor for SQLite JSON functions, `datetime`/`strftime`, `WITHOUT ROWID`, or `INTEGER`-as-boolean. It also only scans `.ts` under one root and (per its only caller being `pg-portability.test.ts`) is never surfaced in any report/route, so nobody actually sees its output.
- **Impact**: The migration it exists to de-risk would hit `rowid`/JSON-function walls the checklist declared clean. No runtime effect today.
- **Fix sketch**: Add rules for `rowid`, SQLite JSON funcs, `strftime/datetime`, `WITHOUT ROWID`; assert in the test that known SQLite-isms (the `rowid` line) appear, so a missed pattern fails CI rather than passing silently.

## 5. `unit-db` stale-sweep can delete a still-running test's database directory

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: race-condition (test infra)
- **File**: `app/_lib/testing/unit-db.ts:58-69`
- **Scenario**: Two `node --test` files run concurrently; file A's run has been active > 15 min (a slow/heavy suite). File B starts, runs the sweep, and `rmSync(dir, {recursive,force})`s A's run dir mid-test.
- **Root cause**: The sweep gates on the run DIRECTORY's mtime (`STALE_MS = 15min`). Directory mtime bumps on entry create/delete/rename, not on content writes to an existing file — so a long test that created its `kp.sqlite`/`-wal` early and thereafter only writes to them has a stale dir mtime while very much alive. The guard's assumption ("a sibling running now has a fresh mtime") does not hold for write-only activity.
- **Impact**: On POSIX the open SQLite file is unlinked out from under the running test → corruption/flake; narrow window (needs a >15-min sibling), so low.
- **Fix sketch**: Gate on a liveness marker the running process `touch`es on an interval (or a lockfile with an open handle), not directory mtime; or widen `STALE_MS` well past the longest suite and never sweep a dir whose lock is held.
