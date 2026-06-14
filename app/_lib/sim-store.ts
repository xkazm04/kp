import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { SIM_MARKER } from "@/app/features/simulation/constants";

// Pipeline simulation — reset helper. Isolated connection (job-ingest/offers
// pattern; avoids the fork-churned db.ts) that clears every artifact a sim run
// created, identified by the "(SIM)" marker in the title, so the demo is cleanly
// re-runnable. WAL-safe alongside db.ts's own connection.

// The "what counts as a sim artifact" contract is the ONE marker in
// simulation/constants.ts; build the SQL LIKE pattern from it so the two files
// can't drift (a drifted marker would silently leave sim rows behind — or, worse,
// a real job a user happened to title "(SIM)" would match). `(SIM)` has no LIKE
// wildcards, so it needs no escaping; the % are the only special chars here.
const MARKER = `%${SIM_MARKER}%`;

// resetSim runs destructive DELETEs, so its catches must NOT swallow real SQL
// failures (which would let reset report success while leaving rows behind). The
// only tolerable error is a table that hasn't been created yet on a cold DB
// (offers/jds are made lazily by offers-store / db.ts); everything else re-throws.
function isNoSuchTable(err: unknown): boolean {
  return err instanceof Error && /no such table/i.test(err.message);
}

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  // Isolated connection on the shared kp.sqlite file (WAL + busy_timeout=5000):
  // resetSim runs a multi-statement DELETE transaction while db.ts / offers-store
  // may be mid-write; without the wait a concurrent writer makes the transaction
  // throw SQLITE_BUSY instantly — 500ing the reset and leaving sim rows behind (a
  // dirty next run). Wait briefly instead of crashing (mirrors offers-store).
  const d = openStore();
  _db = d;
  return d;
}

export function resetSim(): { entries: number; offers: number; jobs: number; jds: number } {
  const d = db();
  const ids = (d.prepare(`SELECT id FROM pipeline_entries WHERE job_title LIKE ?`).all(MARKER) as { id: string }[]).map(
    (r) => r.id
  );

  const tx = d.transaction(() => {
    let offers = 0;
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      try {
        offers = d.prepare(`DELETE FROM offers WHERE entry_id IN (${placeholders})`).run(...ids).changes;
      } catch (err) {
        if (!isNoSuchTable(err)) throw err; // tolerate only a not-yet-created table
      }
      d.prepare(`DELETE FROM pipeline_events WHERE entry_id IN (${placeholders})`).run(...ids);
    }
    const entries = d.prepare(`DELETE FROM pipeline_entries WHERE job_title LIKE ?`).run(MARKER).changes;
    const jobs = d.prepare(`DELETE FROM jobs WHERE title LIKE ?`).run(MARKER).changes;
    let jds = 0;
    try {
      jds = d.prepare(`DELETE FROM jds WHERE title LIKE ?`).run(MARKER).changes;
    } catch (err) {
      if (!isNoSuchTable(err)) throw err; // tolerate only a not-yet-created table
    }
    return { entries, offers, jobs, jds };
  });

  return tx();
}
