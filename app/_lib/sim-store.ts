import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

// Pipeline simulation — reset helper. Isolated connection (job-ingest/offers
// pattern; avoids the fork-churned db.ts) that clears every artifact a sim run
// created, identified by the "(SIM)" marker in the title, so the demo is cleanly
// re-runnable. WAL-safe alongside db.ts's own connection.

const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");
const MARKER = "%(SIM)%";

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
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
      } catch {
        /* offers table may not exist yet */
      }
      d.prepare(`DELETE FROM pipeline_events WHERE entry_id IN (${placeholders})`).run(...ids);
    }
    const entries = d.prepare(`DELETE FROM pipeline_entries WHERE job_title LIKE ?`).run(MARKER).changes;
    const jobs = d.prepare(`DELETE FROM jobs WHERE title LIKE ?`).run(MARKER).changes;
    let jds = 0;
    try {
      jds = d.prepare(`DELETE FROM jds WHERE title LIKE ?`).run(MARKER).changes;
    } catch {
      /* jds table shape may differ */
    }
    return { entries, offers, jobs, jds };
  });

  return tx();
}
