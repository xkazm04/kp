import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { SIM_TITLE_LIKE } from "@/app/features/simulation/constants";

// Pipeline simulation — reset helper. Isolated connection (job-ingest/offers
// pattern; avoids the fork-churned db.ts) that clears every artifact a sim run
// created, identified by the "(SIM)" marker in the title, so the demo is cleanly
// re-runnable. WAL-safe alongside db.ts's own connection.

// The "what counts as a sim artifact" contract is the ONE marker in
// simulation/constants.ts; SIM_TITLE_LIKE is the shared SQL pattern derived from
// it (also used by the analytics read-side filter), so the writer, this purge and
// every aggregate filter can't drift (a drifted marker would silently leave sim
// rows behind — or, worse, a real job a user happened to title "(SIM)" would
// match). `(SIM)` has no LIKE wildcards, so it needs no escaping.
const MARKER = SIM_TITLE_LIKE;

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

export function resetSim(workspaceId: string = DEFAULT_WORKSPACE_ID): { entries: number; offers: number; jobs: number; jds: number } {
  const d = db();
  const ids = (d.prepare(`SELECT id FROM pipeline_entries WHERE job_title LIKE ? AND workspace_id = ?`).all(MARKER, workspaceId) as { id: string }[]).map(
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
      d.prepare(`DELETE FROM pipeline_events WHERE entry_id IN (${placeholders}) AND workspace_id = ?`).run(...ids, workspaceId);
    }
    const entries = d.prepare(`DELETE FROM pipeline_entries WHERE job_title LIKE ? AND workspace_id = ?`).run(MARKER, workspaceId).changes;
    // bug-ui-scan-2026-07-09 (guided-pipeline-simulation #2): scope the jobs/jds
    // purge by workspace_id too. Previously these were workspace-UNSCOPED, so ANY
    // caller's reset (an operator's, or a demo session's auto-reset at run start)
    // reached across the shared jobs/jds tables and destroyed another tenant's
    // (SIM) rows. The sim's JD/job are ingested under the caller's currentWorkspace()
    // (jds/save threads it), so scoping here purges exactly the caller's tenant.
    const jobs = d.prepare(`DELETE FROM jobs WHERE title LIKE ? AND workspace_id = ?`).run(MARKER, workspaceId).changes;
    let jds = 0;
    try {
      jds = d.prepare(`DELETE FROM jds WHERE title LIKE ? AND workspace_id = ?`).run(MARKER, workspaceId).changes;
    } catch (err) {
      if (!isNoSuchTable(err)) throw err; // tolerate only a not-yet-created table
    }
    return { entries, offers, jobs, jds };
  });

  return tx();
}
