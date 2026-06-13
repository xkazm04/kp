import Database from "better-sqlite3";
import { DB_PATH, ensureDbDir } from "./db-path";
import { randomId } from "./random-id";

// Standing silver-medalist alerts (idea-fdb45cd0). Isolated-connection store
// (same pattern as application-status-store.ts / offers-store.ts): owns the
// `rediscovery_alerts` table. Rediscovery used to be a button a recruiter had to
// remember to click per role; this persists each "a candidate you rejected from
// Role X clears the bar for new Role Y" hit so it surfaces in a dismissable feed
// the moment it becomes true — on publish, or on a manual pool-change sweep.
//
// A row is keyed UNIQUE on (job_id, candidate_id) so re-running the ranking for
// the same role never accretes duplicates AND never resurrects an alert the
// recruiter already dismissed (INSERT OR IGNORE preserves the existing row,
// dismissed_at and all).

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  ensureDbDir();
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  // The publish/sweep writers interleave with the rest of the app on the same
  // kp.sqlite file — wait briefly rather than throwing SQLITE_BUSY (sibling stores).
  d.pragma("busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS rediscovery_alerts (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      job_title TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      candidate_label TEXT NOT NULL,
      archetype TEXT NOT NULL DEFAULT 'bau',
      score INTEGER NOT NULL,
      prior_kind TEXT NOT NULL,
      prior_label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      dismissed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_rediscovery_alert
      ON rediscovery_alerts(job_id, candidate_id);
  `);
  _db = d;
  return d;
}

export type RediscoveryAlertInput = {
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  prior: { kind: string; label: string };
};

export type RediscoveryAlert = {
  id: string;
  jobId: string;
  jobTitle: string;
  candidateId: string;
  label: string;
  archetype: string;
  score: number;
  prior: { kind: string; label: string };
  createdAt: string;
};

/** Persist a role's rediscovered candidates as standing alerts. INSERT OR IGNORE
 *  on the (job_id, candidate_id) unique index: a candidate already alerted for
 *  this role (active or dismissed) is left untouched, so the feed neither
 *  duplicates nor un-dismisses. Returns the count of genuinely-new alerts (so the
 *  publish/sweep caller can report "3 silver medalists surfaced"). */
export function recordRediscoveryAlerts(
  jobId: string,
  jobTitle: string,
  rows: RediscoveryAlertInput[]
): number {
  if (rows.length === 0) return 0;
  const d = db();
  const now = new Date().toISOString();
  const insert = d.prepare(`
    INSERT OR IGNORE INTO rediscovery_alerts
      (id, job_id, job_title, candidate_id, candidate_label, archetype, score, prior_kind, prior_label, created_at)
    VALUES (@id, @jobId, @jobTitle, @candidateId, @label, @archetype, @score, @priorKind, @priorLabel, @createdAt)
  `);
  const tx = d.transaction((items: RediscoveryAlertInput[]): number => {
    let added = 0;
    for (const r of items) {
      const res = insert.run({
        id: randomId("ra"),
        jobId,
        jobTitle,
        candidateId: r.candidateId,
        label: r.label,
        archetype: r.archetype,
        score: r.score,
        priorKind: r.prior.kind,
        priorLabel: r.prior.label,
        createdAt: now,
      });
      if (res.changes > 0) added += 1;
    }
    return added;
  });
  return tx(rows);
}

/** All un-dismissed alerts, newest (and within a timestamp, highest-scoring)
 *  first. Relevance (job still published, candidate not since pipelined) is
 *  filtered by the caller against live pipeline/job state — see
 *  filterRelevantAlerts. */
export function listRediscoveryAlerts(): RediscoveryAlert[] {
  const rows = db()
    .prepare(
      `SELECT id, job_id, job_title, candidate_id, candidate_label, archetype, score, prior_kind, prior_label, created_at
       FROM rediscovery_alerts
       WHERE dismissed_at IS NULL
       ORDER BY created_at DESC, score DESC`
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    jobId: r.job_id as string,
    jobTitle: r.job_title as string,
    candidateId: r.candidate_id as string,
    label: r.candidate_label as string,
    archetype: r.archetype as string,
    score: r.score as number,
    prior: { kind: r.prior_kind as string, label: r.prior_label as string },
    createdAt: r.created_at as string,
  }));
}

/** Dismiss one alert (guarded to a still-active row → res.changes===0 when it was
 *  already dismissed or never existed; returns whether it flipped). */
export function dismissRediscoveryAlert(id: string): boolean {
  const res = db()
    .prepare(`UPDATE rediscovery_alerts SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL`)
    .run(new Date().toISOString(), id);
  return res.changes > 0;
}
