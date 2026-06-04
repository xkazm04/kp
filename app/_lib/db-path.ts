import path from "node:path";
import { mkdirSync } from "node:fs";

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
