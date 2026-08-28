import type Database from "better-sqlite3";

// Bookkeeping for the ONE-SHOT fixture seeders: which of them have already run against
// this database. See the seed_marks DDL in core.ts for the table itself.
//
// Why this exists rather than the `SELECT COUNT(*) ... if (n > 0) return` gate it replaced:
// a row count cannot distinguish "this seeder has never run" from "it ran, and the operator
// has since legitimately emptied the table". So a self-hosted recruiter who archived every
// job got the whole ČS demo corpus injected back on the next boot — silent, timer-driven,
// into a table they had deliberately cleared. seedExampleJd sidestepped it by checking for
// its own known slug, but per-seeder identity checks only move the problem: delete the
// seeded rows and it still reads as "never seeded". Whether a seeder has run is a fact
// about the DATABASE, so record it as one.
//
// Lives in its own module so seed-benchmark-team.ts can use it too — core.ts imports that
// seeder, so it cannot import back out of core.ts.

/** Has this one-shot seeder already run against this database? */
export function seedAlreadyRan(db: Database.Database, name: string): boolean {
  return db.prepare(`SELECT 1 FROM seed_marks WHERE name = ?`).get(name) !== undefined;
}

/** Record that a one-shot seeder has run. INSERT OR IGNORE so a double boot or a race can
 *  never turn bookkeeping into a boot failure. */
export function markSeedRan(db: Database.Database, name: string): void {
  db.prepare(`INSERT OR IGNORE INTO seed_marks (name, applied_at) VALUES (?, ?)`).run(name, new Date().toISOString());
}

/** Back-compat adoption for a database seeded before seed_marks existed: if the seeder's
 *  table already holds rows, stamp the mark instead of seeding. The count is the SAME one
 *  each seeder used to gate on, so this boot's judgment is identical to the behaviour being
 *  replaced — a DB that would have skipped seeding still skips it — and from the next boot
 *  on the mark governs and the count is never consulted again. Returns true when the seeder
 *  should stop here. */
export function adoptedExistingSeed(db: Database.Database, name: string, existingRows: number): boolean {
  if (existingRows <= 0) return false;
  markSeedRan(db, name);
  return true;
}
