import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

// Persisted store for interview-prep artifacts — one timed interview plan per
// pipeline entry (candidate × role), generated on accepted screening and opened
// from the Schedule tab. Uses its OWN better-sqlite3 connection to the shared DB
// file (WAL), mirroring group-eval.ts / dev-control.ts so it never touches the
// fork-churned db.ts.

const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  // Shares the kp.sqlite file with db.ts and the reminder heartbeat; busy_timeout
  // makes a concurrent writer wait briefly rather than instantly throwing
  // SQLITE_BUSY (mirrors db.ts).
  d.pragma("busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS interview_preps (
      entry_id TEXT PRIMARY KEY,
      candidate_label TEXT,
      job_title TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  _db = d;
  return d;
}

export type InterviewPrep = {
  entryId: string;
  candidateLabel: string | null;
  jobTitle: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export function saveInterviewPrep(entryId: string, candidateLabel: string | null, jobTitle: string | null, payload: Record<string, unknown>): void {
  db()
    .prepare(
      `INSERT INTO interview_preps (entry_id, candidate_label, job_title, payload_json, created_at)
       VALUES (@entry_id, @candidate_label, @job_title, @payload_json, @created_at)
       ON CONFLICT(entry_id) DO UPDATE SET
         candidate_label = excluded.candidate_label,
         job_title = excluded.job_title,
         payload_json = excluded.payload_json,
         created_at = excluded.created_at`
    )
    .run({
      entry_id: entryId,
      candidate_label: candidateLabel,
      job_title: jobTitle,
      payload_json: JSON.stringify(payload),
      created_at: new Date().toISOString(),
    });
}

export function getInterviewPrep(entryId: string): InterviewPrep | null {
  const row = db()
    .prepare(`SELECT entry_id, candidate_label, job_title, payload_json, created_at FROM interview_preps WHERE entry_id = ?`)
    .get(entryId) as { entry_id: string; candidate_label: string | null; job_title: string | null; payload_json: string; created_at: string } | undefined;
  if (!row) return null;
  try {
    return { entryId: row.entry_id, candidateLabel: row.candidate_label, jobTitle: row.job_title, payload: JSON.parse(row.payload_json), createdAt: row.created_at };
  } catch {
    return null;
  }
}

/** Which of the given entry ids already have a prep artifact. */
export function listPreparedEntries(entryIds: string[]): Record<string, string> {
  if (entryIds.length === 0) return {};
  const placeholders = entryIds.map(() => "?").join(",");
  const rows = db()
    .prepare(`SELECT entry_id, created_at FROM interview_preps WHERE entry_id IN (${placeholders})`)
    .all(...entryIds) as { entry_id: string; created_at: string }[];
  return Object.fromEntries(rows.map((r) => [r.entry_id, r.created_at]));
}
