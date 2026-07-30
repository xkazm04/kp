> **Archived 2026-07-30.** Superseded by `docs/architecture/postgres-backend.md`
> (rewritten + verified against code). Kept here for the decision-record history.

# Postgres backend — design, decision & migration plan

_Enterprise readiness E-SH-3 (docs/ENTERPRISE_READINESS.md §5). This is the plan and
the decision record for moving KP's storage off a single SQLite file. It is
**analysis + a seam**, not a shipped migration — the migration itself is a dedicated
multi-week effort, and this doc says why, what it takes, and what to do first._

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

**The SQL itself is largely portable** (run `npm run db:pg-audit` for the live list):
no `strftime` / `json_extract` / `rowid` / `PRAGMA`-in-queries. The whole dialect
surface is ~11 `AUTOINCREMENT`, ~26 `ON CONFLICT`, ~13 `INSERT OR IGNORE/REPLACE` —
mechanical tweaks (`AUTOINCREMENT` → `IDENTITY`, `INSERT OR IGNORE` → `ON CONFLICT DO
NOTHING`). The audit test (`pg-portability.test.ts`) fails if a NEW un-portable
construct creeps in, so this surface stays small and known.

## 2. Do we even need Postgres? (the honest question)

| Concern | Does SQLite+WAL handle it? |
|---|---|
| Concurrent readers | ✅ Yes — WAL allows many readers during a write. |
| Concurrent writers, 1–2 users/team | ✅ Yes — writers serialize; `busy_timeout=5000` waits briefly. KP's stated scale (org plan §3). |
| Durable, backed-up, one-file ops | ✅ Yes — copy one file (docs/SELF_HOSTING.md §4). |
| **Multiple app replicas / HA** | ❌ **No** — SQLite is a local file; you can't run 2+ Node instances against it. |
| Managed DB + a customer's DBA tooling | ❌ Not with plain SQLite. |

So the driver is **multi-replica HA** and **"our DBA runs Postgres"** procurement
mandates — both later on the enterprise-adoption curve than SSO / audit / branding.
Don't pay the migration cost until one of those is a real, blocking requirement.

## 3. The seam (what already exists)

Every connection in the app — `ensureDb()` and all ~18 isolated stores — opens
through **one function**: `openStore()` in `app/_lib/db-path.ts`. That is the single
place a backend adapter slots into. This increment adds `resolveDbBackend()` there:

- `KP_DB_BACKEND` (default `sqlite`) and a `postgres://` `DATABASE_URL` are parsed.
- Anything but SQLite **fails fast** with a pointer here — so an operator who
  configures Postgres learns immediately it isn't wired, instead of the app silently
  running on a local SQLite file they didn't intend for production.

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

### Option C — Distributed SQLite (evaluate FIRST) ⭐
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
   already documented (SELF_HOSTING.md). No action.
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
`docs/ORGANIZATION_MULTIUSER_PLAN.md` §2.3 — reconcile before multi-tenant + Postgres.)

## 8. See also
- `app/_lib/db-path.ts` — the single connection seam (`openStore`, `resolveDbBackend`).
- `app/_lib/db/pg-portability.ts` + `npm run db:pg-audit` — the living dialect audit.
- `docs/SELF_HOSTING.md` §4 — the current SQLite data-layer + backups.
- `docs/ORGANIZATION_MULTIUSER_PLAN.md` — tenancy scoping (interacts with any backend).
- `docs/ENTERPRISE_READINESS.md` §5 — where E-SH-3 sits in the roadmap.
