import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

// Single source of truth for the SQLite file location. db.ts and every
// isolated-connection store (offers-store, schedule-store, scheduler-store, …)
// open THIS path. The same expression was previously copy-pasted into a dozen
// modules, so an env-var rename or a relocation had to be repeated in every one —
// miss a copy and that module silently opens a different file. Resolve it once.
// (pipeline/jobfit/seed_interview_calendar.py recomputes the same default in
// Python; keep the two defaults in sync.)
//
// PORTABILITY: the default is <cwd>/data/kp.sqlite. process.cwd() is the directory the
// Node process was LAUNCHED from — the project root for `next dev` / `next start`, but
// a PM2/systemd unit, a cron-launched route, or a standalone build can run from a
// DIFFERENT cwd and silently open another (empty) kp.sqlite while the real one sits
// elsewhere — the classic "why is my data gone after deploy?" trap. A module-location
// anchor (import.meta.dirname) is NOT reliable under Next's server bundling, so the
// robust mechanism is the explicit KP_DB_PATH override: set it to an ABSOLUTE path in
// every deploy and cron unit. We resolve to absolute here (a relative KP_DB_PATH is
// itself cwd-relative) and warn once in production when the override is unset.
/** The default SQLite location when KP_DB_PATH is unset: <cwd>/data/kp.sqlite — a real
 *  developer's DB. Named so the test-isolation guard (openStore) can recognise when a
 *  test resolved to it. */
export const DEFAULT_DB_PATH = path.resolve(process.cwd(), "data", "kp.sqlite");

export const DB_PATH = process.env.KP_DB_PATH ? path.resolve(process.env.KP_DB_PATH) : DEFAULT_DB_PATH;

/** True when this process is a `node --test` run: the isolated child sets
 *  NODE_TEST_CONTEXT, and the runner/children carry --test* flags in execArgv. Kept as a
 *  cheap best-effort signal — it only gates the DB-isolation guard below, which is inert
 *  in production regardless. (bug-ui-scan-2026-07-09 data-store-persistence #3) */
function inTestRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    Boolean(env.NODE_TEST_CONTEXT) ||
    env.NODE_ENV === "test" ||
    Boolean(env.VITEST) ||
    process.execArgv.some((a) => a === "--test" || a.startsWith("--test-"))
  );
}

/** bug-ui-scan-2026-07-09 (data-store-persistence #3): test DB isolation used to hinge on
 *  unenforced import order — a db-touching import evaluated BEFORE testing/unit-db.ts would
 *  freeze DB_PATH to the real data/kp.sqlite (KP_DB_PATH still unset), and the test then
 *  silently seeded/`INSERT OR REPLACE`-overwrote the developer's DB. Make it impossible: in
 *  a test run the connection MUST resolve to an isolated temp KP_DB_PATH that MATCHES the
 *  frozen DB_PATH. A default path (forgot to import unit-db) OR an env/const mismatch (a
 *  KP_DB_PATH set AFTER db-path.ts froze — the mis-ordered-import signature) throws loudly
 *  instead. No-op outside a test run, so production/dev servers are unaffected. */
function assertTestDbIsolated(): void {
  if (!inTestRun()) return;
  const envPath = process.env.KP_DB_PATH ? path.resolve(process.env.KP_DB_PATH) : "";
  if (!envPath || envPath !== DB_PATH || DB_PATH === DEFAULT_DB_PATH) {
    throw new Error(
      `[db] refusing to open the database in a test run without an isolated KP_DB_PATH ` +
        `(bug-ui-scan-2026-07-09 data-store-persistence #3). Resolved DB_PATH=${DB_PATH}; ` +
        `KP_DB_PATH=${process.env.KP_DB_PATH ?? "<unset>"}. Import "app/_lib/testing/unit-db.ts" ` +
        `as the FIRST project import so it sets KP_DB_PATH before db-path.ts freezes DB_PATH — ` +
        `otherwise the test would read/overwrite the real data/kp.sqlite.`
    );
  }
}

let _warnedDefaultDbPath = false;
function warnIfDefaultDbPath(): void {
  if (_warnedDefaultDbPath || process.env.KP_DB_PATH || process.env.NODE_ENV !== "production") return;
  _warnedDefaultDbPath = true;
  console.warn(
    `[db] KP_DB_PATH is not set — using ${DB_PATH} (derived from the launch directory). ` +
      "A launch from a different working directory (PM2 / systemd / cron / standalone build) " +
      "will open a DIFFERENT, empty database. Set KP_DB_PATH to an absolute path in every deploy/cron unit."
  );
}

export type DbBackend = "sqlite";

/**
 * The configured database backend (E-SH-3). Only `sqlite` is implemented today —
 * and every connection in the app opens through `openStore()` below, which is the
 * single seam a future Postgres adapter slots into. A Postgres backend (needed for
 * multi-replica HA, not for KP's 1–2-users-per-team concurrency, which SQLite+WAL
 * already handles) is DESIGNED but unbuilt: the blocker is that better-sqlite3 is
 * synchronous while Node's Postgres drivers are async, so the ~500 sync query sites
 * can't just swap drivers. The full plan + options live in docs/architecture/postgres-backend.md.
 *
 * We still parse `KP_DB_BACKEND` / a `postgres://` `DATABASE_URL` and FAIL FAST with
 * a pointer, rather than silently ignoring them — so an operator who configures
 * Postgres learns immediately it isn't wired yet, instead of the app quietly running
 * on a local SQLite file they didn't intend to use in production.
 */
export function resolveDbBackend(env: NodeJS.ProcessEnv = process.env): DbBackend {
  // Test runs always use SQLite — assertTestDbIsolated() enforces the correct path.
  // Skipping the postgres fail-fast here so DATABASE_URL in the environment (e.g. a
  // Supabase connection string used by other tools, or a CI env that happens to carry
  // the production URL) does not break every test that touches the DB.
  if (inTestRun(env)) return "sqlite";
  const explicit = env.KP_DB_BACKEND?.trim().toLowerCase() || "";
  const url = env.DATABASE_URL?.trim() || "";
  const wantsPostgres = explicit === "postgres" || explicit === "postgresql" || /^postgres(ql)?:\/\//i.test(url);
  if (wantsPostgres) {
    throw new Error(
      "Postgres backend is configured (KP_DB_BACKEND / DATABASE_URL) but is NOT yet " +
        "implemented — KP runs on SQLite today. The Postgres migration is designed in " +
        "docs/architecture/postgres-backend.md (blocked on the sync→async DB refactor). Unset those " +
        "variables or set KP_DB_BACKEND=sqlite to proceed."
    );
  }
  if (explicit && explicit !== "sqlite") {
    throw new Error(
      `Unknown KP_DB_BACKEND '${explicit}' — the only supported backend is 'sqlite' ` +
        "(see docs/architecture/postgres-backend.md for the Postgres roadmap)."
    );
  }
  return "sqlite";
}

/** Ensure the directory holding the SQLite file exists before a connection opens
 *  it (the stores call this in their lazy initializer, mirroring db.ts). */
export function ensureDbDir(): void {
  warnIfDefaultDbPath();
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

/** Open a fresh better-sqlite3 connection on DB_PATH with the canonical isolated-
 *  store pragmas: WAL (so this second connection safely shares the file with
 *  db.ts and every sibling store) + busy_timeout=5000 (so a concurrent writer
 *  waits briefly instead of instantly throwing SQLITE_BUSY) + foreign_keys=ON.
 *
 *  SQLite defaults foreign_keys=OFF PER CONNECTION, and it was never enabled here,
 *  so referential integrity was unenforced everywhere (a child row could point at a
 *  vanished parent, and a bad id could be inserted freely). Enabling it is the
 *  correct, standard default and the prerequisite for ANY FK to be enforced — note
 *  the schema does not yet declare REFERENCES clauses, so this is a no-op behavioral
 *  change today, but it means the moment a relation is declared (or migrated in) it
 *  is enforced rather than silently ignored. Declaring REFERENCES across the existing
 *  tables is a separate per-table migration (SQLite can't ALTER ADD CONSTRAINT); the
 *  GDPR path anonymizes-in-place rather than deleting, so it doesn't strand orphans
 *  today regardless. ensureDb() (the main app connection) opens through here too; the
 *  dump/load export handles deliberately manage their own pragmas and are unaffected.
 *
 *  This open+pragma wrapper was copy-pasted verbatim into ~12 isolated-connection
 *  stores; resolve it once here, beside DB_PATH/ensureDbDir. Callers keep their own
 *  memoization and run their own CREATE/migration DDL on the returned handle. */
export function openStore(): Database.Database {
  // Fail LOUD before touching disk if a test run would open the real dev DB
  // (bug-ui-scan-2026-07-09 data-store-persistence #3). Inert in production.
  assertTestDbIsolated();
  // Single backend chokepoint: every connection (ensureDb + all ~18 stores) opens
  // here, so a postgres/unknown backend fails fast with a pointer at the roadmap
  // rather than silently opening SQLite.
  resolveDbBackend();
  ensureDbDir();
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  // Pin durability EXPLICITLY rather than inheriting an ambiguous compile/file default.
  // NORMAL is the SQLite-recommended setting for WAL: no corruption ever, and durable
  // across an APPLICATION crash (a kill / dev hot-restart leaves the -wal intact); only
  // an OS crash / power loss between commit and checkpoint can drop the last few
  // transactions. The boot wal_checkpoint(TRUNCATE) (db/core.ts) bounds -wal growth.
  d.pragma("synchronous = NORMAL");
  d.pragma("busy_timeout = 5000");
  d.pragma("foreign_keys = ON");
  return d;
}
