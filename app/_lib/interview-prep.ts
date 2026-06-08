import Database from "better-sqlite3";
import { DB_PATH, ensureDbDir } from "./db-path";
import { chunk, SQL_IN_CHUNK } from "./entries-param";
import type { Scorecard } from "./interview-scorecard";

// Persisted store for interview-prep artifacts — one timed interview plan per
// pipeline entry (candidate × role), generated on accepted screening and opened
// from the Schedule tab. Uses its OWN better-sqlite3 connection to the shared DB
// file (WAL), mirroring group-eval.ts / dev-control.ts so it never touches the
// fork-churned db.ts.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  ensureDbDir();
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

// The interviewer's working state on a prep guide (PREP2): which coverage items
// are ticked + free-text notes (the verbatim quotes the rubric asks for). Stored
// UNDER a reserved `userProgress` key inside the artifact payload so it rides the
// same row without a schema change and the generated plan (scenario/chronology/…)
// stays untouched.
export type InterviewPrepProgress = { checked?: Record<string, boolean>; notes?: string };

/** Merge the interviewer's checklist + notes into an EXISTING prep artifact,
 *  preserving the generated plan AND `created_at` (a progress save is not a
 *  regeneration — `listPreparedEntries`/the "generated NN ago" stamp must not
 *  move). Returns false when there's no artifact to attach progress to (the prep
 *  must be generated first). Writes only `payload_json`. */
export function saveInterviewPrepProgress(entryId: string, progress: InterviewPrepProgress): boolean {
  const existing = getInterviewPrep(entryId);
  if (!existing) return false;
  const payload = { ...existing.payload, userProgress: progress };
  const res = db()
    .prepare(`UPDATE interview_preps SET payload_json = ? WHERE entry_id = ?`)
    .run(JSON.stringify(payload), entryId);
  return res.changes > 0;
}

/** Persist the recruiter's human-filled scorecard (PREP1) onto an EXISTING prep
 *  artifact, under a reserved `humanScorecard` key in the payload — same seam as
 *  saveInterviewPrepProgress, so no schema change and the generated plan +
 *  created_at are untouched. Always tagged source:"human". Returns false when
 *  there's no prep to attach to (the scorecard is filled from the prep modal, so
 *  one always exists in practice). */
export function saveHumanScorecard(entryId: string, scorecard: Scorecard): boolean {
  const existing = getInterviewPrep(entryId);
  if (!existing) return false;
  const payload = { ...existing.payload, humanScorecard: { ...scorecard, source: "human" as const } };
  const res = db()
    .prepare(`UPDATE interview_preps SET payload_json = ? WHERE entry_id = ?`)
    .run(JSON.stringify(payload), entryId);
  return res.changes > 0;
}

/** The human scorecard saved on an entry's prep artifact, if any (PREP1). Read by
 *  surfaces that show interview results so a human-led round isn't invisible. */
export function getHumanScorecard(entryId: string): Scorecard | null {
  const prep = getInterviewPrep(entryId);
  const sc = (prep?.payload as { humanScorecard?: Scorecard } | undefined)?.humanScorecard;
  return sc ?? null;
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

/** Which of the given entry ids already have a prep artifact. The IN query is
 *  chunked under the SQLite variable limit so a wide board never trips
 *  SQLITE_MAX_VARIABLE_NUMBER (idea-191ccc0c). */
export function listPreparedEntries(entryIds: string[]): Record<string, string> {
  if (entryIds.length === 0) return {};
  const out: Record<string, string> = {};
  for (const ids of chunk(entryIds, SQL_IN_CHUNK)) {
    const placeholders = ids.map(() => "?").join(",");
    const rows = db()
      .prepare(`SELECT entry_id, created_at FROM interview_preps WHERE entry_id IN (${placeholders})`)
      .all(...ids) as { entry_id: string; created_at: string }[];
    for (const r of rows) out[r.entry_id] = r.created_at;
  }
  return out;
}
