import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";

// The apply funnel's DENOMINATOR. Every other record on the apply path is written
// only when a candidate SUCCEEDS — a pipeline entry on submit, a ko_declined event
// for someone who finished the questionnaire and failed a gate. The in-progress
// draft lives in the candidate's localStorage and never reaches the server. So the
// one number that says whether intake itself is the bottleneck — how many people
// started an application at all — did not exist anywhere, and abandonment was
// structurally invisible.
//
// One row per candidate per job attempt, minted by the client on first render and
// reused across reloads (the id is kept in localStorage beside the draft), so a
// refresh is not a second start. `entry_id` is back-linked when the submission
// creates the entry: rows with a NULL entry_id after their window are the
// abandonment.
//
// Isolated-connection store (same pattern as offers-store.ts / job-ingest.ts): its
// own better-sqlite3 handle on the shared kp.sqlite file, WAL-safe, so it never
// touches the fork-churned db.ts connection.

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS apply_sessions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      -- 'chat' (the conversational flow) | 'quick' (the short form). Kept so the
      -- two intake surfaces can be compared rather than averaged together.
      flow TEXT NOT NULL,
      started_at TEXT NOT NULL,
      -- The pipeline entry this attempt became; NULL = started and never filed.
      entry_id TEXT,
      -- Campaign attribution, so a channel's abandonment is separable from its volume.
      campaign TEXT,
      variant TEXT,
      workspace_id TEXT NOT NULL DEFAULT 'workspace'
    );
    CREATE INDEX IF NOT EXISTS idx_apply_sessions_job ON apply_sessions (job_id);
    CREATE INDEX IF NOT EXISTS idx_apply_sessions_started ON apply_sessions (started_at);
  `);
  _db = d;
  return d;
}

export type ApplySessionFlow = "chat" | "quick";

/** Record that a candidate opened an application. Idempotent on `id`: the client
 *  keeps one id per (job, attempt) in localStorage and re-POSTs it after a reload,
 *  which must not inflate the denominator — so a repeat start is ignored rather
 *  than counted or treated as an error. */
export function startApplySession(input: {
  id: string;
  jobId: string;
  flow: ApplySessionFlow;
  campaign?: string | null;
  variant?: string | null;
  workspaceId?: string;
}): void {
  db()
    .prepare(
      `INSERT INTO apply_sessions (id, job_id, flow, started_at, campaign, variant, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(
      input.id,
      input.jobId,
      input.flow,
      new Date().toISOString(),
      input.campaign ?? null,
      input.variant ?? null,
      input.workspaceId ?? DEFAULT_WORKSPACE_ID
    );
}

/** Back-link a completed application to the attempt that produced it. Best-effort
 *  by design: the application has already been filed by the time this runs, so a
 *  bookkeeping failure must never turn a successful submission into an error — it
 *  only makes that one attempt look abandoned. */
export function linkApplySession(sessionId: string | null | undefined, entryId: string): void {
  if (!sessionId) return;
  try {
    db().prepare(`UPDATE apply_sessions SET entry_id = ? WHERE id = ? AND entry_id IS NULL`).run(entryId, sessionId);
  } catch (err) {
    console.error(`[apply-session] could not link ${sessionId} → ${entryId}:`, err instanceof Error ? err.message : err);
  }
}

/** KPI "Candidate apply-to-pipeline rate": % of attempts started in the window
 *  that reached a filed pipeline entry. `windowDays` bounds the cohort; attempts
 *  younger than `graceHours` are excluded because a candidate mid-application is
 *  not an abandonment yet — counting them would drag the rate down by however
 *  fast you happen to read it. */
export function applyToPipelineRate(
  windowDays = 30,
  graceHours = 24,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { started: number; filed: number; ratePct: number | null; byFlow: Record<string, { started: number; filed: number }> } {
  const rows = db()
    .prepare(
      `SELECT flow, entry_id FROM apply_sessions
        WHERE workspace_id = ?
          AND started_at >= datetime('now', ?)
          AND started_at <= datetime('now', ?)`
    )
    .all(workspaceId, `-${Math.max(1, Math.floor(windowDays))} days`, `-${Math.max(0, Math.floor(graceHours))} hours`) as {
    flow: string;
    entry_id: string | null;
  }[];
  const byFlow: Record<string, { started: number; filed: number }> = {};
  let filed = 0;
  for (const r of rows) {
    const b = (byFlow[r.flow] ??= { started: 0, filed: 0 });
    b.started += 1;
    if (r.entry_id) {
      b.filed += 1;
      filed += 1;
    }
  }
  // null rather than 0 on an empty cohort: "no one applied yet" and "everyone
  // abandoned" are different facts and must not render as the same number.
  return { started: rows.length, filed, ratePct: rows.length ? Math.round((filed / rows.length) * 1000) / 10 : null, byFlow };
}
