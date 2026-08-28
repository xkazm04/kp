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

**The SQL itself is largely portable** (run `npm run db:pg-audit` for the live list):
no `strftime` / `json_extract` / `rowid` / `PRAGMA`-in-queries. The whole dialect
surface is ~11 `AUTOINCREMENT`, ~26 `ON CONFLICT`, ~13 `INSERT OR IGNORE/REPLACE` —
mechanical tweaks (`AUTOINCREMENT` → `IDENTITY`, `INSERT OR IGNORE` → `ON CONFLICT DO
NOTHING`). The audit test (`app/_lib/db/pg-portability.ts` + its test) fails if a NEW
un-portable construct creeps in, so this surface stays small and known.

## 2. Do we even need Postgres? (the honest question)

| Concern | Does SQLite+WAL handle it? |
|---|---|
| Concurrent readers | Yes — WAL allows many readers during a write. |
| Concurrent writers, 1–2 users/team | Yes — writers serialize; `busy_timeout=5000` waits briefly. KP's stated scale. |
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
