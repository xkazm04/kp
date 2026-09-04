# Postgres backend — design, decision & migration plan

_Enterprise readiness E-SH-3 (`docs/product/enterprise-readiness.md` §5). This is
the plan and the decision record for moving KP's storage off a single SQLite
file. It is **analysis + a seam**, not a shipped migration — the migration itself
is a dedicated multi-week effort, and this doc says why, what it takes, and what
to do first._

> **TL;DR.** SQLite + WAL already handles KP's concurrency (1–2 users per team). The
> only real reason to leave it is **multi-replica HA** — running 2+ app instances
> against one database, which a local file can't do. Before committing to a Postgres
> port (a large sync→async refactor), **evaluate distributed-SQLite** (LiteFS / Turso /
> libSQL) — it may deliver multi-replica while preserving the entire synchronous data
> layer. Pursue a true Postgres port only when a customer specifically mandates it.

---

## 1. Why this is not a one-PR change

The data layer is **512 synchronous query sites across ~48 files**, plus **16 files
using synchronous transactions**, all on `better-sqlite3`:

```ts
const row = db.prepare("SELECT … WHERE id = ?").get(id);      // sync
db.prepare("INSERT …").run(a, b);                              // sync
db.transaction(() => { … })();                                 // sync
```

`better-sqlite3` is **synchronous** by design (native, blocking). **Node's Postgres
drivers (`pg`, `postgres.js`) are asynchronous** — there is no production-grade
synchronous Postgres driver. So you cannot "swap the driver": every one of those 512
sites becomes `await`, and `await` is contagious — every function that calls them
becomes `async`, cascading up through the stores, the `_lib` services, and into the
route handlers. That cascade, not the SQL, is the cost. It is realistically the
single largest refactor in the codebase.

The synchrony is now **enforced, not just assumed**: `no-restricted-syntax` in
`eslint.config.mjs` fails the build on an `await` (or an async callback) inside a
`db.transaction(...)`, because on better-sqlite3 that silently forfeits atomicity
between BEGIN and COMMIT with no error and no failing test. The rule shipped clean —
zero violations across the 34 transaction call sites — which is a useful datum for
this document: nothing in the codebase currently *wants* to await inside a
transaction, so the port does not have to untangle one. Whichever adapter wins below
has to keep that property, and a port that makes `transaction()` genuinely async must
re-derive the isolation level of every call site by hand: only 9 of the 34 use
`.immediate()` today, and several of the rest are safe purely because a compensating
`WHERE` precondition makes a lost race a no-op.

### The decode seam

`db/core.ts` carries the seam where an untyped JSON column becomes a typed value:
`readRowColumn()` returns `absent | ok | unreadable{corrupt|invalid}`, and `safeRowParse()` is a
back-compat wrapper collapsing the last two to `null` for its ~76 existing callers. A validator is
optional and zod-shaped but structurally typed, so `core.ts` imports neither zod nor the generated
schemas — the data layer keeps its dependency direction.

Two properties a port must preserve, because they are contracts rather than conveniences:

- **`absent` and `unreadable` are different answers.** A NULL column and an undecodable one must not
  collapse for a by-identity read; reporting a corrupt row as "not found" invites the caller to
  recreate it, and then the identity exists twice.
- **Nothing is skipped silently.** Every unreadable column is recorded — context, row id, reason —
  in a bounded ledger surfaced by `getRowHealth()`, the sibling of `getSeedHealth()`. This is the one
  layer that sees every row, so it is the only place read-health can be measured at all.

Validation runs in `enforce` (a mismatch makes the column unreadable) or `observe` (the mismatch is
recorded and the value still returned) — the posture for switching validation on over a table that
already holds nonconforming rows. `analyses.payload_json` is in `observe` today for a measured
reason: 50 of 121 stored analyses fail `analysisResultSchema` because the CV-analysis writer omits
`keywordCoverage.hits[].status`.

Two boot-path details a port inherits from `db/core.ts`: the PK-widening rebuilds
(`channel_spend`, `analytics_targets`, `billing_usage`) exist only because SQLite
cannot `ALTER` a PRIMARY KEY — Postgres can, so they become no-ops rather than
translations — and they now run through a `rebuildTable` helper that drops the scratch
table and wraps the swap in a transaction, since the unguarded version could wedge boot
after an interrupted migration.

A third: the boot DDL is deliberately loud. Every `ALTER`/`CREATE` runs through
`migrateExec`, which tolerates ONLY the benign "already applied" error and re-throws the
rest — and, since wave 40, so do the nine per-tenant scan indexes (previously one bare
`catch` wrapped all nine, so a single unexpected failure silently skipped the remaining
eight) and the four UNIQUE indexes, which now go through `migrateUniqueIndex`: it tolerates
`SQLITE_CONSTRAINT_UNIQUE` — a legacy DB whose existing rows block the constraint, where
the app-level read-then-insert coalescing stays the guarantee — logs which index was
skipped and why, and re-throws everything else. A port keeps that split: the "duplicate
rows already exist" case is real on Postgres too (`CREATE UNIQUE INDEX` raises
`unique_violation`), a locked or broken database is not something to boot past.

And a fourth, at the other end of boot: `runBootMaintenance()` (exported from `db/core.ts`,
pinned by `app/_lib/db/core-boot-tail.test.ts`) prunes expired prompt-cache rows and runs
`wal_checkpoint(TRUNCATE)`. Both reclaim SPACE, not correctness, so both are best-effort —
a failure is logged and survived, never allowed to wedge a boot that would otherwise serve.
On Postgres the checkpoint half disappears entirely (no WAL sidecar to fold back; autovacuum
owns the equivalent), while the prune must stay: nothing else bounds `gemini_cache`, because
`lookupPromptCache` skips expired rows without deleting them. Fixture seeding runs BEFORE
the PK rebuilds and the `workspace_id`/`org_id` backfills, and that order is load-bearing —
the backfills are written as heals over "whatever rows exist", which is what makes them
order-independent; the same test pins it. `KP_EMPTY=1` (`npm run dev:empty`) skips every
fixture seeder while still creating the schema, the default workspace and the default org,
and leaves `onboarding_state` NULL so the first-run wizard fires
(`app/_lib/db/core-empty-boot.test.ts`).

**The SQL itself is largely portable** (run `npm run db:pg-audit` for the live list):
no `strftime` / `json_extract`, and `PRAGMA` appears in connection setup rather than in
queries. The whole dialect surface is ~11 `AUTOINCREMENT`, ~26 `ON CONFLICT`, ~13
`INSERT OR IGNORE/REPLACE` — mechanical tweaks (`AUTOINCREMENT` → `IDENTITY`,
`INSERT OR IGNORE` → `ON CONFLICT DO NOTHING`) — plus two constructs with no mechanical
equivalent: `prunePromptCache`'s `WHERE rowid IN (…)` (Postgres has no implicit rowid) and
`scripts/db-dump.mjs`'s `pragma_table_info()` schema introspection (Postgres answers that
from `information_schema` / `pg_catalog`).

**What the audit scans** is `auditRoots()` in `app/_lib/db/pg-portability.ts`: `app/_lib`
**plus** `scripts/db-dump.mjs` and `scripts/db-load.mjs`. Those two were outside the audit
until wave 40, which understated the surface: they are the operator's backup/restore path
(`releases.md` §Going back), they hold their own SQL and pragmas, and `db-load` wraps the
entire restore in a synchronous `db.transaction()` — the sync→async blocker again, outside
the app. A port that migrated every app store but left the dump/load tooling speaking
SQLite is discovered on the day someone tries to restore a backup. The audit test
(`app/_lib/db/pg-portability.test.ts`) fails if a NEW un-portable construct creeps in, and
pins the roots so the scripts cannot silently fall out of scope again.

## 2. Do we even need Postgres? (the honest question)

| Concern | Does SQLite+WAL handle it? |
|---|---|
| Concurrent readers | Yes — WAL allows many readers during a write. |
| Concurrent writers, 1–2 users/team | Yes — writers serialize; `busy_timeout=5000` waits briefly. KP's stated scale. Basis: **measured 2026-08-30**, `scripts/perf/sqlite-writer-knee.mjs` (the repo's real pragmas, single-row transactions, N=1..5 worker connections, 1000 commits each, dev Windows/NVMe): p95 commit latency stays ~0.1–0.16 ms through N=5 with **zero** SQLITE_BUSY; only the worst-case tail grows (~10 ms at N=1 → ~110–140 ms at N=4–5). So a third writer does NOT degrade the typical commit — the stated 1–2 ceiling has measured headroom for the dominant small-commit shape, and the thing to re-measure if write shapes grow (bulk imports, long transactions) is that tail. Re-run the script and update this line when pragmas or write shapes change. |
| Durable, backed-up, one-file ops | Yes — copy one file (`docs/architecture/self-hosting.md` §4). |
| **Multiple app replicas / HA** | **No** — SQLite is a local file; you can't run 2+ Node instances against it. |
| Managed DB + a customer's DBA tooling | Not with plain SQLite. |

So the driver is **multi-replica HA** and **"our DBA runs Postgres"** procurement
mandates — both later on the enterprise-adoption curve than SSO / audit / branding.
Don't pay the migration cost until one of those is a real, blocking requirement.

## 3. The seam (what already exists)

Every connection in the app — `ensureDb()` and all ~19 isolated stores (the newest
is `edge-config.ts`, the always-on edge's pairing row) — opens
through **one function**: `openStore()` in `app/_lib/db-path.ts`. That is the single
place a backend adapter slots into. `resolveDbBackend()` lives there:

- `KP_DB_BACKEND` (default `sqlite`) and a `postgres://` `DATABASE_URL` are parsed.
- Anything but SQLite **fails fast** with a pointer here — so an operator who
  configures Postgres learns immediately it isn't wired, instead of the app silently
  running on a local SQLite file they didn't intend for production. Verified in code
  (`app/_lib/db-path.ts:91-106`).

Two SQLite-specific facts a port has to answer for, both documented in
[workspace-data.md](workspace-data.md): boot runs **`PRAGMA quick_check(1)`** once in
`ensureDb()` and refuses to serve on damage (`DB_INTEGRITY_FAILED`) — a Postgres backend
would drop the pragma and get the equivalent from the server's own startup, so the
refusal must move rather than vanish; and `openStore()` sets **`foreign_keys=ON`** per
connection, which Postgres enforces unconditionally. Today **no table declares a
`REFERENCES` clause**, so a port inherits no referential constraints to translate — and
adding them here first would make that translation strictly easier.

That config surface + the single seam are the concrete groundwork; the sections below
are the plan for filling it in.

## 4. The three real options

### Option A — Full async migration to Postgres (`pg`)
Rewrite the data layer async; `pg`/`postgres.js` driver. **Cleanest long-term**,
gives real Postgres (RDS/CloudSQL, HA, replicas, a DBA's tooling). **Cost: L,
multi-week.** Touches every layer up to the route handlers; must land behind a flag
with both backends green in tests during the transition.

### Option B — Sync-over-async Postgres shim
A `PgDatabase` that mimics better-sqlite3's synchronous surface
(`prepare().get()/.all()/.run()`, `transaction()`) by running `pg` on a **worker
thread** and blocking the main thread on `Atomics.wait`. Keeps all 512 call sites
unchanged. **But:** it blocks the event loop on every query (a serious perf regression
for a web server), and needs careful SQL/placeholder (`?`→`$1`) translation, `RETURNING`
handling, and type coercion. Realistic only if profiling shows the blocking is
tolerable at KP's request volume. Bounded to the `db-path.ts` seam, which is its one
virtue.

### Option C — Distributed SQLite (evaluate FIRST)
If the goal is **multi-replica HA** (not "Postgres specifically"), distributed-SQLite
tech may deliver it **without the async rewrite**:
- **LiteFS** (Fly.io) — replicates the SQLite file across nodes (1 primary writer, N
  read replicas); the app keeps using `better-sqlite3` almost unchanged.
- **libSQL / Turso** — a SQLite fork with a network/HTTP server and embedded replicas;
  a near-drop-in client, and its embedded-replica mode keeps local sync reads.
- **rqlite** — a Raft-replicated SQLite over HTTP (async client; heavier change).

LiteFS or a libSQL embedded replica could satisfy multi-replica HA while preserving
the synchronous data layer and almost all 48 files. **This is the recommended first
investigation** — it can make the whole Postgres question moot.

## 5. Recommendation

1. **Single-replica self-host:** stay on SQLite + WAL. It's sufficient, simplest, and
   already documented (`docs/architecture/self-hosting.md`). No action.
2. **Need multi-replica HA:** evaluate **Option C (LiteFS / libSQL/Turso)** before
   anything else — it likely meets the need without the async migration.
3. **A customer hard-requires Postgres** (their compliance/DBA mandates it): pursue
   **Option A**, budgeted as a dedicated multi-week project, per the phasing below.
   Option B only if a spike proves the event-loop blocking acceptable.

## 6. Phased plan (if pursuing Option A)

1. **Freeze the dialect.** Keep SQL to the portable subset; the `pg-portability`
   audit test guards against new SQLite-isms. (Done — this increment.)
2. **Async DB interface.** Define `interface Db { get/all/run/exec/tx }` (async) and a
   SQLite-backed adapter first (wrapping better-sqlite3 or libSQL), landing behind
   `resolveDbBackend()`. No behavior change yet.
3. **Convert call sites** to the interface, layer by layer (stores → `_lib` services →
   routes), each behind its existing tests. This is the long pole.
4. **Add the `pg` adapter** + schema DDL translated to Postgres (audit list §1).
5. **Dual-run** the store/route test suites against both backends in CI; migrate data
   via the existing `db:dump` / `db:load` portability path (`app/_lib/db-portability.ts`).
6. Flip `KP_DB_BACKEND=postgres` for the customers that need it.

## 7. Data migration

The export/import path already exists (`npm run db:dump` / `db:load`,
`app/_lib/db-portability.ts`). A SQLite→Postgres data move reuses it: dump to a
portable JSON, load into the Postgres schema. Schema DDL is translated per the audit
(§1). (Note: the whole-DB export is also flagged for per-tenant scoping in
`docs/features/organization/README.md` §2.3 — reconcile before multi-tenant + Postgres.)

## 8. See also
- `app/_lib/db-path.ts` — the single connection seam (`openStore`, `resolveDbBackend`).
- `app/_lib/db/pg-portability.ts` + `npm run db:pg-audit` — the living dialect audit.
- `docs/architecture/self-hosting.md` §4 — the current SQLite data-layer + backups.
- `docs/features/organization/README.md` — tenancy scoping (interacts with any backend).
- `docs/product/enterprise-readiness.md` §5 — where E-SH-3 sits in the roadmap.
