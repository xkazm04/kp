import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

// Single source of truth for the SQLite file location. db.ts and every
// isolated-connection store (offers-store, schedule-store, scheduler-store, …)
// open THIS path. The same `process.env.KP_DB_PATH ?? path.join(process.cwd(),
// "data", "kp.sqlite")` expression was previously copy-pasted into a dozen
// modules, so an env-var rename or a relocation had to be repeated in every one —
// miss a copy and that module silently opens a different file. Resolve it once.
// (pipeline/jobfit/seed_interview_calendar.py recomputes the same default in
// Python; keep the two defaults in sync.)
export const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

/** Ensure the directory holding the SQLite file exists before a connection opens
 *  it (the stores call this in their lazy initializer, mirroring db.ts). */
export function ensureDbDir(): void {
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
