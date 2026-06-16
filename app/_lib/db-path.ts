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
 *  waits briefly instead of instantly throwing SQLITE_BUSY). This open+pragma
 *  wrapper was copy-pasted verbatim into ~12 isolated-connection stores; resolve
 *  it once here, beside DB_PATH/ensureDbDir. Callers keep their own memoization
 *  and run their own CREATE/migration DDL on the returned handle. Stores that
 *  intentionally use a DIFFERENT pragma set (e.g. WAL-only, or a readonly export
 *  handle) deliberately do NOT use this. */
export function openStore(): Database.Database {
  ensureDbDir();
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.pragma("busy_timeout = 5000");
  return d;
}
