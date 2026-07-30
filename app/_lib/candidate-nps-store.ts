import { ensureDb } from "./db/core";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { summarizeNps, type NpsSummary } from "./candidate-nps";

// W0.6b — storage for candidate NPS. The scoring/validation rules are pure and live in
// candidate-nps.ts; this file only reads and writes.
//
// One row per entry (entry_id is the primary key), so the token holder can answer once
// and change their mind, but cannot inflate their own outcome by submitting repeatedly.

/** Record (or replace) a candidate's response. Score/comment must already be validated
 *  by parseNpsSubmission — this writes what it is given. */
export function recordCandidateNps(
  entryId: string,
  score: number,
  comment: string | null,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): void {
  ensureDb()
    .prepare(
      `INSERT INTO candidate_nps (entry_id, score, comment, created_at, workspace_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(entry_id) DO UPDATE SET score = excluded.score, comment = excluded.comment, created_at = excluded.created_at`
    )
    .run(entryId, score, comment, new Date().toISOString(), workspaceId);
}

/** Has this application already answered? Drives the status page's "thanks" state, so a
 *  candidate is not asked the same question on every poll. */
export function candidateNpsFor(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): { score: number; comment: string | null } | null {
  const row = ensureDb()
    .prepare(`SELECT score, comment FROM candidate_nps WHERE entry_id = ? AND workspace_id = ?`)
    .get(entryId, workspaceId) as { score: number; comment: string | null } | undefined;
  return row ?? null;
}

/** Workspace summary, optionally windowed to the last `days` — matching how every other
 *  analytics figure is scoped. */
export function candidateNpsSummary(days: number | null = null, workspaceId: string = DEFAULT_WORKSPACE_ID): NpsSummary {
  const params: unknown[] = [workspaceId];
  let sql = `SELECT score FROM candidate_nps WHERE workspace_id = ?`;
  if (days != null) {
    sql += ` AND created_at >= ?`;
    params.push(new Date(Date.now() - days * 86_400_000).toISOString());
  }
  const rows = ensureDb().prepare(sql).all(...params) as { score: number }[];
  return summarizeNps(rows.map((r) => r.score));
}

/** Recent free-text comments, newest first — the qualitative half a bare score hides.
 *  Bounded so a caller cannot pull the whole table into a response. */
export function recentCandidateNpsComments(limit = 10, workspaceId: string = DEFAULT_WORKSPACE_ID): { score: number; comment: string; createdAt: string }[] {
  return (
    ensureDb()
      .prepare(
        `SELECT score, comment, created_at FROM candidate_nps
         WHERE workspace_id = ? AND comment IS NOT NULL AND comment != ''
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(workspaceId, Math.min(50, Math.max(1, limit))) as { score: number; comment: string; created_at: string }[]
  ).map((r) => ({ score: r.score, comment: r.comment, createdAt: r.created_at }));
}
