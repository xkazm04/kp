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
export const DB_PATH = process.env.KP_DB_PATH
  ? path.resolve(process.env.KP_DB_PATH)
  : path.resolve(process.cwd(), "data", "kp.sqlite");

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
 * can't just swap drivers. The full plan + options live in docs/POSTGRES_BACKEND.md.
 *
 * We still parse `KP_DB_BACKEND` / a `postgres://` `DATABASE_URL` and FAIL FAST with
 * a pointer, rather than silently ignoring them — so an operator who configures
 * Postgres learns immediately it isn't wired yet, instead of the app quietly running
 * on a local SQLite file they didn't intend to use in production.
 */
export function resolveDbBackend(env: NodeJS.ProcessEnv = process.env): DbBackend {
  const explicit = env.KP_DB_BACKEND?.trim().toLowerCase() || "";
  const url = env.DATABASE_URL?.trim() || "";
  const wantsPostgres = explicit === "postgres" || explicit === "postgresql" || /^postgres(ql)?:\/\//i.test(url);
  if (wantsPostgres) {
    throw new Error(
      "Postgres backend is configured (KP_DB_BACKEND / DATABASE_URL) but is NOT yet " +
        "implemented — KP runs on SQLite today. The Postgres migration is designed in " +
        "docs/POSTGRES_BACKEND.md (blocked on the sync→async DB refactor). Unset those " +
        "variables or set KP_DB_BACKEND=sqlite to proceed."
    );
  }
  if (explicit && explicit !== "sqlite") {
    throw new Error(
      `Unknown KP_DB_BACKEND '${explicit}' — the only supported backend is 'sqlite' ` +
        "(see docs/POSTGRES_BACKEND.md for the Postgres roadmap)."
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
